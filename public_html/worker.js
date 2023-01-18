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
    this.initiated = false;
    this.idle = false;

    this.frameLimit = frameLimit;
    this.iterationsLimit = iterationsLimit;
  }

  initiate() {
    console.log(this.modelID, this.workerID, 'initiating model in worker');
    const { resX, resY, view, step, offset } = this;
    this.model = new MandelbrotGrid(resX, resY, view, step, offset);
    this.model.initiate();
    this.iteration = 0;
    this.frameIndex = null;
    this.frameIteration = null;
    this.frameTime = null;
    this.initiated = true;
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


    /*
    if (this.workerID == 0) {
      const points = _.sortBy(this.model.points, p => (p.escapeAge || 0));

      const p = points[points.length - 1];
      console.log(this.iteration, p.escapeAge, p.c);
    }
    */
  }

  // do the next piece of work
  async work() {
    if (!this.initiated) {
      this.initiate();
      return;
    }

    if (!this.model.live.length) {
      console.log(this.modelID, this.workerID, 'no remaining live points, model idling');
      this.idle = true;
    }

    if (this.iteration >= this.iterationsLimit) {
      console.log(this.modelID, this.workerID, 'iteration limit reached, model idling');
      this.idle = true;
      return;
    }

    if (!this.idle) {
      this.model.iterate();
      this.iteration += 1;
    }

    // post frame if something has changed
    // and the throttle doesn't bite
    if (this.frameIteration !== this.iteration) {
      const timestamp = Date.now();

      if (!this.isFrameThrottled(timestamp)) {
        await this.postFrame(timestamp);
      }
    }
  }
}

// info on current model running
var currentModelPack = null;

// main loop
async function loop() {
  const modelPack = currentModelPack;

  if (modelPack && !modelPack.idle) {
    await modelPack.work();
  } else {
    await new Promise(resolve => setTimeout(resolve, 100)); // snooze
  }

  setTimeout(loop);
}
loop();

// incoming message handler
onmessage = function (e) {
  switch (e.data.command) {
    case 'initiate': {
      const { modelID, workerID, resX, resY, view, step, offset, frameLimit, iterationsLimit } = e.data;
      currentModelPack = new ModelPack(modelID, workerID, resX, resY, view, step, offset, frameLimit, iterationsLimit);
      break;
    }

    case 'limit': {
      const modelPack = currentModelPack;
      const { modelID, frameLimit, iterationsLimit, idle } = e.data;

      if (modelPack.modelID == modelID) {
        if (typeof frameLimit != "undefined") {
          modelPack.frameLimit = Math.max(frameLimit, currentModelPack.frameLimit);
        }

        if (typeof iterationsLimit != "undefined") {
          modelPack.iterationsLimit = iterationsLimit;
        }
        
        if (typeof idle != "undefined") {
          modelPack.idle = idle;
        }
      }

      break;
    }

    default:
      throw new ValueError('unknown worker command received', command);
  }
}