"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { BEST_COLOR, CURRENT_COLOR, PHASES, PLAYBACK_RATES, rateLabel } from "@/lib/constants";
import { drawPose, frameAt, videoContentRect } from "@/lib/draw-pose";
import { formatClock } from "@/lib/format";
import {
  handTrail,
  impactReport,
  liveRows,
  measurePose,
  projectLandmarks,
  spaceSpec,
  swingFacing,
  type ImpactCard,
  type ImpactTone,
  type ImpactView,
  type SwingFacing,
} from "@/lib/impact";
import type { PlaybackRate, PoseFrame, Side, SwingRead, VideoSlot } from "@/lib/types";
import { cn } from "@/lib/utils";

type FigureMode = "both" | "stack" | "current" | "best";
type Clip = "current" | "best";

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

const VIEWS: Array<{ id: ImpactView; label: string }> = [
  { id: "camera", label: "原始鏡頭" },
  { id: "front", label: "正面 3D" },
  { id: "pitcher", label: "投手方向" },
  { id: "top", label: "俯視" },
];

const BONES: Array<[number, number, "L" | "R" | "M"]> = [
  [11, 12, "M"],
  [23, 24, "M"],
  [11, 23, "L"],
  [12, 24, "R"],
  [11, 13, "L"],
  [13, 15, "L"],
  [12, 14, "R"],
  [14, 16, "R"],
  [23, 25, "L"],
  [25, 27, "L"],
  [24, 26, "R"],
  [26, 28, "R"],
  [27, 31, "L"],
  [28, 32, "R"],
];

