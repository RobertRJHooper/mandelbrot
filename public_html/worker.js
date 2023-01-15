"use strict";

importScripts(
  'https://cdnjs.cloudflare.com/ajax/libs/mathjs/11.5.0/math.js',
  'https://cdnjs.cloudflare.com/ajax/libs/lodash.js/4.17.21/lodash.min.js',
  'model.js'
);

class ModelTerminatedException extends Error {
  constructor(reason) {
    super(reason);
    this.name = "ModelTerminatedException";
  }
}

// minmum period between image posts
const frameThrottlePeriod = 200;

// info on current model running
var currentModelPack = null;

class ModelPack {
  constructor(modelID, resX, resY, view, frameLimit) {
    this.modelID = modelID;

    this.model = new MandelbrotGrid(resX, resY, view);
    this.model.initiate();

    this.iteration = 0;
    this.maxIterations = 1000;
    
    // create image and initialise (alpha component mainly)
    this.image = new ImageData(resX, resY);
    this.image.data.fill(255);

    // throttling information about the last frame issued
    this.frameLimit = frameLimit;
    this.frameIndex = null;
    this.frameTime = null;

    // termination info
    this.terminate = false;
  }

  loop() {
    new Promise((resolve, reject) => {
      const { modelID, model, terminate, maxIterations, frameIndex, frameLimit, frameTime } = this;

      if (terminate) {
        return reject(new ModelTerminatedException('model pack terminated'));
      }

      if (this.iteration >= maxIterations) {
        return reject(new ModelTerminatedException('iteration limit reached', modelID));
      }

      // update the model and paint updates to image buffer
      //console.time('model.iterate()');
      model.iterate();
      this.iteration += 1;
      //console.timeEnd('model.iterate()');
      model.paint(this.image);

      // determine if we can send a frame
      const now = Date.now();
      let throttle = frameIndex && (frameIndex + 1 >= frameLimit)
        || frameTime && (now < frameTime + frameThrottlePeriod);

      // if it's the last iteration then we send always
      if (this.iteration == maxIterations - 1) {
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
      if (this.iteration % 5 == 1) {
        // compact the model so future iterations are quicker
        this.model.compact();
      }

      // loop the loop
      setTimeout(() => this.loop());
    }).catch(error => {
      if (error instanceof ModelTerminatedException) {
        console.debug(this.modelID, "loop ended with message:", error.message);
      } else {
        console.error(error);
      }
    });
  }
}

// incoming message handler
onmessage = function (e) {
  const command = e.data.command;

  if (command == "init") {
    if (currentModelPack) {
      console.log(currentModelPack.modelID, "marking current model pack for termination");
      currentModelPack.terminate = true;
      currentModelPack = null;
    }

    const { modelID, resX, resY, view, frameLimit } = e.data;
    console.log(modelID, 'running model in worker');
    const modelPack = new ModelPack(modelID, resX, resY, view, frameLimit);

    // run the iteration loop
    currentModelPack = modelPack;
    modelPack.loop();
  } else if (command == "frameLimit") {
    const { modelID, frameLimit } = e.data;

    if (currentModelPack.modelID == modelID) {
      currentModelPack.frameLimit = frameLimit;
    } else {
      throw new ValueError('command of non-current model', modelID);
    }
  } else {
    throw new ValueError('unknown worker command received', command);
  }
}