import { frameAt } from "./draw-pose";
import { formatDegreeDelta, formatDegrees, formatMeasure, formatMeasureDelta, formatMsDelta, formatSeconds } from "./format";
import type { Landmark, MetricUnit, PoseFrame, Side, SwingRead } from "./types";

export type ImpactView = "camera" | "front" | "pitcher" | "top";
export type ImpactTone = "good" | "warn" | "bad" | "mute";

export type SpaceSpec = {
  space: "world" | "image";
  /** +1 when world Y points up. */
  ySign: number;
  aspect: number;
};

/** Pitcher side stays on screen-right for the whole swing, including the follow-through. */
export type SwingFacing = {
  cameraSign: 1 | -1;
  forward: V3;
  side: V3;
  up: V3;
};

export type PoseMeasure = {
  unit: MetricUnit;
  trunk: number;
  hipTurn: number;
  shoulderTurn: number;
  frontKnee: number;
  leadElbow: number;
  headTravel: number;
  wristHeight: number;
};

export type ImpactCard = {
  id: "sho" | "hip" | "head" | "knee" | "time";
  label: string;
  best: string;
  current: string;
  delta: string;
  advice: string;
  tone: Exclude<ImpactTone, "mute">;
};

export type ImpactPill = {
  id: string;
  label: string;
  value: string;
  tone: ImpactTone;
};

type V3 = { x: number; y: number; z: number };
type Pt = { x: number; y: number };

const L_SHO = 11;
const R_SHO = 12;
const L_ELB = 13;
const R_ELB = 14;
const L_WRI = 15;
const R_WRI = 16;
const L_HIP = 23;
const R_HIP = 24;
const L_KNE = 25;
const R_KNE = 26;
const L_ANK = 27;
const R_ANK = 28;

export function spaceSpec(frames: PoseFrame[], aspect = 16 / 9): SpaceSpec {
  const safeAspect = Number.isFinite(aspect) && aspect > 0.3 ? aspect : 16 / 9;
  const lengths: number[] = [];
  let ySign = 1;
  for (const frame of frames) {
    const lm = frame.lm;
    if (!lm || lm.length < 33) continue;
    const hip = mid(rawWorld(lm, L_HIP), rawWorld(lm, R_HIP));
    const sho = mid(rawWorld(lm, L_SHO), rawWorld(lm, R_SHO));
    const length = dist3(hip, sho);
    if (length > 0.05) lengths.push(length);
    if (lm[L_SHO].y < lm[L_HIP].y) ySign = lm[L_SHO].wy < lm[L_HIP].wy ? -1 : 1;
    if (lengths.length >= 8) break;
  }
  if (!lengths.length) return { space: "image", ySign: 1, aspect: safeAspect };
  const midLen = median(lengths);
  return midLen >= 0.25 && midLen <= 1.45
    ? { space: "world", ySign, aspect: safeAspect }
    : { space: "image", ySign: 1, aspect: safeAspect };
}

export function swingFacing(
  frames: PoseFrame[],
  handedness: Side,
  imageSwingSign: 1 | -1,
  spec: SpaceSpec,
  landingTime: number,
): SwingFacing {
  const lm = frameAt(frames, landingTime)?.lm;
  const ready = lm && lm.length >= 33 ? lm : null;
  const axes = ready ? axesOf(ready, handedness, spec) : null;
  return {
    cameraSign: ready ? cameraSign(ready, handedness, imageSwingSign) : imageSwingSign,
    forward: axes?.forward ?? { x: 0, y: 0, z: 1 },
    side: axes?.side ?? { x: 1, y: 0, z: 0 },
    up: axes?.up ?? { x: 0, y: 1, z: 0 },
  };
}

export function projectLandmarks(
  lm: Landmark[] | null,
  view: ImpactView,
  handedness: Side,
  spec: SpaceSpec,
  facing?: SwingFacing,
): Array<Pt | null> | null {
  if (!lm || lm.length < 33) return null;
  const basis = facing ?? swingFacing([{ t: 0, lm }], handedness, 1, spec, 0);
  if (view === "camera") return applyCameraSign(imagePlane(lm, spec.aspect), basis.cameraSign);
  const hip = mid(pointOf(lm, L_HIP, spec), pointOf(lm, R_HIP, spec));
  return lm.map((point, index) => {
    if (point.v < 0.3 && index !== 0) return null;
    return project(pointOf(lm, index, spec), { hip, ...basis }, view);
  });
}

