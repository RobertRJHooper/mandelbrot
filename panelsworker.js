/**
 * Worker script for iterating and painting
 * points in the complex plane organised into panels.
 */

"use strict";

importScripts(
  'lib/lodash.min.js',
  'lib/decimal.js',
  'arithmetic.js',
  'colours.js',
  'mandelbrot.js',
  'panels.js'
);

// worker-global multi-precision arithmetic currently in use
var Arithmetic = null;

// Objects representing known areas of complex plane inside mbs
// each object has a function test(re, im) to check an individual point
// this must be refreshed if the Arithmetic global is updated
var mbKnownRegions = [];

/**
 * set globals that are used by model scripts. These are globals
 * for speed and simplicity.
 */
function setGlobals(precision) {
  console.debug('setting global worker arithmetic with precision parameter', precision);

  // defined in arithmetic.js
  Arithmetic = getArithmetic(precision);

  // defined in mandelbrot.js
  mbKnownRegions = getKnownRegions();
}

/* Class to control the life-cycle of the worker */
class Controller {

  // minmum period between image posts back to client
  static frameThrottlePeriod = 250;

  /**
   * Get a controlelr for a particular zoom level and precision
   * @constructor
   * @param {object} reference - Reference added to all messages back to the client
   * @param {NumberObject} zoom - Zoom level in pixels per unit of complex plane
   * @param {Integer} precision - The number of decimals accuracy in arithmetic calculations
   */
  constructor(reference, zoom) {
    console.debug('controller reference', reference);
    console.debug('controller zoom level', zoom);

    this.reference = reference;
    this.zoom = zoom;

    // controller loop binding
    this.loop = this.loop.bind(this);

    // panels controller placeholder - this is set up by the work loop
    this.panels = null;

    // placeholder for changing the current view
    // the work loop will pick up a new definition from this variable
    this.requestedView = null;

    // flag to exit the work loop
    this.terminate = false;
  }

  /**
   * Set the active view
   * @param {NumberObject} re The real value of the center of the view
   * @param {NumberObject} im The imaginary value of the center of the view
   * @param {Integer} width - The width of the view in pixels
   * @param {Integer} height - The height of the view in pixels
   * @param {Integer} step - The stride or step used in multi-worker panel stripping
   * @param {Integer} offset - The offset used in multi-worker panel stripping
  */
  setView(re, im, width, height, step, offset) {
    if (!this.panels) {
      console.warn('Panels controoler not setup while setting view');
      return;
    }

    console.debug('setting view real', re);
    console.debug('setting view imag', im);
    console.debug('setting view width', width);
    console.debug('setting view height', height);
    console.debug('worker panel stripping', step, offset);
    const activePanels = this.panels.getPanelsForView(re, im, width, height, step, offset);

    // set visible panels for calculation
    console.debug('setting active panels numbering', activePanels.length);
    this.panels.setActivePanels(activePanels);

    // reset the issue time of the last frame of updates send to client
    this.lastFrameTime = 0;
  }

  /**
   * work function to do the next piece of work
   * @return {Boolean} True iff something was done. False if idle
   */
  async work() {
    if (!this.panels) {
      this.panels = new Panels(this.zoom);
      return true;
    }

    // new view has been requested
    if (this.requestedView) {
      const { re, im, width, height, step, offset } = this.requestedView;

      // clear request so it is setup only once
      this.requestedView = null;

      this.setView(
        Arithmetic.N(re),
        Arithmetic.N(im),
        width,
        height,
        BigInt(step),
        BigInt(offset)
      );

      return true;
    }

    // get timestamp to throttle sending updates and iterating points
    const timestamp = Date.now();
    const active = this.timeToIdle > timestamp;
    const postThrottled = timestamp < this.lastFrameTime + Controller.frameThrottlePeriod;

    // post statistics
    if (active && !postThrottled) {
      const statistics = {
        iteration: this.panels.iteration,
      };

      postMessage({
        reference: this.reference,
        statistics: statistics,
      });
    }

    // post dirty panels
    if (active && !postThrottled) {
      const snapshots = await this.panels.flush();

      if (snapshots.length) {
        postMessage({
          reference: this.reference,
          snapshots: snapshots,
        }, snapshots.map(s => s.bitmap));

        this.lastFrameTime = timestamp;
        return true;
      }
    }

    // iterate points in each active panel
    if (active) {
      this.panels.iterate();
      return true;
    }

    // nothing to do
    return false;
  }

  async loop() {
    if (this.terminate) return;
    const workDone = await this.work();
    const pause = workDone ? 0 : 100;
    setTimeout(this.loop, pause);
  }
}

// current controller for this worker
var controller = null;

/* handler for messages from the master */
onmessage = function (message) {
  switch (message.data.command) {
    case 'setup': {
      const { zoom, reference, precision } = message.data;

      // terminate current controller and stop the loop
      if (controller) {
        controller.terminate = true;
        controller = null;
      }

      // setup new global environment
      setGlobals(precision);

      // set up new controller
      controller = new Controller(reference, Arithmetic.N(zoom));

      // schedule the start of the controller loop
      setTimeout(controller.loop, 0);
      break;
    }

    case 'view': {
      if (!controller) {
        console.warn('view requested before controller setup');
        break;
      }

      console.debug('requesting new view');
      controller.requestedView = message.data;
      break;
    }

    case 'limit': {
      if (!controller) {
        console.warn('time limit update requested before controller setup');
        break;
      }

      controller.timeToIdle = message.data.timeToIdle;
      break;
    }

    default:
      throw new Error(`unknown worker command "${message.data.command}" received`);
  }
}