export function ImpactBoard({
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
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [playing, setPlaying] = useState(false);
  const [master, setMaster] = useState(0);
  const [view, setView] = useState<ImpactView>("pitcher");
  const [figures, setFigures] = useState<FigureMode>("both");
  const [clip, setClip] = useState<Clip>("current");
  const [notes, setNotes] = useState(true);
  const [trail, setTrail] = useState(true);
  const [ground, setGround] = useState(true);
  const [cardsOnCanvas, setCardsOnCanvas] = useState(false);
  const playingRef = useRef(false);
  const masterRef = useRef(0);

  const contactBest = bestContact ?? (bestRead.ok ? bestRead.phases.contact : 0);
  const contactCurrent = currentContact ?? (currentRead.ok ? currentRead.phases.contact : 0);
  const contactKey = `${bestContact ?? ""}|${currentContact ?? ""}`;
  const [seenContact, setSeenContact] = useState(contactKey);
  if (seenContact !== contactKey) {
    setSeenContact(contactKey);
    setMaster(0);
  }

  const start = -Math.max(contactBest, contactCurrent);
  const end = Math.max(best.duration - contactBest, current.duration - contactCurrent, 0.2);
  const rawBest = master + contactBest;
  const rawCurrent = master + contactCurrent;

  const report = useMemo(
    () =>
      impactReport(
        bestRead,
        currentRead,
        bestFrames,
        currentFrames,
        best.width / best.height,
        current.width / current.height,
      ),
    [bestRead, currentRead, bestFrames, currentFrames, best.width, best.height, current.width, current.height],
  );
  const bestLive = bestRead.ok
    ? measurePose(bestFrames, rawBest, bestRead.handedness, bestRead.phases.load, best.width / best.height)
    : null;
  const currentLive = currentRead.ok
    ? measurePose(currentFrames, rawCurrent, currentRead.handedness, currentRead.phases.load, current.width / current.height)
    : null;
  const rows = liveRows(bestLive, currentLive);
  const focus = report.cards.find((card) => card.tone === "bad") ?? report.cards.find((card) => card.tone === "warn") ?? null;
  const phaseName = nearestPhase(master, bestRead, contactBest);
  const bestSpec = useMemo(() => spaceSpec(bestFrames, best.width / best.height), [bestFrames, best.width, best.height]);
  const currentSpec = useMemo(
    () => spaceSpec(currentFrames, current.width / current.height),
    [currentFrames, current.width, current.height],
  );
  const bestFacing = useMemo(
    () => swingFacing(bestFrames, bestRead.handedness, bestRead.imageSwingSign, bestSpec, bestRead.phases.landing),
    [bestFrames, bestRead.handedness, bestRead.imageSwingSign, bestRead.phases.landing, bestSpec],
  );
  const currentFacing = useMemo(
    () =>
      swingFacing(
        currentFrames,
        currentRead.handedness,
        currentRead.imageSwingSign,
        currentSpec,
        currentRead.phases.landing,
      ),
    [currentFrames, currentRead.handedness, currentRead.imageSwingSign, currentRead.phases.landing, currentSpec],
  );

  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);

  useEffect(() => {
    masterRef.current = master;
  }, [master]);

  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      let stop = false;
      setMaster((value) => {
        const next = value + dt * rate;
        if (next >= end) {
          stop = true;
          return end;
        }
        return next;
      });
      if (stop) {
        setPlaying(false);
        return;
      }
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [playing, rate, end]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const paint = () => {
      const bounds = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(1, Math.round(bounds.width * dpr));
      const height = Math.max(1, Math.round(bounds.height * dpr));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const overlay = notes && report.cards.length > 0 && bounds.width >= 720 && bounds.height >= 380;
      setCardsOnCanvas((value) => (value === overlay ? value : overlay));
      paintStage(ctx, width, height, {
        view,
        figures,
        trail,
        ground,
        notes,
        overlay,
        cards: report.cards,
        focusId: focus?.id ?? null,
        title: phaseHeading(phaseName),
        badge: phaseBadge(phaseName),
        best: bestRead.ok
          ? {
              frames: bestFrames,
              read: bestRead,
              spec: bestSpec,
              facing: bestFacing,
              time: rawBest,
              color: BEST_COLOR,
            }
          : null,
        current: currentRead.ok
          ? {
              frames: currentFrames,
              read: currentRead,
              spec: currentSpec,
              facing: currentFacing,
              time: rawCurrent,
              color: CURRENT_COLOR,
            }
          : null,
      });
    };
    paint();
    const observer = new ResizeObserver(paint);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [
    view,
    figures,
    trail,
    ground,
    notes,
    focus,
    phaseName,
    report.cards,
    master,
    bestRead,
    currentRead,
    bestFrames,
    currentFrames,
    bestSpec,
    currentSpec,
    bestFacing,
    currentFacing,
    rawBest,
    rawCurrent,
    contactBest,
  ]);

  function jump(raw: number) {
    setPlaying(false);
    setMaster(clamp(raw - contactBest, start, end));
  }

  function confirmHit() {
    const raw = clip === "best" ? rawBest : rawCurrent;
    const duration = clip === "best" ? best.duration : current.duration;
    if (raw < -0.02 || raw > duration + 0.02) return;
    setPlaying(false);
    if (clip === "best") onBestContact(Math.max(0, raw));
    else onCurrentContact(Math.max(0, raw));
  }

  const ready = bestRead.ok || currentRead.ok;

  return (
    <section id="impact" className="scroll-mt-6 rounded-2xl border border-line bg-[#07111c] p-4 md:p-5">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-white">擊球瞬間</h2>
          <p className="mt-1 text-sm text-muted">
            青色是最佳揮棒，黃色是目前這球。差距會拉線標在目前這球的關節上。
          </p>
        </div>
        <p className="font-mono text-xs text-muted">T {formatSigned(master)}</p>
      </div>

      {report.pills.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {report.pills.map((pill) => (
            <span key={pill.id} className={cn("rounded-full border px-2.5 py-1 text-xs", toneClass(pill.tone))}>
              {pill.label} {pill.value}
            </span>
          ))}
        </div>
      ) : null}

      <div className="mt-4 grid items-start gap-3 xl:grid-cols-[minmax(0,1fr)_220px]">
        <div className="grid items-start gap-3 lg:grid-cols-[150px_minmax(0,1fr)]">
          {notes && ready ? (
            <table className="w-full text-left text-[11px] leading-5">
              <thead>
                <tr className="text-muted">
                  <th className="py-1 pr-2 font-medium" />
                  <th className="py-1 pr-2 font-medium text-cyan">最佳</th>
                  <th className="py-1 font-medium text-yellow">球員</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.label} className="border-t border-line/70">
                    <th className="py-1 pr-2 font-medium text-[#d5e4ee]">{row.label}</th>
                    <td className="py-1 pr-2 font-mono text-cyan">{row.best}</td>
                    <td className="py-1 font-mono text-yellow">{row.current}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="hidden lg:block" />
          )}

          <div>
            <div className="relative min-h-[320px] overflow-hidden rounded-xl border border-line bg-[#071018] lg:min-h-[460px]">
              <canvas ref={canvasRef} className="h-full min-h-[320px] w-full lg:min-h-[460px]" />
            </div>
            {notes && report.cards.length > 0 && !cardsOnCanvas ? (
              <div className="mt-2 flex flex-col gap-2">
                {report.cards.map((card) => (
                  <Callout key={card.id} card={card} />
                ))}
              </div>
            ) : null}
          </div>
        </div>

        <FilmInset
          clip={clip}
          slot={clip === "best" ? best : current}
          frames={clip === "best" ? bestFrames : currentFrames}
          read={clip === "best" ? bestRead : currentRead}
          color={clip === "best" ? BEST_COLOR : CURRENT_COLOR}
          raw={clip === "best" ? rawBest : rawCurrent}
          rate={rate}
          playing={playing}
          onClip={setClip}
        />
      </div>

      <div className="mt-3 flex flex-wrap gap-3 text-[11px] text-muted">
        <span className="inline-flex items-center gap-1">
          <i className="h-2 w-2 rounded-full bg-cyan" /> 最佳（矯正版）
        </span>
        <span className="inline-flex items-center gap-1">
          <i className="h-2 w-2 rounded-full bg-yellow" /> 目前（你）
        </span>
        <span className="inline-flex items-center gap-1">
          <i className="h-2 w-2 rounded-full bg-white" /> 拉線標出的關節
        </span>
      </div>

      <div className="mt-4">
        <label className="sr-only" htmlFor="impact-scrub">
          擊球時間軸
        </label>
        <input
          id="impact-scrub"
          type="range"
          min={start}
          max={end}
          step={0.001}
          value={clamp(master, start, end)}
          onChange={(event) => {
            setPlaying(false);
            setMaster(Number(event.target.value));
          }}
        />
        <div className="relative mt-2 h-4">
          {bestRead.ok
            ? PHASES.map((phase) => {
                const at = bestRead.phases[phase.id] - contactBest;
                const left = ((at - start) / (end - start)) * 100;
                return (
                  <span
                    key={phase.id}
                    className="absolute top-1 h-2 w-2 -translate-x-1/2 rounded-full"
                    style={{ left: `${clamp(left, 0, 100)}%`, background: phase.color }}
                    title={phase.label}
                  />
                );
              })
            : null}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button type="button" onClick={() => setPlaying((value) => !value)}>
          {playing ? "暫停" : "播放"}
        </Button>
        <ToggleGroup
          type="single"
          value={String(rate)}
          onValueChange={(value) => {
            if (value === "0.1" || value === "0.25" || value === "0.5" || value === "1") onRate(Number(value) as PlaybackRate);
          }}
          aria-label="骨架播放速度"
        >
          {PLAYBACK_RATES.map((item) => (
            <ToggleGroupItem key={item} value={String(item)}>
              {item === 0.1 ? "0.1×" : rateLabel(item)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <span className="text-[11px] text-muted">顯示</span>
        <ToggleGroup
          type="single"
          value={figures}
          onValueChange={(value) => {
            if (value === "both" || value === "stack" || value === "current" || value === "best") setFigures(value);
          }}
          aria-label="顯示誰"
        >
          <ToggleGroupItem value="both">左右並排</ToggleGroupItem>
          <ToggleGroupItem value="stack">疊在一起</ToggleGroupItem>
          <ToggleGroupItem value="current">只看球員</ToggleGroupItem>
          <ToggleGroupItem value="best">只看最佳</ToggleGroupItem>
        </ToggleGroup>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="text-[11px] text-muted">視角</span>
        <ToggleGroup
          type="single"
          value={view}
          onValueChange={(value) => {
            if (value === "camera" || value === "front" || value === "pitcher" || value === "top") setView(value);
          }}
          aria-label="視角"
        >
          {VIEWS.map((item) => (
            <ToggleGroupItem key={item.id} value={item.id}>
              {item.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <PressButton on={notes} onClick={() => setNotes((value) => !value)}>
          定格標註
        </PressButton>
        <PressButton on={trail} onClick={() => setTrail((value) => !value)}>
          手部軌跡
        </PressButton>
        <PressButton on={ground} onClick={() => setGround((value) => !value)}>
          地面
        </PressButton>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="text-[11px] text-muted">定格</span>
        <Button type="button" variant="outline" size="sm" onClick={() => jump(Math.max(0, bestRead.phases.load - 0.4))}>
          準備
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => jump(bestRead.phases.landing)}>
          著地
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => jump(bestRead.phases.load)}>
          啟動
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => jump(bestRead.phases.contact)}>
          擊球
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => jump(bestRead.phases.follow)}>
          收尾
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => { setPlaying(false); setMaster((value) => clamp(value - 1 / 30, start, end)); }}>
          −1 格
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => { setPlaying(false); setMaster((value) => clamp(value + 1 / 30, start, end)); }}>
          +1 格
        </Button>
        <span className="text-[11px] text-muted">空白鍵在下面的並排播放。這裡用按鈕。</span>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <button type="button" onClick={confirmHit} className="text-sm font-semibold text-white underline-offset-4 hover:underline">
          確認擊球幀
        </button>
        <p className="text-xs text-muted">
          會把右邊{clip === "best" ? "最佳" : "目前"}這支、現在停住的這一格當成擊球。不用重跑骨架。
        </p>
      </div>
    </section>
  );
}

