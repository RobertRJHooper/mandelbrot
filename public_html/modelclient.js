"use strict";

// import math functions into global namespace
var { complex, conj, add, subtract, multiply, divide, ceil, floor, sqrt } = math;

/* helper to convert pixel coordinates to imaginary plane point */
function rectToImaginary(center, zoom, width, height, x, y) {
    return complex(
        center.re + (x - width / 2) / zoom,
        center.im - (y - height / 2) / zoom,
    );
}

/* helper to convert imaginary plane point to pixel coordinates */
function imaginarytoRect(center, zoom, width, height, point) {
    return [
        width / 2 + (point.re - center.re) * zoom,
        height / 2 - (point.im - center.im) * zoom
    ];
}

/* class to handle model calculations and communication with worker */
class ModelClient {
    static maxWorkerCount = 8;

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

        // throttling defaults
        this.frameBudget = 2;
        this.iterationsLimit = 4000;

        // callback reference
        this.onUpdate = null;
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

        // save state locally
        this.zoom = zoom;
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
    setCenter(center, width, height) {
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

        // save working state
        this.canvasOffsetX = Math.round(width / 2 - center.re * this.zoom);
        this.canvasOffsetY = Math.round(height / 2 + center.im * this.zoom);

        // send center to workers
        this.workers.forEach(worker => {
            worker.postMessage({
                command: 'center',
                center: center,
                width: width,
                height: height,
            });
        });

        // set budget in workers
        for (const worker of this.workers) {
            worker.postMessage({
                command: 'limit',
                iterationsLimit: this.iterationsLimit,
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
        const updates = this.updates;
        this.updates = new Map();
        return updates.values();
    }
}
