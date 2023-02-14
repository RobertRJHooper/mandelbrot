"use strict";

// these functions require an arithmetic system set up
// under the global variable Artihmetic with the required precision
// var Arithmetic = getArithmetic(15);

/**
* Converts an HSL color value to RGB. Conversion formula
* adapted from http://en.wikipedia.org/wiki/HSL_color_space.
* Assumes h, s, and l are contained in the set [0, 1] and
* returns r, g, and b in the set [0, 255].
*
* @param   Number  h       The hue
* @param   Number  s       The saturation
* @param   Number  l       The lightness
* @return  Array           The RGB representation
*/
function hslToRgb(h, s, l) {
  var r, g, b;

  if (s == 0) {
    r = g = b = l; // achromatic
  } else {
    function hue2rgb(p, q, t) {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    }

    var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    var p = 2 * l - q;

    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }

  return [r * 255, g * 255, b * 255];
}

// lookup table of age to RGB colour
const ageToRGBCycleLength = 30;
const ageToRGB = _.range(ageToRGBCycleLength).map(i =>
  hslToRgb((i / ageToRGBCycleLength + 0.61) % 1, 0.9, 0.5)
);

class Point {
  constructor(c_re, c_im) {
    const { mul } = Arithmetic;

    this.c_re = c_re;
    this.c_im = c_im;

    // initial iteration state
    this.age = 1;
    this.z_re = c_re;
    this.z_re2 = mul(c_re, c_re); // z_re squared
    this.z_im = c_im;
    this.z_im2 = mul(c_im, c_im); // z_im squared

    // initial escape calculation
    if (this.escaped()) {
      this.determined = true;
      this.escapeAge = this.age;
    } else {
      this.determined = false;
      this.escapeAge = null;
    }
  }

  // check for escape (with short-circuits for speed)
  // this is when z is outside the disk with radius 2 about origin
  escaped() {
    const { add, gt, TWO, FOUR } = Arithmetic;
    const { z_re2, z_im2 } = this;

    // see if the point is outside a square of length sqrt(2)
    const reFar = gt(z_re2, TWO);
    const imFar = gt(z_im2, TWO);

    // if not then the point has not escaped
    // this is the negative short-circuit
    if (!reFar && !imFar)
      return false;

    // check if one dimension is enought to determine escape
    // this is the positive short-circuit
    if (reFar && gt(z_re2, FOUR))
      return true;
    if (imFar && gt(z_im2, FOUR))
      return true;

    // full disc calculation for the remaining region
    return gt(add(z_im2, z_re2), FOUR);
  }

  iterate() {
    const { mul, add, sub, TWO } = Arithmetic;
    const { c_re, c_im, z_re, z_re2, z_im, z_im2 } = this;

    // next iteration of z
    const re = add(sub(z_re2, z_im2), c_re);
    const re2 = mul(re, re);
    const im = add(mul(mul(z_re, z_im), TWO), c_im);
    const im2 = mul(im, im);

    // save state
    this.z_re = re;
    this.z_re2 = re2;
    this.z_im = im;
    this.z_im2 = im2;
    this.age += 1;

    // check for escape
    if (!this.determined && this.escaped()) {
      this.determined = true;
      this.escapeAge = this.age;
    }
  }
}

/* static bounded point used when boundedness is determined by formula */
class BoundedPoint {
  constructor() {
    this.determined = true;
    this.escapeAge = null;
  }
}

// Object that holds a regular rectangular grid of Point objects
class MandelbrotGrid {
  constructor(center_re, center_im, zoom, width, height, retain = false) {
    this.center_re = center_re;
    this.center_im = center_im;
    this.zoom = zoom;
    this.width = width;
    this.height = height;

    // panel bitmap image
    this.image = null;

    // flat list of all points
    // this is available when 'retain' is set
    this.points = null;

    // flag to keep points after they have been painted
    this.retain = retain;

    // points where it is not yet determined whether the
    // point is in the mandelbrot set or not
    this.live = null;
  }

  initiateImage() {
    this.image = new ImageData(this.width, this.height);
  }

  initiatePoints() {
    const { center_re, center_im, zoom, width, height } = this;
    const { ONE, TWO, mul, div, add, sub } = Arithmetic;

    // length in the imaginary plane per pixel width
    // divided by two so we can use integers below and
    // avoid precision differences
    const pixelLength = div(div(ONE, zoom), TWO);

    // get real points for the grid
    const grid_re = [];

    for (let i = 0; i < width; i++) {
      const pixelOffset = 2 * i - width + 1;
      const x = add(center_re, mul(pixelLength, pixelOffset));
      grid_re.push(x);
    }

    // get imaginary points for the grid
    const grid_im = [];

    for (let i = 0; i < height; i++) {
      const pixelOffset = 2 * i - height + 1;
      const x = sub(center_im, mul(pixelLength, pixelOffset));
      grid_im.push(x);
    }

    // function to generate point from left/right/ top/bottom index
    function createPoint(idx) {
      const i = idx % width;
      const j = (idx - i) / width;
      const c_re = grid_re[i];
      const c_im = grid_im[j];

      // we can know by formula that some values remain bounded
      const boundedByFormula = Arithmetic.mbCheckFormula(c_re, c_im);

      // status storage for this point
      const point = boundedByFormula ? new BoundedPoint() : new Point(c_re, c_im);

      // attach index to point for reference while drawing
      point.idx = idx;
      return point;
    }

    /*
    console.log(center_re, center_im, zoom, width, height);
    console.log('im', im);
    console.log('re', re);
    */

    // points lists - not sure how to vectorize this in Javascript
    const live = [], determined = [];
    const pointsCount = width * height;

    for (let idx = 0; idx < pointsCount; idx++) {
      const point = createPoint(idx);
      (point.determined ? determined : live).push(point);
    }

    // paint initially determined points
    this.paint(determined);

    // save points references
    if (this.retain) this.points = [...live, ...determined];
    this.live = live;
  }

  initiate() {
    this.initiateImage();
    this.initiatePoints();
  }

  // iterate live points and paint ones that become determined
  iterate() {
    const [determined, live] = _.partition(this.live, p => (p.iterate() || p.determined));

    // paint determined points to image
    this.paint(determined);

    // update live list
    this.live = live;
  }

  /* paint determined points to the image */
  paint(points) {
    const imageData = this.image.data;

    points.forEach((point) => {
      const i = point.idx * 4;

      if (point.escapeAge !== null) {
        const rgb = ageToRGB[point.escapeAge % ageToRGBCycleLength];
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
}