function Callout({ card }: { card: ImpactCard }) {
  return (
    <article className={cn("rounded-lg border px-2.5 py-2 text-[11px] leading-5", toneClass(card.tone))}>
      <p className="font-semibold text-white">
        {card.label} · 最佳 {card.best}
      </p>
      <p>
        目前 {card.current}
        {card.delta !== "0°" && card.delta !== "0 毫秒" ? ` ${card.delta}` : ""} → {card.advice}
        {card.tone === "good" ? " ✓" : ""}
      </p>
    </article>
  );
}

function PressButton({ on, onClick, children }: { on: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "h-8 rounded-md border px-2.5 text-[13px] font-semibold",
        on ? "border-cyan bg-[#14384c] text-white" : "border-line bg-[#071821] text-[#b7c9d6]",
      )}
    >
      {children}
    </button>
  );
}

function FilmInset({
  clip,
  slot,
  frames,
  read,
  color,
  raw,
  rate,
  playing,
  onClip,
}: {
  clip: Clip;
  slot: VideoSlot;
  frames: PoseFrame[];
  read: SwingRead;
  color: string;
  raw: number;
  rate: PlaybackRate;
  playing: boolean;
  onClip: (clip: Clip) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const outside = raw < -0.03 || raw > slot.duration + 0.03;

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const duration = video.duration || slot.duration;
    const target = clamp(raw, 0, Math.max(duration - 0.001, 0));
    video.playbackRate = rate;
    if (video.readyState >= 1 && Math.abs(video.currentTime - target) > (playing ? 0.08 : 0.02)) {
      video.currentTime = target;
    }
    if (playing && !outside) {
      if (video.paused) void video.play().catch(() => undefined);
    } else video.pause();
  }, [raw, rate, playing, outside, slot.duration, clip]);

  useEffect(() => {
    let frame = 0;
    const paint = () => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (video && canvas) {
        const bounds = canvas.getBoundingClientRect();
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const width = Math.max(1, Math.round(bounds.width * dpr));
        const height = Math.max(1, Math.round(bounds.height * dpr));
        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width;
          canvas.height = height;
        }
        const ctx = canvas.getContext("2d");
        if (ctx) {
          const rect = videoContentRect(video.videoWidth, video.videoHeight, width, height);
          drawPose(ctx, frameAt(frames, video.currentTime || 0), rect, color, read.highlightRawLeft);
        }
      }
      frame = window.requestAnimationFrame(paint);
    };
    frame = window.requestAnimationFrame(paint);
    return () => window.cancelAnimationFrame(frame);
  }, [frames, color, read.highlightRawLeft]);

  return (
    <aside className="rounded-xl border border-line bg-[#071018] p-2">
      <div className="mb-2 flex items-center justify-between gap-2 text-[11px] text-muted">
        <span>原始影片</span>
        <span className="font-mono">{outside ? "—" : formatClock(Math.max(raw, 0))}</span>
      </div>
      <div className="relative overflow-hidden rounded-lg bg-black" style={{ aspectRatio: `${slot.width} / ${slot.height}` }}>
        <video
          ref={videoRef}
          src={slot.url}
          muted
          playsInline
          preload="auto"
          className="h-full w-full object-contain"
        />
        <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" />
        {outside ? (
          <div className="absolute inset-0 flex items-center justify-center bg-black/55 text-xs text-white">
            {raw < 0 ? "這支還沒開始" : "這支已經結束"}
          </div>
        ) : null}
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => onClip("current")}
          className={cn(
            "rounded-lg border py-2 text-sm font-semibold",
            clip === "current" ? "border-yellow bg-[#3a3412] text-yellow" : "border-line text-muted",
          )}
        >
          目前
        </button>
        <button
          type="button"
          onClick={() => onClip("best")}
          className={cn(
            "rounded-lg border py-2 text-sm font-semibold",
            clip === "best" ? "border-cyan bg-[#14384c] text-cyan" : "border-line text-muted",
          )}
        >
          最佳
        </button>
      </div>
    </aside>
  );
}

