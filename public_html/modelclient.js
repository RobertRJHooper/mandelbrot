"use strict";

const getModelGeometry = _.memoize(
    (center, zoom, precision) => new ModelGeometry(center, zoom, precision)
);

class ModelGeometry {
    constructor(center, zoom, precision) {
        this.A = getArithmetic(precision);

        // parse to number objects
        const N = this.A.N;
        this.center_re = N(center.re);
        this.center_im = N(center.im);
        this.zoom = N(zoom);
    }

    /* helper to convert pixel coordinates to imaginary plane point */
    rectToImaginary(width, height, x, y) {
        const { N, add, sub, mul, div } = this.A;
        const { center_re, center_im, zoom } = this;

        // pixels from center point
        const pixelsX = sub(x, div(width, 2));
        const pixelsY = sub(y, div(height, 2));

        // convert to imaginary plane units and reset origin
        const re = add(center_re, div(pixelsX, zoom));
        const im = sub(center_im, div(pixelsY, zoom));

        return { re: re, im: im, }
    }

    /* helper to convert imaginary plane point to pixel coordinates */
    imaginarytoRect(width, height, point) {
        const { N, toNumber, add, sub, mul, div } = this.A;
        const { center_re, center_im, zoom } = this;

        // align precison
        const point_re = N(point.re);
        const point_im = N(point.im);

        // calculate pixels from center point
        const pixels_re = mul(sub(point_re, center_re), zoom);
        const pixels_im = mul(sub(point_im, center_im), zoom);

        // pixel offset from center of canvas
        const x = add(div(width, 2), pixels_re);
        const y = sub(div(height, 2), pixels_im);

        // convert to native numbers for pixel coordinates
        return {
            x: toNumber(x),
            y: toNumber(y),
        };
    }

    /* return the new zoom value give a further magnification factor */
    magnify(factor) {
        const { mul, round } = this.A;
        return round(mul(this.zoom, factor));
    }

    /* get canvas coordinates from panel coordinates */
    getPixelCoordinates(panelX, panelY, panelLength, width, height, postZoom) {
        const { N, toBigInt, round, mul } = this.A;
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


/* class to handle communication with workers */
class ModelClient {
    static maxWorkerCount = 8;

    // ms to run before idling workers after the last flush call
    static timeToIdle = 3000;

    // width and height of panels in pixels
    static panelLength = 32;

    constructor() {
        this.workers = null;

        // reference counter to check for expired snaps
        this.setupReference = 0;
        this.iterations = 0;

        // snaps of panels and updated snaps since last flush
        this.snaps = new Map();
        this.updates = new Map();

        // flag if the next flush is from blank. Otherwise, it is cumulative on previous flushes 
        this.flushFromBlank = true;
    }

    initiate() {
        const workerCount = Math.min(navigator.hardwareConcurrency || 1, ModelClient.maxWorkerCount);
        console.debug(`initiating model with ${workerCount} workers`);

        this.workers = []
        for (let i = 0; i < workerCount; i++) {
            const worker = new Worker('modelworker.js');
            worker.onmessage = this.workerMessage.bind(this);
            this.workers.push(worker);
        }
    }

    terminate() {
        console.debug('terminating model');
        this.workers && this.workers.forEach(w => w.terminate());
        this.workers = null;
    }

    /* set the center and zoom level in the workers */
    setup(zoom, precision) {
        if (!this.workers || !this.workers.length) {
            console.error("no workers set up");
            return;
        }

        // clear snap caches
        this.snaps = new Map();
        this.updates = new Map();
        this.flushFromBlank = true;

        // update reference counters
        this.setupReference += 1;
        this.iterations = 0;

        // send to workers
        this.workers.forEach(worker => {
            worker.postMessage({
                command: 'setup',
                zoom: zoom.toString(),
                precision: precision,
                panelLength: ModelClient.panelLength,
                setupReference: this.setupReference,
            });
        });
    }

    /* set the center in the workers */
    setView(center, width, height) {
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
                center_re: center.re.toString(),
                center_im: center.im.toString(),
                width: width,
                height: height,
                step: this.workers.length,
                offset: workerIndex,
            });
        });

        // lift idle limit for first frames
        this.setIdleTime();
    }

    // set the time that workers will idle
    setIdleTime() {
        for (const worker of this.workers) {
            worker.postMessage({
                command: 'limit',
                timeToIdle: Date.now() + ModelClient.timeToIdle,
            });
        }
    }

    workerMessage(message) {
        const { setupReference, iterations, snaps } = message.data;

        if (setupReference != this.setupReference) {
            console.debug("expired snaps received from worker");
            return;
        }

        for (const snap of snaps) {
            const key = `${snap.panelX} ${snap.panelY}`;
            this.updates.set(key, snap);
            this.snaps.set(key, snap);
        }

        // diagnostic info
        this.iterations = iterations;
    }

    /* get updates since last flush */
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
        const snaps = flushFromBlank ? Array.from(this.snaps.values()) : updates.values();

        return {
            snaps: snaps,
            update: !flushFromBlank,
        }
    }
}
