"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { formatClock } from "@/lib/format";
import type { PlaybackRate, VideoSlot } from "@/lib/types";
import { cn } from "@/lib/utils";

type Props = {
  tone: "cyan" | "orange";
  title: string;
  hint: string;
  rate: PlaybackRate;
  contact: number | null;
  onContact: (time: number | null) => void;
  onClear: () => void;
  onSlot: (slot: VideoSlot) => void;
};

export function UploadCard({ tone, title, hint, rate, contact, onContact, onClear, onSlot }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const nameRef = useRef("");
  const [url, setUrl] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [meta, setMeta] = useState<{ duration: number; width: number; height: number } | null>(null);
  const [over, setOver] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [rateNote, setRateNote] = useState<string | null>(null);

  useEffect(() => {
    if (!url) return;
    return () => URL.revokeObjectURL(url);
  }, [url]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const apply = () => {
      video.playbackRate = rate;
      if (Math.abs(video.playbackRate - rate) > 0.03) {
        setRateNote(`這個瀏覽器最慢放到 ${video.playbackRate.toFixed(2)} 倍。`);
      } else {
        setRateNote(null);
      }
    };
    apply();
    video.addEventListener("play", apply);
    video.addEventListener("loadedmetadata", apply);
    return () => {
      video.removeEventListener("play", apply);
      video.removeEventListener("loadedmetadata", apply);
    };
  }, [rate, url]);

  function take(file: File | undefined) {
    if (!file) return;
    const looksLikeVideo = file.type.startsWith("video/") || /\.(mp4|webm|mov|m4v)$/i.test(file.name);
    if (!looksLikeVideo) {
      setError("請放影片檔，例如 MP4 或 WebM。");
      return;
    }
    setError(null);
    setMeta(null);
    setPlaying(false);
    setTime(0);
    nameRef.current = file.name;
    setName(file.name);
    onClear();
    setUrl(URL.createObjectURL(file));
  }

  function onMetadata() {
    const video = videoRef.current;
    if (!video || !url) return;
    if (!Number.isFinite(video.duration) || video.duration <= 0) {
      setError("讀不到這支影片的長度。請改用 H.264 的 MP4。");
      return;
    }
    const next = {
      duration: video.duration,
      width: video.videoWidth,
      height: video.videoHeight,
    };
    setMeta(next);
    onSlot({ name: nameRef.current, url, ...next });
  }

  async function toggle() {
    const video = videoRef.current;
    if (!video) return;
    if (!video.paused) {
      video.pause();
      setPlaying(false);
      return;
    }
    video.playbackRate = rate;
    try {
      await video.play();
      setPlaying(true);
    } catch {
      setError("這個瀏覽器沒辦法播放這支影片。");
    }
  }

  function step(direction: -1 | 1) {
    const video = videoRef.current;
    if (!video) return;
    video.pause();
    setPlaying(false);
    const next = Math.min(Math.max(video.currentTime + direction / 30, 0), video.duration || 0);
    video.currentTime = next;
    setTime(next);
  }

  return (
    <article
      onDragOver={(event) => {
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        take(event.dataTransfer.files?.[0]);
      }}
      className={cn(
        "flex min-h-[168px] flex-col rounded-2xl border bg-card p-4 transition-colors",
        tone === "cyan" ? "border-cyan" : "border-yellow",
        over && "bg-[#123044]",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-[15px] font-semibold text-white">{title}</h2>
        <Button variant="outline" size="sm" type="button" onClick={() => inputRef.current?.click()}>
          {url ? "更換影片" : "選擇影片"}
        </Button>
        <input
          ref={inputRef}
          className="sr-only"
          type="file"
          accept="video/mp4,video/webm,video/quicktime,video/*"
          onChange={(event) => {
            take(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
      </div>

      {url ? (
        <div className="mt-3 flex flex-1 flex-col gap-2">
          <div className="relative overflow-hidden rounded-xl bg-black">
            <video
              ref={videoRef}
              src={url}
              muted
              playsInline
              preload="metadata"
              className="aspect-video w-full bg-black object-contain"
              onLoadedMetadata={onMetadata}
              onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)}
              onPause={() => setPlaying(false)}
              onPlay={() => setPlaying(true)}
              onEnded={() => setPlaying(false)}
              onError={() => setError("這支影片播不了。請改用 H.264 的 MP4 或 WebM。")}
            />
            {rate === 0.1 ? (
              <span className="absolute left-2 top-2 rounded-md bg-amber px-2 py-1 text-[11px] font-bold text-[#2a1d05]">
                0.1× 慢放
              </span>
            ) : rate !== 1 ? (
              <span className="absolute left-2 top-2 rounded-md bg-black/70 px-2 py-1 text-[11px] font-semibold text-white">
                {rate}×
              </span>
            ) : null}
            {contact != null && Math.abs(time - contact) < 1 / 40 ? (
              <span className="absolute top-2 right-2 rounded-md bg-white px-2 py-1 text-[11px] font-bold text-[#042029]">
                擊球
              </span>
            ) : null}
          </div>
          <p className="truncate text-xs text-muted" title={name}>
            {name}
            {meta ? ` · ${formatClock(meta.duration)} · ${meta.width}×${meta.height}` : " · 讀取中"}
          </p>
          {meta && meta.duration > 12 ? (
            <p className="text-xs text-amber">影片超過 12 秒。剪成單次揮棒，慢的電腦會比較穩。</p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => void toggle()} disabled={!meta}>
              {playing ? "暫停" : "播放"}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => step(-1)} disabled={!meta}>
              上一幀
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => step(1)} disabled={!meta}>
              下一幀
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!meta}
              onClick={() => {
                const video = videoRef.current;
                if (!video) return;
                video.pause();
                setPlaying(false);
                onContact(video.currentTime);
              }}
              className={
                contact != null && Math.abs(time - contact) < 1 / 40
                  ? "border-amber bg-amber text-[#2a1d05] hover:bg-[#ffd78a]"
                  : undefined
              }
            >
              這幀是擊球
            </Button>
            {contact != null ? (
              <Button type="button" variant="quiet" size="sm" onClick={() => onContact(null)}>
                改回自動
              </Button>
            ) : null}
            <span className="ml-auto font-mono text-xs tabular-nums text-muted">
              {formatClock(time)}
              {meta ? ` / ${formatClock(meta.duration)}` : ""}
            </span>
          </div>
          {contact != null ? (
            <p className="text-xs text-amber">擊球標在 {formatClock(contact)}。這格會留下來，換邊也不用重跑。</p>
          ) : (
            <p className="text-xs text-muted">停在球棒碰到球的那一格，按「這幀是擊球」。沒標的話就用自動判斷。</p>
          )}
          {rateNote ? <p className="text-xs text-amber">{rateNote}</p> : null}
        </div>
      ) : (
        <p className="mt-3 max-w-md text-sm leading-6 text-muted">{hint}</p>
      )}
      {error ? <p className="mt-2 text-sm text-orange">{error}</p> : null}
    </article>
  );
}
