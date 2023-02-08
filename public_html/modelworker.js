"use strict";

importScripts(
  'lib/lodash.min.js',
  'lib/decimal.js',
  'arithmetic.js',
  'model.js'
);

// minmum period between image posts
const frameThrottlePeriod = 250;

// current Arithmetic system in use (depending on precision required)
var Arithmetic;

// current frame controller
var currentPanels;

// grid class representing a square of the set
class Panel extends MandelbrotGrid {
  constructor(panelX, panelY, zoom, length) {
    const { N, mul, div, add, sub } = Arithmetic;

    const lengthN = BigInt(length);
    const pixelX = panelX * lengthN;
    const pixelY = panelY * lengthN;
    
    // center of the panel in complex coordinates
    const halfPanelLengthInComplexPlane = div(div(length, zoom), 2);
    const center_re = add(div(N(pixelX), zoom), halfPanelLengthInComplexPlane);
    const center_im = add(div(N(pixelY), zoom), halfPanelLengthInComplexPlane);

    // set up grid
    super(center_re, center_im, zoom, length, length);
    this.dirty = false;

    // snap template
    this.snapTemplate = {
      panelX: panelX,
      panelY: panelY,
      length: length,
    }
  }

  // create a snapshot and clear dirty flag
  async snap() {
    const bitmap = await createImageBitmap(this.image);
    this.dirty = false;

    return {
      ...this.snapTemplate,
      bitmap: bitmap,
    };
  }

  iterate() {
    if (super.iterate()) this.dirty = true;
  }
}

class Panels {
  constructor(setupReference, zoom, precision, panelLength) {
    this.setupReference = setupReference;
    this.zoom = zoom;
    this.precision = precision;

    // width and height of each panel in pixels
    this.panelLength = panelLength;

    // storage for all cached frames
    this.panels = new Map();

    // active panels that this worker is currently working on
    this.activePanels = [];

    // limiters and counter
    this.frameTime = 0;
    this.timeToIdle = 0;
    this.iterations = 0;
  }

  /*
  Set the active panels based on an iterable of keys.
  The key is also the coordinates in units of panels on the
  imaginary plane
  */
  setActivePanels(coordinates) {
    this.activePanels = [];

    for (const [panelX, panelY] of coordinates) {
      const key = `${panelX} ${panelY}`;
      let panel = this.panels.get(key);

      // create new one
      if (!panel) {
        panel = new Panel(panelX, panelY, this.zoom, this.panelLength);
        panel.initiate();
        this.panels.set(key, panel);
      }

      this.activePanels.push(panel);
    }
  }

  /* determine active panel coordinates around a center */
  getPanelsForView(center_re, center_im, width, height, step, offset) {
    const { toBigInt, mul, div, add, sub, floor, mod } = Arithmetic;
    const { zoom, panelLength } = this;

    // center panel coordinates in units of panel lengths
    const centerX = toBigInt(floor(mul(div(center_re, panelLength), zoom)));
    const centerY = toBigInt(floor(mul(div(center_im, panelLength), zoom)));

    // width and height of the view in panels either side of the center
    // rounding up means the view is always covered in worst case
    const xPanels = BigInt(Math.ceil((width / panelLength + 1) / 2));
    const yPanels = BigInt(Math.ceil((height / panelLength + 1) / 2));

    // viewbox lower bounds in units of panel lengths
    const xMin = centerX - xPanels;
    const yMin = centerY - yPanels;
    const xMax = centerX + xPanels;
    const yMax = centerY + yPanels;

    const out = [];
    for (let panelX = xMin; panelX <= xMax; panelX++) {
      for (let panelY = yMin; panelY <= yMax; panelY++) {
        if ((panelX + panelY - offset) % step) continue; // multi-worker striping
        out.push([panelX, panelY]);
      }
    }

    return out;
  }

  // iterate all current panels
  iterate() {
    for (const panel of this.activePanels) panel.iterate();
    this.iterations += 1;
  }

  // post updates for visible panels
  async post() {
    const dirtyPanels = this.activePanels.filter(p => p.dirty);

    // no dirty panels to send
    if (!dirtyPanels.length) return false;

    // generate snap bitmaps
    const snaps = await Promise.all(dirtyPanels.map(p => p.snap()));
    console.debug('posting frame of dirty panels', dirtyPanels.length, 'of', this.activePanels.length);

    postMessage({
      setupReference: this.setupReference,
      iterations: this.iterations,
      snaps: snaps,
    }, snaps.map(s => s.bitmap).filter(s => s));

    // return signaling something was sent
    return true;
  }
}

// incoming message handler
onmessage = function (e) {
  switch (e.data.command) {
    case 'setup': {
      const { setupReference, zoom, panelLength, precision } = e.data;
      console.debug('setting up with reference', setupReference);

      // first setup the arithmetic structure used by worker
      console.debug('setting arithmetic precision', precision);
      Arithmetic = getArithmetic(precision);

      // set up panels controoler
      console.debug('setting zoom', zoom)
      console.debug('setting panelLength', panelLength);

      const N = Arithmetic.Number;
      currentPanels = new Panels(
        setupReference,
        Arithmetic.N(zoom),
        precision,
        panelLength
      );

      break;
    }

    case 'view': {
      const panels = currentPanels;

      if (!panels) {
        console.warn('not setup with setting view');
        break;
      }

      const { center_re, center_im, width, height, step, offset } = e.data;

      // get visible panel keys
      console.debug('setting center', center_re, center_im);

      const active = panels.getPanelsForView(
        Arithmetic.N(center_re),
        Arithmetic.N(center_im),
        width,
        height,
        BigInt(step),
        BigInt(offset)
      );

      // set visible panels for calculation
      console.debug('setting active panels numbering', active.length);
      panels.setActivePanels(active);
      break;
    }

    case 'limit': {
      const panels = currentPanels;

      if (!panels) {
        console.warn('limit command ignored while worker not setup')
        break;
      }

      // update time to run iterations to
      panels.timeToIdle = e.data.timeToIdle;
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
  if (!panels) return false;

  // work throttle
  const timestamp = Date.now();
  if (panels.timeToIdle < timestamp) return false;

  // post a frame of panels to the master
  if (timestamp > panels.frameTime + frameThrottlePeriod) {
    if (await panels.post(timestamp)) {
      panels.frameTime = timestamp;
      return true;
    }
  }

  // iterate points in each panel
  //console.time('iterate');
  panels.iterate();
  //console.timeEnd('iterate');
  return true;
}

async function runLoop() {
  const workDone = await loop();
  const pause = workDone ? 0 : 250;
  setTimeout(runLoop, pause);
}
runLoop();