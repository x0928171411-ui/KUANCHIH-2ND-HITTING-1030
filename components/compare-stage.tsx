"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { PHASES, rateLabel } from "@/lib/constants";
import { drawPose, frameAt, videoContentRect } from "@/lib/draw-pose";
import { formatClock } from "@/lib/format";
import type { PhaseId, PlaybackRate, PoseFrame, SwingRead, VideoSlot } from "@/lib/types";
import { cn } from "@/lib/utils";

type Props = {
  best: VideoSlot;
  current: VideoSlot;
  bestFrames: PoseFrame[];
  currentFrames: PoseFrame[];
  bestRead: SwingRead;
  currentRead: SwingRead;
  rate: PlaybackRate;
  onRate: (rate: PlaybackRate) => void;
  bestContact: number | null;
  currentContact: number | null;
  onBestContact: (time: number | null) => void;
  onCurrentContact: (time: number | null) => void;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function CompareStage({
  best,
  current,
  bestFrames,
  currentFrames,
  bestRead,
  currentRead,
  rate,
  onRate,
  bestContact,
  currentContact,
  onBestContact,
  onCurrentContact,
}: Props) {
  const videoA = useRef<HTMLVideoElement>(null);
  const videoB = useRef<HTMLVideoElement>(null);
  const canvasA = useRef<HTMLCanvasElement>(null);
  const canvasB = useRef<HTMLCanvasElement>(null);
  const [align, setAlign] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [master, setMaster] = useState(0);
  const [rateNote, setRateNote] = useState<string | null>(null);
  const masterRef = useRef(0);
  const playingRef = useRef(false);

  const contactA = bestContact ?? (bestRead.ok ? bestRead.phases.contact : 0);
  const contactB = currentContact ?? (currentRead.ok ? currentRead.phases.contact : 0);
  const contactKey = `${bestContact ?? ""}|${currentContact ?? ""}`;
  const [seenContact, setSeenContact] = useState(contactKey);
  if (seenContact !== contactKey) {
    setSeenContact(contactKey);
    setMaster(0);
  }
  const domain = align
    ? {
        min: -Math.max(contactA, contactB),
        max: Math.max(best.duration - contactA, current.duration - contactB, 0.1),
      }
    : { min: 0, max: Math.max(best.duration, current.duration, 0.1) };

  useEffect(() => {
    masterRef.current = master;
  }, [master]);

  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);

  const place = useCallback(
    (next: number) => {
      const left = videoA.current;
      const right = videoB.current;
      if (!left || !right) return;
      const rawA = align ? next + contactA : next;
      const rawB = align ? next + contactB : next;
      left.currentTime = clamp(rawA, 0, Math.max((left.duration || best.duration) - 0.001, 0));
      right.currentTime = clamp(rawB, 0, Math.max((right.duration || current.duration) - 0.001, 0));
    },
    [align, contactA, contactB, best.duration, current.duration],
  );

  useEffect(() => {
    const left = videoA.current;
    const right = videoB.current;
    const next = masterRef.current;
    if (left && left.readyState >= 1) {
      const raw = align ? next + contactA : next;
      left.currentTime = clamp(raw, 0, Math.max((left.duration || best.duration) - 0.001, 0));
      left.playbackRate = rate;
    }
    if (right && right.readyState >= 1) {
      const raw = align ? next + contactB : next;
      right.currentTime = clamp(raw, 0, Math.max((right.duration || current.duration) - 0.001, 0));
      right.playbackRate = rate;
    }
  }, [align, contactA, contactB, best.url, current.url, best.duration, current.duration, rate]);

  useEffect(() => {
    let frame = 0;
    const paint = () => {
      drawVideo(videoA.current, canvasA.current, bestFrames, bestRead, "#3edcf6");
      drawVideo(videoB.current, canvasB.current, currentFrames, currentRead, "#ff8a3c");
      frame = window.requestAnimationFrame(paint);
    };
    frame = window.requestAnimationFrame(paint);
    return () => window.cancelAnimationFrame(frame);
  }, [bestFrames, currentFrames, bestRead, currentRead]);

  const seek = useCallback(
    (next: number) => {
      const clamped = clamp(next, domain.min, domain.max);
      videoA.current?.pause();
      videoB.current?.pause();
      setPlaying(false);
      playingRef.current = false;
      setMaster(clamped);
      masterRef.current = clamped;
      place(clamped);
    },
    [domain.min, domain.max, place],
  );

  const step = useCallback(
    (direction: -1 | 1) => {
      seek(masterRef.current + direction / 30);
    },
    [seek],
  );

  const toggle = useCallback(async () => {
    const left = videoA.current;
    const right = videoB.current;
    if (!left || !right) return;
    if (playingRef.current) {
      left.pause();
      right.pause();
      setPlaying(false);
      playingRef.current = false;
      return;
    }
    let next = masterRef.current;
    if (next >= domain.max - 0.03) next = domain.min;
    setMaster(next);
    masterRef.current = next;
    place(next);
    left.playbackRate = rate;
    right.playbackRate = rate;
    try {
      await left.play();
      const rawB = align ? next + contactB : next;
      if (rawB >= 0 && rawB < (right.duration || current.duration) - 0.02) await right.play();
      setPlaying(true);
      playingRef.current = true;
    } catch {
      setPlaying(false);
      playingRef.current = false;
    }
  }, [align, rate, domain.min, domain.max, contactB, current.duration, place]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, button, a")) return;
      if (event.code === "Space") {
        event.preventDefault();
        void toggle();
      } else if (event.code === "ArrowLeft") {
        event.preventDefault();
        step(-1);
      } else if (event.code === "ArrowRight") {
        event.preventDefault();
        step(1);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle, step]);

  function onTime() {
    const left = videoA.current;
    const right = videoB.current;
    if (!left || !right || !playingRef.current) return;
    const next = align ? left.currentTime - contactA : left.currentTime;
    setMaster(next);
    masterRef.current = next;
    const target = align ? next + contactB : next;
    if (target < 0 || target > (right.duration || 0)) {
      if (!right.paused) right.pause();
    } else if (right.paused) {
      right.currentTime = target;
      right.playbackRate = rate;
      void right.play();
    } else if (Math.abs(right.currentTime - target) > 0.12) {
      right.currentTime = target;
    }
    if (left.ended || next >= domain.max - 0.015) {
      left.pause();
      right.pause();
      setPlaying(false);
      playingRef.current = false;
    }
  }

  function ready(video: HTMLVideoElement, contact: number) {
    const raw = align ? masterRef.current + contact : masterRef.current;
    video.currentTime = clamp(raw, 0, Math.max((video.duration || 0) - 0.001, 0));
    video.playbackRate = rate;
    if (Math.abs(video.playbackRate - rate) > 0.03) {
      setRateNote(`這個瀏覽器最慢放到 ${video.playbackRate.toFixed(2)} 倍。`);
    } else {
      setRateNote(null);
    }
  }

  function nudge(which: "best" | "current", direction: -1 | 1) {
    const video = which === "best" ? videoA.current : videoB.current;
    if (!video) return;
    videoA.current?.pause();
    videoB.current?.pause();
    setPlaying(false);
    playingRef.current = false;
    const duration = video.duration || (which === "best" ? best.duration : current.duration);
    video.currentTime = clamp(video.currentTime + direction / 30, 0, Math.max(duration - 0.001, 0));
  }

  function mark(which: "best" | "current") {
    const video = which === "best" ? videoA.current : videoB.current;
    if (!video) return;
    videoA.current?.pause();
    videoB.current?.pause();
    setPlaying(false);
    playingRef.current = false;
    const time = video.currentTime;
    if (which === "best") onBestContact(time);
    else onCurrentContact(time);
  }

  function jump(phase: PhaseId) {
    if (!bestRead.ok) return;
    const time = bestRead.phases[phase];
    seek(align ? time - contactA : time);
  }

  const percent = (time: number) => ((time - domain.min) / (domain.max - domain.min)) * 100;

  return (
    <section className="rounded-2xl border border-line bg-card p-4 md:p-5" aria-label="兩棒並排">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-white">兩棒並排</h2>
          <p className="mt-1 text-sm text-muted">
            空白鍵一起播放，左右方向鍵兩支一起走。要改某一支打到球的那一幀，用那支底下的上一幀、下一幀，再按「這幀是擊球」。
          </p>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[11px] text-muted">播放速度</span>
          <ToggleGroup
            type="single"
            value={String(rate)}
            onValueChange={(value) => {
              if (!value) return;
              onRate(Number(value) as PlaybackRate);
            }}
            aria-label="播放速度"
          >
            {([0.1, 0.25, 0.5, 1] as const).map((item) => (
              <ToggleGroupItem
                key={item}
                value={String(item)}
                data-slow={item === 0.1 ? "" : undefined}
                className="data-slow:data-[state=on]:bg-amber data-slow:data-[state=on]:text-[#2a1d05]"
              >
                {rateLabel(item)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Film
          label="最佳揮棒"
          tone="cyan"
          slot={best}
          read={bestRead}
          videoRef={videoA}
          canvasRef={canvasA}
          rate={rate}
          master={master}
          align={align}
          contact={contactA}
          marked={bestContact}
          onTime={onTime}
          onReady={(video) => ready(video, contactA)}
          onNudge={(direction) => nudge("best", direction)}
          onMark={() => mark("best")}
          onClearMark={() => onBestContact(null)}
        />
        <Film
          label="目前揮棒"
          tone="orange"
          slot={current}
          read={currentRead}
          videoRef={videoB}
          canvasRef={canvasB}
          rate={rate}
          master={master}
          align={align}
          contact={contactB}
          marked={currentContact}
          onTime={() => undefined}
          onReady={(video) => ready(video, contactB)}
          onNudge={(direction) => nudge("current", direction)}
          onMark={() => mark("current")}
          onClearMark={() => onCurrentContact(null)}
        />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button type="button" onClick={() => void toggle()}>
          {playing ? "暫停" : "一起播放"}
        </Button>
        <Button type="button" variant="outline" onClick={() => step(-1)}>
          上一幀
        </Button>
        <Button type="button" variant="outline" onClick={() => step(1)}>
          下一幀
        </Button>
        <Button
          type="button"
          variant={align ? "solid" : "outline"}
          onClick={() => {
            videoA.current?.pause();
            videoB.current?.pause();
            setPlaying(false);
            playingRef.current = false;
            setAlign((value) => !value);
            setMaster(0);
            masterRef.current = 0;
          }}
          aria-pressed={align}
        >
          {align ? "已對齊擊球" : "對齊擊球"}
        </Button>
        <span className="ml-auto font-mono text-sm tabular-nums text-muted">{formatClock(Math.max(master, 0))}</span>
      </div>
      {rate === 0.1 ? (
        <p className="mt-2 text-sm text-amber">0.1 倍慢放。停在球棒碰到球的那一格，再按「這幀是擊球」。</p>
      ) : null}
      {rateNote ? <p className="mt-2 text-sm text-amber">{rateNote}</p> : null}

      <div className="mt-4">
        <label className="sr-only" htmlFor="swing-scrub">
          時間軸
        </label>
        <input
          id="swing-scrub"
          type="range"
          min={domain.min}
          max={domain.max}
          step={0.001}
          value={clamp(master, domain.min, domain.max)}
          onChange={(event) => seek(Number(event.target.value))}
        />
        <div className="relative mt-3 h-10">
          <Ticks
            read={bestRead}
            align={align}
            contact={contactA}
            percent={percent}
            className="top-0"
          />
          <Ticks
            read={currentRead}
            align={align}
            contact={contactB}
            percent={percent}
            className="top-5"
          />
        </div>
        <div className="mt-1 flex flex-wrap gap-2">
          {PHASES.map((phase) => (
            <button
              key={phase.id}
              type="button"
              onClick={() => jump(phase.id)}
              className="rounded-full border border-line px-2.5 py-1 text-xs text-[#d5e4ee] hover:border-cyan"
            >
              <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full" style={{ background: phase.color }} />
              {phase.label}
              <span className="ml-1 text-muted">{phase.hint}</span>
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted">上面那排點是最佳揮棒，下面那排是目前這球。點階段名稱會跳過去。</p>
      </div>
    </section>
  );
}

function drawVideo(
  video: HTMLVideoElement | null,
  canvas: HTMLCanvasElement | null,
  frames: PoseFrame[],
  read: SwingRead,
  color: string,
) {
  if (!video || !canvas) return;
  const bounds = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.round(bounds.width * dpr));
  const height = Math.max(1, Math.round(bounds.height * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const context = canvas.getContext("2d");
  if (!context) return;
  const rect = videoContentRect(video.videoWidth, video.videoHeight, width, height);
  drawPose(context, frameAt(frames, video.currentTime || 0), rect, color, read.highlightRawLeft);
}

function Film({
  label,
  tone,
  slot,
  read,
  videoRef,
  canvasRef,
  rate,
  master,
  align,
  contact,
  marked,
  onTime,
  onReady,
  onNudge,
  onMark,
  onClearMark,
}: {
  label: string;
  tone: "cyan" | "orange";
  slot: VideoSlot;
  read: SwingRead;
  videoRef: RefObject<HTMLVideoElement | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  rate: PlaybackRate;
  master: number;
  align: boolean;
  contact: number;
  marked: number | null;
  onTime: () => void;
  onReady: (video: HTMLVideoElement) => void;
  onNudge: (direction: -1 | 1) => void;
  onMark: () => void;
  onClearMark: () => void;
}) {
  const [local, setLocal] = useState(0);
  const synced = align ? master + contact : master;
  const detached = Math.abs(local - clamp(synced, 0, Math.max(slot.duration, 0))) > 1 / 20;
  const outside = !detached && (synced < -0.03 || synced > slot.duration + 0.03);
  const onThisFrame = marked != null && Math.abs(local - marked) < 1 / 40;
  const side = read.handedness === "left" ? "左打者" : "右打者";
  const source =
    read.choice === "auto" ? "自動" : read.lowConfidence ? "依你指定的前腳" : read.mirrored ? "已改掉自動結果" : "你指定的";

  return (
    <figure className="min-w-0">
      <figcaption className="mb-2 flex flex-wrap items-center gap-2">
        <span className={cn("text-sm font-semibold", tone === "cyan" ? "text-cyan" : "text-orange")}>{label}</span>
        <span className="rounded-full border border-line px-2 py-0.5 text-[11px] text-[#d5e4ee]">
          {side} · {source}
        </span>
      </figcaption>
      <div className="relative overflow-hidden rounded-xl bg-black">
        <video
          ref={videoRef}
          src={slot.url}
          muted
          playsInline
          preload="auto"
          className="aspect-video w-full bg-black object-contain"
          onTimeUpdate={(event) => {
            setLocal(event.currentTarget.currentTime);
            onTime();
          }}
          onLoadedMetadata={(event) => onReady(event.currentTarget)}
        />
        <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" />
        {rate === 0.1 ? (
          <span className="absolute left-2 top-2 rounded-md bg-amber px-2 py-1 text-[11px] font-bold text-[#2a1d05]">
            0.1× 慢放
          </span>
        ) : null}
        {onThisFrame ? (
          <span className="absolute top-2 right-2 rounded-md bg-white px-2 py-1 text-[11px] font-bold text-[#042029]">
            擊球
          </span>
        ) : null}
        {outside ? (
          <div className="absolute inset-0 flex items-center justify-center bg-black/55 text-sm text-white">
            {synced < 0 ? "這支還沒開始" : "這支已經結束"}
          </div>
        ) : null}
      </div>
      <p className="mt-2 text-xs leading-5 text-muted">
        {read.ok
          ? `${read.leadOnImageLeft ? "鉛側手在畫面左邊" : "鉛側手在畫面右邊"} · ${
              read.imageSwingSign > 0 ? "揮棒朝畫面右邊" : "揮棒朝畫面左邊"
            }`
          : read.warnings[0]}
      </p>
      {read.ok ? (
        <div className="mt-2 grid grid-cols-4 gap-1 text-center">
          {PHASES.map((phase) => (
            <div
              key={phase.id}
              className={cn(
                "rounded-md bg-[#071821] px-1 py-1.5",
                phase.id === "contact" && read.contactSource === "manual" && "bg-[#2a220f] ring-1 ring-amber",
              )}
            >
              <div className="text-[10px] text-muted">{phase.label}</div>
              <div className="font-mono text-[12px] tabular-nums text-white">{read.phases[phase.id].toFixed(2)}s</div>
            </div>
          ))}
        </div>
      ) : null}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => onNudge(-1)}>
          上一幀
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => onNudge(1)}>
          下一幀
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onMark}
          aria-pressed={onThisFrame}
          className={onThisFrame ? "border-amber bg-amber text-[#2a1d05] hover:bg-[#ffd78a]" : undefined}
        >
          這幀是擊球
        </Button>
        {marked != null ? (
          <Button type="button" variant="quiet" size="sm" onClick={onClearMark}>
            改回自動
          </Button>
        ) : null}
        <span className="ml-auto font-mono text-xs tabular-nums text-muted">{formatClock(local)}</span>
      </div>
      <p className="mt-1 text-xs leading-5 text-muted">
        {marked != null
          ? `擊球標在 ${formatClock(marked)}。兩支會對在這一格。`
          : `擊球現在是自動判斷${read.ok ? `（${formatClock(contact)}）` : ""}。不准就改成你看到的那一格。`}
      </p>
      {read.warnings.length > 0 && read.ok ? <p className="mt-2 text-xs text-amber">{read.warnings[0]}</p> : null}
    </figure>
  );
}

function Ticks({
  read,
  align,
  contact,
  percent,
  className,
}: {
  read: SwingRead;
  align: boolean;
  contact: number;
  percent: (time: number) => number;
  className: string;
}) {
  if (!read.ok) return null;
  return (
    <div className={cn("pointer-events-none absolute right-0 left-0 h-3", className)}>
      {PHASES.map((phase) => {
        const master = align ? read.phases[phase.id] - contact : read.phases[phase.id];
        return (
          <span
            key={phase.id}
            className="absolute top-1 h-2 w-2 -translate-x-1/2 rounded-full"
            style={{ left: `${clamp(percent(master), 0, 100)}%`, background: phase.color }}
            title={phase.label}
          />
        );
      })}
    </div>
  );
}
