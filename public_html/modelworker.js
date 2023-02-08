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
  constructor(key, panelX, panelY, zoom, length) {
    const { N, mul, div, add, sub } = Arithmetic;

    const panelLengthComplexPlane = div(length, zoom);
    const halfPanelLengthComplexPlane = div(panelLengthComplexPlane, 2);

    // demote BigInt to arithmetic precision
    const panelX_ = N(panelX);
    const panelY_ = N(panelY);

    // center of the panel in pixels
    const pixel_re = add(mul(length, panelX_), halfPanelLengthComplexPlane);
    const pixel_im = add(mul(length, panelY_), halfPanelLengthComplexPlane);

    // center of the panel in complex coordinates
    const center_re = div(pixel_re, zoom);
    const center_im = div(pixel_im, zoom);

    // set up grid
    super(center_re, center_im, zoom, length, length);
    this.dirty = false;

    // snap template
    this.snapTemplate = {
      key: key,
      panelX: panelX.toString(),
      panelY: panelY.toString(),
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

    // limiters
    this.frameTime = 0;
    this.timeToIdle = 0;
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
        panel = new Panel(key, panelX, panelY, this.zoom, this.panelLength);
        panel.initiate();
        this.panels.set(key, panel);
      }

      this.activePanels.push(panel);
    }
  }

  /* determine active panel coordinates around a center */
  getPanelsForView(center_re, center_im, width, height, step, offset) {
    const { demote, mul, div, add, sub, floor, mod } = Arithmetic;
    const { zoom, panelLength } = this;

    // panel length on complex plane
    const panelLengthComplexPlane = div(panelLength, zoom);

    // center in units of panel lengths
    const center_pre = div(center_re, panelLengthComplexPlane);
    const center_pim = div(center_im, panelLengthComplexPlane);

    // total view box in units of panel lengths about origin divided by two
    const halfWidthInPanels = div(div(width, panelLength), 2);
    const halfHeightInPanels = div(div(height, panelLength), 2);

    // viewbox lower bounds in units of panel lengths
    const xMin = floor(sub(center_pre, halfWidthInPanels));
    const yMin = floor(sub(center_pim, halfHeightInPanels));

    // determine modulo offset of bounding panels
    const offset0 = demote(mod(add(xMin, yMin), step));

    // width and height of the view in panels
    // rounding up and adding one means the view is covered in worst case
    const widthInPanels = Math.ceil(width / panelLength) + 1;
    const heightInPanels = Math.ceil(height / panelLength) + 1;

    // generate keys - got to be careful to avoid infinite loop
    // when rounding on huge numbers means add(xMin, i) == xMin
    // when the precision has expired
    const out = [];

    for (let j = 0; j < heightInPanels; j++) {
      const panelY = add(yMin, j);

      for (let i = 0; i < widthInPanels; i++) {

        // multi worker striping
        if ((offset0 + i + j - offset) % step)
          continue;

        const panelX = add(xMin, i);
        out.push([panelX, panelY]);
      }
    }

    return out;
  }

  // iterate all current panels
  iterate() {
    for (const panel of this.activePanels) panel.iterate();
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
        N(zoom),
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
      const N = Arithmetic.Number;

      // get visible panel keys
      console.debug('setting center', center_re, center_im);

      const active = panels.getPanelsForView(
        N(center_re),
        N(center_im),
        width,
        height,
        step,
        offset
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