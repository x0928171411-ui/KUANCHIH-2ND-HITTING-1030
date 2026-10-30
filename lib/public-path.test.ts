import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { modelAsset, publicPath } from "./constants";

describe("public paths", () => {
  const previous = process.env.NEXT_PUBLIC_BASE_PATH;

  afterEach(() => {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_BASE_PATH;
    else process.env.NEXT_PUBLIC_BASE_PATH = previous;
  });

  it("keeps root paths when the site is hosted at the domain root", () => {
    delete process.env.NEXT_PUBLIC_BASE_PATH;
    assert.equal(publicPath("/mediapipe/wasm"), "/mediapipe/wasm");
    assert.equal(modelAsset("lite"), "/mediapipe/models/pose_landmarker_lite.task");
  });

  it("prefixes the GitHub Pages project folder", () => {
    process.env.NEXT_PUBLIC_BASE_PATH = "/KUANCHIH-2ND-HITTING-1030";
    assert.equal(publicPath("/mediapipe/wasm"), "/KUANCHIH-2ND-HITTING-1030/mediapipe/wasm");
    assert.equal(modelAsset("full"), "/KUANCHIH-2ND-HITTING-1030/mediapipe/models/pose_landmarker_full.task");
  });
});
