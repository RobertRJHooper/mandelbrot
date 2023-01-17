"use strict";

importScripts(
  'https://cdnjs.cloudflare.com/ajax/libs/mathjs/11.5.0/math.js',
  'https://cdnjs.cloudflare.com/ajax/libs/lodash.js/4.17.21/lodash.min.js',
  'model.js'
);


// minmum period between image posts
const frameThrottlePeriod = 250;

class ModelPack {
  constructor(modelID, workerID, resX, resY, view, step, offset, frameLimit) {
    this.modelID = modelID;
    this.workerID = workerID;
    this.resX = resX;
    this.resY = resY;
    this.view = view;
    this.step = step;
    this.offset = offset;

    this.model = null;
    this.terminate = false;
    this.frameLimit = frameLimit;
  }

  initiate() {
    const { resX, resY, view, step, offset } = this;
    this.model = new MandelbrotGrid(resX, resY, view, step, offset);
    this.model.initiate();

    this.iteration = 0;
    this.frameIndex = 0;
    this.frameTime = null;
  }

  checkThrottle(t) {
    const { frameIndex, frameLimit, frameTime } = this;

    if (frameIndex >= frameLimit) {
      return true;
    }

    if (frameTime && (t < frameTime + frameThrottlePeriod)) {
      return true;
    }

    return false;
  }

  async loop() {
    if (this.terminate) {
      console.log(this.modelID, this.workerID, 'model calculation terminated');
      return;
    }

    if(!this.model.live.length) {
      console.log(this.modelID, this.workerID, 'no remaining live points, model terminated');
      return;
    }

    this.model.iterate();
    this.iteration += 1;

    // post a frame if the throttle doesn't bite
    const timestamp = Date.now();

    if (!this.checkThrottle(timestamp)) {
      const bitmap = await createImageBitmap(this.model.image);

      postMessage({
        modelID: this.modelID,
        workerID: this.workerID,
        iteration: this.iteration,
        frameIndex: this.frameIndex,
        bitmap: bitmap,
      }, [bitmap]);

      this.frameIndex += 1;
      this.frameTime = timestamp;
    }

    // loop the loop
    setTimeout(() => this.loop());
  }
}

// info on current model running
var currentModelPack = null;

// incoming message handler
onmessage = function (e) {
  const command = e.data.command;

  switch (command) {
    case 'initiate': {
      if (currentModelPack) {
        currentModelPack.terminate = true;
        currentModelPack = null;
      }

      console.log(e.data.modelID, e.data.workerID, 'running model in worker');
      const { modelID, workerID, resX, resY, view, step, offset, frameLimit } = e.data;
      const modelPack = new ModelPack(modelID, workerID, resX, resY, view, step, offset, frameLimit);

      // run the iteration loop
      currentModelPack = modelPack;
      modelPack.initiate();
      modelPack.loop();
      break;
    }

    case 'limit': {
      const { modelID, frameLimit } = e.data;

      if (currentModelPack.modelID == modelID) {
        currentModelPack.frameLimit = frameLimit;
      }

      break;
    }

    default:
      throw new ValueError('unknown worker command received', command);
  }
}