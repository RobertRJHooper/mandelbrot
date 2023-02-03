
// varying precision floating point functions
function DecimalArithmetic(precision) {
  let D = Decimal.clone({ precision: precision, defaults: true });

  // build to Artithmetic constants/functions set
  let A = {
    Number: x => new D(x),
    mul: D.mul.bind(D),
    div: D.div.bind(D),
    add: D.add.bind(D),
    sub: D.sub.bind(D),
    lt: (x, y) => x.lt(y),
    gt: (x, y) => x.gt(y),

    // constants
    ZERO: new D(0),
    ONE: new D(1),
    SQRT2: new D(2).sqrt(),
    NEG_SQRT2: new D(2).sqrt().mul(-1),
    TWO: new D(2),
    NEG_TWO: new D(-2),
    FOUR: new D(4),
    NEG_FOUR: new D(-4),
  };

  // mandelbrot escape test:
  // check if a point has escaped and will always diverge with further iterations
  A.mbEscaped = function (re, im) {
    if (re.lt(A.SQRT2) && re.gt(A.NEG_SQRT2) && im.lt(A.SQRT2) && im.gt(A.NEG_SQRT2))
      return false;

    if (re.lt(A.NEG_TWO) || re.gt(A.TWO) || im.lt(A.NEG_TWO) || im.gt(A.TWO))
      return true;

    const im2 = im.mul(im);
    const re2 = re.mul(re);
    return im2.add(re2).gt(A.FOUR);
  };

  // smallest bounding rectangle for the main cardiod
  // left, right, bottom, top
  A.CARIDOID_EXC = [new D(-0.76), new D(0.38), new D(-0.66), new D(+0.66)];

  // maximum internal rectangle for the main cardiod
  // left, right, bottom, top
  A.CARDIOID_INC = [new D(-0.5), new D(0.23), new D(-0.5), new D(+0.5)];

  // is the point in the main cardiod region
  A.mbInMainCardiod = function (re, im) {
    const [a, b, c, d] = A.CARIDOID_EXC;
    if (re.lt(a) || re.gt(b) || im.lt(c) || im.gt(d)) return false;

    const [e, f, g, h] = A.CARDIOID_INC;
    if (re.gt(e) && re.lt(f) && im.gt(g) && im.lt(h)) return true;

    // full calculation for main cardiod using principle square root
    // |sqrt(1 - 4c) - 1| < 1 with c = re + i * im

    // u = 1 - 4z
    const u_re = re.mul(A.NEG_FOUR).add(A.ONE);
    const u_im = im.mul(A.NEG_FOUR);
    const u_modulus = D.sqrt(u_re.mul(u_re).add(u_im.mul(u_im)));

    // v = sqrt(u) = sqrt(1 - 4z)
    const v_re = D.sqrt(u_modulus.add(u_re).div(A.TWO));
    const v_im = D.sqrt(u_modulus.sub(u_re).div(A.TWO)).mul(D.sign(u_im));

    // w = v - 1 = sqrt(1 - 4z) - 1
    const w_re = v_re.sub(A.ONE);
    const w_im = v_im;
    const w_re2 = w_re.mul(w_re);
    const w_im2 = w_im.mul(w_im);

    // |w| < 1
    return w_re2.add(w_im2).lt(A.ONE);
  };

  // primary circles known to be in the mandelbrot set
  // re real im imaginary r radius
  A.BULBS = [
    { re: new D(-1.000), im: new D(+0.000), r: new D(0.250) },
    { re: new D(-1.320), im: new D(+0.000), r: new D(0.065) },
    { re: new D(-0.150), im: new D(+0.750), r: new D(0.090) },
    { re: new D(-0.150), im: new D(-0.750), r: new D(0.090) },
  ];

  // add excluding and including bounding rectangles to the bulbs
  for (const bulb of A.BULBS) {
    const { re, im, r } = bulb;
    const l = r.div(A.SQRT2);

    // left, right, bottom, top
    bulb.exclusion = [re.sub(r), re.add(r), im.sub(r), im.add(r)];
    bulb.inclusion = [re.sub(l), re.add(l), im.sub(l), im.add(l)];
    bulb.r2 = r.mul(r);
  }

  // is a point in the given bulb circle
  A.mbBulbContains = function(bulb, re, im) {
    const [a, b, c, d] = bulb.exclusion;
    if (re.lt(a) || re.gt(b) || im.lt(c) || im.gt(d)) return false;

    const [e, f, g, h] = bulb.inclusion;
    if (re.gt(e) && re.lt(f) && im.gt(g) && im.lt(h)) return true;

    // full circle calculation
    const dx = re.sub(bulb.re);
    const dy = im.sub(bulb.im);
    const dx2 = dx.mul(dx);
    const dy2 = dy.mul(dy);
    return dx2.add(dy2).lt(bulb.r2);
  }

  // is the point in one of the major bulbs?
  A.mbInPrimaryBulb = function(re, im) {
    return A.BULBS.some(bulb => A.mbBulbContains(bulb, re, im));
  }

  // all done
  return A;
}

