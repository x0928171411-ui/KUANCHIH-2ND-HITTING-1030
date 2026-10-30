import {
  formatDegreeDelta,
  formatDegrees,
  formatMeasure,
  formatMeasureDelta,
  formatMsDelta,
  formatSeconds,
  formatSpeed,
  formatSpeedDelta,
} from "./format";
import type { DiffRow, SwingComparison, SwingRead } from "./types";

function relativeGap(best: number, current: number) {
  return Math.abs(current - best) / Math.max(Math.abs(best), 1e-6);
}

export function compareSwings(best: SwingRead, current: SwingRead): SwingComparison {
  if (!best.ok || !current.ok) {
    return {
      rows: [],
      summary: "有一支影片沒有抓穩骨架，數字先不要拿來比較。",
      unitsDiffer: false,
    };
  }

  const unitsDiffer = best.metrics.unit !== current.metrics.unit;
  const unit = best.metrics.unit;
  const rows: DiffRow[] = [];

  const strideRatio = best.metrics.stride > 0.01 ? current.metrics.stride / best.metrics.stride : 1;
  rows.push({
    id: "stride",
    label: "踏步",
    best: formatMeasure(best.metrics.stride, best.metrics.unit),
    current: formatMeasure(current.metrics.stride, current.metrics.unit),
    delta: unitsDiffer ? "—" : formatMeasureDelta(current.metrics.stride - best.metrics.stride, unit),
    note:
      strideRatio < 0.92 ? "踏步比最佳揮棒短。" : strideRatio > 1.08 ? "踏步比最佳揮棒長。" : "踏步長度和最佳揮棒接近。",
    tone: strideRatio < 0.92 || strideRatio > 1.08 ? "gap" : "close",
  });

  const timeDelta = current.metrics.timeToContact - best.metrics.timeToContact;
  rows.push({
    id: "time",
    label: "啟動到擊球",
    best: formatSeconds(best.metrics.timeToContact),
    current: formatSeconds(current.metrics.timeToContact),
    delta: formatMsDelta(timeDelta),
    note:
      timeDelta > 0.03
        ? "啟動到擊球比較慢。"
        : timeDelta < -0.03
          ? "啟動到擊球比較快。"
          : "啟動到擊球的時間接近。",
    tone: Math.abs(timeDelta) > 0.03 ? "gap" : "close",
  });

  const speedRatio = best.metrics.handSpeed > 0.05 ? current.metrics.handSpeed / best.metrics.handSpeed : 1;
  rows.push({
    id: "hand",
    label: "手部峰值速度",
    best: formatSpeed(best.metrics.handSpeed, best.metrics.unit),
    current: formatSpeed(current.metrics.handSpeed, current.metrics.unit),
    delta: unitsDiffer ? "—" : formatSpeedDelta(best.metrics.handSpeed, current.metrics.handSpeed),
    note:
      speedRatio < 0.92 ? "手部最快速度比最佳揮棒慢。" : speedRatio > 1.08 ? "手部最快速度比最佳揮棒快。" : "手部速度接近。",
    tone: !unitsDiffer && (speedRatio < 0.92 || speedRatio > 1.08) ? "gap" : "close",
  });

  const sepDelta = current.metrics.hipShoulderSep - best.metrics.hipShoulderSep;
  rows.push({
    id: "sep",
    label: "髖肩分離",
    best: formatDegrees(best.metrics.hipShoulderSep),
    current: formatDegrees(current.metrics.hipShoulderSep),
    delta: formatDegreeDelta(sepDelta),
    note: sepDelta < -5 ? "髖肩分離比較小。" : sepDelta > 5 ? "髖肩分離比較大。" : "髖肩分離接近。",
    tone: Math.abs(sepDelta) > 5 ? "gap" : "close",
  });

  const kneeDelta = current.metrics.frontKnee - best.metrics.frontKnee;
  rows.push({
    id: "knee",
    label: "擊球前膝",
    best: formatDegrees(best.metrics.frontKnee),
    current: formatDegrees(current.metrics.frontKnee),
    delta: formatDegreeDelta(kneeDelta),
    note: kneeDelta < -6 ? "擊球時前膝比較彎。" : kneeDelta > 6 ? "擊球時前膝比較直。" : "擊球時前膝角度接近。",
    tone: Math.abs(kneeDelta) > 6 ? "gap" : "close",
  });

  const shiftRatio = Math.abs(best.metrics.weightShift) > 0.01 ? current.metrics.weightShift / best.metrics.weightShift : 1;
  rows.push({
    id: "weight",
    label: "重心前移",
    best: formatMeasure(best.metrics.weightShift, best.metrics.unit),
    current: formatMeasure(current.metrics.weightShift, current.metrics.unit),
    delta: unitsDiffer ? "—" : formatMeasureDelta(current.metrics.weightShift - best.metrics.weightShift, unit),
    note:
      shiftRatio < 0.85 ? "重心往前送得比較少。" : shiftRatio > 1.15 ? "重心往前送得比較多。" : "重心前移接近。",
    tone: !unitsDiffer && (shiftRatio < 0.85 || shiftRatio > 1.15) ? "gap" : "close",
  });

  if (unitsDiffer) {
    return {
      rows,
      summary: "兩支影片的比例尺不一樣，公分和身位不要直接相減。時間和角度還是可以看。",
      unitsDiffer: true,
    };
  }

  const ranked = rows
    .filter((row) => row.tone === "gap")
    .map((row) => ({
      row,
      score:
        row.id === "time"
          ? Math.abs(current.metrics.timeToContact - best.metrics.timeToContact) / 0.2
          : row.id === "sep"
            ? Math.abs(current.metrics.hipShoulderSep - best.metrics.hipShoulderSep) / 20
            : row.id === "knee"
              ? Math.abs(current.metrics.frontKnee - best.metrics.frontKnee) / 20
              : row.id === "stride"
                ? relativeGap(best.metrics.stride, current.metrics.stride)
                : row.id === "hand"
                  ? relativeGap(best.metrics.handSpeed, current.metrics.handSpeed)
                  : relativeGap(best.metrics.weightShift, current.metrics.weightShift),
    }))
    .sort((a, b) => b.score - a.score);

  const summary = ranked.length
    ? ranked
        .slice(0, 2)
        .map((item) => item.row.note)
        .join("")
    : "步伐、時間和手速都跟最佳揮棒接近。";

  return { rows, summary, unitsDiffer: false };
}
