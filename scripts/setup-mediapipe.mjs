import { cpSync, createWriteStream, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wasmSrc = path.join(root, "node_modules/@mediapipe/tasks-vision/wasm");
const wasmDest = path.join(root, "public/mediapipe/wasm");

if (existsSync(wasmSrc)) {
  mkdirSync(wasmDest, { recursive: true });
  cpSync(wasmSrc, wasmDest, { recursive: true });
}

const models = [
  [
    "pose_landmarker_full.task",
    "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task",
  ],
  [
    "pose_landmarker_lite.task",
    "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
  ],
];

for (const [name, url] of models) {
  const dest = path.join(root, "public/mediapipe/models", name);
  if (existsSync(dest)) continue;
  mkdirSync(path.dirname(dest), { recursive: true });
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`下載姿態模型失敗：${name}`);
  }
  await pipeline(Readable.fromWeb(response.body), createWriteStream(dest));
}
