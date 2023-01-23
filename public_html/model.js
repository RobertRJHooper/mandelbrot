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
  const z = math.sqrt(math.complex(-4 * c.re + 1, -4 * c.im));
  z.re = z.re - 1;
  return z.re * z.re + z.im * z.im < 0.9999;
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
  z.re = re * re - im * im + c.re;
  z.im = 2 * re * im + c.im;
}

class Point {
  constructor(c) {
    this.c = c;
    this.z = math.complex(0, 0);
    this.age = 0;
    this.escapeAge = null;

    // we can know by formula that some values series remain bounded
    this.boundedByFormula = mbInPrimary(c) || mbInSecondary(c);

    // flag whether the point is determined yet
    this.undetermined = !this.boundedByFormula;
  }

  iterate() {
    mbIterate(this.z, this.c);
    this.age += 1;

    if (this.undetermined && mbEscaped(this.z)) {
      this.escapeAge = this.age;
      this.undetermined = false;
    }
  }
}

// give the complex numbers of a particular point to escape
function mbSample(c, iterations = 100) {
  const point = new Point(c);

  // runout of points
  const zi = [];

  // run to escape of max iterations
  while (point.age < iterations) {
    zi.push(math.complex(point.z));
    point.iterate();

    if (point.escapeAge && point.escapeAge + 1 < point.age) {
        break;
    }
  }

  // append info to point
  point.zi = zi;
  return point;
}

// helper to get the complex value of an (x, y) point in the grid
function gridToValue(center, resolution, width, height, i, j) {
  const dx = (i - (width - 1) / 2) / resolution;
  const dy = (j - (height - 1) / 2) / resolution;
  return math.complex(center.re + dx, center.im + dy);
}

// helper to get the (x, y) point in the grid from a complex point
function valueToGrid(width, height, view, z) {
  throw Error('not implemented');
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
  constructor(center, resolution, width, height, step = 1, offset = 0) {
    this.center = center;
    this.resolution = resolution;
    this.width = width;
    this.height = height;
    this.image = null;

    // step and offset are used to only consider
    // a portion of the points so we can have
    // multiple grids on different cpus
    // working on one view
    this.step = step;
    this.offset = offset;

    // flat list of all points
    this.points = null;

    // points where it is not yet determined whether the
    // point is in the mandelbrot set or not
    this.live = null;
  }

  initiateImage() {
    const { width, height, step, offset } = this;

    this.image = new ImageData(width, height);  
    const imageData = this.image.data;
    const imageDataLength = this.image.data.length;
    const stride = 4 * step;
    
    for (let i = 4 * offset; i < imageDataLength; i += stride) {
      imageData[i + 0] = 0;
      imageData[i + 1] = 0;
      imageData[i + 2] = 0;
      imageData[i + 3] = 255;
    }
  }

  initiatePoints() {
    const { center, resolution, width, height, step, offset} = this;
    const points = [];

    // this could be vectorised for speed
    for (let j = 0; j < height; j++) {
      for (let i = 0; i < width; i++) {
        const idx = j * width + i;

        // filter to relevant subset of points
        if (idx % step != offset) {
          continue;
        }

        const point = new Point(gridToValue(center, resolution, width, height, i, j));
        point.idx = idx;
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

      if(point.escapeAge !== null) {
        const rgb = ageToRGB(point.escapeAge);
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

    // return true if pixels were updated
    return determined.length;
  }
}