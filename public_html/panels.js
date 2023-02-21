"use strict";

/*
this module requires global variables:
1. Arithmetic =     multi-precision arithmetic to use
2. mbKnownRegions = instances representing known areas of complex plane inside mbs
                    each instance has a function test(re, im) to check a point
                    this must be refreshed if the Arithmetic global is updated.
*/

// length (=width and height) of each panel in pixels
var panelLength = 32;
var panelLengthEnumeration = _.range(panelLength);
var panelGridEnumeration = _.range(panelLength * panelLength);

// lookup table of RGB cycling around hue
var hueCycleLength = 30;

var hueCycle = _.range(hueCycleLength).map(i =>
    hslToRgb((i / hueCycleLength + 0.61) % 1, 0.9, 0.5)
);

/**
 * An object representing points on the complex plane that
 * have been determined by formula to be inside the Mandelbrot set
 * and do not need iteration.
 */
class BoundedPoint {
    constructor() {
        this.determined = true;
        this.escapeAge = null;
    }
}

/**
 * A panel is a grid representing a square of points on the complex plane.
 * The points are located by coordinates in units of panels.
 * Each panel has constant width and height equal to panelLength pixels.
 */
class Panel {
    /**
     * Create an uninitiated panel instance
     * @constructor
     * @param {BigInt} panelX - x coordinate in the complex plane in units of panels
     * @param {BigInt} panelY - y coordinate in the complex plane in units of panels
     * @param {NumberObject} zoom - Pixels per unit of the complex plane
     */
    constructor(panelX, panelY, zoom) {
        const { N, mul, div, add, sub, TWO } = Arithmetic;

        // save parameters
        this.zoom = zoom
        this.panelX = panelX;
        this.panelY = panelY;

        // find pixel coordinates of panel
        const lengthN = BigInt(panelLength);
        const pixelX = panelX * lengthN;
        const pixelY = panelY * lengthN;

        // find center of the panel in complex coordinates
        const halfPanelLengthInComplexPlane = div(div(panelLength, zoom), TWO);
        this.center_re = add(div(N(pixelX), zoom), halfPanelLengthInComplexPlane);
        this.center_im = add(div(N(pixelY), zoom), halfPanelLengthInComplexPlane);

        // flag for when the panel image has been updated and not yet flushed
        this.dirty = false;

        // panel image as array of pixels
        this.image = null;

        // points where it is not yet determined whether the
        // point is in the mandelbrot set or not
        this.live = null;
    }

    /**
     * Private function used in initiation to create an array of points
     */
    generatePoints() {
        const { center_re, center_im, zoom } = this;
        const { ONE, TWO, mul, div, add, sub } = Arithmetic;

        // length in the imaginary plane per pixel
        // divided by two so we can use integers below and
        // avoid precision differences
        const halfPixelLength = div(div(ONE, zoom), TWO);

        // get real points for the grid
        const grid_re = panelLengthEnumeration.map(i => {
            const pixelOffset = 2 * i - panelLength + 1;
            return add(center_re, mul(halfPixelLength, pixelOffset));
        });

        // get imaginary points for the grid
        const grid_im = panelLengthEnumeration.map(i => {
            const pixelOffset = 2 * i - panelLength + 1;
            return sub(center_im, mul(halfPixelLength, pixelOffset));
        });

        // generate points for the grid
        return panelGridEnumeration.map(idx => {
            const i = idx % panelLength;
            const c_re = grid_re[i];

            const j = (idx - i) / panelLength;
            const c_im = grid_im[j];

            // we can know by formula that some values remain bounded
            const boundedByFormula = mbKnownRegions.some(r => r.test(c_re, c_im));

            // status storage for this point
            const point = boundedByFormula ? new BoundedPoint() : new Point(c_re, c_im);

            // attach index to point for reference while drawing
            point.idx = idx;
            return point;
        });
    }

    /**
     * Initiate the panel by creating the points required etc.
     */
    initiate() {
        this.image = new ImageData(panelLength, panelLength);

        // generate points and split to already determined and live
        const [determined, live] = _.partition(
            this.generatePoints(),
            p => p.determined
        );

        // paint determined points
        if (determined.length) {
            this.paint(determined);
            this.dirty = true;
        } else {
            this.dirty = false;
        }

        // save live points for future work
        this.live = live;
    }

    /**
     * Paint points to the panel image if the point status has been determined
     */
    paint(points) {
        const imageData = this.image.data;

        points.forEach(point => {
            const i = point.idx * 4;

            if (point.escapeAge !== null) {
                const rgb = hueCycle[point.escapeAge % hueCycleLength];
                imageData[i + 0] = rgb[0];
                imageData[i + 1] = rgb[1];
                imageData[i + 2] = rgb[2];
                imageData[i + 3] = 255;
            } else if (point.determined) {
                // points determined by formula rather than iteration
                imageData[i + 0] = 0;
                imageData[i + 1] = 0;
                imageData[i + 2] = 0;
                imageData[i + 3] = 255;
            }
        });
    }

