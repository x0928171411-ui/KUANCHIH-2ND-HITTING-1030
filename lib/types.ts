export type Side = "left" | "right";

export type HandednessChoice = "auto" | Side;

export type ModelQuality = "lite" | "full" | "fine";

export type PlaybackRate = 0.1 | 0.25 | 0.5 | 1;

export type PhaseId = "load" | "landing" | "contact" | "follow";

/** One body point. x/y are image-normalized (0–1). wx/wy/wz are meters. */
export type Landmark = {
  x: number;
  y: number;
  z: number;
  v: number;
  wx: number;
  wy: number;
  wz: number;
};

export type PoseFrame = {
  t: number;
  lm: Landmark[] | null;
};

export type MetricUnit = "m" | "bh";

export type SwingMetrics = {
  unit: MetricUnit;
  /** Stride length. Meters, or body-heights when unit is "bh". */
  stride: number;
  /** Seconds from the gather (啟動) to the fastest hands (擊球). */
  timeToContact: number;
  /** Peak hand speed. m/s, or body-heights per second. */
  handSpeed: number;
  /** Peak hip–shoulder separation, degrees, between 啟動 and 擊球. */
  hipShoulderSep: number;
  /** Front-knee angle at contact. 180 is straight. */
  frontKnee: number;
  /** How far the hips travel toward the pitch. Same unit as stride. */
  weightShift: number;
};

export type SwingRead = {
  ok: boolean;
  handedness: Side;
  choice: HandednessChoice;
  inferred: Side;
  /** User named the other side from the one the feet suggest, and the feet were clear. */
  mirrored: boolean;
  confidence: number;
  lowConfidence: boolean;
  /** Draw the brighter lead arm on the raw left-side joints. */
  highlightRawLeft: boolean;
  /** +1 means the hands move toward the right edge of the frame. */
  imageSwingSign: 1 | -1;
  /** Lead wrist sits on the left half relative to the other wrist. */
  leadOnImageLeft: boolean;
  /** Contact time came from the coach, not the hand-speed peak. */
  contactSource: "auto" | "manual";
  phases: Record<PhaseId, number>;
  metrics: SwingMetrics;
  validFrames: number;
  frameCount: number;
  warnings: string[];
};

export type VideoSlot = {
  name: string;
  url: string;
  duration: number;
  width: number;
  height: number;
};

export type DiffTone = "close" | "gap";

export type DiffRow = {
  id: string;
  label: string;
  best: string;
  current: string;
  delta: string;
  note: string;
  tone: DiffTone;
};

export type SwingComparison = {
  rows: DiffRow[];
  summary: string;
  unitsDiffer: boolean;
};
