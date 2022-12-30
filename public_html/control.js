"use strict";

import { GridShape, MBSModel, PointsModel } from './model.js';
import { InfoView, MBSView, PointsView } from './view.js';

var mbs_canvas = document.getElementById('mbs');
var points_svg = document.getElementById('points');

// default zoom level
var top_left0 = math.complex(-2.2, +1.5);
var bottom_right0 = math.complex(+1.2, -1.5);

// rendering resolution
var grid_width = 800;
var grid_height = 600;

// models and views
var info_view;
var mbs_model;
var mbs_view;
var points_model;
var points_view;


function setMBSModel(top_left, bottom_right) {
  mbs_model = null;

  return Promise.resolve().then(() => {
    let g = new GridShape(
      top_left,
      bottom_right,
      grid_width,
      grid_height);
    return new MBSModel(g);
  }).then((m) => {
    mbs_model = m;
    mbs_view = new MBSView(mbs_canvas, mbs_model);
    info_view.update(mbs_model, points_model);
  });
}

function setPointsModel(c) {
  return Promise.resolve().then(() => {
    return new PointsModel(c);
  }).then((m) => {
    points_model = m;
    points_view = new PointsView(points_svg);
    points_view.update(points_model);
    info_view.update(mbs_model, points_model);
  });
}

function canvasLocalCoordinates(event) {
  var r = event.target.getBoundingClientRect();

  return {
    x: event.clientX - r.left,
    y: event.clientY - r.top
  }
}

function svgLocalCoordinates(event) {
  const domPoint = new DOMPointReadOnly(event.clientX, event.clientY);
  const pt = domPoint.matrixTransform(points_svg.getScreenCTM().inverse());
  return math.complex(pt.x, pt.y);
}

// animation loop
function frame() {
  if (mbs_model && mbs_view) {
    mbs_model.iterate();
    mbs_view.update(mbs_model);
    mbs_view.render();
    info_view.update(mbs_model, points_model);
  }

  requestAnimationFrame(frame);
}

Promise.resolve().then(() => {
  info_view = new InfoView(
    document.getElementById("current_point_re"),
    document.getElementById("current_point_im"),
    document.getElementById("escape"),
    document.getElementById("iterations")
  );
}).then(() => {
  setMBSModel(top_left0, bottom_right0);
  setPointsModel(math.complex(0, 0));

}).then(() => {

  // mouse listeners for zoom rectangle
  mbs_canvas.addEventListener("mousedown", function(event) {
    if (event.button != 0) {
      return;
    }

    let m = canvasLocalCoordinates(event);

    mbs_view.zoomRect = {
      x: m.x,
      y: m.y,
      width: 1,
      height: 1,
    }
  }.bind(this));

  mbs_canvas.addEventListener("mousemove", function(event) {
    let m = canvasLocalCoordinates(event);
    let r = mbs_view.zoomRect;

    // no zoom selection happening
    if (r == null) {
        setPointsModel(mbs_model.grid_shape.coordinatesToValue(m.x, m.y));
        return;
    }

    // update zoom rectangle selection area
    mbs_view.zoomRect = {
      x: r.x,
      y: r.y,
      width: m.x - r.x,
      height: m.y - r.y,
    }
  }.bind(this));

  points_svg.addEventListener("mousemove", function(event) {
    setPointsModel(svgLocalCoordinates(event));
  }.bind(this));

  // release of click for zoom rectangle
  window.addEventListener("mouseup", function(event) {
    if (event.button != 0) {
      return;
    }

    let r = mbs_view.zoomRect;
    if (r == null) {
      return;
    }

    let x = r.width > 0 ? r.x : r.x + r.width;
    let y = r.height > 0 ? r.y : r.y + r.height;
    let w = math.abs(r.width);
    let h = math.abs(r.height);

    // ignore very small windows
    if (w < 3 || h < 3) {
      return;
    }

    // update view box
    let top_left = mbs_model.grid_shape.coordinatesToValue(x, y);
    let bottom_right = mbs_model.grid_shape.coordinatesToValue(x + w, y + h);
    setMBSModel(top_left, bottom_right);

    // clear rectangle
    mbs_view.zoomRect = null;
  }.bind(this));

  // unzooming
  mbs_canvas.addEventListener("mouseup", function(event) {
    if (event.button != 0) {
      return;
    }

    let r = mbs_view.zoomRect;

    // ignore when it's to do with the zoom rectange
    if (r != null) {
      if (math.abs(r.width) > 2 && math.abs(r.heigth) > 2) {
        return;
      }
    }

    // return to default zoom
    mbs_view.zoomRect = null;
    setMBSModel(top_left0, bottom_right0);
  }.bind(this));

}).then(() => {
  requestAnimationFrame(frame);
});
