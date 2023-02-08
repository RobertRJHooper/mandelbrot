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
        const pixels_re = sub(x, div(width, 2));
        const pixels_im = sub(y, div(height, 2));

        // convert to imaginary plane units and reset origin
        return {
            re: add(center_re, div(pixels_re, zoom)),
            im: sub(center_im, div(pixels_im, zoom)),
        }
    }

    /* helper to convert imaginary plane point to pixel coordinates */
    imaginarytoRect(width, height, point) {
        const { N, demote, add, sub, mul, div } = this.A;
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
            x: demote(x),
            y: demote(y),
        };
    }

    /* return the new zoom value give a further magnification factor */
    magnify(factor) {
        const {mul, round} = this.A;
        return round(mul(this.zoom, factor));
    }

    /* get canvas coordinates from panel coordinates */
    getPixelCoordinates(panelX, panelY, panelLength, width, height, postZoom) {
        const { N, demote, add, sub, mul, div } = this.A;
        const { center_re, center_im, zoom } = this;

        // promote/demote to Artithmetic precision
        const zoom_ = N(zoom);
        const panelX_ = N(panelX);
        const panelY_ = N(panelY);

        // pixel coordinates relative to origin
        // shift y one panel down because painting is done downwards
        const px = mul(panelX_, panelLength);
        const py = mul(add(panelY_, 1), panelLength);

        // pixel coordinates relative to center
        const x = sub(px, mul(center_re, zoom_));
        const y = sub(py, mul(center_im, zoom_));

        // x, y can now be handled with low precision
        // these can be native precision numbers as it's pixels on screen
        // negative in y direction because pixel coordinates
        // increase downwards on the canvas
        const left = Math.round(width / 2 + demote(x) * postZoom);
        const top = Math.round(height / 2 - demote(y) * postZoom);

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

        // update reference counter
        this.setupReference += 1;

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
        const { setupReference, snaps } = message.data;

        if(setupReference != this.setupReference) {
            console.debug("expired snaps received from worker");
            return;
        }

        for (const snap of snaps) {
            this.updates.set(snap.key, snap);
            this.snaps.set(snap.key, snap);
        }
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
