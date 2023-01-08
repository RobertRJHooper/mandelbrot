"use strict";
importScripts('https://unpkg.com/mathjs/lib/browser/math.js', 'utils.js', 'model.js');

// minmum period between image posts
const frameThrottlePeriod = 200;

// info on current model running
var currentModelPack = null;

class ModelPack {
  constructor(modelID, viewTopLeft, viewWidth, viewHeight, gridWidth, gridHeight, maxIterations, frameLimit) {
    this.modelID = modelID;
    this.model = new MandelbrotSetModel(viewTopLeft, viewWidth, viewHeight, gridWidth, gridHeight);
    this.model.initiate();

    // create image and initialise (alpha component mainly)
    this.image = new ImageData(gridWidth, gridHeight);
    this.image.data.fill(255);

    // throttling information about the last frame issued
    this.frameLimit = frameLimit;
    this.frameIndex = null;
    this.frameTime = null;

    // termination info
    this.terminate = false;
    this.maxIterations = maxIterations;
  }

  loop() {
    new Promise((resolve, reject) => {
      const {modelID, model, terminate, maxIterations, frameIndex, frameLimit, frameTime} = this;

      if (terminate) {
        return reject(`termination flag set for modelID ${modelID}`, );
      }

      if (model.iteration >= maxIterations) {
        return reject(`iteration limit reached for modelID ${modelID}`);
      }

      // update the model and paint updates to image buffer
      //console.time('model.iterate()');
      model.iterate();
      //console.timeEnd('model.iterate()');
      model.paint(this.image);

      // determine if we can send a frame
      const now = Date.now();
      let throttle = frameIndex && (frameIndex + 1 >= frameLimit)
        || frameTime && (now < frameTime + frameThrottlePeriod);

      // if it's the last iteration then we send always
      if (model.iteration == maxIterations - 1) {
        throttle = false;
      }

      // update counters and generate frame bitmap
      if (!throttle) {
        this.frameIndex += 1;
        this.frameTime = now;
        resolve(createImageBitmap(this.image));
      } else {
        resolve();
      }
    }).then((frameBitmap) => {
      if (frameBitmap) {
        // post the bitmap if there is one (not throttled)
        const message = {
          modelID: this.modelID,
          frameBitmap: frameBitmap,
          frameIndex: this.frameIndex,
          frameLimit: this.frameLimit
        };
        postMessage(message, [frameBitmap]);
      }
    }).then(() => {
      if (this.model.iteration % 5 == 1) {
        // compact the model so future iterations are quicker
        this.model.compact();
      }

      // loop the loop
      setTimeout(() => this.loop());
    }).catch(error => {
      console.error('exception in model loop: ', error);
    });
  }
}

// incoming message handler
onmessage = function (e) {
  const command = e.data.command;

  if (command == "init") {
    if (currentModelPack) {
      currentModelPack.terminate = true;
      currentModelPack = null;
    }

    const {modelID, viewTopLeft, viewWidth, viewHeight, gridWidth, gridHeight, maxIterations, frameLimit} = e.data;
    console.log('running model in worker', modelID);
    const modelPack = new ModelPack(modelID, viewTopLeft, viewWidth, viewHeight, gridWidth, gridHeight, maxIterations, frameLimit);

    // run the iteration loop
    currentModelPack = modelPack;
    modelPack.loop();
  } else if (command == "frameLimit") {
    const {modelID, frameLimit} = e.data;

    if (currentModelPack.modelID == modelID) {
      currentModelPack.frameLimit = frameLimit;
    } else {
      throw new ValueError('command of non-current model', modelID);
    }
  } else {
    throw new ValueError('unknown worker command received', command);
  }
}