type Figure = {
  frames: PoseFrame[];
  read: SwingRead;
  spec: ReturnType<typeof spaceSpec>;
  facing: SwingFacing;
  time: number;
  color: string;
};

type Anchor = { x: number; y: number };
type JointAnchors = Record<Exclude<ImpactCard["id"], "time">, Anchor | null>;

function paintStage(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  input: {
    view: ImpactView;
    figures: FigureMode;
    trail: boolean;
    ground: boolean;
    notes: boolean;
    overlay: boolean;
    cards: ImpactCard[];
    focusId: ImpactCard["id"] | null;
    title: string;
    badge: string;
    best: Figure | null;
    current: Figure | null;
  },
) {
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#071018";
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "rgba(148, 184, 206, 0.12)";
  ctx.lineWidth = 1;
  for (let x = 0; x < width; x += 48) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let y = 0; y < height; y += 48) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  const overlay = input.overlay && input.notes && input.cards.length > 0;
  const stageRight = overlay ? width * 0.58 : width;
  const stacked = input.figures === "stack";
  const slots: Array<{ figure: Figure | null; cx: number; who: "best" | "current" }> = stacked
    ? [
        { figure: input.best, cx: stageRight * 0.5, who: "best" },
        { figure: input.current, cx: stageRight * 0.5, who: "current" },
      ]
    : input.figures === "current"
      ? [{ figure: input.current, cx: stageRight * 0.5, who: "current" }]
      : input.figures === "best"
        ? [{ figure: input.best, cx: stageRight * 0.5, who: "best" }]
        : [
            { figure: input.best, cx: stageRight * 0.36, who: "best" },
            { figure: input.current, cx: stageRight * 0.66, who: "current" },
          ];
  const limit = overlay
    ? input.figures === "both"
      ? Math.min(stageRight * 0.32, height * 0.46)
      : Math.min(stageRight * 0.4, height * 0.48)
    : input.figures === "both"
      ? Math.min(width * 0.22, height * 0.42)
      : Math.min(width * 0.34, height * 0.44);
  const lineTarget: "best" | "current" | null =
    input.figures === "best" ? (input.best ? "best" : null) : input.current ? "current" : input.best ? "best" : null;
  let anchors: JointAnchors | null = null;
  for (const slot of slots) {
    if (!slot.figure) continue;
    const marked =
      slot.who === lineTarget
        ? markedJoints(input.cards, slot.figure.read.handedness, overlay ? null : input.focusId)
        : new Set<number>();
    const drawn = drawFigure(ctx, slot.figure, slot.cx, height * 0.57, limit, { ...input, marked }, stacked ? 0.78 : 1);
    if (slot.who === lineTarget && drawn) anchors = drawn;
  }
  if (!input.best && !input.current) {
    ctx.fillStyle = "#9eb3c6";
    ctx.font = `500 ${Math.round(height * 0.04)}px ${CANVAS_FONT}`;
    ctx.textAlign = "center";
    ctx.fillText("骨架不夠，沒辦法畫出人形。", width / 2, height / 2);
  }
  const headingBottom = paintHeading(ctx, width, height, input.title, input.badge, stageRight);
  if (overlay && anchors) drawCallouts(ctx, width, height, input.cards, anchors, headingBottom);
}

