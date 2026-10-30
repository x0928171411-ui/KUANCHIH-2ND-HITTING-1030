import { compareSwings } from "@/lib/compare";
import type { SwingRead } from "@/lib/types";
import { cn } from "@/lib/utils";

export function BlastPanel({ best, current }: { best: SwingRead | null; current: SwingRead | null }) {
  const comparison = best && current ? compareSwings(best, current) : null;

  return (
    <section id="blast" className="scroll-mt-6 rounded-2xl border border-line bg-card p-4 md:p-5">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <h2 className="text-lg font-semibold text-white">Blast 數字比較</h2>
        <p className="text-xs text-muted">骨架估計，不是感測器。同一機位才好互相比。</p>
      </div>

      {!comparison ? (
        <p className="mt-4 text-sm leading-6 text-muted">分析完成後，最佳揮棒和目前這球會並排在這裡。</p>
      ) : comparison.rows.length === 0 ? (
        <p className="mt-4 text-sm leading-6 text-amber">{comparison.summary}</p>
      ) : (
        <>
          <p className="mt-3 text-sm leading-6 text-white">{comparison.summary}</p>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[520px] border-collapse text-left text-sm">
              <thead>
                <tr className="text-xs text-muted">
                  <th className="py-2 pr-3 font-medium">項目</th>
                  <th className="py-2 pr-3 font-medium text-cyan">最佳揮棒</th>
                  <th className="py-2 pr-3 font-medium text-orange">目前這球</th>
                  <th className="py-2 pr-3 font-medium">差距</th>
                  <th className="py-2 font-medium">怎麼看</th>
                </tr>
              </thead>
              <tbody>
                {comparison.rows.map((row) => (
                  <tr key={row.id} className="border-t border-line">
                    <th className="py-3 pr-3 font-medium text-white">{row.label}</th>
                    <td className="py-3 pr-3 font-mono tabular-nums text-[#d7f6fd]">{row.best}</td>
                    <td className="py-3 pr-3 font-mono tabular-nums text-[#ffe0cc]">{row.current}</td>
                    <td className="py-3 pr-3 font-mono tabular-nums">{row.delta}</td>
                    <td className={cn("py-3", row.tone === "gap" ? "text-white" : "text-muted")}>{row.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
