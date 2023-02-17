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

/*
static bounded point used when boundedness is determined by formula
in one of the known regions
*/
class BoundedPoint {
    constructor() {
        this.determined = true;
        this.escapeAge = null;
    }
}

// grid representing a square of points on the complex plane
class Panel {
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

    initiate() {
        this.image = new ImageData(panelLength, panelLength);
        
        // generate points and split to already determined and live
        const [determined, live] = _.partition(
            this.generatePoints(),
            p => p.determined
        );

        // paint determined points
        if(determined.length) {
            this.paint(determined);
            this.dirty = true;
        } else {
            this.dirty = false;
        }

        // save live points for future work
        this.live = live;
    }

    /* paint determined points to the image */
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
                imageData[i + 0] = 255;
                imageData[i + 1] = 0;
                imageData[i + 2] = 255;
                imageData[i + 3] = 255;
            }
        });
    }

    flush() {
        this.dirty = false;
        return createImageBitmap(this.image);
    }

    // iterate live points and paint ones that become determined
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

// panels controller for a given zoom level
// this must be discarded if the global Artithmetic changes
class Panels {
    constructor(zoom) {
        this.zoom = zoom;

        // storage for all cached frames
        this.panels = new Map();

        // active panels that this worker is currently working on
        this.activePanels = [];

        // counter
        this.iterations = 0;
    }

    /* determine active panel coordinates around a center */
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
                panel = new Panel(panelX, panelY, this.zoom);
                panel.initiate();
                this.panels.set(key, panel);
            }

            this.activePanels.push(panel);
        }
    }

    // iterate all current panels
    iterate() {
        for (const panel of this.activePanels) panel.iterate();
        this.iterations += 1;
    }

    // return a list of bitmaps for updated (dirty) panels since last flush
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