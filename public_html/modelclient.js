/**
 * Here are found classes that bridge the user interface and the worker backend
*/

"use strict";

/* Class to handle convertions from screen coordinates to the complex plane */
class ModelGeometry {
    /**
     * Create an instance based on a center point in the complex plane,
     * a zoom level and the required arithmetic precision. The input parameters
     * are objects that correspond to the Arithmetic system required or decimal
     * strings.
     * @constructor
     * @param {object} center_re - Real coordinate of the center of the view on complex plane
     * @param {object} center_im - Imaginary coordinate of the center of the view on the complex plane
     * @param {object} zoom - A value representing the number of pixels per unit on the complex plane
     * @param {object} precision - Minimum number of decimal places to calculate to. 0 or null for Javascript native Numbers
   */
    constructor(center_re, center_im, zoom, precision) {
        this.Arithmetic = getArithmetic(precision);

        // parse to number objects
        const { N } = this.Arithmetic;
        this.center_re = N(center_re);
        this.center_im = N(center_im);
        this.zoom = N(zoom);
    }

    /** 
     * helper to convert pixel coordinates in a rectangle to imaginary plane point
     * @param {integer} width - width of the rectangle in pixels
     * @param {integer} height - height of the rectangle in pixels
     * @param {integer} x - Distance from the left edge of the rectangle
     * @param {integer} y - Distance from the top edge of the rectangle
     * @returns {object} - A object with re and im fields with the point in the instance Arithmetic system
     * */
    rectToImaginary(width, height, x, y) {
        const { add, sub, mul, div } = this.Arithmetic;
        const { center_re, center_im, zoom } = this;

        // pixels from center point
        const pixelsX = sub(x, div(width, 2));
        const pixelsY = sub(y, div(height, 2));

        // convert to imaginary plane units
        const re = add(center_re, div(pixelsX, zoom));
        const im = sub(center_im, div(pixelsY, zoom));

        return { re: re, im: im }
    }

    /** 
     * helper to convert imaginary plane point to pixel coordinates in a rectange.
     * The center of the rectangle corresponds to the center of the view defined in instance
     * initiation.
     * @param {integer} width - width of the rectangle in pixels
     * @param {integer} height - height of the rectangle in pixels
     * @param {object} re - Real point in the imaginary plane
     * @param {object} im - Imaginary point in the imaginary plane
     * @returns {object} - A object with x and y Number integer fields with the pixel coordinates in the rectangle.
     * */
    imaginaryToRect(width, height, re, im) {
        const { N, toNumber, add, sub, mul, div } = this.Arithmetic;
        const { center_re, center_im, zoom } = this;

        // align precison
        const re_ = N(re);
        const im_ = N(im);

        // calculate pixels from center point
        const pixels_re = mul(sub(re_, center_re), zoom);
        const pixels_im = mul(sub(im_, center_im), zoom);

        // pixel offset from center of canvas
        const x = add(div(width, 2), pixels_re);
        const y = sub(div(height, 2), pixels_im);

        // convert to native numbers for local pixel coordinates
        return {
            x: toNumber(x),
            y: toNumber(y),
        };
    }

    /**
     * Helper to get a new zoom value after a further zoom factor is applied
     * @param {float} factor - The ratio to increase zoom e.g. 1.5
     * @returns the new zoom value in current Arithmetic system
     * */
    magnify(factor) {
        const { N, mul } = this.Arithmetic;
        return mul(this.zoom, N(factor));
    }

    /** 
     * Get the pixel coordinates of a panel in a rectangle centered on the view center with width and height specified.
     * @param {BigInt} panelX - The x coordinate in untis of panels from the origin of the complex plane
     * @param {BigInt} panelY - The y coordinate in untis of panels from the origin of the complex plane
     * @param {panelLength} integer - The length of each panel in pixels
     * @param {integer} width - width of the rectangle in pixels
     * @param {integer} height - height of the rectangle in pixels
     * @param {float} postZoom - A further magnification factor that enlarges the view about the center after all other calculations are done
     * @returns {object} - A object with left and top Number integer fields with the pixel coordinates in the rectangle of the top left point of the panel.
     * */
    getPixelCoordinates(panelX, panelY, panelLength, width, height, postZoom) {
        const { N, toBigInt, round, mul } = this.Arithmetic;
        const { center_re, center_im, zoom } = this;

        // panel length as a bigint
        const panelLengthN = BigInt(panelLength);

        // pixel coordinates relative to origin
        // shift y one panel down because painting is done downwards
        const pixelX = panelX * panelLengthN;
        const pixelY = (panelY + 1n) * panelLengthN;

        // center coordinates in pixels
        const centerX = toBigInt(round(mul(center_re, zoom)));
        const centerY = toBigInt(round(mul(center_im, zoom)));

        // panel coodinates in pixel units
        const x = pixelX - centerX;
        const y = pixelY - centerY;

        // x, y can now be handled with low precision
        // these can be native precision numbers as it's pixels on screen
        // negative in y direction because pixel coordinates
        // increase downwards on the canvas
        const left = Math.round(width / 2 + Number(x) * postZoom);
        const top = Math.round(height / 2 - Number(y) * postZoom);

        return { left: left, top: top };
    }
}

