import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { measurePose, projectLandmarks, spaceSpec, swingFacing, toneDegree } from "./impact";
import type { Landmark, PoseFrame } from "./types";

function point(partial: Partial<Landmark> = {}): Landmark {
  return { x: 0.5, y: 0.55, z: 0, v: 0.99, wx: 0, wy: 1, wz: 0, ...partial };
}

function pose(overrides: Record<number, Partial<Landmark>>): Landmark[] {
  const lm = Array.from({ length: 33 }, () => point());
  for (const [index, partial] of Object.entries(overrides)) Object.assign(lm[Number(index)], partial);
  return lm;
}

function stance(): Landmark[] {
  return pose({
    11: { x: 0.4, y: 0.3, wx: -0.2, wy: 1.5, wz: 0 },
    12: { x: 0.6, y: 0.3, wx: 0.2, wy: 1.5, wz: 0 },
    23: { x: 0.44, y: 0.6, wx: -0.12, wy: 1, wz: 0 },
    24: { x: 0.56, y: 0.6, wx: 0.12, wy: 1, wz: 0 },
    25: { x: 0.44, y: 0.75, wx: -0.12, wy: 0.5, wz: 0 },
    27: { x: 0.5, y: 0.9, wx: 0.28, wy: 0.5, wz: 0.4 },
    26: { x: 0.56, y: 0.75, wx: 0.12, wy: 0.55, wz: -0.05 },
    28: { x: 0.58, y: 0.9, wx: 0.12, wy: 0.1, wz: -0.15 },
    13: { x: 0.38, y: 0.42, wx: -0.25, wy: 1.2, wz: 0.1 },
    15: { x: 0.36, y: 0.5, wx: -0.15, wy: 1.05, wz: 0.25 },
    0: { x: 0.5, y: 0.2, wx: 0, wy: 1.7, wz: 0 },
  });
}

describe("impact skeleton", () => {
  it("reads a side view with the front foot ahead of the back foot", () => {
    const lm = stance();
    const spec = spaceSpec([{ t: 0, lm }], 16 / 9);
    assert.equal(spec.space, "world");
    const points = projectLandmarks(lm, "pitcher", "right", spec);
    assert.ok(points);
    const front = points[27];
    const back = points[28];
    assert.ok(front && back);
    assert.ok(front.x > back.x, JSON.stringify({ front, back }));
  });

  it("measures a square knee and a quarter turn of the hips", () => {
    const load = stance();
    const turned = stance();
    turned[23] = { ...turned[23], wx: 0, wz: -0.12 };
    turned[24] = { ...turned[24], wx: 0, wz: 0.12 };
    turned[11] = { ...turned[11], wx: 0, wz: -0.2 };
    turned[12] = { ...turned[12], wx: 0, wz: 0.2 };
    const frames: PoseFrame[] = [
      { t: 0, lm: load },
      { t: 1, lm: turned },
    ];
    const measure = measurePose(frames, 1, "right", 0, 16 / 9);
    assert.ok(measure);
    assert.ok(Math.abs(measure.frontKnee - 90) < 8, String(measure.frontKnee));
    assert.ok(Math.abs(measure.hipTurn - 90) < 8, String(measure.hipTurn));
    assert.ok(Math.abs(measure.shoulderTurn - 90) < 8, String(measure.shoulderTurn));
    assert.equal(toneDegree(4), "good");
    assert.equal(toneDegree(30), "bad");
  });

  it("turns opposite camera sides to the same right-handed facing", () => {
    const filmed = stance();
    const otherSide = filmed.map((point) => ({ ...point, x: 1 - point.x, wx: -point.wx }));
    const spec = spaceSpec([{ t: 0, lm: filmed }], 16 / 9);
    const pairs = [
      { lm: filmed, sign: -1 as const },
      { lm: otherSide, sign: 1 as const },
    ];
    for (const item of pairs) {
      const facing = swingFacing([{ t: 0, lm: item.lm }], "right", item.sign, spec, 0);
      const camera = projectLandmarks(item.lm, "camera", "right", spec, facing);
      const pitcher = projectLandmarks(item.lm, "pitcher", "right", spec, facing);
      assert.ok(camera?.[27] && camera[28] && pitcher?.[27] && pitcher[28]);
      assert.ok(camera[27].x > camera[28].x, JSON.stringify(camera[27]));
      assert.ok(pitcher[27].x > pitcher[28].x, JSON.stringify(pitcher[27]));
    }
  });

  it("keeps the pitcher direction after the feet cross in the follow-through", () => {
    const landing = stance();
    const follow = stance();
    follow[27] = { ...follow[27], x: 0.32, wx: 0.05, wz: -0.3 };
    follow[28] = { ...follow[28], x: 0.7, wx: 0.2, wz: 0.35 };
    const frames: PoseFrame[] = [
      { t: 0, lm: landing },
      { t: 1, lm: follow },
    ];
    const spec = spaceSpec(frames, 16 / 9);
    const facing = swingFacing(frames, "right", 1, spec, 0);
    const locked = projectLandmarks(follow, "pitcher", "right", spec, facing);
    const refreshed = projectLandmarks(follow, "pitcher", "right", spec);
    assert.ok(locked?.[27] && locked[28] && refreshed?.[27] && refreshed[28]);
    assert.ok(refreshed[27].x > refreshed[28].x);
    assert.ok(locked[27].x < locked[28].x);
  });
});
