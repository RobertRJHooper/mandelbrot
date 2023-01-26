"use strict";

importScripts(
  'https://cdnjs.cloudflare.com/ajax/libs/mathjs/11.5.0/math.js',
  'https://cdnjs.cloudflare.com/ajax/libs/lodash.js/4.17.21/lodash.min.js',
  'model.js'
);


// minmum period between image posts
const frameThrottlePeriod = 250;

// grid class representing a square of the set
class Panel extends MandelbrotGrid {
  static width = 32;

  constructor(center, zoom, step, offset) {
    super(center, zoom, Panel.width, Panel.width, step, offset);
    this.iteration = 0;
    this.dirty = true;
  }

  async getBitmap() {
    this.dirty = false;
    return await createImageBitmap(this.image);
  }

  iterate() {
    const ret = super.iterate();
    this.iteration += 1;
    this.dirty |= ret;
    return this.dirty;
  }
}

class Panels {
  constructor(zoom, step, offset) {
    this.zoom = zoom;
    this.step = step;
    this.offset = offset;

    // storage for all cached frames
    this.panels = new Map();

    // current center point and panels around it
    this.center = null;
    this.visiblePanels = [];

    // limiters
    this.pause = false;
    this.iteration = 0;
    this.iterationsLimit = 3000;

    this.frameBudget = 0;
    this.frameTime = null;
  }

  // set panels around the point that cover width and height
  setCenter(center, width, height) {
    const { zoom, step, offset } = this;

    // save current point
    this.center = center;

    // total view box in units of panels about origin
    const pCenter = divide(multiply(center, zoom), Panel.width);
    const pWidth = width / Panel.width;
    const pHeight = height / Panel.width;

    // viewbox in panels
    const xMin = floor(pCenter.re - pWidth / 2);
    const xMax = ceil(pCenter.re + pWidth / 2);
    const yMin = floor(pCenter.im - pHeight / 2);
    const yMax = ceil(pCenter.im + pHeight / 2);

    // get panels from the cache of create new ones
    const visiblePanels = [];

    for (let panelX = xMin; panelX < xMax; panelX++) {
      for (let panelY = yMin; panelY < yMax; panelY++) {
        const key = `${panelX} ${panelY} ${step} ${offset}`;
        let panel = this.panels.get(key);

        // create panel if it is not already in the cache
        if (typeof panel == "undefined") {
          const panelCenter = complex(
            (panelX + 0.5) / zoom * Panel.width,
            (panelY + 0.5) / zoom * Panel.width,
          );

          panel = new Panel(panelCenter, zoom, step, offset);
          panel.initiate();
          panel.key = key;

          // canvas coordinates of bottom left
          // on the canvas Y-axis increasing is downwards (multiple panelY by -1)
          // and the box is painted downwards (add 1 to panelY)
          panel.canvasX = panelX * Panel.width;
          panel.canvasY = -1 * (panelY + 1) * Panel.width;
          this.panels.set(key, panel);
        }

        visiblePanels.push(panel);
      }
    }

    // diagnostics
    console.debug('visible panels selected', visiblePanels.length);

    // state
    this.visiblePanels = visiblePanels;
    this.iteration = 0;
  }

  // iterate all current panels
  iterate() {
    for (let panel of this.panels.values()) {
      if (panel.iteration <= this.iterationsLimit) {
        if (panel.iterate()) {
          this.dirty = true;
        }
      }
    }
    this.iteration += 1;
  }

  // post updates for visible panels
  async post(timestamp) {
    const dirtyPanels = this.visiblePanels.filter(p => p.dirty);

    // no dirty panels to send
    if(!dirtyPanels.length) {
      return null;
    }

    // diagnostics
    console.debug('posting frame of dirty panels', dirtyPanels.length, 'of', this.visiblePanels.length);
    
    // generate all bitmaps asyncronously
    const bitmaps = await Promise.all(dirtyPanels.map(p => p.getBitmap()));

    // put together panels with meta info
    let snaps = [];

    for (let [panel, bitmap] of _.zip(dirtyPanels, bitmaps)) {
      snaps.push({
        key: panel.key,
        canvasX: panel.canvasX,
        canvasY: panel.canvasY,
        bitmap: bitmap,
      });
    }

    // counters
    this.frameBudget -= 1;
    this.frameTime = timestamp;

    // send to master
    postMessage({
      zoom: this.zoom,
      snaps: snaps,

      offset: this.offset,
      step: this.step,
    }, snaps.map(s => s.bitmap));

    // return signally something was sent
    return true;
  }

  // check if frame issue throttling is applying now
  isFrameThrottled(timestamp) {
    const { frameBudget, frameTime } = this;

    if (frameBudget <= 0) {
      return true;
    }

    if (frameTime) {
      if (timestamp < frameTime + frameThrottlePeriod) {
        return true;
      }
    }

    return false;
  }
}

// current frame controller
var currentPanels = null;

// incoming message handler
onmessage = function (e) {
  switch (e.data.command) {
    case 'zoom': {
      const { zoom, step, offset } = e.data;
      console.debug('setting up worker with zoom level', zoom, 'step', step, 'offset', offset);

      currentPanels = new Panels(
        zoom,
        step,
        offset
      );
      break;
    }

    case 'center': {
      const { center, width, height } = e.data;
      const panels = currentPanels;
      console.debug('setting center in worker', center);
      
      if (!panels) {
        console.error('zoom level not setup yet while setting center');
        break;
      }

      panels.setCenter(
        complex(center),
        width,
        height
      );
      break;
    }

    case 'limit': {
      const panels = currentPanels;

      // nothing yet initiated
      if (!panels) {
        console.warning('limit command ignored becaue there are no current panels')
        break;
      }

      const { frameBudget, iterationsLimit, pause } = e.data;

      if (typeof frameBudget != "undefined") {
        panels.frameBudget = frameBudget;
      }

      if (typeof iterationsLimit != "undefined") {
        panels.iterationsLimit = iterationsLimit;
      }

      if (typeof pause != "undefined") {
        panels.pause = pause;
      }

      break;
    }

    default:
      throw new Error(`unknown worker command "${e.data.command}" received`);
  }
}

// work loop. returns true iff some work was done.
async function loop() {
  const panels = currentPanels;

  // nothing to do
  if (!panels) {
    return false;
  }

  // decide if was can send panels to master
  const timestamp = Date.now();
  const throttled = panels.isFrameThrottled(timestamp);

  // post a frame of panels to the master
  if (!throttled) {
    if(await panels.post(timestamp)) {
      return true;
    }
  }


  // iterate points in each panel
  if (!panels.pause && panels.iteration < panels.iterationsLimit) {
    panels.iterate();
    return true;
  }

  // nothing done
  return false;
}

async function runLoop() {
  const worked = await loop();
  setTimeout(runLoop, worked ? 0 : 100);
}
runLoop();