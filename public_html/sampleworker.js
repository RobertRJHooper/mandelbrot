"use strict";

importScripts(
  'lib/lodash.min.js',
  'lib/decimal.js',
  'arithmetic.js',
  'mandelbrot.js',
);

// maximum iterations for samples
const sampleIterations = 1000;

// current Arithmetic system in use (depending on precision required)
var Arithmetic = null;

// last sample point request ID
var requestID = null;

function processRequest(re, im, precision) {
  if(!Arithmetic || Arithmetic.precision != precision)
    Arithmetic = getArithmetic(precision);
  
  // generate sample in model.js
  const { N } = Arithmetic;
  const sample = getSample(N(re), N(im), sampleIterations);

  // encode variable precision numbers to strings
  sample.re = sample.re.toString();
  sample.im = sample.im.toString();
  sample.runout = sample.runout.map(z => z.map(x => x.toString()));
  
  // send back to client
  postMessage(sample);
}

// attach incoming message handler
// multiple requests will fall through to the final request
onmessage = e => {
  const {re, im, precision} = e.data;
  
  // overwrite any pending request
  clearTimeout(requestID);
  requestID = setTimeout(() => processRequest(re, im, precision), 0);
}