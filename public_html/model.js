"use strict";

function mb_iterate(z, c) {
  let zr = z.re;
  let zi = z.im;
  let r = zr * zr - zi * zi + c.re;
  let i = 2 * zr * zi + c.im;
  return math.complex(r, i);
}

function mb_escaped(z) {
  let zr = z.re;
  let zi = z.im;
  return zr * zr + zi * zi > 4;
}

// is the point in the main cardiod when zn converges?
function mb_in_primary(c) {
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
function mb_in_secondary(c) {
  let zr = c.re + 1;
  let zi = c.im;
  return zr * zr + zi * zi < 1 / 16;
}

function ageToRGB(age) {
  let hue = math.mod(age / 30 + 0.6, 1);
  return hslToRgb(hue, 0.9, 0.5);
}

class MandelbrotSetModel {
  constructor(center, resolution, width, height, max_iterations) {
    this.center = center;
    this.resolution = resolution;
    this.width = width;
    this.height = height;
    this.max_iterations = max_iterations;

    // number of iterations completed
    this.iteration = 0;

    // flat list of points
    this.points = null;

    // points where convergeance is not yet determined
    this.live = null;
  }

  // helper to get the complex value of an (x, y) point in the grid
  coordinatesToValue(x, y) {
    const dx = x - (this.width - 1) / 2;
    const dy = (this.height - 1) / 2 - y;

    return math.complex({
      re: this.center.re + this.resolution * dx,
      im: this.center.im + this.resolution * dy,
    });
  }

  // helper to get the (x, y) point in the grid from a complex point
  valueToCoordinates(z) {
    const dx = (z.re - this.center.re) / this.resolution;
    const dy = (z.im - this.center.im) / this.resolution;

    return {
      x: math.round(dx + (this.width - 1) / 2),
      y: math.round((this.height - 1) / 2 - dy),
    };
  }

  // initiate point structures
  initiate() {
    const z0 = math.complex(0, 0);
    const {width, height} = this;
    const points = [];
    
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        points.push({
          x: x,
          y: y,
          c: null,
          z: z0,
          age: 0,
          in_mbs: null,
        });
      }
    }
    
    // set c values for the points with vectorisation
    for (const point of points) {
      point.c = this.coordinatesToValue(point.x, point.y)
    }

    this.points = points;
    this.live = points;
  }
  
  // for the first iteration use known formula
  // then iterate points using the iteration function
  iterate() {
    if (this.iteration == 0) {
      for (let point of this.live) {
        const c = point.c;

        if(mb_escaped(c)) {
          point.in_mbs = false;
        } else if (mb_in_primary(c) || mb_in_secondary(c)) {
          point.in_mbs = true;
        }
      }
    }

    if (this.iteration > 0) {
      for (let point of this.live) {
        if (point.in_mbs !== null) {
          continue; // already determined
        }

        if (point.age >= this.max_iterations) {
          continue; // limit reached
        }

        point.z = mb_iterate(point.z, point.c);
        point.age += 1;

        if (mb_escaped(point.z)) {
          point.in_mbs = false;
        }
      }
    }

    this.iteration += 1;
  }

  // update the image with the new model data of live points
  // The image must be painted before a compact
  paint(image) {
    const data = image.data;
    const width = this.width;
    
    for (let point of this.live) {
      const in_mbs = point.in_mbs;
      const idx = (point.y * width + point.x) * 4;

      if(in_mbs === false) {
        const rgb = ageToRGB(point.age);
        data[idx + 0] = rgb[0];
        data[idx + 1] = rgb[1];
        data[idx + 2] = rgb[2];
      } else {
        data[idx + 0] = 0;
        data[idx + 1] = 0;
        data[idx + 2] = 0;
      }
    }
  }

  // update live list
  compact() {
    this.live = this.live.filter(p => p.in_mbs === null);
  }
}