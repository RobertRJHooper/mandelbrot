"use strict";

function mbIterate(z, c) {
  const zr = z.re;
  const zi = z.im;
  const r = zr * zr - zi * zi + c.re;
  const i = 2 * zr * zi + c.im;
  return math.complex(r, i);
}

function mbEscaped(z) {
  const zr = z.re;
  const zi = z.im;
  return zr * zr + zi * zi > 4;
}

// is the point in the main cardiod when zn converges?
function mbInPrimary(c) {
  if (c.re < 0.23 && c.re > -0.5 && c.im < 0.5 && c.im > -0.5) {
    return true; // short cut positive
  }

  if (c.re > 0.38 || c.re < -0.76 || c.im > 0.66 || c.im < -0.66) {
    return false; // short cut negative
  }

  // full calculation
  const z = math.add(math.sqrt(math.add(math.multiply(c, -4), 1)), -1);
  return math.abs(z) < 0.999;
}

// is the point in the secondary circle when zn has period two in limit?
function mbInSecondary(c) {
  const zr = c.re + 1;
  const zi = c.im;
  return zr * zr + zi * zi < 1 / 16;
}

// give the complex numbers of a particular point to escape
function mbSample(c, maxIterations = 100) {
  let inMBS = null;
  
  // check for simple bounded areas
  if (mbInPrimary(c) || mbInSecondary(c)) {
    inMBS = true;
  }
  
  // get runout of points
  let z = c;
  const zn = [];
  let escapeAge = null;
  
  for (let i = 0; i < maxIterations; i++) {
    zn.push(z);

    if (escapeAge === null && mbEscaped(z)) {
      escapeAge = i;
      inMBS = false;

      // include one iteration after escape
      maxIterations = i + 2;
    }

    z = mbIterate(z, c);
  }

  return {
    c: c,
    zn: zn,
    inMBS: inMBS,
    escapeAge: escapeAge,
  }
}

function ageToRGB(age) {
  const hue = math.mod(age / 30 + 0.61, 1);
  return hslToRgb(hue, 0.9, 0.5);
}

class MandelbrotSetModel {
  constructor(viewTopLeft, viewWidth, viewHeight, gridWidth, gridHeight) {
    this.viewTopLeft = viewTopLeft;
    this.viewWidth = viewWidth;
    this.viewHeight = viewHeight;
    this.gridWidth = gridWidth;
    this.gridHeight = gridHeight;

    // number of iterations completed
    this.iteration = 0;

    // flat list of points
    this.points = null;

    // points where convergeance is not yet determined
    this.live = null;
  }

  // helper to get the complex value of an (x, y) point in the grid
  gridToValue(x, y) {
    const fx = (x + 0.5) / this.gridWidth;
    const fy = (y + 0.5) / this.gridHeight;

    return math.complex(
      this.viewTopLeft.re + fx * this.viewWidth,
      this.viewTopLeft.im - fy * this.viewHeight,
    );
  }

  // helper to get the (x, y) point in the grid from a complex point
  valueToGrid(z) {
    const fx = (z.re - this.viewTopLeft.re) / this.viewWidth;
    const fy = (this.viewTopLeft.im - z.im) / this.viewHeight;

    return {
      x: math.round(fx * this.gridWidth - 0.5),
      y: math.round(fy * this.gridHeight - 0.5),
    };
  }

  initiate() {
    const z0 = math.complex(0, 0);
    const { gridWidth, gridHeight } = this;
    const points = [];

    for (let y = 0; y < gridHeight; y++) {
      for (let x = 0; x < gridWidth; x++) {
        points.push({
          x: x,
          y: y,
          c: null,
          z: z0,
          age: 0,
          inMBS: null,
        });
      }
    }

    // set c values for the points with vectorisation
    for (const point of points) {
      point.c = this.gridToValue(point.x, point.y)
    }

    this.points = points;
    this.live = points;
  }

  // for the first iteration use known formula
  // then iterate points using the iteration function
  iterate() {
    if (this.iteration == 0) {
      for (const point of this.live) {
        const c = point.c;

        if (mbEscaped(c)) {
          point.inMBS = false;
        } else if (mbInPrimary(c) || mbInSecondary(c)) {
          point.inMBS = true;
        }
      }
    }

    if (this.iteration > 0) {
      for (const point of this.live) {
        if (point.inMBS !== null) {
          continue; // already determined
        }

        point.z = mbIterate(point.z, point.c);
        point.age += 1;

        if (mbEscaped(point.z)) {
          point.inMBS = false;
        }
      }
    }

    this.iteration += 1;
  }

  // update the image with the new model data of live points
  // The image must be painted before a compact
  paint(image) {
    const data = image.data;
    const gridWidth = this.gridWidth;

    for (const point of this.live) {
      const idx = (point.y * gridWidth + point.x) * 4;

      if (point.inMBS === null || point.inMBS == true) {
        data[idx + 0] = 0;
        data[idx + 1] = 0;
        data[idx + 2] = 0;
      } else if (point.inMBS === false) {
        const rgb = ageToRGB(point.age);
        data[idx + 0] = rgb[0];
        data[idx + 1] = rgb[1];
        data[idx + 2] = rgb[2];
      }
    }
  }

  // update live list
  compact() {
    this.live = this.live.filter(point => point.inMBS === null);
  }
}