export function handTrail(
  frames: PoseFrame[],
  from: number,
  to: number,
  view: ImpactView,
  handedness: Side,
  spec: SpaceSpec,
  facing?: SwingFacing,
): Pt[] {
  const current = frameAt(frames, to);
  if (!current?.lm) return [];
  const basis = facing ?? swingFacing(frames, handedness, 1, spec, from);
  const lead = handedness === "right" ? L_WRI : R_WRI;
  const points: Pt[] = [];
  const start = Math.min(from, to);
  const end = Math.max(from, to);
  const hipX = (current.lm[L_HIP].x + current.lm[R_HIP].x) / 2;
  const hipY = (current.lm[L_HIP].y + current.lm[R_HIP].y) / 2;
  for (const frame of frames) {
    if (frame.t < start - 1e-4 || frame.t > end + 1e-4 || !frame.lm) continue;
    if (frame.lm[lead].v < 0.3) continue;
    if (view === "camera") {
      points.push({
        x: (frame.lm[lead].x - hipX) * spec.aspect * basis.cameraSign,
        y: hipY - frame.lm[lead].y,
      });
      continue;
    }
    const hip = mid(pointOf(frame.lm, L_HIP, spec), pointOf(frame.lm, R_HIP, spec));
    const wrist = pointOf(frame.lm, lead, spec);
    points.push(project(sub(wrist, hip), { ...basis, hip: { x: 0, y: 0, z: 0 } }, view));
  }
  return points;
}

function imagePlane(lm: Landmark[], aspect: number): Array<Pt | null> {
  const hipX = (lm[L_HIP].x + lm[R_HIP].x) / 2;
  const hipY = (lm[L_HIP].y + lm[R_HIP].y) / 2;
  return lm.map((point, index) => {
    if (point.v < 0.3 && index !== 0) return null;
    return { x: (point.x - hipX) * aspect, y: hipY - point.y };
  });
}

function applyCameraSign(points: Array<Pt | null> | null, sign: 1 | -1) {
  if (!points || sign === 1) return points;
  return points.map((point) => (point ? { x: -point.x, y: point.y } : null));
}

function cameraSign(lm: Landmark[], handedness: Side, imageSwingSign: 1 | -1): 1 | -1 {
  const lead = lm[handedness === "right" ? L_ANK : R_ANK];
  const back = lm[handedness === "right" ? R_ANK : L_ANK];
  const dx = lead.x - back.x;
  if (Math.abs(dx) >= 0.015) return dx > 0 ? 1 : -1;
  return imageSwingSign === -1 ? -1 : 1;
}

export function measurePose(
  frames: PoseFrame[],
  time: number,
  handedness: Side,
  loadTime: number,
  aspect = 16 / 9,
): PoseMeasure | null {
  const spec = spaceSpec(frames, aspect);
  const now = frameAt(frames, time);
  const load = frameAt(frames, loadTime);
  if (!now?.lm || !load?.lm) return null;
  const lead = leadJoints(handedness);
  const hipNow = horizontal(jointLine(now.lm, L_HIP, R_HIP, spec), upOf(now.lm, spec));
  const hipLoad = horizontal(jointLine(load.lm, L_HIP, R_HIP, spec), upOf(load.lm, spec));
  const shoNow = horizontal(jointLine(now.lm, L_SHO, R_SHO, spec), upOf(now.lm, spec));
  const shoLoad = horizontal(jointLine(load.lm, L_SHO, R_SHO, spec), upOf(load.lm, spec));
  const trunk = leanAngle(now.lm, spec);
  const knee = jointAngle(now.lm, lead.hip, lead.knee, lead.ankle, spec);
  const elbow = jointAngle(now.lm, lead.shoulder, lead.elbow, lead.wrist, spec);
  const noseNow = pointOf(now.lm, 0, spec);
  const noseLoad = pointOf(load.lm, 0, spec);
  const wrist = pointOf(load.lm, lead.wrist, spec);
  const sho = mid(pointOf(load.lm, L_SHO, spec), pointOf(load.lm, R_SHO, spec));
  const body = bodyHeight(now.lm, spec);
  const unit: MetricUnit = spec.space === "world" ? "m" : "bh";
  const head = dist3(noseNow, noseLoad);
  const wristHeight = wrist.y - sho.y;
  return {
    unit,
    trunk,
    hipTurn: hipNow && hipLoad ? turn(hipLoad, hipNow) : Number.NaN,
    shoulderTurn: shoNow && shoLoad ? turn(shoLoad, shoNow) : Number.NaN,
    frontKnee: knee,
    leadElbow: elbow,
    headTravel: unit === "m" ? head : head / body,
    wristHeight: unit === "m" ? wristHeight : wristHeight / body,
  };
}

