"use strict";

importScripts(
  'lib/lodash.min.js',
  //  'lib/decimal.js',
  'arithmetic.js',
  'model.js'
);

// minmum period for sample debouncing
const sampleIterations = 1000;

// current Arithmetic system in use (depending on precision required)
// always use just native arithmetic for sampling
var Arithmetic = NativeArithmetic();

// last sample point request ID
var requestID = null;


function getSample(re, im, iterations) {
  const N = Arithmetic.N;

  // point iterator
  const point = new Point(N(re), N(im));

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
    if (point.escapeAge && point.escapeAge + 1 < point.age) break;
  }

  // determine if the point is known bounded
  const boundedByFormula = Arithmetic.mbCheckFormula(re, im);

  // this only works for native numbers as high precision would
  // require encoded to post back to client
  return {
    re: re,
    im: im,
    runout: runout,
    escapeAge: point.escapeAge,
    boundedByFormula: boundedByFormula,
    determined: boundedByFormula || point.determined,
  }
}

function processRequest(re, im) {
  const sample = getSample(re, im, sampleIterations);
  postMessage(sample);
}

// attach incoming message handler
// multiple requests will fall through to the final request
onmessage = e => {
  const re = e.data.re, im = e.data.im;
  
  // overwrite any pending request
  clearTimeout(requestID);
  requestID = setTimeout(() => processRequest(re, im), 0);
}