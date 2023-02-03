"use strict";

// multiple precision floating point numbers
var Arithmetic = DecimalArithmetic(19);
var Arithmetic = NativeArithmetic();

// check if the point is in a known region of mandelbrot set using formula
function mbByFormula(re, im) {
  return Arithmetic.mbInMainCardiod(re, im) || Arithmetic.mbInPrimaryBulb(re, im);
}

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
    this.c_re = c_re;
    this.c_im = c_im;
    this.z_re = Arithmetic.ZERO;
    this.z_im = Arithmetic.ZERO;
    this.age = 0;
    this.escapeAge = null;

    // we can know by formula that some values series remain bounded
    this.boundedByFormula = mbByFormula(this.c_re, this.c_im);

    // flag whether the point escape is determined yet
    this.undetermined = !this.boundedByFormula;
  }

  iterate() {
    const { z_re, z_im, c_re, c_im } = this;
    const {mul, add, sub, TWO} = Arithmetic;

    const z_re2 = mul(z_re, z_re);
    const z_im2 = mul(z_im, z_im);
    const re = add(sub(z_re2, z_im2), c_re);
    const im = add(mul(mul(z_re, z_im), TWO), c_im);

    this.z_re = re;
    this.z_im = im;
    this.age += 1;

    if (Arithmetic.mbEscaped(re, im) && this.undetermined) {
      this.escapeAge = this.age;
      this.undetermined = false;
    }
  }
}

// give the complex numbers of a particular point to escape
// not optimised for speed
function mbSample(c_re, c_im, iterations = 1000) {
  const point = new Point(
    Arithmetic.Number(c_re),
    Arithmetic.Number(c_im)
  );

  // runout of points
  const zi = [];

  // run to escape of max iterations
  while (point.age < iterations) {
    zi.push([point.z_re, point.z_im]);
    point.iterate();

    if (point.escapeAge && point.escapeAge + 1 < point.age) {
      break;
    }
  }

  // append runout info to point and return
  point.zi = zi;
  return point;
}

// Object that holds a regular rectangular grid of Point objects
class MandelbrotGrid {
  constructor(center_re, center_im, zoom, width, height) {
    this.center_re = Arithmetic.Number(center_re);
    this.center_im = Arithmetic.Number(center_im);
    this.zoom = Arithmetic.Number(zoom);
    this.width = width;
    this.height = height;
    this.image = null;

    // flat list of all points
    this.points = null;

    // points where it is not yet determined whether the
    // point is in the mandelbrot set or not
    this.live = null;
  }

  initiateImage() {
    this.image = new ImageData(this.width, this.height);
  }

  initiatePoints() {
    const { center_re, center_im, zoom, width, height } = this;
    const {ONE, TWO, mul, div, add, sub} = Arithmetic;

    // factor to convert from pixels to imaginary coorindate
    // divided by two so we can use integers in dp below
    const f = div(div(ONE, zoom), TWO);

    // get real points for the grid
    const re = []
    for (let i = 0; i < width; i++) {
      const dp = 2 * i - (width - 1);
      const x = add(center_re, mul(f, dp));
      re.push(x);
    }

    // get imaginary points for the grid
    const im = [];
    for (let i = 0; i < height; i++) {
      const dp = 2 * i - (height - 1);
      const x = sub(center_im, mul(f, dp));
      im.push(x);
    }

    // get points in the grid
    const points = [];
    for (let j = 0; j < height; j++) {
      const c_im = im[j];

      for (let i = 0; i < width; i++) {
        const c_re = re[i];
        const point = new Point(c_re, c_im);
        point.idx = j * width + i;
        points.push(point);
      }
    }

    this.points = points;
    this.live = points;
  }

  initiate() {
    this.initiateImage();
    this.initiatePoints();
  }

  // iterals all live points and returns true iff the image changed
  iterate() {
    const [live, determined] = _.partition(this.live, p => (p.iterate() || p.undetermined));

    // colour newly determined points
    const imageData = this.image.data;

    determined.forEach((point) => {
      const i = point.idx * 4;

      if (point.escapeAge !== null) {
        const rgb = ageToRGB[point.escapeAge % ageToRGBCycleLength];
        imageData[i + 0] = rgb[0];
        imageData[i + 1] = rgb[1];
        imageData[i + 2] = rgb[2];
        imageData[i + 3] = 255;
      } else if (point.boundedByFormula) {
        imageData[i + 0] = 255;
        imageData[i + 1] = 0;
        imageData[i + 2] = 255;
        imageData[i + 3] = 255;
      } else {
        imageData[i + 0] = 0;
        imageData[i + 1] = 0;
        imageData[i + 2] = 0;
        imageData[i + 3] = 255;
      }
    });

    // update live list
    this.live = live;

    // return true iff pixels were updated
    return Boolean(determined.length);
  }
}