    /**
     * Get the current image of the panel as a bitmap
     * @returns {Promise} A promise to an ImageBitmap
     */
    flush() {
        this.dirty = false;
        return createImageBitmap(this.image);
    }

    /**
     * Perform one iteration on live undetermined points.
     * If any point become determined then it will be painted to the image and discarded.
     * If at least one pixel is determined in this iteration then the dirty flag is set to true.
     */
    iterate() {
        const [determined, live] = _.partition(
            this.live,
            p => (p.iterate() || p.determined)
        );

        // paint determined points to image
        if (determined.length) {
            this.paint(determined);
            this.dirty = true;
        }

        // update live list and discard determined points
        this.live = live;
    }
}

/* A controller class for organising the life cycle of panels. If the global Arithmetic system changes then instances must be recreated. */
class Panels {
    /**
     * Create the controller.
     * @constructor
     * @params {object} The zoom level desired
     */
    constructor(zoom) {
        this.zoom = zoom;

        // storage for all cached frames
        this.panels = new Map();

        // active panels that this worker is currently working on
        this.activePanels = [];

        // counter
        this.iteration = 0;
    }

    /**
     * Determine active panels for a give view. Multi-worker stripping means that the current
     * worker will only include panels with coordinates satisfying:
     * (panelX + panelY) % step == offset
     * @param {NumberObject} re - The real coordinate of the center of the view 
     * @param {NumberObject} im - The imaginary coordinate of the center of the view
     * @param {Integer} width - The width of the view in pixels
     * @param {Integer} height - The height of the view in pixels
     * @param {Integer} step - Used in multiworker stripping 
     * @param {Integer} offset - Used in multiworker stripping
     * @returns {Array.<[BigInt, BigInt]>} - The x, y coordinates of the visible panels in units of panels
     */
    getPanelsForView(re, im, width, height, step, offset) {
        const { toBigInt, mul, div, floor } = Arithmetic;
        const { zoom } = this;

        // coordinates of the center panel in the view in units of panel lengths
        const centerX = toBigInt(floor(mul(div(re, panelLength), zoom)));
        const centerY = toBigInt(floor(mul(div(im, panelLength), zoom)));

        // width and height of the view in panels either side of the center
        // rounding up means the view is always covered by panels
        const xPanels = BigInt(Math.ceil((width / panelLength + 1) / 2));
        const yPanels = BigInt(Math.ceil((height / panelLength + 1) / 2));

        // viewbox lower bounds in units of panel lengths
        const xMin = centerX - xPanels;
        const yMin = centerY - yPanels;
        const xMax = centerX + xPanels;
        const yMax = centerY + yPanels;

        // list the coorrdinates of panels
        const out = [];
        for (let panelX = xMin; panelX <= xMax; panelX++) {
            for (let panelY = yMin; panelY <= yMax; panelY++) {
                if ((panelX + panelY - offset) % step) continue; // multi-worker stripping
                out.push([panelX, panelY]);
            }
        }

        return out;
    }

    /**
     * Set the active panels that will be calculated in the worker.
     * @param {Array.<[BigInt, BigInt]>} coordinates - An array of panel coordinates in units of panels to set as active
     */
    setActivePanels(coordinates) {
        this.activePanels = [];

        for (const [panelX, panelY] of coordinates) {
            const key = `${panelX} ${panelY}`;
            let panel = this.panels.get(key);

            // create new one
            if (!panel) {
                panel = new Panel(panelX, panelY, this.zoom);
                panel.initiate();
                this.panels.set(key, panel);
            }

            this.activePanels.push(panel);
        }
    }

    /**
     * Iterate all active panels
     */
    iterate() {
        for (const panel of this.activePanels) panel.iterate();
        this.iteration += 1;
    }

    /**
     * Get bitmaps for all updated (dirty) active panels.
     * @return {Promise} A promise to an array of snapshots. Each snapshot has the bitmap and coordinates of the dirty panel.
     */ 
    flush() {
        const dirtyPanels = this.activePanels.filter(p => p.dirty);

        // nothing new under the sun
        if (!dirtyPanels.length) return [];

        // generate snapshots
        console.debug('flushing dirty panels', dirtyPanels.length, 'of', this.activePanels.length);

        async function getSnapshot(panel) {
            return {
                panelX: panel.panelX,
                panelY: panel.panelY,
                length: panelLength,
                bitmap: await panel.flush(),
            }
        }

        // return promise of snapshots
        return Promise.all(dirtyPanels.map(p => getSnapshot(p)));
    }
}