"use strict";

importScripts(
  'lib/lodash.min.js',
  'lib/decimal.js',
  'arithmetic.js',
  'colours.js',
  'mandelbrot.js',
  'panels.js'
);

// multi-precision arithmetic currently in use
var Arithmetic = null;

// instances representing known areas of complex plane inside mbs
// each instance has a function test(re, im) to check a point
// this must be refreshed if the Arithmetic global is updated
var mbKnownRegions = null;

// minmum period between image posts
var frameThrottlePeriod = 250;

// current running work
var current = {};

// setup arithmetic, panels controller, etc
function setup() {
  const { reference, zoom, precision } = current.setup;
  console.debug('setting up with reference', reference);
  current.reference = reference;

  // first setup the arithmetic structure used by worker
  console.debug('setting arithmetic precision', precision);
  Arithmetic = getArithmetic(precision);
  mbKnownRegions = getKnownRegions();

  // set up panels controller
  console.debug('setting zoom', zoom)
  current.panels = new Panels(Arithmetic.N(zoom));
}

// set current view
function setView() {
  const panels = current.panels;

  if (!panels) {
    console.warn('not setup with setting view');
    return;
  }

  const { re, im, width, height, step, offset } = current.view;
  console.debug('setting view at', re, im);
  console.debug('setting view width', width);
  console.debug('setting view height', height);

  const active = panels.getPanelsForView(
    Arithmetic.N(re),
    Arithmetic.N(im),
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
}

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

// work loop. returns true iff some work was done.
async function loop() {

  // setup the worker from the global configuation
  if (current.dirtySetup) {
    current.dirtySetup = false;
    setup();
    return true;
  }

  // nothing to do if nothing is set up
  if (!current.panels)
    return false;

  // setup view
  if (current.dirtyView) {
    current.dirtyView = false;
    setView();
    return true;
  }

  // get timestamp to throttle sending updates and iterating points
  const timestamp = Date.now();
  const active = current.timeToIdle > timestamp;

  // post dirty panels to the master
  if (active && timestamp > current.frameTime + frameThrottlePeriod) {
    const statistics = {
      iteration: current.panels.iteration,
    };

    // post statistics
    postMessage({
      reference: current.reference,
      statistics: statistics,
    });

    // post panel updates
    const snapshots = await current.panels.flush();
    if (snapshots.length) {
      postMessage({
        reference: current.reference,
        snapshots: snapshots,
      },
        snapshots.map(s => s.bitmap)
      );

      // update throttling information
      current.frameTime = timestamp;
      return true;
    }
  }

  // iterate points in each active panel
  if (active) {
    current.panels.iterate();
    return true;
  }

  // nothing to do
  return false;
}

async function runLoop() {
  const workDone = await loop();
  const pause = workDone ? 0 : 100;
  setTimeout(runLoop, pause);
}
runLoop();