const CANVAS_FONT = '"WenQuanYi Micro Hei", "Microsoft JhengHei", "PingFang TC", sans-serif';

function paintHeading(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  title: string,
  badge: string,
  stageRight: number,
) {
  const fontSize = Math.round(Math.max(15, Math.min(32, height * 0.04)));
  const titleY = Math.max(14, height * 0.03);
  ctx.font = `600 ${fontSize}px ${CANVAS_FONT}`;
  ctx.fillStyle = "#d7e6f0";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  const titleX = stageRight / 2;
  ctx.fillText(title, titleX, titleY);
  const titleWidth = ctx.measureText(title).width;
  const underlineY = titleY + fontSize + 6;
  ctx.strokeStyle = "#e6c36a";
  ctx.lineWidth = Math.max(1.5, height * 0.0022);
  ctx.beginPath();
  ctx.moveTo(titleX - titleWidth / 2, underlineY);
  ctx.lineTo(titleX + titleWidth / 2, underlineY);
  ctx.stroke();
  ctx.font = `600 ${Math.round(fontSize * 0.92)}px ${CANVAS_FONT}`;
  const badgeWidth = ctx.measureText(badge).width;
  const gutter = Math.max(14, width * 0.014);
  if (badge && titleX + titleWidth / 2 + 18 < width - gutter - badgeWidth) {
    ctx.textAlign = "right";
    ctx.fillStyle = "#e8f2f8";
    ctx.fillText(badge, width - gutter, titleY);
  }
  ctx.textAlign = "left";
  return underlineY + Math.max(12, height * 0.02);
}

