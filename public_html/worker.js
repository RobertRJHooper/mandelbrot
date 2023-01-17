"use strict";

importScripts(
  'https://cdnjs.cloudflare.com/ajax/libs/mathjs/11.5.0/math.js',
  'https://cdnjs.cloudflare.com/ajax/libs/lodash.js/4.17.21/lodash.min.js',
  'model.js'
);


// minmum period between image posts
const frameThrottlePeriod = 250;

class ModelPack {
  constructor(modelID, workerID, resX, resY, view, step, offset, frameLimit, iterationsLimit) {
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
    this.iterationsLimit = iterationsLimit;
  }

  initiate() {
    const { resX, resY, view, step, offset } = this;
    this.model = new MandelbrotGrid(resX, resY, view, step, offset);
    this.model.initiate();

    this.iteration = 0;
    this.frameIndex = null;
    this.frameIteration = null;
    this.frameTime = null;
  }

  isFrameThrottled(timestamp) {
    const { frameIndex, frameLimit, frameTime } = this;

    if (frameIndex >= frameLimit) {
      return true;
    }

    if (frameTime && (timestamp < frameTime + frameThrottlePeriod)) {
      return true;
    }

    return false;
  }

  async postFrame(timestamp) {
    const bitmap = await createImageBitmap(this.model.image);
    
    // update last frame status
    this.frameIndex = (this.frameIndex || 0) + 1;
    this.frameIteration = this.iteration;
    this.frameTime = timestamp;

    // send to master
    postMessage({
      modelID: this.modelID,
      workerID: this.workerID,
      iteration: this.frameIteration,
      index: this.frameIndex,
      bitmap: bitmap,
    }, [bitmap]);

    
    if (this.workerID == 0) {
      const points = _.sortBy(this.model.points, p => (p.escapeAge || 0));

      const p = points[points.length - 1];
      console.log(this.iteration, p.escapeAge, p.c);
    }
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

    if(this.iteration <= this.iterationsLimit) {
      this.model.iterate();
      this.iteration += 1;
    } else {
      await new Promise(resolve => setTimeout(resolve, 100)); // snooze
    }

    // post frame if something has changed
    // and the throttle doesn't bite
    if(this.frameIteration !== this.iteration) {
      const timestamp = Date.now();

      if (!this.isFrameThrottled(timestamp)) {
        await this.postFrame(timestamp);
      }
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
      const { modelID, workerID, resX, resY, view, step, offset, frameLimit, iterationsLimit } = e.data;
      const modelPack = new ModelPack(modelID, workerID, resX, resY, view, step, offset, frameLimit, iterationsLimit);

      // run the iteration loop
      currentModelPack = modelPack;
      modelPack.initiate();
      modelPack.loop();
      break;
    }

    case 'limit': {
      const { modelID, frameLimit, iterationsLimit } = e.data;

      if (currentModelPack.modelID == modelID) {
        currentModelPack.frameLimit = frameLimit;
        currentModelPack.iterationsLimit = iterationsLimit;
      }

      break;
    }

    default:
      throw new ValueError('unknown worker command received', command);
  }
}