export function impactReport(best: SwingRead, current: SwingRead, bestFrames: PoseFrame[], currentFrames: PoseFrame[], bestAspect: number, currentAspect: number) {
  const bestPose = best.ok ? measurePose(bestFrames, best.phases.contact, best.handedness, best.phases.load, bestAspect) : null;
  const currentPose = current.ok
    ? measurePose(currentFrames, current.phases.contact, current.handedness, current.phases.load, currentAspect)
    : null;
  const unitsDiffer = !!bestPose && !!currentPose && bestPose.unit !== currentPose.unit;
  const cards: ImpactCard[] = [];
  if (bestPose && currentPose) {
    pushDegree(cards, "sho", "擊球時轉肩", bestPose.shoulderTurn, currentPose.shoulderTurn);
    pushDegree(cards, "hip", "擊球時轉髖", bestPose.hipTurn, currentPose.hipTurn);
    pushLength(cards, "head", "啟動到擊球頭部位移", bestPose.headTravel, currentPose.headTravel, bestPose.unit, unitsDiffer);
    pushDegree(cards, "knee", "擊球時前膝角", bestPose.frontKnee, currentPose.frontKnee);
  }
  if (best.ok && current.ok) {
    const delta = current.metrics.timeToContact - best.metrics.timeToContact;
    const tone = toneTime(delta);
    cards.push({
      id: "time",
      label: "下棒時間（啟動到擊球）",
      best: formatSeconds(best.metrics.timeToContact),
      current: formatSeconds(current.metrics.timeToContact),
      delta: formatMsDelta(delta),
      advice: tone === "good" ? "維持得好" : `回到 ${formatSeconds(best.metrics.timeToContact)}`,
      tone,
    });
  }
  const pills: ImpactPill[] = [];
  if (best.ok && current.ok) {
    const landing = current.phases.contact - current.phases.landing;
    const bestLanding = best.phases.contact - best.phases.landing;
    pills.push({
      id: "land",
      label: "著地–擊球時間",
      value: formatSeconds(Math.max(0, landing)),
      tone: toneTime(landing - bestLanding),
    });
    pills.push({
      id: "stride",
      label: "跨步距離",
      value: formatMeasure(current.metrics.stride, current.metrics.unit),
      tone:
        best.metrics.unit === current.metrics.unit
          ? toneRatio(best.metrics.stride, current.metrics.stride)
          : "mute",
    });
  }
  if (bestPose && currentPose) {
    pills.push({
      id: "sho",
      label: "擊球時轉肩",
      value: formatDegrees(currentPose.shoulderTurn),
      tone: toneDegree(currentPose.shoulderTurn - bestPose.shoulderTurn),
    });
    pills.push({
      id: "hip",
      label: "擊球時轉髖",
      value: formatDegrees(currentPose.hipTurn),
      tone: toneDegree(currentPose.hipTurn - bestPose.hipTurn),
    });
    pills.push({
      id: "head",
      label: "啟動到擊球頭部位移",
      value: formatMeasure(currentPose.headTravel, currentPose.unit),
      tone: unitsDiffer ? "mute" : toneRatio(bestPose.headTravel, currentPose.headTravel),
    });
    pills.push({
      id: "wrist",
      label: "啟動時手腕高度",
      value: formatMeasure(currentPose.wristHeight, currentPose.unit),
      tone: unitsDiffer ? "mute" : toneLength(bestPose.wristHeight, currentPose.wristHeight, currentPose.unit),
    });
  }
  return { cards, pills, bestPose, currentPose, unitsDiffer };
}

