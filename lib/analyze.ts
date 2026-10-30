import type {
  HandednessChoice,
  Landmark,
  MetricUnit,
  PhaseId,
  PoseFrame,
  Side,
  SwingMetrics,
  SwingRead,
} from "./types";

const VIS = 0.35;

const LR_PAIRS: ReadonlyArray<readonly [number, number]> = [
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

const L_SHOULDER = 11;
const R_SHOULDER = 12;
const L_WRIST = 15;
const R_WRIST = 16;
const L_HIP = 23;
const R_HIP = 24;
const L_KNEE = 25;
const R_KNEE = 26;
const L_ANKLE = 27;
const R_ANKLE = 28;

type P = { x: number; y: number; z: number };
type Space = "world" | "image";
type AnkleKey = "lAnkle" | "rAnkle";

type Sample = {
  wrist: P;
  lAnkle: P;
  rAnkle: P;
  lHip: P;
  rHip: P;
  lSho: P;
  rSho: P;
  lKnee: P;
  rKnee: P;
  hip: P;
  sho: P;
};

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function sub(a: P, b: P): P {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function dot(a: P, b: P) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function hypot(a: P) {
  return Math.hypot(a.x, a.y, a.z);
}

function dist(a: P, b: P) {
  return hypot(sub(a, b));
}

function mid(a: P, b: P): P {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
}

function normalize(p: P): P | null {
  const h = hypot(p);
  if (h < 1e-6) return null;
  return { x: p.x / h, y: p.y / h, z: p.z / h };
}

function horizontal(p: P): P {
  return { x: p.x, y: 0, z: p.z };
}

function angleDiff(a: number, b: number) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function jointAngle(a: P, b: P, c: P) {
  const v1 = sub(a, b);
  const v2 = sub(c, b);
  const denom = hypot(v1) * hypot(v2);
  if (denom < 1e-6) return 180;
  const cos = clamp(dot(v1, v2) / denom, -1, 1);
  return (Math.acos(cos) * 180) / Math.PI;
}

function lineAngle(a: P, b: P) {
  return Math.atan2(b.z - a.z, b.x - a.x);
}

function hasBody(lm: Landmark[] | null): lm is Landmark[] {
  return !!lm && lm.length >= 33 && lm[L_HIP].v >= VIS && lm[R_HIP].v >= VIS;
}

function swapLR(lm: Landmark[]) {
  const next = lm.map((point) => ({ ...point }));
  for (const [left, right] of LR_PAIRS) {
    next[left] = { ...lm[right] };
    next[right] = { ...lm[left] };
  }
  return next;
}

const STABLE_JOINTS = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];

function poseDrift(current: Landmark[], previous: Landmark[]) {
  let sum = 0;
  let count = 0;
  for (const index of STABLE_JOINTS) {
    if (current[index].v < VIS || previous[index].v < VIS) continue;
    sum += Math.hypot(current[index].x - previous[index].x, current[index].y - previous[index].y);
    count += 1;
  }
  return count ? sum / count : Infinity;
}

/**
 * Weak models swap left and right for a frame, then swap back.
 * A real label swap jumps every joint; a real turn moves them smoothly.
 * Keep the labeling that stays continuous with the previous frame.
 */
function stabilize(frames: PoseFrame[]): PoseFrame[] {
  let previous: Landmark[] | null = null;
  return frames.map((frame) => {
    if (!hasBody(frame.lm)) return { t: frame.t, lm: null };
    let lm = frame.lm.map((point) => ({ ...point }));
    if (previous) {
      const swapped = swapLR(lm);
      if (poseDrift(swapped, previous) < poseDrift(lm, previous) * 0.65) lm = swapped;
    }
    previous = lm;
    return { t: frame.t, lm };
  });
}

function smooth(frames: PoseFrame[]): PoseFrame[] {
  const weight = 0.82;
  let prev: Landmark[] | null = null;
  return frames.map((frame) => {
    if (!hasBody(frame.lm)) return { t: frame.t, lm: null };
    const lm = frame.lm.map((point) => ({ ...point }));
    if (prev) {
      for (let i = 0; i < lm.length; i++) {
        if (lm[i].v < VIS || prev[i].v < VIS) continue;
        const keep = 1 - weight;
        lm[i].x = prev[i].x * keep + lm[i].x * weight;
        lm[i].y = prev[i].y * keep + lm[i].y * weight;
        lm[i].z = prev[i].z * keep + lm[i].z * weight;
        lm[i].wx = prev[i].wx * keep + lm[i].wx * weight;
        lm[i].wy = prev[i].wy * keep + lm[i].wy * weight;
        lm[i].wz = prev[i].wz * keep + lm[i].wz * weight;
      }
    }
    prev = lm;
    return { t: frame.t, lm };
  });
}

function pointOf(lm: Landmark[], index: number, space: Space, aspect: number): P {
  const point = lm[index];
  if (space === "world") return { x: point.wx, y: point.wy, z: point.wz };
  return { x: point.x * aspect, y: -point.y, z: point.z };
}

function sampleOf(lm: Landmark[], space: Space, aspect: number): Sample {
  const lSho = pointOf(lm, L_SHOULDER, space, aspect);
  const rSho = pointOf(lm, R_SHOULDER, space, aspect);
  const lHip = pointOf(lm, L_HIP, space, aspect);
  const rHip = pointOf(lm, R_HIP, space, aspect);
  const lWrist = pointOf(lm, L_WRIST, space, aspect);
  const rWrist = pointOf(lm, R_WRIST, space, aspect);
  return {
    wrist: mid(lWrist, rWrist),
    lAnkle: pointOf(lm, L_ANKLE, space, aspect),
    rAnkle: pointOf(lm, R_ANKLE, space, aspect),
    lHip,
    rHip,
    lSho,
    rSho,
    lKnee: pointOf(lm, L_KNEE, space, aspect),
    rKnee: pointOf(lm, R_KNEE, space, aspect),
    hip: mid(lHip, rHip),
    sho: mid(lSho, rSho),
  };
}

function emptyMetrics(unit: MetricUnit): SwingMetrics {
  return {
    unit,
    stride: 0,
    timeToContact: 0,
    handSpeed: 0,
    hipShoulderSep: 0,
    frontKnee: 0,
    weightShift: 0,
  };
}

function emptyRead(choice: HandednessChoice, frameCount: number, warnings: string[]): SwingRead {
  const handedness: Side = choice === "left" ? "left" : "right";
  return {
    ok: false,
    handedness,
    choice,
    inferred: handedness,
    mirrored: false,
    confidence: 0,
    lowConfidence: true,
    highlightRawLeft: handedness === "right",
    imageSwingSign: 1,
    leadOnImageLeft: false,
    phases: { load: 0, landing: 0, contact: 0, follow: 0 },
    metrics: emptyMetrics("bh"),
    validFrames: 0,
    frameCount,
    warnings,
  };
}

function chooseSpace(frames: PoseFrame[]): Space {
  const lengths: number[] = [];
  for (const frame of frames) {
    if (!hasBody(frame.lm)) continue;
    const sho = mid(
      { x: frame.lm[L_SHOULDER].wx, y: frame.lm[L_SHOULDER].wy, z: frame.lm[L_SHOULDER].wz },
      { x: frame.lm[R_SHOULDER].wx, y: frame.lm[R_SHOULDER].wy, z: frame.lm[R_SHOULDER].wz },
    );
    const ank = mid(
      { x: frame.lm[L_ANKLE].wx, y: frame.lm[L_ANKLE].wy, z: frame.lm[L_ANKLE].wz },
      { x: frame.lm[R_ANKLE].wx, y: frame.lm[R_ANKLE].wy, z: frame.lm[R_ANKLE].wz },
    );
    const length = dist(sho, ank);
    if (length > 0.05) lengths.push(length);
  }
  if (lengths.length < 5) return "image";
  const midLen = median(lengths);
  if (midLen < 0.35 || midLen > 1.25) return "image";
  const drift = median(lengths.map((length) => Math.abs(length - midLen))) / midLen;
  return drift < 0.18 ? "world" : "image";
}

/**
 * Read one swing.
 * Handedness does not rerun pose detection. On a clear clip it locks the lead
 * side. On a muddy clip it also chooses which foot counts as the front foot.
 */
export function interpretSwing(input: PoseFrame[], choice: HandednessChoice, aspect = 16 / 9): SwingRead {
  const safeAspect = Number.isFinite(aspect) && aspect > 0.3 ? aspect : 16 / 9;
  const frames = smooth(stabilize(input));
  const validFrames = frames.filter((frame) => hasBody(frame.lm)).length;
  if (validFrames < 8) {
    return emptyRead(choice, input.length, ["抓到的骨架太少，沒辦法拆這支揮棒。"]);
  }

  const space = chooseSpace(frames);
  const series: Array<Sample | null> = frames.map((frame) =>
    hasBody(frame.lm) ? sampleOf(frame.lm, space, safeAspect) : null,
  );
  const validIdx = series.flatMap((sample, index) => (sample ? [index] : []));

  const heights: number[] = [];
  for (const index of validIdx) {
    const sample = series[index];
    if (!sample) continue;
    const ank = mid(sample.lAnkle, sample.rAnkle);
    const height = dist(sample.sho, ank);
    if (height > 1e-4) heights.push(height);
  }
  const bodyHeight = Math.max(median(heights), 1e-3);

  const speeds: Array<{ i: number; s: number }> = [];
  for (const index of validIdx) {
    if (index === 0 || index === frames.length - 1) continue;
    const prev = series[index - 1];
    const next = series[index + 1];
    if (!prev || !next) continue;
    const dt = frames[index + 1].t - frames[index - 1].t;
    if (dt < 1e-4) continue;
    speeds.push({ i: index, s: hypot(sub(next.wrist, prev.wrist)) / dt });
  }
  if (!speeds.length) {
    return emptyRead(choice, input.length, ["畫面幾乎沒有移動，看不出揮棒。"]);
  }

  const speedAt = new Array<number>(frames.length).fill(0);
  for (const item of speeds) speedAt[item.i] = item.s;
  const pool = speeds.map((item) => {
    const window = [speedAt[item.i - 1], speedAt[item.i], speedAt[item.i + 1]]
      .filter((value) => value > 0)
      .sort((a, b) => a - b);
    const mid = window[Math.floor(window.length / 2)] ?? item.s;
    return { i: item.i, s: mid };
  });
  const contact = pool.reduce((best, item) => (item.s > best.s ? item : best)).i;

  const before = Math.max(0, contact - 3);
  const after = Math.min(frames.length - 1, contact + 2);
  const xBefore = wristImageX(frames[before]);
  const xAfter = wristImageX(frames[after]);
  let imageSwingSign: 1 | -1 = 1;
  if (xBefore != null && xAfter != null && Math.abs(xAfter - xBefore) >= 0.004) {
    imageSwingSign = xAfter >= xBefore ? 1 : -1;
  }

  let dir: P = { x: imageSwingSign, y: 0, z: 0 };
  if (space === "world") {
    const prev = series[before];
    const next = series[after];
    if (prev && next) {
      const worldDir = normalize(horizontal(sub(next.wrist, prev.wrist)));
      if (worldDir) dir = worldDir;
    }
  }

  const stanceIdx = validIdx.slice(0, 3);
  const average = (key: keyof Sample) => {
    let x = 0;
    let y = 0;
    let z = 0;
    let count = 0;
    for (const index of stanceIdx) {
      const sample = series[index];
      if (!sample) continue;
      const point = sample[key] as P;
      x += point.x;
      y += point.y;
      z += point.z;
      count += 1;
    }
    return { x: x / count, y: y / count, z: z / count };
  };

  const project = (point: P, origin: P) => {
    const delta = horizontal(sub(point, origin));
    return dot(delta, dir);
  };

  const travelOf = (key: AnkleKey) => {
    const origin = average(key);
    let max = -Infinity;
    for (let index = 0; index <= contact; index++) {
      const sample = series[index];
      if (!sample) continue;
      max = Math.max(max, project(sample[key], origin));
    }
    return max === -Infinity ? 0 : max;
  };

  const leftTravel = travelOf("lAnkle");
  const rightTravel = travelOf("rAnkle");
  const scale = space === "world" ? 0.18 : bodyHeight * 0.1;
  let confidence = clamp(Math.abs(leftTravel - rightTravel) / Math.max(scale, 1e-6), 0, 1);
  if (Math.max(leftTravel, rightTravel) < scale * 0.45) confidence = Math.min(confidence, 0.25);
  const lowConfidence = confidence < 0.4;
  const inferred: Side = leftTravel >= rightTravel ? "right" : "left";
  const handedness: Side = choice === "auto" ? inferred : choice;
  const useMotion = choice === "auto" || !lowConfidence;
  const motionFront: AnkleKey = leftTravel >= rightTravel ? "lAnkle" : "rAnkle";
  const labeledFront: AnkleKey = handedness === "right" ? "lAnkle" : "rAnkle";
  const frontKey: AnkleKey = useMotion ? motionFront : labeledFront;
  const mirrored = choice !== "auto" && !lowConfidence && choice !== inferred;
  const highlightRawLeft = handedness === "right";

  const warnings: string[] = [];
  if (input.filter((frame) => !hasBody(frame.lm)).length / Math.max(input.length, 1) > 0.35) {
    warnings.push("不少畫面沒有抓到人，階段可能會偏。");
  }
  if (lowConfidence) warnings.push("左右腳的移動太接近，自動判斷沒有把握。");
  if (xBefore != null && xAfter != null && Math.abs(xAfter - xBefore) < 0.004) {
    warnings.push("看不太出揮棒方向，最好是側面、固定機位。");
  }

  const ankleOrigin = average(frontKey);
  const wristOrigin = average("wrist");
  const ankleProj = (index: number) => {
    const sample = series[index];
    if (!sample) return null;
    return project(sample[frontKey], ankleOrigin);
  };
  const wristProj = (index: number) => {
    const sample = series[index];
    if (!sample) return null;
    return project(sample.wrist, wristOrigin);
  };

  let maxProj = 0;
  for (let index = 0; index <= contact; index++) {
    const value = ankleProj(index);
    if (value != null) maxProj = Math.max(maxProj, value);
  }

  const velocities: Array<number | null> = [];
  let peakV = 0;
  let peakI = 0;
  for (let index = 0; index <= contact; index++) {
    const now = ankleProj(index);
    const nextIndex = Math.min(contact, index + 1);
    const next = ankleProj(nextIndex);
    if (now == null || next == null) {
      velocities.push(null);
      continue;
    }
    const dt = frames[nextIndex].t - frames[index].t || 1 / 30;
    const velocity = (next - now) / dt;
    velocities.push(velocity);
    if (velocity > peakV) {
      peakV = velocity;
      peakI = index;
    }
  }

  let landing = contact;
  const minStride = space === "world" ? 0.02 : bodyHeight * 0.02;
  if (maxProj < minStride) {
    warnings.push("幾乎看不到前腳跨出去。");
  } else {
    let found = -1;
    for (let index = peakI; index <= contact; index++) {
      const value = ankleProj(index);
      const velocity = velocities[index] ?? 0;
      if (value != null && value >= maxProj * 0.72 && velocity < Math.max(peakV * 0.35, 0)) {
        found = index;
        break;
      }
    }
    if (found < 0) {
      for (let index = 0; index <= contact; index++) {
        const value = ankleProj(index);
        if (value != null && value >= maxProj * 0.85) {
          found = index;
          break;
        }
      }
    }
    if (found >= 0) landing = found;
  }
  if (landing > contact) landing = contact;

  let load = landing;
  let minWrist = Infinity;
  for (let index = 0; index <= landing; index++) {
    const value = wristProj(index);
    if (value == null) continue;
    if (value <= minWrist + 1e-4) {
      minWrist = Math.min(minWrist, value);
      load = index;
    }
  }

  let follow = contact;
  let maxWrist = -Infinity;
  for (let index = contact; index < frames.length; index++) {
    if (frames[index].t > frames[contact].t + 0.6 && index > contact) break;
    const value = wristProj(index);
    if (value == null) continue;
    if (value >= maxWrist) {
      maxWrist = value;
      follow = index;
    }
  }
  if (follow <= contact) {
    const target = frames[contact].t + 0.28;
    let best = Math.min(frames.length - 1, contact + 1);
    let bestDistance = Infinity;
    for (let index = contact + 1; index < frames.length; index++) {
      const distance = Math.abs(frames[index].t - target);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = index;
      }
    }
    follow = best;
  }

  const phases: Record<PhaseId, number> = {
    load: frames[load].t,
    landing: frames[landing].t,
    contact: frames[contact].t,
    follow: frames[follow].t,
  };

  const planted = series[landing];
  let stride = planted ? Math.max(0, project(planted[frontKey], ankleOrigin)) : 0;
  const hipAt = (index: number) => series[index]?.hip ?? null;
  const hipLoad = hipAt(load);
  const hipContact = hipAt(contact);
  let weightShift = hipLoad && hipContact ? project(hipContact, hipLoad) : 0;

  let handSpeed = 0;
  for (const item of pool) {
    if (item.i < load || item.i > follow) continue;
    handSpeed = Math.max(handSpeed, item.s);
  }
  if (handSpeed === 0) handSpeed = pool.reduce((best, item) => Math.max(best, item.s), 0);

  if (space === "image") {
    stride /= bodyHeight;
    weightShift /= bodyHeight;
    handSpeed /= bodyHeight;
  }

  let hipShoulderSep = 0;
  for (let index = load; index <= contact; index++) {
    const sample = series[index];
    if (!sample) continue;
    const sep = Math.abs(angleDiff(lineAngle(sample.lSho, sample.rSho), lineAngle(sample.lHip, sample.rHip)));
    hipShoulderSep = Math.max(hipShoulderSep, (sep * 180) / Math.PI);
  }

  const contactSample = series[contact];
  const frontKnee = contactSample
    ? jointAngle(
        frontKey === "lAnkle" ? contactSample.lHip : contactSample.rHip,
        frontKey === "lAnkle" ? contactSample.lKnee : contactSample.rKnee,
        frontKey === "lAnkle" ? contactSample.lAnkle : contactSample.rAnkle,
      )
    : 0;

  const contactLm = frames[contact].lm;
  let leadOnImageLeft = false;
  if (contactLm) {
    const lead = highlightRawLeft ? L_WRIST : R_WRIST;
    const back = highlightRawLeft ? R_WRIST : L_WRIST;
    leadOnImageLeft = contactLm[lead].x < contactLm[back].x;
  }

  const metrics: SwingMetrics = {
    unit: space === "world" ? "m" : "bh",
    stride,
    timeToContact: Math.max(0, phases.contact - phases.load),
    handSpeed,
    hipShoulderSep,
    frontKnee,
    weightShift,
  };

  return {
    ok: true,
    handedness,
    choice,
    inferred,
    mirrored,
    confidence,
    lowConfidence,
    highlightRawLeft,
    imageSwingSign,
    leadOnImageLeft,
    phases,
    metrics,
    validFrames,
    frameCount: input.length,
    warnings,
  };
}

function wristImageX(frame: PoseFrame) {
  if (!hasBody(frame.lm)) return null;
  const left = frame.lm[L_WRIST];
  const right = frame.lm[R_WRIST];
  if (left.v < VIS && right.v < VIS) return null;
  if (left.v < VIS) return right.x;
  if (right.v < VIS) return left.x;
  return (left.x + right.x) / 2;
}
