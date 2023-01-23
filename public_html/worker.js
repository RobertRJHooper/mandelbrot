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

  constructor(center, resolution, step, offset) {
    super(center, resolution, Panel.width, Panel.width, step, offset);
    this.iteration = 0;
  }

  async getBitmap() {
    return await createImageBitmap(this.image);
  }

  iterate() {
    super.iterate();
    this.iteration += 1;
  }
}

class Panels {
  constructor(originX, originY, resolution, step, offset) {
    this.originX = originX;
    this.originY = originY;
    this.resolution = resolution;
    this.step = step;
    this.offset = offset;

    // storage for all cached frames
    this.allPanels = {};

    // current point and frames around it
    this.workReference = null;
    this.pointX = null;
    this.pointY = null;
    this.panels = null;

    // limiters
    this.pause = false;
    this.dirty = true; // new pixels exist to send to master
    this.iteration = 0;
    this.iterationsLimit = 3000;
    this.frameIndex = 0;
    this.frameLimit = 5;
    this.frameIteration = 0;
    this.frameTime = null;
  }

  // can we use this instance for a give point
  isCompatible(pointX, pointY, resolution, step, offset) {
    return this.resolution == resolution
      && this.step == step
      && this.offset == offset;
  }

  // frames around the point that cover
  setPoint(workReference, pointX, pointY, width, height) {
    const { originX, originY, resolution } = this;

    // save current point
    this.workReference = workReference;
    this.pointX = pointX;
    this.pointY = pointY;

    // view box in pixels about origin point
    const xMin = (pointX - originX) * resolution - width / 2;
    const xMax = (pointX - originX) * resolution + width / 2;
    const yMin = (pointY - originY) * resolution - height / 2;
    const yMax = (pointY - originY) * resolution + height / 2;

    // viewbox in panels
    const pxMin = Math.floor(xMin / Panel.width);
    const pxMax = Math.ceil(xMax / Panel.width);
    const pyMin = Math.floor(yMin / Panel.width);
    const pyMax = Math.ceil(yMax / Panel.width);

    // get panels from the cache of create new ones
    const panels = [];

    for (let panelX = pxMin; panelX < pxMax; panelX++) {
      for (let panelY = pyMin; panelY < pyMax; panelY++) {
        const key = `${panelX} ${panelY}`;
        let panel = this.allPanels[key];

        // create panel if it is not already in the cache
        if (typeof panel == "undefined") {
          const centre = math.complex(
            this.originX + (panelX + 0.5) * Panel.width / this.resolution,
            this.originY + (panelY + 0.5) * Panel.width / this.resolution,
          );

          this.allPanels[key] = panel = new Panel(centre, this.resolution, this.step, this.offset);
          panel.initiate();
          panel.key = key;
          panel.panelX = panelX;
          panel.panelY = panelY;
        }

        panels.push(panel);
      }
    }

    // state
    this.panels = panels;
    this.dirty = true;
    this.iteration = 0;
    this.frameIndex = 0;
    this.frameIteration = 0;
    this.frameTime = null;
  }

  // iterate all current panels
  iterate() {
    for (let panel of this.panels) {
      if (panel.iteration <= this.iterationsLimit) {
        if (panel.iterate()) {
          this.dirty = true;
        }
      }
    }
    this.iteration += 1;
  }

  // post updates for current frames
  async post(timestamp) {

    // panels to send - at the moment send all - could filter to changed ones
    const dirty = this.panels;

    // generate all bitmaps asyncronously
    const bitmaps = await Promise.all(dirty.map(p => p.getBitmap()));

    // pixel offset of origin from the point
    const xOffset = Math.round((this.originX - this.pointX) * this.resolution);
    const yOffset = Math.round((this.originY - this.pointY) * this.resolution);
    
    // put together panels with meta info
    let snaps = [];
    for (let [panel, bitmap] of _.zip(dirty, bitmaps)) {
      snaps.push({
        bitmap: bitmap,

        // top left corner coordinates in pixels relative to selected point
        x: xOffset + panel.panelX * Panel.width,
        y: yOffset + panel.panelY * Panel.width,
      });
    }

    // counters
    this.frameIndex += 1;
    this.frameIteration = this.iteration;
    this.frameTime = timestamp;

    // send to master
    postMessage({
      workReference: this.workReference,
      index: this.frameIndex,
      iteration: this.frameIteration,
      snaps: snaps,
    }, snaps.map(s => s.bitmap));
  }

  // check if frame issue throttling is applying now
  isFrameThrottled(timestamp) {
    const { frameIndex, frameLimit, frameTime } = this;

    if (frameIndex >= frameLimit) {
      return true;
    }

    if (frameTime && (timestamp < frameTime + frameThrottlePeriod)) {
      return true;
    }

    return false;
  }
}

// current frame server
var currentPanels = null;

// incoming message handler
onmessage = function (e) {
  switch (e.data.command) {
    case 'point': {
      const { workReference, pointX, pointY, resolution, width, height, step, offset } = e.data;

      // get the frame server one way or another
      let panels;

      if (currentPanels && currentPanels.isCompatible(pointX, pointY, resolution, step, offset)) {
        console.debug(workReference, 'reusing current panels');
        panels = currentPanels;
      } else {
        console.debug(workReference, 'no panels to reuse, starting from scratch');

        // use the selected point as origin
        panels = new Panels(pointX, pointY, resolution, step, offset);
        currentPanels = panels;
      }

      // set current point
      panels.setPoint(workReference, pointX, pointY, width, height);
      break;
    }

    case 'limit': {
      const panels = currentPanels;

      // nothing yet initiated
      if (!panels) {
        console.warning('limit command ignored becaue there are no current panels')
        break;
      }

      const { frameLimit, iterationsLimit, pause } = e.data;

      if (typeof frameLimit != "undefined") {
        panels.frameLimit = Math.max(frameLimit, panels.frameLimit);
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
      throw new ValueError('unknown worker command received', command);
  }
}

// work loop. returns true iff some work was done.
async function loop() {
  const panels = currentPanels;

  // nothing to do
  if (!panels) {
    return false;
  }

  // post a frame to master if required
  if (panels.dirty) {
    const timestamp = Date.now();

    if (!panels.isFrameThrottled(timestamp)) {
      await panels.post(timestamp);
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