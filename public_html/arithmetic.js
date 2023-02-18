"use strict";

/**
 * Arithmetic provider based on standard javascript Numbers.
 * @constructor
 */
function NativeArithmetic() {
  const N = Number;

  return {
    precision: "native",
    N: N,
    toNumber: x => x,
    toBigInt: x => BigInt(x.toString()),

    mul: (a, b) => a * b,
    div: (a, b) => a / b,
    add: (a, b) => a + b,
    sub: (a, b) => a - b,
    mod: (x, y) => x % y,

    neg: a => -a,
    sqrt: Math.sqrt,
    sign: Math.sign,

    lt: (x, y) => x < y,
    gt: (x, y) => x > y,

    floor: x => Math.floor(x),
    ceil: x => Math.ceil(x),
    round: x => Math.round(x),

    // constants
    ZERO: 0,
    HALF: 0.5,
    ONE: 1,
    SQRT2: Math.sqrt(2),
    NEG_SQRT2: -1 * Math.sqrt(2),
    TWO: 2,
    NEG_TWO: -2,
    FOUR: 4,
    NEG_FOUR: -4,
  };
}

/**
 * Arithmetic provider based on multi-precision Decimal.js numbers
 * @constructor
 * @param {integer} precision - The number of decimal places that numbers are rounded to. 
 */
function DecimalArithmetic(precision) {
  const N = Decimal.clone({ precision: precision, defaults: true });

  return {
    precision: precision,

    N: x => {
      switch (typeof (x)) {
        case 'bigint':
          return N(x.toString());
        default:
          return N(x)
      }
    },

    toNumber: x => x.toNumber(),
    toBigInt: x => BigInt(x.toString()),

    mul: N.mul.bind(N),
    div: N.div.bind(N),
    add: N.add.bind(N),
    sub: N.sub.bind(N),
    mod: N.mod.bind(N),

    neg: x => x.neg(),
    sqrt: N.sqrt.bind(N),
    sign: N.sign.bind(N),

    lt: (x, y) => x.lt(y),
    gt: (x, y) => x.gt(y),

    floor: x => x.floor(),
    ceil: x => x.ceil(),
    round: x => x.round(),

    // constants
    ZERO: new N(0),
    HALF: (new N(1)).div(2),
    ONE: new N(1),
    SQRT2: new N(2).sqrt(),
    NEG_SQRT2: new N(2).sqrt().mul(-1),
    TWO: new N(2),
    NEG_TWO: new N(-2),
    FOUR: new N(4),
    NEG_FOUR: new N(-4),
  };
}

/**
 * Helper function to get an appropriate arithmetic provider.
 * @param {integer} precision - The number of decimal places that numbers are rounded to.
 */
function getArithmetic(precision) {
  if (!precision || precision <= 19)
    return NativeArithmetic();

   return DecimalArithmetic(precision);
}