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

// current running work
const current = {};

// incoming message handler
onmessage = function (e) {
  switch (e.data.command) {
    case 'setup': {
      current.setup = e.data;
      current.dirtySetup = true;
      break;
    }

    case 'view': {
      current.view = e.data;
      current.dirtyView = true;
      break;
    }

    case 'limit': {
      current.timeToIdle = e.data.timeToIdle;
      break;
    }

    default:
      throw new Error(`unknown worker command "${e.data.command}" received`);
  }
}

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

    // snap template
    this.snapTemplate = {
      panelX: panelX,
      panelY: panelY,
      length: length,
    }

    // when the panel image has been updated and not posted yet
    this.dirty = false;
  }

  initiate() {
    super.initiate();
    this.dirty = this.live.length != this.width * this.height;
  }

  iterate() {
    const liveCount = this.live.length;
    super.iterate();

    // dirty if a point has been determined and stops being live
    if (liveCount != this.live.length) this.dirty = true;
  }

  // create a snapshot bitmap. clears dirty flag
  async snap() {
    const bitmap = await createImageBitmap(this.image);
    this.dirty = false;

    return {
      ...this.snapTemplate,
      bitmap: bitmap,
    };
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

    // counter
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

// work loop. returns true iff some work was done.
async function loop() {

  // setup the worker from the global configuation
  if (current.dirtySetup) {
    current.dirtySetup = false;

    const { setupReference, zoom, panelLength, precision } = current.setup;
    console.debug('setting up with reference', setupReference);

    // first setup the arithmetic structure used by worker
    console.debug('setting arithmetic precision', precision);
    Arithmetic = getArithmetic(precision);

    // set up panels controller
    console.debug('setting zoom', zoom)
    console.debug('setting panelLength', panelLength);

    current.panels = new Panels(
      setupReference,
      Arithmetic.N(zoom),
      precision,
      panelLength
    );

    return true;
  }

  // nothing to do if nothing is set up
  if (!current.panels)
    return false;

  // setup view
  if (current.dirtyView) {
    current.dirtyView = false;

    const panels = current.panels;
    if (!panels) {
      console.warn('not setup with setting view');
      return true;
    }

    const { center_re, center_im, width, height, step, offset } = current.view;
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

    // make sure first issue of panels can go without pause
    current.frameTime = 0;
    return true;
  }

  // don't do any work if the time limit has been reached
  const timestamp = Date.now();

  if (current.timeToIdle < timestamp)
    return false;

  // post dirty panels to the master
  if (timestamp > current.frameTime + frameThrottlePeriod) {
    const somethingSent = await current.panels.post(timestamp);

    if (somethingSent) {
      current.frameTime = timestamp;
      return true;
    }
  }

  // iterate points in each panel
  current.panels.iterate();
  return true;
}

async function runLoop() {
  const workDone = await loop();
  const pause = workDone ? 0 : 250;
  setTimeout(runLoop, pause);
}
runLoop();