"use strict";
import { mb_iterate, mb_escaped, mb_in_primary, mb_in_secondary } from "./model";


export class PointsModel {
  constructor(c, limit = 1000) {
    this.c = c;

    // generate series
    this.points = []; // zn series
    this.escape_age = null;
    this.in_mbs = null;

    let z = math.complex(0, 0);
    for (let i = 0; i < limit - 3; i++) {
      z = mb_iterate(z, c);
      this.points.push(z);

      if (mb_escaped(z)) {
        this.in_mbs = false;
        this.escape_age = i + 1;
        break;
      }
    }

    // add a few more points after escape
    for (let i = 0; i < 3; i++) {
      z = mb_iterate(z, c);
      this.points.push(z);
    }

    // points known to be in the set
    if (mb_in_primary(c) || mb_in_secondary(c)) {
      this.in_mbs = true;
    };
  }
}
