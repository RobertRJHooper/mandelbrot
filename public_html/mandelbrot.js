"use strict";

/**
 * these functions require an arithmetic system set up 
 * under the global variable Artihmetic with the required precision
 * var Arithmetic = getArithmetic(15);
 */

/** Class representing a point on the complex plane that can be iterated under the mandelbrot set transformation z -> z² + c. */
class Point {
  /**
  * Create a point
  * @param {object} re - Real value of the complex point
  * @param {object} im - Imaginary value of the complex point
  */
  constructor(re, im) {
    const { mul } = Arithmetic;

    this.c_re = re;
    this.c_im = im;

    this.age = 1;
    this.z_re = re;
    this.z_re2 = mul(re, re); // z_re squared
    this.z_im = im;
    this.z_im2 = mul(im, im); // z_im squared

    if (this.escaped()) {
      this.determined = true;
      this.escapeAge = this.age;
    } else {
      this.determined = false;
      this.escapeAge = null;
    }
  }

  /**
   * Check if the point has escaped from the disk about the origin radius 2 at the current iteration.
   * @returns {boolean} True if and only if the point has escaped
   */
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

  /**
   * Iterate the current point once and check if escape has occurred
   */
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

/**
 * Generate a sample of a complex point run out under mandelbrot iteration until escape or the specified number of iterations have happened
 * @param {object} re - Real value of the complex point
 * @param {object} im - Imaginary value of the complex point
 * @param {integer} iterations - The number of iterations to stop the calculation if escape has not occured
 * @return {object} An object containing the runout, escape age and a flag wheter the point was determined by the end of the iterations. 
 */
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

/* A class representing the main cardiod of the mandelbrot set */
class MainCardiod {

  // smallest bounding rectangle for the main cardiod: left, right, bottom, top
  static exclusion = [-0.76, 0.38, -0.66, +0.66];

  // rectangles inside for the main cardiod: left, right, bottom, top
  static inclusions = [
    [-0.51, 0.23, -0.51, +0.51],
    [-0.675, -0.5, -0.305, +0.305],
    [-0.354, 0.1, +0.5, +0.603],
    [-0.354, 0.1, -0.603, -0.5],
    [+0.23, 0.33, +0.061, +0.388],
    [+0.23, 0.33, -0.388, -0.061],
  ];

  /**
   * Constructor for the class that uses the current global Artithmetic at time of creation
   */
  constructor() {
    const { N } = Arithmetic;

    // setup according to the current global Artithmetic at instance creation time
    this.exclusion = MainCardiod.exclusion.map(N);
    this.inclusions = MainCardiod.inclusions.map(r => r.map(N));
  }

  /**
   * Check if a point is in the main cardiod.
   * @param {object} re - The real value of the point to test
   * @param {object} im - The imaginary value of the point to test
   */
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

/* Class representing a bulb (a circle) on the complex plane that is known to be in the mandelbrot set */
class Bulb {
  /**
   * Contructor for the bulb class.
   * @param {object} re - Real point of the center of the bulb
   * @param {object} im - Imaginary point of the center of the bulb
   * @param {object} radius - Radius of the bulb in the complex plane
   * 
   */
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

  /**
 * Check if a point is in the bulb.
 * @param {object} re - The real value of the point to test
 * @param {object} im - The imaginary value of the point to test
 */
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

/* A helper to return known major regions inside the mandelbrot set */
function getKnownRegions() {
  return [
    new MainCardiod(),
    new Bulb(-1, 0, 0.250),
  ];
}