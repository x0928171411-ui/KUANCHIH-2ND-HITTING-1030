import type { HandednessChoice, ModelQuality, PhaseId, PlaybackRate } from "./types";

export const PLAYBACK_RATES: readonly PlaybackRate[] = [0.1, 0.25, 0.5, 1];

/** Best swing is cyan. The current swing is yellow. */
export const BEST_COLOR = "#3edcf6";
export const CURRENT_COLOR = "#ffe14a";

export const HANDEDNESS_OPTIONS: readonly { value: HandednessChoice; label: string }[] = [
  { value: "auto", label: "自動判斷" },
  { value: "left", label: "左打者" },
  { value: "right", label: "右打者" },
];

export const MODEL_OPTIONS: readonly { value: ModelQuality; label: string; note: string }[] = [
  {
    value: "lite",
    label: "輕量（較慢的電腦）",
    note: "模型約 6 MB，畫面會縮小再抓，比較不容易卡住。",
  },
  {
    value: "full",
    label: "標準（建議）",
    note: "模型約 10 MB，骨架和速度比較平衡。",
  },
  {
    value: "fine",
    label: "精細",
    note: "同一套標準模型，每秒多看幾格，電腦要夠力。",
  },
];

export const PHASES: readonly { id: PhaseId; label: string; hint: string; color: string }[] = [
  { id: "load", label: "啟動", hint: "手收到最後面", color: "#f0c36a" },
  { id: "landing", label: "著地", hint: "前腳踩穩", color: "#3edcf6" },
  { id: "contact", label: "擊球", hint: "球棒碰到球", color: "#f4f8fb" },
  { id: "follow", label: "收棒", hint: "手送到最前面", color: "#ff8a3c" },
];

export const SAMPLE_FPS: Record<ModelQuality, number> = {
  lite: 8,
  full: 12,
  fine: 20,
};

export const MAX_FRAMES: Record<ModelQuality, number> = {
  lite: 96,
  full: 150,
  fine: 220,
};

export const MAX_DETECT_WIDTH: Record<ModelQuality, number> = {
  lite: 640,
  full: 960,
  fine: 1280,
};

export function modelAsset(quality: ModelQuality) {
  return quality === "lite"
    ? "/mediapipe/models/pose_landmarker_lite.task"
    : "/mediapipe/models/pose_landmarker_full.task";
}

export function rateLabel(rate: PlaybackRate) {
  return rate === 0.1 ? "0.1× 慢放" : `${rate}×`;
}
