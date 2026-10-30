import { Muxer, ArrayBufferTarget } from "mp4-muxer";
import { drawPose, frameAt, videoContentRect } from "./draw-pose";
import { formatClock } from "./format";
import type { PoseFrame, SwingRead } from "./types";

const WIDTH = 1280;
const HEIGHT = 720;
const HALF = WIDTH / 2;
const FPS = 30;
const FONT = '"WenQuanYi Micro Hei", "Microsoft JhengHei", "PingFang TC", sans-serif';

const CODECS = ["avc1.42E01F", "avc1.4D401F", "avc1.640028"] as const;

export function comparisonFilename(rate: number, date = new Date()) {
  const pad = (value: number) => String(value).padStart(2, "0");
  const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  const speed = rate === 0.1 ? "0.1x" : `${rate}x`;
  return `揮棒比較-${speed}-${stamp}.mp4`;
}

export function isVideoFilename(name: string) {
  return /\.(mp4|avi)$/i.test(name);
}

export function outputFrameCount(span: number, rate: number, fps = FPS) {
  if (!(span > 0) || !(rate > 0) || !(fps > 0)) return 1;
  return Math.max(1, Math.ceil((span * fps) / rate - 1e-9));
}

export function masterAtFrame(start: number, index: number, rate: number, fps = FPS) {
  return start + (index * rate) / fps;
}

type Panel = {
  video: HTMLVideoElement;
  frames: PoseFrame[];
  read: SwingRead;
  color: string;
  label: string;
  contact: number;
  duration: number;
};

export type ComparisonExport = {
  bestUrl: string;
  currentUrl: string;
  bestDuration: number;
  currentDuration: number;
  bestFrames: PoseFrame[];
  currentFrames: PoseFrame[];
  bestRead: SwingRead;
  currentRead: SwingRead;
  align: boolean;
  contactA: number;
  contactB: number;
  start: number;
  span: number;
  rate: number;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
};

export async function exportComparison(input: ComparisonExport) {
  if (typeof VideoEncoder === "undefined") {
    throw new Error("這個瀏覽器沒辦法做出 mp4。請改用 Chrome 或 Edge。");
  }

  const filename = comparisonFilename(input.rate);
  const total = outputFrameCount(input.span, input.rate);
  const bestVideo = await openVideo(input.bestUrl);
  const currentVideo = await openVideo(input.currentUrl);
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const context = canvas.getContext("2d", { alpha: false });
  const poseCanvas = document.createElement("canvas");
  poseCanvas.width = HALF;
  poseCanvas.height = HEIGHT;
  const pose = poseCanvas.getContext("2d");
  if (!context || !pose) {
    bestVideo.remove();
    currentVideo.remove();
    throw new Error("這台電腦沒辦法畫比較影片。");
  }

  const best: Panel = {
    video: bestVideo,
    frames: input.bestFrames,
    read: input.bestRead,
    color: "#3edcf6",
    label: "最佳揮棒",
    contact: input.contactA,
    duration: input.bestDuration,
  };
  const current: Panel = {
    video: currentVideo,
    frames: input.currentFrames,
    read: input.currentRead,
    color: "#ff8a3c",
    label: "目前揮棒",
    contact: input.contactB,
    duration: input.currentDuration,
  };

  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: { codec: "avc", width: WIDTH, height: HEIGHT, frameRate: FPS },
    fastStart: "in-memory",
    firstTimestampBehavior: "offset",
  });

  let encoderError: Error | null = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (error) => {
      encoderError = error instanceof Error ? error : new Error("mp4 編碼失敗。");
    },
  });

  try {
    throwIfAborted(input.signal);
    const codec = await supportedCodec();
    encoder.configure({
      codec,
      width: WIDTH,
      height: HEIGHT,
      bitrate: 4_000_000,
      framerate: FPS,
      latencyMode: "quality",
      hardwareAcceleration: "prefer-software",
      avc: { format: "avc" },
    });

    for (let index = 0; index < total; index++) {
      throwIfAborted(input.signal);
      if (encoderError) throw encoderError;
      const master = masterAtFrame(input.start, index, input.rate);
      const rawA = input.align ? master + input.contactA : master;
      const rawB = input.align ? master + input.contactB : master;
      await Promise.all([seekIfNeeded(best.video, rawA, best.duration), seekIfNeeded(current.video, rawB, current.duration)]);
      paint(context, pose, best, rawA, 0);
      paint(context, pose, current, rawB, HALF);
      context.fillStyle = "#1c3c52";
      context.fillRect(HALF - 1, 0, 2, HEIGHT);

      const frame = new VideoFrame(canvas, {
        timestamp: Math.round((index * 1_000_000) / FPS),
        duration: Math.round(1_000_000 / FPS),
      });
      try {
        encoder.encode(frame, { keyFrame: index % FPS === 0 });
      } finally {
        frame.close();
      }
      input.onProgress?.(index + 1, total);
      if (index % 2 === 1) await wait(0);
    }

    throwIfAborted(input.signal);
    await encoder.flush();
    if (encoderError) throw encoderError;
    muxer.finalize();
    const blob = new Blob([target.buffer], { type: "video/mp4" });
    if (blob.size < 32) throw new Error("比較影片是空的，請再試一次。");
    return { filename, blob };
  } finally {
    if (encoder.state !== "closed") encoder.close();
    release(bestVideo);
    release(currentVideo);
  }
}