function drawFigure(
  ctx: CanvasRenderingContext2D,
  figure: Figure,
  cx: number,
  cy: number,
  limit: number,
  input: { view: ImpactView; trail: boolean; ground: boolean; marked: Set<number> },
  opacity = 1,
): JointAnchors | null {
  const frame = frameAt(figure.frames, figure.time);
  const points = projectLandmarks(frame?.lm ?? null, input.view, figure.read.handedness, figure.spec, figure.facing);
  if (!points) return null;
  const hip = mid2(points[23], points[24]);
  const sho = mid2(points[11], points[12]);
  if (!hip || !sho) return null;
  const torso = Math.hypot(sho.x - hip.x, sho.y - hip.y) || 0.4;
  let scale = (limit * 0.85) / torso;
  let maxReach = 0.001;
  for (const point of points) {
    if (!point) continue;
    maxReach = Math.max(maxReach, Math.abs(point.x - hip.x), Math.abs(point.y - hip.y));
  }
  if (maxReach * scale > limit) scale = limit / maxReach;
  const map = (point: { x: number; y: number }) => ({
    x: cx + (point.x - hip.x) * scale,
    y: cy - (point.y - hip.y) * scale,
  });

  if (input.ground) {
    const ankles = [points[27], points[28]].filter((point): point is { x: number; y: number } => !!point);
    const foot = ankles.length ? map(ankles.reduce((a, b) => (a.y < b.y ? a : b))) : map(hip);
    ctx.save();
    ctx.translate(cx, foot.y + 8);
    ctx.scale(1, 0.28);
    ctx.beginPath();
    ctx.strokeStyle = figure.color;
    ctx.globalAlpha = 0.45 * opacity;
    ctx.lineWidth = 2;
    ctx.ellipse(0, 0, Math.max(36, torso * scale * 0.85), Math.max(36, torso * scale * 0.85), 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  if (input.trail) {
    const trail = handTrail(
      figure.frames,
      figure.read.phases.load,
      figure.time,
      input.view,
      figure.read.handedness,
      figure.spec,
      figure.facing,
    );
    if (trail.length > 1) {
      ctx.beginPath();
      ctx.strokeStyle = figure.color;
      ctx.globalAlpha = 0.9 * opacity;
      ctx.lineWidth = 2.5;
      ctx.lineCap = "round";
      trail.forEach((point, index) => {
        const at = map(point);
        if (index === 0) ctx.moveTo(at.x, at.y);
        else ctx.lineTo(at.x, at.y);
      });
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  const leadLeft = figure.read.handedness === "right";
  for (const [from, to, side] of BONES) {
    const start = points[from];
    const end = points[to];
    if (!start || !end) continue;
    const lead = side === "L" ? leadLeft : side === "R" ? !leadLeft : false;
    const a = map(start);
    const b = map(end);
    ctx.beginPath();
    ctx.strokeStyle = figure.color;
    ctx.globalAlpha = (side === "M" ? 0.95 : lead ? 1 : 0.4) * opacity;
    ctx.lineWidth = lead ? 5 : 2.4;
    ctx.lineCap = "round";
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  const nose = points[0];
  const neck = mid2(points[11], points[12]);
  if (nose && neck) {
    const a = map(nose);
    const b = map(neck);
    ctx.beginPath();
    ctx.strokeStyle = figure.color;
    ctx.globalAlpha = 0.8 * opacity;
    ctx.lineWidth = 2;
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  ctx.globalAlpha = opacity;
  for (const index of [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]) {
    const point = points[index];
    if (!point) continue;
    const at = map(point);
    const lead = index !== 0 && (index % 2 === 1) === leadLeft;
    const marked = input.marked.has(index);
    ctx.beginPath();
    ctx.fillStyle = marked ? "#ffffff" : lead ? "#ffffff" : figure.color;
    ctx.arc(at.x, at.y, marked ? 7 : lead ? 5 : 3.5, 0, Math.PI * 2);
    ctx.fill();
    if (index === 0) {
      ctx.beginPath();
      ctx.strokeStyle = figure.color;
      ctx.lineWidth = 2;
      ctx.arc(at.x, at.y, 11, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
  const leadKnee = figure.read.handedness === "right" ? 25 : 26;
  return {
    sho: map(sho),
    hip: map(hip),
    head: nose ? map(nose) : null,
    knee: points[leadKnee] ? map(points[leadKnee]) : null,
  };
}

const CARD_RANK: Record<ImpactCard["id"], number> = { knee: 0, sho: 1, hip: 2, head: 3, time: 4 };

function drawCallouts(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  cards: ImpactCard[],
  anchors: JointAnchors,
  top: number,
) {
  const list = [...cards].sort((a, b) => CARD_RANK[a.id] - CARD_RANK[b.id]);
  if (!list.length) return;
  const gutter = Math.max(12, width * 0.012);
  const cardW = Math.max(160, width - width * 0.58 - gutter * 2);
  const x = width - cardW - gutter;
  const padX = Math.max(10, cardW * 0.04);
  const padY = Math.max(8, height * 0.012);
  const titleSize = Math.round(Math.max(13, Math.min(26, height * 0.028)));
  const bodySize = Math.round(titleSize * 0.92);
  const inner = cardW - padX * 2;
  const laid = list.map((card) => {
    const copy = cardCopy(card);
    ctx.font = `600 ${titleSize}px ${CANVAS_FONT}`;
    const headLines = wrapText(ctx, copy.head, inner);
    ctx.font = `500 ${bodySize}px ${CANVAS_FONT}`;
    const bodyLines = wrapText(ctx, copy.body, inner);
    const h = padY + headLines.length * (titleSize + 4) + 4 + bodyLines.length * (bodySize + 4) + padY;
    return { card, headLines, bodyLines, h };
  });
  const gap = Math.max(6, height * 0.01);
  const total = laid.reduce((sum, item) => sum + item.h, 0) + gap * Math.max(0, laid.length - 1);
  let cursor = top;
  if (cursor + total > height - gutter) cursor = Math.max(gutter, height - gutter - total);
  const placed = laid.map((item) => {
    const y = cursor;
    cursor += item.h + gap;
    return { ...item, y };
  });

  ctx.save();
  ctx.lineCap = "round";
  for (const item of placed) {
    const anchor = item.card.id === "time" ? null : anchors[item.card.id];
    if (!anchor) continue;
    const paint = tonePaint(item.card.tone);
    const midY = item.y + item.h / 2;
    ctx.beginPath();
    ctx.strokeStyle = paint.line;
    ctx.globalAlpha = 0.95;
    ctx.lineWidth = Math.max(1.6, height * 0.0022);
    ctx.moveTo(anchor.x, anchor.y);
    ctx.lineTo(x, midY);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.fillStyle = "#ffffff";
    ctx.arc(anchor.x, anchor.y, Math.max(4.2, height * 0.007), 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.strokeStyle = paint.line;
    ctx.lineWidth = Math.max(2, height * 0.003);
    ctx.arc(anchor.x, anchor.y, Math.max(8, height * 0.013), 0, Math.PI * 2);
    ctx.stroke();
  }
  for (const item of placed) {
    const paint = tonePaint(item.card.tone);
    ctx.beginPath();
    ctx.fillStyle = paint.fill;
    ctx.strokeStyle = paint.border;
    ctx.lineWidth = Math.max(1.5, height * 0.002);
    ctx.roundRect(x, item.y, cardW, item.h, 8);
    ctx.fill();
    ctx.stroke();
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    let textY = item.y + padY;
    ctx.font = `600 ${titleSize}px ${CANVAS_FONT}`;
    ctx.fillStyle = paint.title;
    for (const line of item.headLines) {
      ctx.fillText(line, x + padX, textY);
      textY += titleSize + 4;
    }
    textY += 2;
    ctx.font = `500 ${bodySize}px ${CANVAS_FONT}`;
    ctx.fillStyle = paint.text;
    for (const line of item.bodyLines) {
      ctx.fillText(line, x + padX, textY);
      textY += bodySize + 4;
    }
  }
  ctx.restore();
}

function cardCopy(card: ImpactCard) {
  const showDelta = card.delta !== "0°" && card.delta !== "0 毫秒" && card.delta !== "—";
  return {
    head: `${card.label} · 最佳 ${card.best}`,
    body: `目前 ${card.current}${showDelta ? ` ${card.delta}` : ""} → ${card.advice}${card.tone === "good" ? " ✓" : ""}`,
  };
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const lines: string[] = [];
  let line = "";
  for (const ch of text) {
    const next = line + ch;
    if (line && ctx.measureText(next).width > maxWidth) {
      lines.push(line);
      line = ch;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines.slice(0, 3);
}

function tonePaint(tone: ImpactCard["tone"]) {
  if (tone === "good") return { border: "#3dbe78", fill: "rgba(12, 36, 26, 0.94)", text: "#8ee0b0", line: "#3dbe78", title: "#f4fbf7" };
  if (tone === "warn") return { border: "#e0b15a", fill: "rgba(42, 34, 15, 0.94)", text: "#ffc14a", line: "#e0b15a", title: "#fff8ea" };
  return { border: "#e07080", fill: "rgba(48, 16, 24, 0.94)", text: "#ff9aa4", line: "#ff7d8c", title: "#fff5f6" };
}

function markedJoints(cards: ImpactCard[], handedness: Side, only: ImpactCard["id"] | null) {
  const set = new Set<number>();
  for (const card of cards) {
    if (only && card.id !== only) continue;
    if (card.id === "time") continue;
    for (const index of problemJoints(card.id, handedness)) set.add(index);
  }
  return set;
}

function problemJoints(id: ImpactCard["id"] | null, handedness: Side) {
  if (id === "sho") return [11, 12];
  if (id === "hip") return [23, 24];
  if (id === "head") return [0];
  if (id === "knee") return [handedness === "right" ? 25 : 26];
  return [];
}

function mid2(a: { x: number; y: number } | null, b: { x: number; y: number } | null) {
  if (!a || !b) return null;
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function nearestPhase(master: number, read: SwingRead, contact: number) {
  if (Math.abs(master) < 0.04 || !read.ok) return "擊球瞬間";
  const phases: Array<[string, number]> = [
    ["準備", Math.max(0, read.phases.load - 0.4) - contact],
    ["著地", read.phases.landing - contact],
    ["啟動", read.phases.load - contact],
    ["擊球瞬間", read.phases.contact - contact],
    ["收尾", read.phases.follow - contact],
  ];
  phases.sort((a, b) => Math.abs(a[1] - master) - Math.abs(b[1] - master));
  return phases[0][0];
}

function phaseHeading(name: string) {
  const prefix: Record<string, string> = {
    準備: "READY",
    著地: "LAND",
    啟動: "LOAD",
    擊球瞬間: "IMPACT",
    收尾: "FINISH",
  };
  return `${prefix[name] ?? "SWING"} · ${name}`;
}

function phaseBadge(name: string) {
  return name === "擊球瞬間" ? "擊球" : name;
}

function toneClass(tone: ImpactTone) {
  if (tone === "good") return "border-[#2f8f62] bg-[#10281c] text-[#8ee0b0]";
  if (tone === "warn") return "border-amber/70 bg-[#2a220f] text-amber";
  if (tone === "bad") return "border-[#a33b48] bg-[#2a1218] text-[#ff9aa4]";
  return "border-line bg-[#071821] text-muted";
}

function formatSigned(master: number) {
  const sign = master > 0.005 ? "+" : master < -0.005 ? "−" : "";
  return `${sign}${Math.abs(master).toFixed(2)}s`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
