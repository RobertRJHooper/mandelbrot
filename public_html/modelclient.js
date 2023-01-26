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
        this.updates = [];

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
        this.updates = [];

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

        // save working state
        const { zoom } = this;
        this.canvasOffsetX = Math.round(width / 2 - center.re * zoom);
        this.canvasOffsetY = Math.round(height / 2 + center.im * zoom);

        // send center to workers
        this.workers.forEach(worker => {
            worker.postMessage({
                command: 'center',
                center: center,
                width: width,
                height: height,
            });
        });
    }

    workerMessage(message) {
        const data = message.data;
        const { zoom } = this;
        const expired = data.zoom != zoom;
        
        console.debug(
                'frame received with', data.snaps.length, 'snaps.',
                'adding to', this.updates.length, 'existing updates, and total cached snaps', this.snaps.size
        );

        if (!expired) {
            for (const snap of data.snaps) {
                this.updates.push(snap);
                this.snaps.set(snap.key, snap);
            }
        } else {
            console.debug("expired snaps received from worker", zoom);
        }

        // notification callback - needed even if the snaps have expired to reset budget later
        this.onUpdate && this.onUpdate();
    }

    /* get all snaps available */
    full() {
        return [...this.snaps.values()];
    }

    /* get updates since last flush */
    flush() {
        const snaps = this.updates;
        this.updates = [];
        return snaps;
    }

    // reset frame budget in workers
    resetBudget() {
        for (const worker of this.workers) {
            worker.postMessage({
                command: 'limit',
                frameBudget: this.frameBudget,
                iterationsLimit: this.iterationsLimit,
            });
        }
    }
}
