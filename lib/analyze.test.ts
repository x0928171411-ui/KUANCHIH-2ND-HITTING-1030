import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { interpretSwing } from "./analyze";
import { compareSwings } from "./compare";
import { HANDEDNESS_OPTIONS, PLAYBACK_RATES } from "./constants";
import type { Landmark, PoseFrame } from "./types";

function landmark(x: number, y: number, wz = 0): Landmark {
  return {
    x,
    y,
    z: wz,
    v: 0.99,
    wx: (x - 0.5) * 1.8,
    wy: (0.5 - y) * 1.7,
    wz,
  };
}

function interp(keys: Array<[number, number]>, frame: number) {
  if (frame <= keys[0][0]) return keys[0][1];
  for (let index = 1; index < keys.length; index++) {
    const [start, startValue] = keys[index - 1];
    const [end, endValue] = keys[index];
    if (frame <= end) {
      const amount = (frame - start) / (end - start);
      return startValue + (endValue - startValue) * amount;
    }
  }
  return keys[keys.length - 1][1];
}

function ramp(frame: number, start: number, end: number) {
  if (frame <= start) return 0;
  if (frame >= end) return 1;
  const amount = (frame - start) / (end - start);
  return 0.5 - 0.5 * Math.cos(Math.PI * amount);
}

const PAIRS: Array<[number, number]> = [
  [1, 4],
  [2, 5],
  [3, 6],
  [7, 8],
  [9, 10],
  [11, 12],
  [13, 14],
  [15, 16],
  [17, 18],
  [19, 20],
  [21, 22],
  [23, 24],
  [25, 26],
  [27, 28],
  [29, 30],
  [31, 32],
];

function makeSwing(options?: {
  flip?: boolean;
  flipFrom?: number;
  frontEnd?: number;
  backEnd?: number;
}): PoseFrame[] {
  const frontEnd = options?.frontEnd ?? 0.72;
  const backEnd = options?.backEnd ?? 0.44;
  const frames: PoseFrame[] = [];
  for (let frame = 0; frame < 45; frame++) {
    const wrist = interp(
      [
        [0, 0.5],
        [8, 0.5],
        [14, 0.38],
        [19, 0.38],
        [24, 0.74],
        [32, 0.82],
        [44, 0.83],
      ],
      frame,
    );
    const front = interp(
      [
        [0, 0.55],
        [8, 0.55],
        [16, frontEnd],
        [44, frontEnd],
      ],
      frame,
    );
    const back = interp(
      [
        [0, 0.44],
        [8, 0.44],
        [16, backEnd],
        [44, backEnd],
      ],
      frame,
    );
    const coil = ramp(frame, 16, 26);
    const lm: Landmark[] = Array.from({ length: 33 }, () => landmark(0.5, 0.5));
    lm[0] = landmark(0.51, 0.18);
    lm[11] = landmark(0.54, 0.32, 0.02 + 0.14 * coil);
    lm[12] = landmark(0.48, 0.32, -0.02 - 0.14 * coil);
    lm[13] = landmark(wrist + 0.03, 0.42);
    lm[14] = landmark(wrist - 0.03, 0.42);
    lm[15] = landmark(wrist + 0.01, 0.48);
    lm[16] = landmark(wrist - 0.01, 0.48);
    lm[23] = landmark(0.53, 0.52, 0.01 + 0.04 * coil);
    lm[24] = landmark(0.47, 0.52, -0.01 - 0.04 * coil);
    lm[25] = landmark((0.53 + front) / 2 + 0.08, 0.7);
    lm[26] = landmark((0.47 + back) / 2 - 0.02, 0.7);
    lm[27] = landmark(front, 0.88);
    lm[28] = landmark(back, 0.88);
    lm[31] = landmark(front + 0.02, 0.92);
    lm[32] = landmark(back + 0.02, 0.92);

    if (options?.flip || (options?.flipFrom != null && frame >= options.flipFrom)) {
      for (const [left, right] of PAIRS) {
        const hold = lm[left];
        lm[left] = lm[right];
        lm[right] = hold;
      }
    }

    frames.push({ t: frame / 30, lm });
  }
  return frames;
}

describe("playback and batter choices", () => {
  it("includes a 0.1x coach speed and both batter sides", () => {
    assert.ok(PLAYBACK_RATES.includes(0.1));
    assert.deepEqual(
      HANDEDNESS_OPTIONS.map((option) => option.value),
      ["auto", "left", "right"],
    );
  });
});

