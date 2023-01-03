"use strict";
importScripts('https://unpkg.com/mathjs/lib/browser/math.js', 'utils.js', 'model.js');

// id of the current model running
var current_id = null;

// minmum period between image posts
const throttlePeriod = 200;

// async iteration loop
function loop(modelpack) {
  new Promise((resolve, reject) => {
    if (modelpack.id != current_id) {
      reject(new Error('modelpack expired'));
      return;
    }

    const { id, model, image } = modelpack;
    
    // if iterations are complete - post the final image and escape
    if (model.iteration >= model.max_iterations) {
      postMessage({ id: modelpack.id, image: image });
      reject(new Error('max_iterations reached'));
      return;
    }

    // update the model
    modelpack.model.iterate();
    model.paint(image);

    // post the image (with throttling)
    const now = Date.now();
    if (!modelpack.last || (now - modelpack.last) >= throttlePeriod) {
      postMessage({ id: modelpack.id, image: image });
      modelpack.last = now;
    }

    // compact the model so iterations are quicker
    modelpack.model.compact();

    // loop
    setTimeout(() => loop(modelpack));
  }).catch(error => {
    console.log('worker exception', modelpack.id, error);
  });
};

// model specification
onmessage = function (e) {
  current_id = null; // release existing loop
  console.debug('setting up model in worker', e.data.id);

  // setup up the model
  const { id, center, resolution, width, height, max_iterations } = e.data;
  const model = new MandelbrotSetModel(center, resolution, width, height, max_iterations)
  model.initiate();

  // create image and initialise
  const image = new ImageData(model.width, model.height);
  image.data.fill(255);

  // collect model info for the worker loop
  const modelpack = {
    id: id,
    model: model,
    image: image,
    last: null,
  }

  // run iteration loop
  console.debug('running model in worker', modelpack.id);
  current_id = id;
  loop(modelpack);
}