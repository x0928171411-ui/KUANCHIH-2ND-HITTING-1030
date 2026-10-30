import { MAX_DETECT_WIDTH, MAX_FRAMES, SAMPLE_FPS, modelAsset } from "./constants";
import type { ModelQuality, PoseFrame } from "./types";

type VisionModule = typeof import("@mediapipe/tasks-vision");
type Landmarker = Awaited<ReturnType<VisionModule["PoseLandmarker"]["createFromOptions"]>>;

let cached: { key: string; landmarker: Landmarker } | null = null;

function aborted(signal: AbortSignal) {
  if (signal.aborted) throw new DOMException("分析已取消", "AbortError");
}

export async function ensureModel(quality: ModelQuality, signal: AbortSignal) {
  aborted(signal);
  const key = quality === "lite" ? "lite" : "full";
  if (cached?.key === key) return cached.landmarker;

  cached?.landmarker.close();
  cached = null;

  const vision = await import("@mediapipe/tasks-vision");
  aborted(signal);
  const fileset = await vision.FilesetResolver.forVisionTasks("/mediapipe/wasm");
  aborted(signal);

  const create = (delegate: "GPU" | "CPU") =>
    vision.PoseLandmarker.createFromOptions(fileset, {
      baseOptions: {
        modelAssetPath: modelAsset(quality),
        delegate,
      },
      runningMode: "IMAGE",
      numPoses: 1,
      minPoseDetectionConfidence: 0.35,
      minPosePresenceConfidence: 0.35,
      minTrackingConfidence: 0.35,
    });

  let landmarker: Landmarker | null = null;
  try {
    landmarker = await create("GPU");
    const probe = document.createElement("canvas");
    probe.width = 8;
    probe.height = 8;
    landmarker.detect(probe);
  } catch {
    landmarker?.close();
    try {
      landmarker = await create("CPU");
    } catch {
      throw new Error("姿態模型載入失敗。請重新整理後再分析一次。");
    }
  }

  cached = { key, landmarker };
  return landmarker;
}

function sampleTimes(duration: number, fps: number, maxFrames: number) {
  const safe = Math.max(duration, 0.2);
  let step = 1 / fps;
  if (safe / step > maxFrames) step = safe / maxFrames;
  const end = Math.max(0, duration - 0.04);
  const times: number[] = [];
  for (let time = 0; time <= end + 1e-4; time += step) {
    times.push(Math.min(time, end));
    if (times.length >= maxFrames) break;
  }
  return times.length ? times : [0];
}

function waitFor(video: HTMLVideoElement, event: keyof HTMLMediaElementEventMap, timeoutMs: number) {
  return new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error("影片讀取逾時。可以改成較短的 MP4 再試。"));
    }, timeoutMs);
    const onReady = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("這支影片播不了。請改用 H.264 的 MP4 或 WebM。"));
    };
    const cleanup = () => {
      window.clearTimeout(timer);
      video.removeEventListener(event, onReady);
      video.removeEventListener("error", onError);
    };
    video.addEventListener(event, onReady, { once: true });
    video.addEventListener("error", onError, { once: true });
  });
}

function seekTo(video: HTMLVideoElement, time: number) {
  const duration = Number.isFinite(video.duration) ? video.duration : time;
  const target = Math.min(Math.max(time, 0), Math.max(duration - 0.001, 0));
  if (Math.abs(video.currentTime - target) < 0.0008) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      cleanup();
      resolve();
    }, 2500);
    const onSeeked = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("影片讀到一半失敗。"));
    };
    const cleanup = () => {
      window.clearTimeout(timer);
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onError);
    };
    video.addEventListener("seeked", onSeeked);
    video.addEventListener("error", onError);
    video.currentTime = target;
  });
}

function toFrame(time: number, result: ReturnType<Landmarker["detect"]>): PoseFrame {
  const points = result.landmarks?.[0];
  const world = result.worldLandmarks?.[0];
  if (!points || points.length < 33) {
    result.close();
    return { t: time, lm: null };
  }
  const frame: PoseFrame = {
    t: time,
    lm: points.slice(0, 33).map((point, index) => ({
      x: point.x || 0,
      y: point.y || 0,
      z: point.z || 0,
      v: point.visibility ?? point.presence ?? 0,
      wx: world?.[index]?.x || 0,
      wy: world?.[index]?.y || 0,
      wz: world?.[index]?.z || 0,
    })),
  };
  result.close();
  return frame;
}

export async function readVideoPoses(
  url: string,
  quality: ModelQuality,
  signal: AbortSignal,
  onFrame: (done: number, total: number) => void,
) {
  const landmarker = await ensureModel(quality, signal);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = url;
  video.style.cssText = "position:fixed;width:160px;height:90px;opacity:0;pointer-events:none;left:0;top:0";
  document.body.appendChild(video);

  try {
    if (video.readyState < 2) await waitFor(video, "loadeddata", 8000);
    aborted(signal);
    if (!Number.isFinite(video.duration) || video.duration < 0.15) {
      throw new Error("這支影片太短，或這個瀏覽器播不了。請改用 H.264 的 MP4。");
    }
    try {
      await video.play();
      video.pause();
    } catch {
      video.pause();
    }

    const times = sampleTimes(video.duration, SAMPLE_FPS[quality], MAX_FRAMES[quality]);
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, MAX_DETECT_WIDTH[quality] / Math.max(video.videoWidth, 1));
    canvas.width = Math.max(2, Math.round((video.videoWidth || 640) * scale));
    canvas.height = Math.max(2, Math.round((video.videoHeight || 360) * scale));
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("這台電腦沒辦法讀影片畫面。");

    const frames: PoseFrame[] = [];
    for (let index = 0; index < times.length; index++) {
      aborted(signal);
      await seekTo(video, times[index]);
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      try {
        frames.push(toFrame(times[index], landmarker.detect(canvas)));
      } catch {
        frames.push({ t: times[index], lm: null });
      }
      onFrame(index + 1, times.length);
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    }
    return frames;
  } finally {
    video.pause();
    video.removeAttribute("src");
    video.load();
    video.remove();
  }
}