async function supportedCodec() {
  for (const codec of CODECS) {
    const support = await VideoEncoder.isConfigSupported({
      codec,
      width: WIDTH,
      height: HEIGHT,
      bitrate: 4_000_000,
      framerate: FPS,
      latencyMode: "quality",
      hardwareAcceleration: "prefer-software",
      avc: { format: "avc" },
    });
    if (support.supported) return codec;
  }
  throw new Error("這台電腦沒辦法把比較畫面做成 mp4。請改用 Chrome 或 Edge。");
}

function paint(
  ctx: CanvasRenderingContext2D,
  pose: CanvasRenderingContext2D,
  panel: Panel,
  raw: number,
  x: number,
) {
  ctx.fillStyle = "#071422";
  ctx.fillRect(x, 0, HALF, HEIGHT);
  const outside = raw < -0.03 || raw > panel.duration + 0.03;
  if (!outside && panel.video.readyState >= 2) {
    const rect = videoContentRect(panel.video.videoWidth, panel.video.videoHeight, HALF, HEIGHT);
    ctx.drawImage(panel.video, x + rect.x, rect.y, rect.w, rect.h);
    drawPose(pose, frameAt(panel.frames, Math.max(raw, 0)), rect, panel.color, panel.read.highlightRawLeft);
    ctx.drawImage(pose.canvas, x, 0);
  }

  ctx.fillStyle = "rgba(7, 20, 34, 0.72)";
  ctx.fillRect(x, 0, HALF, 52);
  ctx.fillRect(x, HEIGHT - 44, HALF, 44);
  ctx.font = `600 22px ${FONT}`;
  ctx.fillStyle = panel.color;
  ctx.textBaseline = "middle";
  ctx.fillText(panel.label, x + 16, 26);

  const hit = !outside && Math.abs(raw - panel.contact) < 1 / 30;
  if (hit) {
    ctx.font = `700 16px ${FONT}`;
    ctx.fillStyle = "#2a1d05";
    ctx.fillRect(x + HALF - 72, 12, 56, 28);
    ctx.fillStyle = "#ffc14a";
    ctx.fillText("擊球", x + HALF - 60, 26);
  }

  ctx.font = `500 18px ${FONT}`;
  ctx.fillStyle = "#e8f3fb";
  ctx.fillText(outside ? "—" : formatClock(Math.max(raw, 0)), x + 16, HEIGHT - 22);

  if (outside) {
    ctx.font = `600 22px ${FONT}`;
    ctx.fillStyle = "#e8f3fb";
    ctx.textAlign = "center";
    ctx.fillText(raw < 0 ? "這支還沒開始" : "這支已經結束", x + HALF / 2, HEIGHT / 2);
    ctx.textAlign = "left";
  }
}

function openVideo(url: string) {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = url;
  video.style.position = "fixed";
  video.style.left = "-9999px";
  video.style.width = "160px";
  video.style.height = "90px";
  document.body.appendChild(video);
  return new Promise<HTMLVideoElement>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error("比較影片讀太久，請再試一次。"));
    }, 15000);
    video.onloadeddata = () => {
      window.clearTimeout(timer);
      resolve(video);
    };
    video.onerror = () => {
      window.clearTimeout(timer);
      reject(new Error("比較影片讀不到畫面。請改用 H.264 的 MP4。"));
    };
  });
}

function seekIfNeeded(video: HTMLVideoElement, raw: number, duration: number) {
  if (raw < -0.03 || raw > duration + 0.03) return Promise.resolve();
  const target = Math.min(Math.max(raw, 0), Math.max((video.duration || duration) - 0.001, 0));
  if (video.readyState >= 2 && Math.abs(video.currentTime - target) < 0.0008) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const done = () => {
      video.removeEventListener("seeked", done);
      resolve();
    };
    video.addEventListener("seeked", done);
    video.currentTime = target;
  });
}

function release(video: HTMLVideoElement) {
  video.pause();
  video.removeAttribute("src");
  video.load();
  video.remove();
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("已取消下載。", "AbortError");
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