export function liveRows(best: PoseMeasure | null, current: PoseMeasure | null) {
  const cell = (measure: PoseMeasure | null, pick: (item: PoseMeasure) => number, kind: "deg" | "len") => {
    if (!measure || !Number.isFinite(pick(measure))) return "—";
    return kind === "deg" ? formatDegrees(pick(measure)) : formatMeasure(pick(measure), measure.unit);
  };
  const rows: Array<{ label: string; current: string; best: string }> = [
    ["上身前傾", (item: PoseMeasure) => item.trunk, "deg"],
    ["轉髖", (item: PoseMeasure) => item.hipTurn, "deg"],
    ["轉肩", (item: PoseMeasure) => item.shoulderTurn, "deg"],
    ["前膝角", (item: PoseMeasure) => item.frontKnee, "deg"],
    ["前手肘角", (item: PoseMeasure) => item.leadElbow, "deg"],
    ["頭部位移", (item: PoseMeasure) => item.headTravel, "len"],
  ].map(([label, pick, kind]) => ({
    label: label as string,
    current: cell(current, pick as (item: PoseMeasure) => number, kind as "deg" | "len"),
    best: cell(best, pick as (item: PoseMeasure) => number, kind as "deg" | "len"),
  }));
  return rows;
}

export function toneDegree(delta: number): Exclude<ImpactTone, "mute"> {
  const gap = Math.abs(delta);
  if (!Number.isFinite(gap)) return "warn";
  if (gap <= 6) return "good";
  if (gap <= 14) return "warn";
  return "bad";
}

function toneTime(delta: number): Exclude<ImpactTone, "mute"> {
  const gap = Math.abs(delta);
  if (!Number.isFinite(gap)) return "warn";
  if (gap <= 0.03) return "good";
  if (gap <= 0.08) return "warn";
  return "bad";
}

function toneRatio(best: number, current: number): Exclude<ImpactTone, "mute"> {
  const scale = Math.max(Math.abs(best), Math.abs(current), 1e-6);
  const gap = Math.abs(current - best) / scale;
  if (gap <= 0.08) return "good";
  if (gap <= 0.18) return "warn";
  return "bad";
}

function toneLength(best: number, current: number, unit: MetricUnit): Exclude<ImpactTone, "mute"> {
  const gap = Math.abs(current - best);
  const good = unit === "m" ? 0.03 : 0.04;
  const warn = unit === "m" ? 0.08 : 0.1;
  if (!Number.isFinite(gap)) return "warn";
  if (gap <= good) return "good";
  if (gap <= warn) return "warn";
  return "bad";
}

function pushDegree(
  cards: ImpactCard[],
  id: ImpactCard["id"],
  label: string,
  best: number,
  current: number,
) {
  if (!Number.isFinite(best) || !Number.isFinite(current)) return;
  const tone = toneDegree(current - best);
  cards.push({
    id,
    label,
    best: formatDegrees(best),
    current: formatDegrees(current),
    delta: formatDegreeDelta(current - best),
    advice: tone === "good" ? "維持得好" : `回到 ${formatDegrees(best)}`,
    tone,
  });
}

function pushLength(
  cards: ImpactCard[],
  id: ImpactCard["id"],
  label: string,
  best: number,
  current: number,
  unit: MetricUnit,
  unitsDiffer: boolean,
) {
  if (!Number.isFinite(best) || !Number.isFinite(current)) return;
  const tone = unitsDiffer ? "warn" : toneRatio(best, current);
  cards.push({
    id,
    label,
    best: formatMeasure(best, unit),
    current: formatMeasure(current, unit),
    delta: unitsDiffer ? "—" : formatMeasureDelta(current - best, unit),
    advice: unitsDiffer ? "兩支的單位不同" : tone === "good" ? "維持得好" : `回到 ${formatMeasure(best, unit)}`,
    tone,
  });
}

function leadJoints(handedness: Side) {
  return handedness === "right"
    ? { shoulder: L_SHO, elbow: L_ELB, wrist: L_WRI, hip: L_HIP, knee: L_KNE, ankle: L_ANK }
    : { shoulder: R_SHO, elbow: R_ELB, wrist: R_WRI, hip: R_HIP, knee: R_KNE, ankle: R_ANK };
}

function rawWorld(lm: Landmark[], index: number): V3 {
  return { x: lm[index].wx, y: lm[index].wy, z: lm[index].wz };
}

function pointOf(lm: Landmark[], index: number, spec: SpaceSpec): V3 {
  const point = lm[index];
  if (spec.space === "world") return { x: point.wx, y: point.wy * spec.ySign, z: point.wz };
  return { x: (point.x - 0.5) * spec.aspect, y: 0.5 - point.y, z: -point.z };
}

