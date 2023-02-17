"use strict";

// these functions require an arithmetic system set up
// under the global variable Artihmetic with the required precision
// var Arithmetic = getArithmetic(15);

class Point {
  constructor(c_re, c_im) {
    const { mul } = Arithmetic;

    this.c_re = c_re;
    this.c_im = c_im;

    this.age = 1;
    this.z_re = c_re;
    this.z_re2 = mul(c_re, c_re); // z_re squared
    this.z_im = c_im;
    this.z_im2 = mul(c_im, c_im); // z_im squared

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
    if (this.escaped() && !this.determined) {
      this.determined = true;
      this.escapeAge = this.age;
    }
  }
}

// a single runout for a point
function getSample(re, im, iterations) {
  const { N } = Arithmetic;

  // point iterator
  const point = new Point(re, im);

  // runout of points (= z_i)
  const runout = [];

  // push origin
  runout.push([N(0), N(0)]);

  // run to escape of maximum 'iterations'
  // and add each iteration z to the runout
  while (point.age < iterations) {
    runout.push([point.z_re, point.z_im]);
    point.iterate();

    // break earlier a couple of iterations after escape
    if (point.escapeAge && point.escapeAge + 1 < point.age)
      break;
  }

  return {
    re: re,
    im: im,
    runout: runout,
    escapeAge: point.escapeAge,
    determined: point.determined,
  }
}

// points in the main cardiod can be found by formula
// and are known to be part of the mandelbrot set
class MainCardiod {

  // smallest bounding rectangle for the main cardiod
  // left, right, bottom, top
  static exclusion = [-0.76, 0.38, -0.66, +0.66];

  // rectangles inside for the main cardiod
  // left, right, bottom, top
  static inclusions = [
    [-0.51, 0.23, -0.51, +0.51],
    [-0.675, -0.5, -0.305, +0.305],
    [-0.354, 0.1, +0.5, +0.603],
    [-0.354, 0.1, -0.603, -0.5],
    [+0.23, 0.33, +0.061, +0.388],
    [+0.23, 0.33, -0.388, -0.061],
  ];

  constructor() {
    const { N } = Arithmetic;

    // setup according to the current global Artithmetic at instance creation time
    this.exclusion = MainCardiod.exclusion.map(N);
    this.inclusions = MainCardiod.inclusions.map(r => r.map(N));
  }

  // check if a point is in the main cardiod
  test(re, im) {
    const { lt, gt } = Arithmetic;

    // short-circuit negative
    const [a, b, c, d] = this.exclusion;

    if (lt(re, a) || gt(re, b) || lt(im, c) || gt(im, d))
      return false;

    // short-circuit positive
    for (const rect of this.inclusions) {
      const [e, f, g, h] = rect;

      if (gt(re, e) && lt(re, f) && gt(im, g) && lt(im, h))
        return true;
    }

    // the calculation below are costly for high precision
    // and will cause an initial delay to display

    // full calculation for main cardiod using principle square root
    // |sqrt(1 - 4c) - 1| < 1 with c = re + i * im
    const { mul, div, add, sub, sqrt, sign, ONE, TWO, NEG_FOUR } = Arithmetic;

    // u = 1 - 4z
    const u_re = add(mul(re, NEG_FOUR), ONE);
    const u_im = mul(im, NEG_FOUR);

    const u_re2 = mul(u_re, u_re);
    const u_im2 = mul(u_im, u_im);
    const u_mod = sqrt(add(u_re2, u_im2));

    // v = sqrt(u) = sqrt(1 - 4z)
    const v_re = sqrt(div(add(u_mod, u_re), TWO));
    const v_im_abs = sqrt(div(sub(u_mod, u_re), TWO));
    const v_im = mul(v_im_abs, sign(u_im));

    // w = v - 1 = sqrt(1 - 4z) - 1
    const w_re = sub(v_re, ONE);
    const w_im = v_im;
    const w_re2 = mul(w_re, w_re);
    const w_im2 = mul(w_im, w_im);
    const w_mod2 = add(w_re2, w_im2);

    // |w| < 1
    return lt(w_mod2, ONE);
  }
}

// A bulb is a circle on the complex plane that is
// known to be in the mandelbrot set
class Bulb {
  constructor(re, im, radius) {
    const { N, mul, div, add, sub, SQRT2 } = Arithmetic;

    this.re = N(re);
    this.im = N(im);
    this.radius = N(radius);
    this.radius2 = mul(this.radius, this.radius);

    // length of largest square contained by the bulb
    this.containedSquareLength = div(this.radius, SQRT2);

    // containing square and internal square
    // for inclusion and exclusion short-circuits
    // left, right, bottom, top
    this.exclusion = [
      sub(re, this.radius),
      add(re, this.radius),
      sub(im, this.radius),
      add(im, this.radius)
    ];

    this.inclusion = [
      sub(re, this.containedSquareLength),
      add(re, this.containedSquareLength),
      sub(im, this.containedSquareLength),
      add(im, this.containedSquareLength)
    ];
  }

  test(re, im) {
    const { lt, gt } = Arithmetic;

    // short-circuit negative
    const [a, b, c, d] = this.exclusion;

    if (lt(re, a) || gt(re, b) || lt(im, c) || gt(im, d))
      return false;

    // short-circuit positive
    const [e, f, g, h] = this.inclusion;

    if (gt(re, e) && lt(re, f) && gt(im, g) && lt(im, h))
      return true;

    // full circle calculation
    const { mul, add, sub } = Arithmetic;

    const dx = sub(re, this.re);
    const dx2 = mul(dx, dx);
    const dy = sub(im, this.im);
    const dy2 = mul(dy, dy);
    return lt(add(dx2, dy2), this.radius2);
  }
}

// get the major bulbs in the current Arithmetic
// TODO: add more buls to these
function getKnownRegions() {
  return [
    new MainCardiod(),
    new Bulb(-1, 0, 0.250),
  ];
}