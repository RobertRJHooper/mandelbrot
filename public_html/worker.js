"use strict";
importScripts('https://unpkg.com/mathjs/lib/browser/math.js', 'utils.js', 'model.js');

// id of the current model running
var currentModelID = null;

// minmum period between image posts
const throttlePeriod = 200;

// async iteration loop
function loop(modelpack) {
  new Promise((resolve, reject) => {
    const { modelID, model, image, last } = modelpack;

    if (modelID != currentModelID) {
      reject(new Error('modelpack expired'));
      return;
    }
    
    // if iterations are complete - post the final image and escape
    if (model.iteration >= model.max_iterations) {
      postMessage({ modelID: modelID, iteration: model.iteration, image: image });
      reject(new Error('max iterations reached'));
      return;
    }

    // update the model
    model.iterate();
    model.paint(image);

    // post the image (with throttling)
    const now = Date.now();
    if (!last || (now - last) >= throttlePeriod) {
      postMessage({ modelID: modelID, iteration: model.iteration, image: image });
      modelpack.last = now;
    }

    // compact the model so iterations are quicker
    model.compact();

    // loop
    setTimeout(() => loop(modelpack));
  }).catch(error => {
    console.log('worker exception', modelpack.modelID, error);
  });
};

// model specification
onmessage = function (e) {
  const { modelID, center, resolution, width, height, maxIterations } = e.data;
  console.debug('setting up model in worker', modelID);
  
  // release existing loop
  currentModelID = null; 
  
  // setup up the model
  const model = new MandelbrotSetModel(center, resolution, width, height, maxIterations)
  model.initiate();

  // create image and initialise
  const image = new ImageData(model.width, model.height);
  image.data.fill(255);

  // collect model info for the worker loop
  const modelpack = {
    modelID: modelID,
    model: model,
    image: image,
    last: null,
  }

  // run iteration loop
  console.debug('running model in worker', modelID);
  currentModelID = modelID;
  loop(modelpack);
}