/**
 * Memoized helper function to get a ModelGeometry class
 * @param {object} re - Real point of the center of the view
 * @param {object} im - Imaginary point of the center of the view
 * @param {object} zoom - Pixels per unit in the complex plane
 * @param {integer} precision - Decimal places of accuracy required or 0/null for native Javascript numbers
 * @returns {ModelGeometry} - The requested ModelGeometry instance
*/
const getModelGeometry = _.memoize(
    (re, im, zoom, precision) => new ModelGeometry(re, im, zoom, precision),
    (...args) => (args.map(x => (x || "null").toString()).join(' '))
);

/* class to handle communication with workers */
class PanelsClient {
    static maxWorkerCount = 8;

    // ms to run before idling workers after the last flush call
    static timeToIdle = 1000;

    /**
     * Create an un-initiated instance.
     * @constructor
     */
    constructor() {
        this.workers = null;

        // reference counter to check for expired snaps
        this.reference = 0;
        this.statistics = {};

        // snaps of panels and updated snaps since last flush
        this.snapshots = new Map();
        this.updates = new Map();

        // flag if the next flush is from blank. Otherwise, it is cumulative on previous flushes 
        this.flushFromBlank = true;

        // worker statistics - these are updated periodically and each
        // statistics object is static once created
        // so equality can be tested on the object reference
        this.statistics = {};
    }

    /**
     * Called once per live cycle - this starts workers.
     */
    initiate() {
        const workerCount = Math.min(navigator.hardwareConcurrency || 1, PanelsClient.maxWorkerCount);
        console.debug(`initiating model with ${workerCount} workers`);

        this.workers = []
        for (let i = 0; i < workerCount; i++) {
            const worker = new Worker('panelsworker.js');
            worker.onmessage = this.workerMessage.bind(this);
            this.workers.push(worker);
        }
    }

    /**
     * Called once per live cycle - this terminates and releases workers.
     */
    terminate() {
        console.debug('terminating model');
        this.workers && this.workers.forEach(w => w.terminate());
        this.workers = null;
    }

    /**
     * set the center and zoom level in the workers
     * @param {object} zoom - Zoom in pixels per unit in complex plane as a decimal string or in the appropriate Arithmetic system
     * @param {integer} precision - The precision level required for the Arithmetic system
     * @returns Nothing returned
     */
    setup(zoom, precision) {
        if (!this.workers || !this.workers.length) {
            console.error("no workers set up");
            return;
        }

        // clear snap caches
        this.snapshots = new Map();
        this.updates = new Map();
        this.flushFromBlank = true;

        // update reference counters
        this.reference += 1;
        this.statistics = {};

        // send to workers
        this.workers.forEach(worker => {
            worker.postMessage({
                command: 'setup',
                reference: this.reference,
                zoom: zoom.toString(),
                precision: precision,
            });
        });
    }

    /**
     * Set the center of the view in the workers and the width and height in pixels of the view.
     * The workers will only work on panels (and hence points) in the view
     * @param {object} re - The real coordinate of the view
     * @param {object} im - The imaginary coordinate of the view
     * @param {integer} width - The width of the view in pixels
     * @param {integer} height - The height of the view in pixels
     * @returns Nothing returned. 
     */
    setView(re, im, width, height) {
        if (!width || !height) {
            console.debug("trivial view, nothing to do");
            return;
        }

        if (!this.workers || !this.workers.length) {
            console.error("no workers set up");
            return;
        }

        // update to all present snaps
        this.updates = new Map();
        this.flushFromBlank = true;

        // send view to workers
        this.workers.forEach((worker, workerIndex) => {
            worker.postMessage({
                command: 'view',
                re: re.toString(),
                im: im.toString(),
                width: width,
                height: height,
                step: this.workers.length,
                offset: workerIndex,
            });
        });

        // lift idle limit for first frames
        this.setIdleTime();
    }

    /**
     * Update the time that workers will idle in the future to now plus
     * PanelsClient.timeToIdle milliseconds.
     */ 
    setIdleTime() {
        for (const worker of this.workers) {
            worker.postMessage({
                command: 'limit',
                timeToIdle: Date.now() + PanelsClient.timeToIdle,
            });
        }
    }

    /**
     * Private function used to update statistics with information returned
     * from the workers.
     */
    updateStatistics(statistics) {
        const prevIterations = this.statistics.iteration || 0;

        this.statistics = {
            iteration: Math.max(statistics.iteration, prevIterations),
        };
    }

    /**
     * Worker message handler
     */
    workerMessage(message) {
        const { reference, snapshots, statistics } = message.data;

        if (reference != this.reference) {
            console.debug("expired snaps received from worker");
            return;
        }

        // deal with snapshots
        for (const snapshot of snapshots || []) {
            const key = `${snapshot.panelX} ${snapshot.panelY}`;
            this.updates.set(key, snapshot);
            this.snapshots.set(key, snapshot);
        }

        // deal with statistics
        if (statistics) this.updateStatistics(statistics);
    }

    /**
     * Get updates to the view since last time that flush was called.
     * @returns {object} A pack of the snapshots and an indicator 'update' that shows if the flush starts from a blank view or is cumulative.
     */
    flush() {
        const { updates, flushFromBlank } = this;

        // reset instance placeholders
        this.updates = new Map();
        this.flushFromBlank = false;

        // update throttle so more updates come
        this.setIdleTime();

        // send all available info when flushing from blank
        // copy to a fresh array because this.snaps will be updated in future
        // otherwise send just the cumulative updates
        // updates is now final, so no need to make a copy
        const snapshots = flushFromBlank ? Array.from(this.snapshots.values()) : updates.values();

        return {
            snapshots: snapshots,
            update: !flushFromBlank,
        }
    }
}