function axesOf(lm: Landmark[], handedness: Side, spec: SpaceSpec) {
  const hip = mid(pointOf(lm, L_HIP, spec), pointOf(lm, R_HIP, spec));
  const up = upOf(lm, spec);
  const lead = pointOf(lm, handedness === "right" ? L_ANK : R_ANK, spec);
  const back = pointOf(lm, handedness === "right" ? R_ANK : L_ANK, spec);
  const across = horizontal(sub(pointOf(lm, R_HIP, spec), pointOf(lm, L_HIP, spec)), up);
  let forward = horizontal(sub(lead, back), up);
  if (!forward && across) forward = norm(cross(up, across));
  if (!forward) forward = { x: 0, y: 0, z: 1 };
  const side = norm(cross(up, forward)) ?? across ?? { x: 1, y: 0, z: 0 };
  return { hip, up, forward, side };
}

function upOf(lm: Landmark[], spec: SpaceSpec) {
  const hip = mid(pointOf(lm, L_HIP, spec), pointOf(lm, R_HIP, spec));
  const sho = mid(pointOf(lm, L_SHO, spec), pointOf(lm, R_SHO, spec));
  return norm(sub(sho, hip)) ?? { x: 0, y: 1, z: 0 };
}

function project(point: V3, axes: { hip: V3; up: V3; forward: V3; side: V3 }, view: ImpactView): Pt {
  const delta = sub(point, axes.hip);
  if (view === "front") return { x: dot(delta, axes.side), y: dot(delta, axes.up) };
  if (view === "top") return { x: dot(delta, axes.forward), y: dot(delta, axes.side) };
  if (view === "camera") return { x: delta.x, y: delta.y };
  return { x: dot(delta, axes.forward), y: dot(delta, axes.up) };
}

function jointLine(lm: Landmark[], from: number, to: number, spec: SpaceSpec) {
  return sub(pointOf(lm, to, spec), pointOf(lm, from, spec));
}

function leanAngle(lm: Landmark[], spec: SpaceSpec) {
  const hip = mid(pointOf(lm, L_HIP, spec), pointOf(lm, R_HIP, spec));
  const sho = mid(pointOf(lm, L_SHO, spec), pointOf(lm, R_SHO, spec));
  const torso = norm(sub(sho, hip));
  if (!torso) return Number.NaN;
  const cos = clamp(torso.y, -1, 1);
  return (Math.acos(cos) * 180) / Math.PI;
}

function jointAngle(lm: Landmark[], a: number, b: number, c: number, spec: SpaceSpec) {
  if (lm[a].v < 0.3 || lm[b].v < 0.3 || lm[c].v < 0.3) return Number.NaN;
  const v1 = sub(pointOf(lm, a, spec), pointOf(lm, b, spec));
  const v2 = sub(pointOf(lm, c, spec), pointOf(lm, b, spec));
  const denom = Math.hypot(v1.x, v1.y, v1.z) * Math.hypot(v2.x, v2.y, v2.z);
  if (denom < 1e-6) return Number.NaN;
  return (Math.acos(clamp(dot(v1, v2) / denom, -1, 1)) * 180) / Math.PI;
}

function bodyHeight(lm: Landmark[], spec: SpaceSpec) {
  const sho = mid(pointOf(lm, L_SHO, spec), pointOf(lm, R_SHO, spec));
  const ank = mid(pointOf(lm, L_ANK, spec), pointOf(lm, R_ANK, spec));
  return Math.max(dist3(sho, ank), 1e-3);
}

function turn(reference: V3, current: V3) {
  const cos = clamp(dot(reference, current), -1, 1);
  return (Math.acos(cos) * 180) / Math.PI;
}

function horizontal(vector: V3, up: V3) {
  const flat = sub(vector, scale(up, dot(vector, up)));
  return norm(flat);
}

function mid(a: V3, b: V3): V3 {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
}

function sub(a: V3, b: V3): V3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function scale(vector: V3, amount: number): V3 {
  return { x: vector.x * amount, y: vector.y * amount, z: vector.z * amount };
}

function dot(a: V3, b: V3) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross(a: V3, b: V3): V3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}

function norm(vector: V3): V3 | null {
  const length = Math.hypot(vector.x, vector.y, vector.z);
  if (length < 1e-6) return null;
  return { x: vector.x / length, y: vector.y / length, z: vector.z / length };
}

function dist3(a: V3, b: V3) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const midIndex = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[midIndex] : (sorted[midIndex - 1] + sorted[midIndex]) / 2;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
