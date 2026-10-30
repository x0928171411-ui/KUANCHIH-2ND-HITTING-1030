import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { comparisonFilename, isVideoFilename, masterAtFrame, outputFrameCount } from "./export-compare";

describe("comparison download", () => {
  it("names the file as an mp4", () => {
    const name = comparisonFilename(0.1, new Date(2026, 9, 30, 17, 33, 5));
    assert.equal(name, "揮棒比較-0.1x-20261030-173305.mp4");
    assert.equal(isVideoFilename(name), true);
    assert.equal(isVideoFilename("揮棒比較.AVI"), true);
    assert.equal(isVideoFilename("揮棒比較.webm"), false);
    assert.equal(isVideoFilename("揮棒比較"), false);
  });

  it("stretches 0.1x into ten times as many frames", () => {
    const span = 3;
    assert.equal(outputFrameCount(span, 1), outputFrameCount(span, 0.1) / 10);
    assert.equal(masterAtFrame(1.5, 30, 0.1), 1.6);
  });
});
