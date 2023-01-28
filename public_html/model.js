"use strict";

// is the point in the main cardiod where the series always converges?
function mbInPrimary(re, im) {

  // short cut negative
  if (re > 0.38 || re < -0.76 || im > 0.66 || im < -0.66) {
    return false;
  }

  // short cut positive
  if (re < 0.23 && re > -0.5 && im < 0.5 && im > -0.5) {
    return true;
  }

  // full calculation (principle square root)
  // |sqrt(1 - 4c) - 1| < 1 with c = re + i * im

  // a = 1 - 4c
  const a_re = -4 * re + 1;
  const a_im = -4 * im;
  const a_r = Math.sqrt(a_re * a_re + a_im * a_im);

  // b = sqrt(a) = sqrt(1 - 4c)
  const b_re = Math.sqrt((a_r + a_re) / 2);
  const b_im = Math.sqrt((a_r - a_re) / 2) * Math.sign(a_im);

  // c = b - 1 = sqrt(1 - 4c) - 1
  const c_re = b_re - 1;
  const c_im = b_im;

  // |c| < 1
  return c_re * c_re + c_im * c_im < 1;
}

// is the point in the secondary circle when zn has period two in limit?
function mbInSecondary(re, im) {
  if (re < -1.25 || re > -0.75 || im < -0.25 || im > -0.25) return false;
  return (re + 1) * (re + 1) + im * im < 1 / 16;
}

function mbEscaped(re, im) {
  if (re < -2 || re > 2 || im < -2 || im > 2) return true;
  return re * re + im * im > 4;
}


class Point {
  constructor(c_re, c_im) {
    this.c_re = c_re;
    this.c_im = c_im;

    this.z_re = 0;
    this.z_im = 0;
    this.age = 0;
    this.escapeAge = null;

    // we can know by formula that some values series remain bounded
    this.boundedByFormula = mbInPrimary(c_re, c_im) || mbInSecondary(c_re, c_im);

    // flag whether the point is determined yet
    this.undetermined = !this.boundedByFormula;
  }

  iterate() {
    const { z_re, z_im, c_re, c_im } = this;
    const re = z_re * z_re - z_im * z_im + c_re;
    const im = 2 * z_re * z_im + c_im;

    this.z_re = re;
    this.z_im = im;
    this.age += 1;

    if (this.undetermined && mbEscaped(re, im)) {
      this.escapeAge = this.age;
      this.undetermined = false;
    }
  }
}

// give the complex numbers of a particular point to escape
// not optimised for speed
function mbSample(c_re, c_im, iterations = 100) {
  const point = new Point(c_re, c_im);

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

// Object that holds a regular rectangular grid of Point objects
class MandelbrotGrid {
  constructor(center_re, center_im, zoom, width, height) {
    this.center_re = center_re;
    this.center_im = center_im;
    this.zoom = zoom;
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
    const imageData = this.image.data;
    const imageDataLength = this.image.data.length;

    // set image to opaque black
    for (let i = 3; i < imageDataLength; i += 4) {
      imageData[i] = 255;
    }
  }

  initiatePoints() {
    const { center_re, center_im, zoom, width, height } = this;
    const points = [];

    // this could be vectorised for speed
    for (let j = 0; j < height; j++) {
      for (let i = 0; i < width; i++) {
        const dx = (i - (width - 1) / 2) / zoom;
        const dy = (j - (height - 1) / 2) / zoom;
        const c_re = center_re + dx;
        const c_im = center_im - dy;

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
      } else if (point.boundedByFormula) {
        imageData[i + 0] = 255;
        imageData[i + 1] = 0;
        imageData[i + 2] = 255;
      } else {
        imageData[i + 0] = 0;
        imageData[i + 1] = 0;
        imageData[i + 2] = 0;
      }
    });

    // update live list
    this.live = live;

    // return true iff pixels were updated
    return determined.length;
  }
}