"use client";

import { useMemo, useRef, useState } from "react";
import { BlastPanel } from "@/components/blast-panel";
import { CompareStage } from "@/components/compare-stage";
import { UploadCard } from "@/components/upload-card";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { HANDEDNESS_OPTIONS, MODEL_OPTIONS, PLAYBACK_RATES, rateLabel } from "@/lib/constants";
import { interpretSwing } from "@/lib/analyze";
import { ensureModel, readVideoPoses } from "@/lib/pose-engine";
import type { HandednessChoice, ModelQuality, PlaybackRate, PoseFrame, VideoSlot } from "@/lib/types";
import { cn } from "@/lib/utils";

const STEPS = [
  { n: 1, label: "偵測骨架" },
  { n: 2, label: "逐幀拆解" },
  { n: 3, label: "判斷階段" },
  { n: 4, label: "兩棒比對" },
];

export function SwingLab() {
  const [best, setBest] = useState<VideoSlot | null>(null);
  const [current, setCurrent] = useState<VideoSlot | null>(null);
  const [bestFrames, setBestFrames] = useState<PoseFrame[] | null>(null);
  const [currentFrames, setCurrentFrames] = useState<PoseFrame[] | null>(null);
  const [hand, setHand] = useState<HandednessChoice>("auto");
  const [model, setModel] = useState<ModelQuality>("full");
  const [analyzedModel, setAnalyzedModel] = useState<ModelQuality | null>(null);
  const [rate, setRate] = useState<PlaybackRate>(1);
  const [bestContact, setBestContact] = useState<number | null>(null);
  const [currentContact, setCurrentContact] = useState<number | null>(null);
  const [running, setRunning] = useState(false);
  const [step, setStep] = useState(0);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const bestRead = useMemo(
    () => (bestFrames && best ? interpretSwing(bestFrames, hand, best.width / best.height, bestContact) : null),
    [bestFrames, best, hand, bestContact],
  );
  const currentRead = useMemo(
    () =>
      currentFrames && current
        ? interpretSwing(currentFrames, hand, current.width / current.height, currentContact)
        : null,
    [currentFrames, current, hand, currentContact],
  );

  const ready = Boolean(best && current);
  const analyzed = Boolean(bestFrames && currentFrames && bestRead && currentRead);
  const header =
    running ? "分析中" : analyzed ? "分析完成" : ready ? "可以分析" : best || current ? "還差一支影片" : "尚未載入影片";

  const modelNote = MODEL_OPTIONS.find((option) => option.value === model)?.note ?? "";
  const handNote =
    hand === "auto"
      ? "自動判斷靠左右腳。慢的電腦比較容易看反，不確定就改選左打者或右打者。"
      : hand === "left"
        ? "鎖定左打者。鉛側是右腳、右手。換邊只重算階段，不重跑影片。"
        : "鎖定右打者。鉛側是左腳、左手。換邊只重算階段，不重跑影片。";

  const statusText = running
    ? progress || "分析中…"
    : error
      ? `${error}${analyzed ? " 播放仍可調到 0.1 倍。打者方向和擊球幀也可以直接改。" : ""}`
      : analyzed
        ? "分析完成。播放可以調到 0.1 倍。擊球的那一幀可以自己標，左打或右打也會立刻重算，不用重跑骨架。"
        : ready
          ? "兩支影片都好了。慢的電腦建議先指定左打或右打，再開始分析。"
          : "等待影片。第一次分析會載入人體姿態模型（標準約 10 MB），之後留在這台電腦。影片不會上傳。";

  function clearBest() {
    setBest(null);
    setBestFrames(null);
    setBestContact(null);
    setError(null);
  }

  function clearCurrent() {
    setCurrent(null);
    setCurrentFrames(null);
    setCurrentContact(null);
    setError(null);
  }

  async function start() {
    if (!best || !current || running) return;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setRunning(true);
    setError(null);
    setBestFrames(null);
    setCurrentFrames(null);
    setStep(1);
    setProgress(model === "lite" ? "正在載入輕量姿態模型…" : "正在載入姿態模型…");
    try {
      await ensureModel(model, ctrl.signal);
      setStep(2);
      const bestPose = await readVideoPoses(best.url, model, ctrl.signal, (done, total) => {
        setProgress(`最佳揮棒 ${done} / ${total} 幀`);
      });
      const currentPose = await readVideoPoses(current.url, model, ctrl.signal, (done, total) => {
        setProgress(`目前揮棒 ${done} / ${total} 幀`);
      });
      setStep(3);
      setProgress("判斷著地、啟動、擊球、收棒…");
      await wait(80);
      const bestResult = interpretSwing(bestPose, hand, best.width / best.height);
      const currentResult = interpretSwing(currentPose, hand, current.width / current.height);
      setStep(4);
      setProgress("對照兩支揮棒…");
      await wait(80);
      setBestFrames(bestPose);
      setCurrentFrames(currentPose);
      setAnalyzedModel(model);
      if (!bestResult.ok || !currentResult.ok) {
        setError("骨架沒有抓穩。請確認全身入鏡、光線夠，或改成輕量模型再試。");
      }
      setProgress("");
    } catch (caught) {
      if (ctrl.signal.aborted || (caught instanceof DOMException && caught.name === "AbortError")) {
        setProgress("已取消。");
        setStep(0);
      } else {
        setError(caught instanceof Error ? caught.message : "分析失敗。");
        setStep(0);
      }
    } finally {
      setRunning(false);
    }
  }

  function onPrimary() {
    if (running) {
      abortRef.current?.abort();
      return;
    }
    void start();
  }

  const mismatch =
    hand === "auto" && bestRead?.ok && currentRead?.ok && bestRead.handedness !== currentRead.handedness;
  const muddy = hand === "auto" && ((bestRead?.lowConfidence ?? false) || (currentRead?.lowConfidence ?? false));
  const modelStale = analyzed && analyzedModel !== null && analyzedModel !== model;

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 md:py-8">
      <header className="flex items-center justify-between gap-3 text-[11px] tracking-[0.16em]">
        <div className="flex items-center gap-3 text-[#9eb6c6]">
          <span className="font-semibold text-white">SWING LAB</span>
          <span>棒球</span>
          <span className="hidden sm:inline">Blast 影片</span>
        </div>
        <p className="text-[#9eb6c6]">{header}</p>
      </header>

      <section className="max-w-3xl">
        <h1 className="text-4xl leading-[1.05] font-bold tracking-tight text-white md:text-5xl">
          揮棒實驗室
          <span className="mt-1 block text-cyan">一棒拆解</span>
        </h1>
        <p className="mt-4 text-sm leading-7 text-muted">
          上傳兩支揮棒影片：最佳揮棒（青色，當成你的矯正版）和目前這球（橘色）。程式會在你的電腦內一格一格看完影片，抓出身上
          33 個關節點，重建估計的 3D 人形，自動找出著地、啟動、擊球、收棒，並告訴你哪裡跟最佳揮棒不一樣。影片不會上傳到任何伺服器。
        </p>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <UploadCard
          tone="cyan"
          title="最佳揮棒 · 青色（矯正版）"
          hint="拖曳影片到這裡，或選擇檔案。建議：單次完整揮棒、固定機位、全身入鏡。"
          rate={rate}
          contact={bestContact}
          onContact={setBestContact}
          onClear={clearBest}
          onSlot={(slot) => {
            setBest(slot);
            setBestFrames(null);
            setError(null);
          }}
        />
        <UploadCard
          tone="orange"
          title="目前揮棒 · 橘色（球員）"
          hint="機位、距離、揮棒動作留白盡量跟最佳那支相同。"
          rate={rate}
          contact={currentContact}
          onContact={setCurrentContact}
          onClear={clearCurrent}
          onSlot={(slot) => {
            setCurrent(slot);
            setCurrentFrames(null);
            setError(null);
          }}
        />
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
          <div className="flex flex-col gap-1">
            <span className="text-[11px] text-muted" id="batter-label">
              打者
            </span>
            <ToggleGroup
              type="single"
              value={hand}
              onValueChange={(value) => {
                if (value === "auto" || value === "left" || value === "right") setHand(value);
              }}
              aria-labelledby="batter-label"
            >
              {HANDEDNESS_OPTIONS.map((option) => (
                <ToggleGroupItem key={option.value} value={option.value}>
                  {option.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>

          <label className="flex flex-col gap-1 text-[11px] text-muted">
            模型
            <select
              value={model}
              disabled={running}
              onChange={(event) => setModel(event.target.value as ModelQuality)}
              className="h-9 rounded-lg border border-line bg-[#071821] px-2 text-sm font-semibold text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan"
            >
              {MODEL_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <div className="flex flex-col gap-1">
            <span className="text-[11px] text-muted" id="rate-label">
              播放速度
            </span>
            <ToggleGroup
              type="single"
              value={String(rate)}
              onValueChange={(value) => {
                const next = Number(value);
                if (next === 0.1 || next === 0.25 || next === 0.5 || next === 1) setRate(next);
              }}
              aria-labelledby="rate-label"
            >
              {PLAYBACK_RATES.map((item) => (
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

          <div className="ml-auto flex items-center gap-3">
            <Button type="button" onClick={onPrimary} disabled={!ready && !running} className="min-w-28">
              {running ? "取消分析" : modelStale ? "用新模型再分析" : "開始分析"}
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <p className="max-w-3xl text-sm leading-6 text-muted">{handNote}</p>
          <Button variant="quiet" asChild>
            <a
              href="#blast"
              onClick={(event) => {
                event.preventDefault();
                document.getElementById("blast")?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
            >
              Blast 數字比較 →
            </a>
          </Button>
        </div>
        <p className="text-xs leading-5 text-muted">
          {modelNote}
          {rate === 0.1 ? " 現在是 0.1 倍慢放，預覽和比對都會用這個速度。" : ""}
          {analyzed ? " 換左打、右打，或改擊球的那一幀，會馬上重算，不用再按開始分析。" : " 可以先把影片停在打到球的那一格，按「這幀是擊球」。"}
        </p>
      </section>

      {mismatch ? (
        <p className="rounded-xl border border-amber/50 bg-[#2a220f] px-4 py-3 text-sm leading-6 text-amber">
          兩支影片自動看成不一樣的打者。若是同一個人，請改選左打者或右打者，不用重跑。
        </p>
      ) : null}
      {muddy && !mismatch ? (
        <p className="rounded-xl border border-amber/50 bg-[#2a220f] px-4 py-3 text-sm leading-6 text-amber">
          這支影片的左右腳不好分。直接選左打者或右打者，前腳會跟著改，不用重跑骨架。
        </p>
      ) : null}

      <section className="rounded-2xl border border-line bg-[#091826] px-4 py-3" aria-live="polite">
        <ol className="flex flex-wrap gap-x-4 gap-y-2">
          {STEPS.map((item) => {
            const state = stepState(item.n, step, running, analyzed);
            return (
              <li key={item.n} className="flex items-center gap-2 text-sm">
                <span
                  className={cn(
                    "flex h-6 w-6 items-center justify-center rounded-md border text-xs font-semibold",
                    state === "done" && "border-cyan bg-cyan text-[#042029]",
                    state === "active" && "border-cyan text-cyan",
                    state === "wait" && "border-line text-muted",
                  )}
                >
                  {item.n}
                </span>
                <span className={state === "wait" ? "text-muted" : "text-white"}>{item.label}</span>
              </li>
            );
          })}
        </ol>
        <p className={cn("mt-3 text-sm leading-6", error ? "text-orange" : "text-muted")}>{statusText}</p>
      </section>

      {analyzed && best && current && bestFrames && currentFrames && bestRead && currentRead ? (
        <CompareStage
          best={best}
          current={current}
          bestFrames={bestFrames}
          currentFrames={currentFrames}
          bestRead={bestRead}
          currentRead={currentRead}
          rate={rate}
          onRate={setRate}
          bestContact={bestContact}
          currentContact={currentContact}
          onBestContact={setBestContact}
          onCurrentContact={setCurrentContact}
        />
      ) : null}

      <BlastPanel best={bestRead} current={currentRead} />

      <p className="text-xs leading-5 text-muted">
        估計值來自骨架，用來跟自己的最佳揮棒比。機位和距離要盡量一樣，不要拿去跟別的場地比。
      </p>
    </main>
  );
}

function stepState(n: number, step: number, running: boolean, done: boolean) {
  if (done) return "done" as const;
  if (!running) return "wait" as const;
  if (n < step) return "done" as const;
  if (n === step) return "active" as const;
  return "wait" as const;
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
