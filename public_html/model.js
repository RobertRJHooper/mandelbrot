"use strict";


// is the point in the main cardiod where zn converges?
function mbInPrimary(c) {
  const { re, im } = c;

  // short cut negative
  if (re > 0.38 || re < -0.76 || im > 0.66 || im < -0.66) {
    return false;
  }

  // short cut positive
  if (re < 0.23 && re > -0.5 && im < 0.5 && im > -0.5) {
    return true;
  }

  // full calculation
  // modulus(sqrt(1-4c) - 1) < 1
  const z = math.add(math.sqrt(math.add(math.multiply(c, -4), 1)), -1);
  return math.abs(z) < 0.9999;
}

// is the point in the secondary circle when zn has period two in limit?
function mbInSecondary(c) {
  const re = c.re + 1;
  const im = c.im;
  return re * re + im * im < 1 / 16;
}

function mbEscaped(z) {
  const { re, im } = z;
  return re * re + im * im > 4;
}

function mbIterate(z, c) {
  const { re, im } = z;

  return math.complex(
    re * re - im * im + c.re,
    2 * re * im + c.im);
}

class Point {
  static zero = math.complex(0, 0);

  constructor(c, checkFormula = true) {
    this.c = c;
    this.z = Point.zero;
    this.age = 0;

    // escape has three values
    // true: escape happended at the given age
    // false: escape will never happen (determined externally by formula)
    // null: escape undetermined so far at this age
    this.escape = null;

    // formula checks
    if (checkFormula) {
      if (mbInPrimary(c) || mbInSecondary(c)) {
        this.escape = false;
      }
    }
  }

  undetermined() {
    return this.escape === null;
  }

  iterate() {
    if (this.undetermined()) {
      const zNext = mbIterate(this.z, this.c);

      this.age += 1;
      this.z = zNext;

      if (mbEscaped(zNext)) {
        this.escape = true;
      }
    }
  }
}

// give the complex numbers of a particular point to escape
function mbSample(c, maxIterations = 100) {
  const point = new Point(c, false);

  // runout of points
  const zi = [];

  // run to escape of max iterations
  while (point.undetermined() && point.age < maxIterations) {
    zi.push(point.z);
    point.iterate();
  }

  // add an extra iteration after the escape point
  if (point.age < maxIterations) {
    zi.push(mbIterate(point.c, point.z));
  }

  // append info to point and return
  point.zi = zi;
  return point;
}

// helper to get the complex value of an (x, y) point in the grid
function gridToValue(width, height, view, x, y) {
  const fx = (x + 0.5) / width;
  const fy = (y + 0.5) / height;

  return math.complex(
    view.topLeft.re + fx * view.width,
    view.topLeft.im - fy * view.height,
  );
}

// helper to get the (x, y) point in the grid from a complex point
function valueToGrid(width, height, view, z) {
  const fx = (z.re - view.topLeft.re) / width;
  const fy = (view.topLeft.im - z.im) / height;

  return {
    x: math.round(fx * width - 0.5),
    y: math.round(fy * height - 0.5),
  };
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

function ageToRGB(age) {
  const hue = math.mod(age / 30 + 0.61, 1);
  return hslToRgb(hue, 0.9, 0.5);
}

class MandelbrotGrid {
  constructor(width, height, view) {
    this.width = width;
    this.height = height;
    this.view = view;

    // flat list of all points
    this.points = null;

    // points where it is not yet determined whether the
    // point is in the mandelbrot set or not
    this.live = null;
  }

  initiate() {
    const { width, height, view } = this;

    function newPoint(x, y) {
      const c = gridToValue(width, height, view, x, y);
      const point = new Point(c);

      // add extra info to point structure
      point.idx = y * width + x;
      point.x = x;
      point.y = y;

      return point;
    }

    const points = [];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        points.push(newPoint(x, y));
      }
    }

    this.points = points;
    this.live = points;
  }

  iterate() {
    this.live.forEach(p => p.iterate());
  }

  // update the image with the new model data of live points
  // The image must be painted before a compact
  paint(image) {
    const data = image.data;

    for (const point of this.live) {
      const idx = point.idx * 4;
      const { escape, age } = point;

      if (escape === null) {
        data[idx + 0] = 0;
        data[idx + 1] = 0;
        data[idx + 2] = 0;
      } else if (escape) {
        const rgb = ageToRGB(age);
        data[idx + 0] = rgb[0];
        data[idx + 1] = rgb[1];
        data[idx + 2] = rgb[2];
      } else {
        data[idx + 0] = 255;
        data[idx + 1] = 0;
        data[idx + 2] = 255;
      }
    }
  }

  // update live list
  compact() {
    this.live = this.live.filter(p => p.undetermined());
  }
}