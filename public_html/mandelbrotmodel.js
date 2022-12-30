"use strict";

export function mb_iterate(z, c) {
  let zr = z.re;
  let zi = z.im;
  let r = zr * zr - zi * zi + c.re;
  let i = 2 * zr * zi + c.im;
  return math.complex(r, i);
}

export function mb_escaped(z) {
  let zr = z.re;
  let zi = z.im;
  return zr * zr + zi * zi > 4;
}

// is the point in the main cardiod when zn converges?
export function mb_in_primary(c) {
  if (c.re < 0.23 && c.re > -0.5 && c.im < 0.5 && c.im > -0.5) {
    return true; // short cut positive
  }

  if (c.re > 0.38 || c.re < -0.76 || c.im > 0.66 || c.im < -0.66) {
    return false; // short cut negative
  }

  // full calculation
  let z = math.add(math.sqrt(math.add(math.multiply(c, -4), 1)), -1);
  return math.abs(z) < 0.999;
}

// is the point in the secondary circle when zn has period two in limit?
export function mb_in_secondary(c) {
  let zr = c.re + 1;
  let zi = c.im;
  return zr * zr + zi * zi < 1 / 16;
}


export class MandelbrotSetModel {
  constructor(top_right, bottom_left, width, height) {
    this.top_left = top_left;
    this.bottom_right = bottom_right;
    this.width = width;
    this.height = height;

    // distance between points
    this.dx = (this.bottom_right.re - this.top_left.re) / this.width
    this.dy = (this.top_left.im - this.bottom_right.im) / this.height

    // number of iterations completed
    this.iteration = 0;

    // flat list of points
    this.points = [];

    // points where convergeance is not yet determined
    this.live = this.points;

    // initiate point structures
    for (let j = 0; j < this.height; j++) {
      for (let i = 0; i < this.width; i++) {
        let c = this.coordinatesToValue(i, j);

        // do we know already that the value doesn't escape
        let never_escapes = mb_in_primary(c) || mb_in_secondary(c);

        let point = {
          i: i,
          j: j,
          c: c,
          z: math.complex(0, 0),
          age: 0,
          in_mbs: never_escapes ? true : null,
        };

        this.points.push(point);
      }
    }
  }

  coordinatesToValue(x, y) {
    let fx = (x + 0.5) / this.width;
    let fy = (y + 0.5) / this.height;

    return math.complex({
      re: this.top_left.re * fx + this.bottom_right.re * (1 - fx),
      im: this.top_left.im * fy + this.bottom_right.im * (1 - fy),
    });
  }

  valueToCoordinates(z) {
    let fx = (z.re - this.bottom_right.re) / (this.top_left.re - this.bottom_right.re);
    let fy = (z.im - this.bottom_right.im) / (this.top_left.im - this.bottom_right.im);

    return {
      x: math.round(fx * this.width - 0.5),
      y: math.round(fy * this.height - 0.5),
    };
  }

  iterate() {
    for (let p of this.live) {
      if (p.in_mbs !== null) {
        continue; // already determined
      }

      p.z = mb_iterate(p.z, p.c);
      p.age += 1;

      if (mb_escaped(p.z)) {
        p.in_mbs = false;
      }
    }

    // update live list if many are determined
    let determined = this.live.reduce((count, p) => count + (p.in_mbs === null ? 0 : 1), 0);

    if (determined > this.live.length * 0.3) {
      this.live = this.live.filter(p => p.in_mbs === null);
    }

    // update stats
    this.iteration += 1;
  }
}