describe("interpretSwing", () => {
  it("reads a right-handed swing without mutating the frames", () => {
    const frames = makeSwing();
    const before = frames[10].lm?.[27].x;
    const read = interpretSwing(frames, "auto", 16 / 9);
    assert.equal(frames[10].lm?.[27].x, before);
    assert.equal(read.ok, true, JSON.stringify(read, null, 2));
    assert.equal(read.handedness, "right");
    assert.equal(read.inferred, "right");
    assert.equal(read.lowConfidence, false);
    assert.equal(read.highlightRawLeft, true);
    assert.equal(read.imageSwingSign, 1);
    assert.ok(read.phases.load <= read.phases.landing + 0.001, JSON.stringify(read.phases));
    assert.ok(read.phases.landing <= read.phases.contact + 0.001, JSON.stringify(read.phases));
    assert.ok(read.phases.follow > read.phases.contact, JSON.stringify(read.phases));
    assert.ok(read.metrics.stride > 0.05, JSON.stringify(read.metrics));
    assert.ok(read.metrics.timeToContact > 0.05, JSON.stringify(read.metrics));
    assert.ok(read.metrics.handSpeed > 0.5, JSON.stringify(read.metrics));
    assert.ok(read.metrics.frontKnee > 100 && read.metrics.frontKnee < 175, JSON.stringify(read.metrics));
    assert.ok(read.metrics.hipShoulderSep > 3, JSON.stringify(read.metrics));
  });

  it("keeps phase order when labels are mirrored and the coach locks the right side", () => {
    const frames = makeSwing({ flip: true });
    const auto = interpretSwing(frames, "auto", 16 / 9);
    const locked = interpretSwing(frames, "right", 16 / 9);
    assert.equal(auto.inferred, "left");
    assert.equal(locked.handedness, "right");
    assert.equal(locked.mirrored, true);
    assert.equal(locked.highlightRawLeft, true);
    assert.equal(auto.highlightRawLeft, false);
    assert.ok(locked.metrics.stride > 0.05);
    assert.ok(locked.phases.landing <= locked.phases.contact);
  });

  it("flips the lead arm when the coach switches sides on a clear swing", () => {
    const frames = makeSwing();
    const right = interpretSwing(frames, "right", 16 / 9);
    const left = interpretSwing(frames, "left", 16 / 9);
    assert.equal(right.highlightRawLeft, true);
    assert.equal(left.highlightRawLeft, false);
    assert.equal(left.mirrored, true);
    assert.ok(Math.abs(right.metrics.stride - left.metrics.stride) < 0.02);
  });

  it("uses the chosen front foot when the feet are hard to tell apart", () => {
    const frames = makeSwing({ frontEnd: 0.62, backEnd: 0.48 });
    const auto = interpretSwing(frames, "auto", 16 / 9);
    const right = interpretSwing(frames, "right", 16 / 9);
    const left = interpretSwing(frames, "left", 16 / 9);
    assert.equal(auto.lowConfidence, true, JSON.stringify({ confidence: auto.confidence, metrics: auto.metrics }));
    assert.notEqual(right.metrics.stride.toFixed(2), left.metrics.stride.toFixed(2));
    assert.ok(right.metrics.stride > left.metrics.stride);
  });

  it("repairs a run of flipped labels instead of changing the batter", () => {
    const frames = makeSwing({ flipFrom: 20 });
    const read = interpretSwing(frames, "auto", 16 / 9);
    assert.equal(read.ok, true);
    assert.equal(read.handedness, "right");
    assert.equal(read.lowConfidence, false);
  });

  it("fails closed when the person is missing", () => {
    const read = interpretSwing([], "auto", 16 / 9);
    assert.equal(read.ok, false);
    assert.ok(read.warnings.length > 0);
  });
});

describe("compareSwings", () => {
  it("calls out a shorter stride", () => {
    const best = interpretSwing(makeSwing(), "right", 16 / 9);
    const current = interpretSwing(makeSwing({ frontEnd: 0.62 }), "right", 16 / 9);
    const comparison = compareSwings(best, current);
    assert.equal(comparison.rows.length, 6);
    const stride = comparison.rows.find((row) => row.id === "stride");
    assert.equal(stride?.tone, "gap");
    assert.match(stride?.note ?? "", /踏步/);
    assert.match(comparison.summary, /踏步/);
  });
});