// use normal javascript floats
function NativeArithmetic() {
  let D = Number;

  // build to Artithmetic constants/functions set
  let A = {
    Number: D,
    mul: (a, b) => a * b,
    div: (a, b) => a / b,
    add: (a, b) => a + b,
    sub: (a, b) => a - b,
    lt: (x, y) => x < y,
    gt: (x, y) => x > y,

    // constants
    ZERO: 0,
    ONE: 1,
    SQRT2: Math.sqrt(2),
    NEG_SQRT2: -1 * Math.sqrt(2),
    TWO: 2,
    NEG_TWO: -2,
    FOUR: 4,
    NEG_FOUR: -4,
  };

  // mandelbrot escape test:
  // check if a point has escaped and will always diverge with further iterations
  A.mbEscaped = function (re, im) {
    const sqrt2 = A.SQRT2;

    if (re < sqrt2 && re > -sqrt2 && im < sqrt2 && im.gt > -sqrt2)
      return false;

    if (re < -2 || re > 2 || im < -2 || im > 2)
      return true;

    const im2 = im * im;
    const re2 = re * re;
    return im2 + re2 > 4;
  };

  // smallest bounding rectangle for the main cardiod
  // left, right, bottom, top
  A.CARIDOID_EXC = [-0.76, 0.38, -0.66, +0.66];

  // maximum internal rectangle for the main cardiod
  // left, right, bottom, top
  A.CARDIOID_INC = [-0.5, 0.23, -0.5, +0.5];

  // is the point in the main cardiod region
  A.mbInMainCardiod = function (re, im) {
    const [a, b, c, d] = A.CARIDOID_EXC;
    if (re < a || re > b || im < c || im > d) return false;

    const [e, f, g, h] = A.CARDIOID_INC;
    if (re > e && re < f && im > g && im < h) return true;

    // full calculation for main cardiod using principle square root
    // |sqrt(1 - 4c) - 1| < 1 with c = re + i * im

    // u = 1 - 4z
    const u_re = re * -4 + 1;
    const u_im = im * -4;
    const u_modulus = Math.sqrt(u_re * u_re + u_im * u_im);

    // v = sqrt(u) = sqrt(1 - 4z)
    const v_re = Math.sqrt((u_modulus + u_re) / 2);
    const v_im = Math.sqrt((u_modulus - u_re) / 2) * Math.sign(u_im);

    // w = v - 1 = sqrt(1 - 4z) - 1
    const w_re = v_re - 1;
    const w_im = v_im;
    const w_re2 = w_re * w_re;
    const w_im2 = w_im * w_im;

    // |w| < 1
    return w_re2 + w_im2 < 1;
  };

  // primary circles known to be in the mandelbrot set
  // re real im imaginary r radius
  A.BULBS = [
    { re: -1.000, im: +0.000, r: 0.250 },
    { re: -1.320, im: +0.000, r: 0.065 },
    { re: -0.150, im: +0.750, r: 0.090 },
    { re: -0.150, im: -0.750, r: 0.090 },
  ];

  // add excluding and including bounding rectangles to the bulbs
  for (const bulb of A.BULBS) {
    const { re, im, r } = bulb;
    const l = r / A.SQRT2;

    // left, right, bottom, top
    bulb.exclusion = [re - r, re + r, im - r, im + r];
    bulb.inclusion = [re - l, re + l, im - l, im + l];
    bulb.r2 = r * r;
  }

  // is a point in the given bulb circle
  A.mbBulbContains = function(bulb, re, im) {
    const [a, b, c, d] = bulb.exclusion;
    if (re < a || re > b || im < c || im > d) return false;

    const [e, f, g, h] = bulb.inclusion;
    if (re > e && re < f && im > g && im < h) return true;

    // full circle calculation
    const dx = re - bulb.re;
    const dy = im - bulb.im;
    const dx2 = dx * dx;
    const dy2 = dy * dy;
    return dx2 + dy2 < bulb.r2;
  }

  // is the point in one of the major bulbs?
  A.mbInPrimaryBulb = function(re, im) {
    return A.BULBS.some(bulb => A.mbBulbContains(bulb, re, im));
  }

  // all done
  return A;
}