"use strict";

function complex(re, im) {
    return {re: re, im: im};
}

/* helper to convert pixel coordinates to imaginary plane point */
function rectToImaginary(center, zoom, width, height, x, y) {
    return complex(
        center.re + (x - width / 2) / zoom,
        center.im - (y - height / 2) / zoom, 
    );
}

/* helper to convert imaginary plane point to pixel coordinates */
function imaginarytoRect(center, zoom, width, height, point) {
    return {
        x: width / 2 + (point.re - center.re) * zoom,
        y: height / 2 - (point.im - center.im) * zoom,
    };
}

/* class to handle model calculations and communication with worker */
class ModelClient {
    static maxWorkerCount = 8;

    // ms to run before idling workers after the last flush call
    static timeToIdle = 3000;

    constructor() {
        this.workers = null;

        // current working state
        this.zoom = null;

        // pixel offset to shift from the origin to the center point
        // updated when setting center point
        this.canvasOffsetX = null;
        this.canvasOffsetY = null;

        // snaps of panels and updated snaps since last flush
        this.snaps = new Map();
        this.updates = new Map();

        // flag if the next flush is from blank or from cumulative 
        this.updatesFromBlank = true;
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
    setZoom(zoom) {
        if (!this.workers || !this.workers.length) {
            console.error("no workers set up");
            return;
        }

        // clear snap caches
        this.snaps = new Map();
        this.updates = new Map();
        this.updatesFromBlank = true;

        // save state locally
        this.zoom = zoom;
        this.postZoom = 1;
        this.canvasOffsetX = null;
        this.canvasOffsetY = null;

        // send to workers
        this.workers.forEach((worker, workerIndex) => {
            worker.postMessage({
                command: 'zoom',
                zoom: zoom,
                step: this.workers.length,
                offset: workerIndex,
            });
        });
    }

    /* set the center in the workers */
    setCenter(center, width, height, postZoom) {
        if (!width || !height) {
            console.debug("trivial view, nothing to do");
            return;
        }

        if (!this.workers || !this.workers.length) {
            console.error("no workers set up");
            return;
        }

        // update to all present snaps
        this.updates = new Map(this.snaps);
        this.updatesFromBlank = true;

        // save working state
        this.postZoom = postZoom;
        this.canvasOffsetX = Math.round(width / 2 - center.re * this.zoom * postZoom);
        this.canvasOffsetY = Math.round(height / 2 + center.im * this.zoom * postZoom);

        // send center to workers
        this.workers.forEach(worker => {
            worker.postMessage({
                command: 'center',
                center: center,
                width: width,
                height: height,
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
        console.debug('frame received with', message.data.snaps.length, 'snaps.', 'adding to', this.updates.size, 'existing updates, and total cached snaps', this.snaps.size);
        const expired = message.data.zoom != this.zoom;

        if (!expired) {
            for (const snap of message.data.snaps) {
                this.updates.set(snap.key, snap);
                this.snaps.set(snap.key, snap);
            }
        } else {
            console.debug("expired snaps received from worker");
        }
    }

    /* get updates since last flush */
    flush() {
        const {updates, updatesFromBlank} = this;

        // reset local updates holders
        this.updates = new Map();
        this.updatesFromBlank = false;

        // update throttle so more updates come
        this.setIdleTime();

        // all done
        return {snaps: updates.values(), update: !updatesFromBlank};
    }
}
