import { Decimal } from 'lib/decimal.mjs';

// is the point in the main cardiod where the series always converges?
function mbInPrimary(re, im) {
  if (re.lessThan(-0.76)
    || re.moreThan(0.38)
    || im.lessThan(-0.66)
    || im.moreThan(0.66)
  ) return false;

  if (re.lessThan(0.23)
    && re.moreThan(-0.5)
    && im.lessThan(0.5)
    && im.moreThan(-0.5)
  ) return true;

  // full calculation (principle square root)
  // |sqrt(1 - 4c) - 1| < 1 with c = re + i * im

  // a = 1 - 4z
  const a_re = re.times(-4).add(1);
  const a_im = im.times(-4);
  const a_modulus = Decimal.sqrt(a_re.times(a_re).add(a_im.times(a_im)));

  // b = sqrt(a) = sqrt(1 - 4z)
  const b_re = Decimal.sqrt(a_modulus.add(a_re).divideBy(2));
  const b_im = Decimal.sqrt(a_modulus.minus(a_re).divideBy(2).times(Decimal.sign(a_im)));

  // d = b - 1 = sqrt(1 - 4z) - 1
  const d_re = b_re.minus(1);
  const d_im = b_im;

  // |d| < 1
  return d_re.times(d_re).add(d_im.times(d_im)).lessThan(1);
}

// is the point in the secondary circle when zn has period two in limit?
function mbInSecondary(re, im) {
  if (re.lessThan(-1.25)
    || re.moreThan(-0.75)
    || im.lessThan(-0.25)
    || im.moreThan(-0.25)
  ) return false;

  const re_plus_1 = re.add(1);
  return re_plus_1.times(re_plus_1).add(im.times(im)).lessThan(1 / 16);
}

// check if a point has escaped and will always diverge
function mbEscaped(re, im) {
  if (re.lessThan(-2)
    || re.moreThan(2)
    || im.lessThan(-2)
    || im.moreThan(2)
  ) return true;
  return re.times(re).add(im.times(im)).moreThan(4);
}


class Point {
  constructor(c_re, c_im) {
    this.c_re = Decimal(c_re);
    this.c_im = Decimal(c_im);

    this.z_re = Decimal(0);
    this.z_im = Decimal(0);
    this.age = 0;
    this.escapeAge = null;

    // we can know by formula that some values series remain bounded
    this.boundedByFormula = mbInPrimary(this.c_re, this.c_im) || mbInSecondary(this.c_re, this.c_im);

    // flag whether the point is determined yet
    this.undetermined = !this.boundedByFormula;
  }

  iterate() {
    const { z_re, z_im, c_re, c_im } = this;
    const re = z_re.times(z_re).minus(z_im.times(z_im)).plus(c_re);
    const im = z_re.times(z_im).times(2).add(c_im);

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
function mbSample(c_re, c_im, iterations = 1000) {
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
    this.center_re = Decimal(center_re);
    this.center_im = Decimal(center_im);
    this.zoom = Decimal(zoom);
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