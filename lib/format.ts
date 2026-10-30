import type { MetricUnit } from "./types";

export function formatClock(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds - minutes * 60;
  return `${minutes}:${rest.toFixed(2).padStart(5, "0")}`;
}

export function formatMeasure(value: number, unit: MetricUnit) {
  if (!Number.isFinite(value)) return "—";
  if (unit === "m") return `${Math.round(value * 100)} cm`;
  return `${value.toFixed(2)} 身位`;
}

export function formatMeasureDelta(delta: number, unit: MetricUnit) {
  if (!Number.isFinite(delta)) return "—";
  const sign = delta > 0 ? "+" : delta < 0 ? "−" : "";
  if (unit === "m") return `${sign}${Math.abs(Math.round(delta * 100))} cm`;
  return `${sign}${Math.abs(delta).toFixed(2)} 身位`;
}

export function formatSeconds(value: number) {
  if (!Number.isFinite(value)) return "—";
  return `${value.toFixed(2)} 秒`;
}

export function formatMsDelta(delta: number) {
  if (!Number.isFinite(delta)) return "—";
  const ms = Math.round(delta * 1000);
  if (ms === 0) return "0 毫秒";
  return `${ms > 0 ? "+" : "−"}${Math.abs(ms)} 毫秒`;
}

export function formatSpeed(value: number, unit: MetricUnit) {
  if (!Number.isFinite(value)) return "—";
  if (unit === "m") return `${value.toFixed(1)} m/s`;
  return `${value.toFixed(1)} 身位/秒`;
}

export function formatSpeedDelta(best: number, current: number) {
  if (!Number.isFinite(best) || !Number.isFinite(current) || best <= 0.05) return "—";
  const pct = Math.round(((current - best) / best) * 100);
  if (pct === 0) return "0%";
  return `${pct > 0 ? "+" : "−"}${Math.abs(pct)}%`;
}

export function formatDegrees(value: number) {
  if (!Number.isFinite(value)) return "—";
  return `${Math.round(value)}°`;
}

export function formatDegreeDelta(delta: number) {
  if (!Number.isFinite(delta)) return "—";
  const rounded = Math.round(delta);
  if (rounded === 0) return "0°";
  return `${rounded > 0 ? "+" : "−"}${Math.abs(rounded)}°`;
}
