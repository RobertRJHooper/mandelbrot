"use strict";
importScripts('https://unpkg.com/mathjs/lib/browser/math.js', 'utils.js', 'model.js');

// minmum period between image posts
const sendThrottlePeriod = 200;

// info on current model running
var currentModelPack = null;

// initiate model from spec and set it running in a loop of iterations
function init(spec) {
  const { modelID, minIm, minRe, viewHeight, viewWidth, width, height, maxIterations, frameLimit } = spec;
  console.log('running model in worker', modelID);

  // release existing model loop and free resources
  currentModelPack = null;

  // setup up the new model
  const model = new MandelbrotSetModel(minIm, minRe, viewHeight, viewWidth, width, height, maxIterations)
  model.initiate();

  // create image and initialise (alpha component mainly)
  const image = new ImageData(width, height);
  image.data.fill(255);

  // collect model info for the worker loop
  const modelPack = {
    modelID: modelID,
    model: model,
    image: image,

    // throttling information
    frameCount: 0,
    frameLimit: frameLimit,
    lastImageSendTime: null,
  }

  // run iteration loop
  console.debug('initiating model iteration loop in worker', modelID);
  currentModelPack = modelPack;
  loop(modelPack);
}

// async iteration loop
function loop(modelPack) {
  new Promise((resolve, reject) => {
    const { modelID, model, image, frameCount, frameLimit, lastImageSendTime } = modelPack;
    const currentModelID = currentModelPack.modelID;

    if (modelID != currentModelID) {
      console.log('model pack expired, exiting loop', modelID);
      return;
    }

    if (model.iteration >= model.maxIterations) {
      postMessage({ modelID: modelID, iteration: model.iteration, image: image, frameCount: frameCount, frameLimit: frameLimit });
      console.log('max iterations reached, exiting loop', modelID);
      return;
    }

    // update the model and paint updates to image
    model.iterate();
    model.paint(image);

    // determine if a new frame is required at this time
    // throttling is based on consumption by the main thread (frameLimit)
    // and time elapsed (sendThrottlePeriod)
    const now = Date.now();
    let skip = false;

    if (frameCount >= frameLimit) {
      console.debug("skipping frame issue because the frame request limit is reached");
      skip = true;
    } else if (lastImageSendTime && (now < lastImageSendTime + sendThrottlePeriod)) {
      console.debug("skipping frame issue because of frequency throttling");
      skip = true;
    }

    // send image to master
    if (!skip) {
      const newFrameCount = frameCount + 1;
      postMessage({ modelID: modelID, iteration: model.iteration, image: image, frameCount: newFrameCount, frameLimit: frameLimit });
      modelPack.frameCount = newFrameCount;
      modelPack.lastImageSendTime = now;
    }

    // compact the model so future iterations are quicker 
    model.compact();

    // loop
    setTimeout(() => loop(modelPack));
  }).catch(error => {
    console.error('worker exception', modelPack.modelID, error);
  });
};

function updateFrameLimit(modelID, frameLimit) {
  const modelPack = currentModelPack;

  if (modelPack.modelID != modelID) {
    console.debug('orphan frame limit update', modelID);
    return;
  }

  if (modelPack.frameLimit >= frameLimit) {
    console.debug('frame limit update not increasing, ignoring', modelID);
    return;
  }

  console.debug('setting model frame limit', frameLimit);
  modelPack.frameLimit = frameLimit;
}

// incoming message handler
onmessage = function (e) {
  const command = e.data.command;

  if (command == "init") {
    init(e.data);
  } else if (command == "frameLimit") {
    updateFrameLimit(e.data.modelID, e.data.frameLimit);
  } else {
    console.error('unknown worker command received', command);
  }
}