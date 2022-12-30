"use strict";

/**
* Converts an HSL color value to RGB. Conversion formula
* adapted from http://en.wikipedia.org/wiki/HSL_color_space.
* Assumes h, s, and l are contained in the set [0, 1] and
* returns r, g, and b in the set [0, 255].
*
* @param   Number  h       The hue
* @param   Number  s       The saturation
* @param   Number  l       The lightness
* @return  Array           The RGB representation
*/
function hslToRgb(h, s, l) {
  var r, g, b;

  if (s == 0) {
    r = g = b = l; // achromatic
  } else {
    function hue2rgb(p, q, t) {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    }

    var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    var p = 2 * l - q;

    r = hue2rgb(p, q, h + 1/3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1/3);
  }

  return [ r * 255, g * 255, b * 255 ];
}

// format to display floats
const float_format = new Intl.NumberFormat(
  "us-en",
  {
    signDisplay: 'always',
    minimumFractionDigits: 15,
    maximumFractionDigits: 15
  });

export class InfoView {
  constructor(current_point_re, current_point_im, escape, iterations) {
    this.current_point_re = current_point_re;
    this.current_point_im = current_point_im;
    this.escape = escape;
    this.iterations = iterations;
  }

  update(mbs_model, points_model) {
    if(mbs_model) {
      this.iterations.innerHTML = mbs_model.iterations;
    }

    if (points_model) {
      this.current_point_re.innerHTML = float_format.format(points_model.c.re) + ' ';
      this.current_point_im.innerHTML = float_format.format(points_model.c.im) + 'i';

      if (points_model.in_mbs == null) {
        this.escape.innerHTML = `not by n = ${points_model.points.length}`;
      } else if (points_model.in_mbs == false) {
        this.escape.innerHTML = `at n = ${points_model.escape_age}`;
      } else {
        this.escape.innerHTML = `never for all n`;
      }
    }
  }
}


export class MBSView {
  constructor(canvas, model) {
    this.canvas = canvas;

    this.width = model.grid_shape.width;
    this.height = model.grid_shape.height;

    // set the size of canvas
    // initially this is not necessarily the size of the canvas element in css
    this.canvas.setAttribute("width", this.width);
    this.canvas.setAttribute("height", this.height);
    this.ctx = this.canvas.getContext('2d');
    this.image = this.ctx.createImageData(this.width, this.height);

    let data = this.image.data;
    for (let i = 0; i < data.length; i += 4) {
      data[i + 0] = 0;    // R value
      data[i + 1] = 0;    // G value
      data[i + 2] = 0;    // B value
      data[i + 3] = 255;  // A value
    }

    // coordinates of zoom rectangle
    this.zoomRect = null
  }

  update(model) {
    const data = this.image.data;

    for (let point of model.points) {
      let idx = (point.j * this.width + point.i) * 4;

      if (point.in_mbs == false) {
        let hue = math.mod(point.age, 100) /  100;
        let rgb = hslToRgb(hue, 1, 0.5)

        data[idx+0] = rgb[0];
        data[idx+1] = rgb[1];
        data[idx+2] = rgb[2];
      } else if (point.in_mbs == true) {
        data[idx+0] = 0;
        data[idx+1] = 0;
        data[idx+2] = 0;
      } else {
        data[idx+0] = 0;
        data[idx+1] = 0;
        data[idx+2] = 20;
      }
    }
  }

  render() {
    this.ctx.putImageData(this.image, 0, 0);

    if (this.zoomRect != null) {
      this.ctx.beginPath();
      this.ctx.lineWidth = "2";
      this.ctx.strokeStyle = "grey";
      this.ctx.rect(this.zoomRect.x, this.zoomRect.y, this.zoomRect.width, this.zoomRect.height);
      this.ctx.stroke();
    }
  }
}

export class PointsView {
  constructor(svg) {
    this.svg = svg;
  }

  update(model) {
    let html = [];

    html.push(`<polyline id="zn_connector" points="`);
    for (let z of model.points) {
      html.push(`${z.re},${z.im} `);
    }
    html.push(`"
    marker-start="url(#z1_dot)"
    marker-mid="url(#zn_dot)"
    marker-end="url(#zn_dot)"
    fill="none" />`);

    // inject
    let e = this.svg.querySelector('.series_container');
    e.innerHTML = html.join('\n');
  }
}
