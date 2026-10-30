import type { PoseFrame } from "./types";

const BONES: ReadonlyArray<readonly [number, number, "left" | "right" | "mid"]> = [
  [11, 12, "mid"],
  [11, 23, "left"],
  [12, 24, "right"],
  [23, 24, "mid"],
  [11, 13, "left"],
  [13, 15, "left"],
  [12, 14, "right"],
  [14, 16, "right"],
  [23, 25, "left"],
  [25, 27, "left"],
  [24, 26, "right"],
  [26, 28, "right"],
  [27, 31, "left"],
  [28, 32, "right"],
];

const JOINTS = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];

export function frameAt(frames: PoseFrame[], time: number) {
  if (!frames.length) return null;
  let lo = 0;
  let hi = frames.length - 1;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (frames[mid].t < time) lo = mid + 1;
    else hi = mid;
  }
  const next = frames[lo];
  const prev = frames[lo - 1];
  if (!prev) return next;
  return Math.abs(prev.t - time) <= Math.abs(next.t - time) ? prev : next;
}

export function videoContentRect(
  videoWidth: number,
  videoHeight: number,
  canvasWidth: number,
  canvasHeight: number,
) {
  const width = videoWidth || 16;
  const height = videoHeight || 9;
  const scale = Math.min(canvasWidth / width, canvasHeight / height);
  const w = width * scale;
  const h = height * scale;
  return { x: (canvasWidth - w) / 2, y: (canvasHeight - h) / 2, w, h };
}

function isLeftJoint(index: number) {
  return index !== 0 && index % 2 === 1;
}

export function drawPose(
  ctx: CanvasRenderingContext2D,
  frame: PoseFrame | null,
  rect: { x: number; y: number; w: number; h: number },
  color: string,
  highlightRawLeft: boolean,
) {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  const lm = frame?.lm;
  if (!lm) return;

  const xy = (index: number) => {
    const point = lm[index];
    if (!point || point.v < 0.3) return null;
    return { x: rect.x + point.x * rect.w, y: rect.y + point.y * rect.h };
  };

  const nose = xy(0);
  const leftShoulder = xy(11);
  const rightShoulder = xy(12);
  if (nose && leftShoulder && rightShoulder) {
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.75;
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.moveTo(nose.x, nose.y);
    ctx.lineTo((leftShoulder.x + rightShoulder.x) / 2, (leftShoulder.y + rightShoulder.y) / 2);
    ctx.stroke();
  }

  for (const [from, to, side] of BONES) {
    const start = xy(from);
    const end = xy(to);
    if (!start || !end) continue;
    const lead = side === "left" ? highlightRawLeft : side === "right" ? !highlightRawLeft : false;
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.globalAlpha = side === "mid" ? 0.92 : lead ? 1 : 0.38;
    ctx.lineWidth = lead ? 4.5 : 2;
    ctx.lineCap = "round";
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
  }

  for (const index of JOINTS) {
    const point = xy(index);
    if (!point) continue;
    const lead = index !== 0 && isLeftJoint(index) === highlightRawLeft;
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.fillStyle = lead ? "#ffffff" : color;
    ctx.arc(point.x, point.y, lead ? 4.5 : 3, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.globalAlpha = 1;
}
