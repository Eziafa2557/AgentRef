"use client";

/**
 * Journey — the visual spine of the AgentRef walkthrough:
 *
 *   01 Brief → 02 Delivery → 03 Evidence → 04 Challenge → 05 AgentRef / GenLayer → 06 Verdict
 *
 * Rendered at the top of the create, challenge and verify pages so a reviewer
 * always knows where they are in the flow. `step` is the current step (1–6);
 * earlier steps are marked done, later steps are dimmed.
 */
import { Check } from "lucide-react";
import { cx } from "@/components/ui";

const STEPS = [
  { n: "01", label: "Brief" },
  { n: "02", label: "Delivery" },
  { n: "03", label: "Evidence" },
  { n: "04", label: "Challenge" },
  { n: "05", label: "AgentRef / GenLayer" },
  { n: "06", label: "Verdict" },
] as const;

export function Journey({ step, accent = "cyan" }: { step: number; accent?: "cyan" | "amber" | "violet" }) {
  const current = Math.max(1, Math.min(6, step));
  return (
    <div className="-mx-1 overflow-x-auto px-1">
      <ol className="flex items-center gap-1.5">
        {STEPS.map((s, i) => {
          const n = i + 1;
          const done = n < current;
          const isCurrent = n === current;
          const accentRing =
            accent === "amber"
              ? "border-amber-400/50 text-amber-300"
              : accent === "violet"
                ? "border-violet-400/50 text-violet-300"
                : "border-cyan-400/50 text-cyan-300";
          return (
            <li key={s.n} className="flex shrink-0 items-center gap-1.5">
              <div
                className={cx(
                  "flex items-center gap-1.5 rounded-full border px-2.5 py-1 transition-colors",
                  isCurrent
                    ? cx("bg-white/[0.04] font-semibold text-white", accentRing)
                    : done
                      ? "border-emerald-400/25 bg-emerald-500/[0.06] text-emerald-200/90"
                      : "border-white/[0.06] text-slate-600"
                )}
              >
                {done ? (
                  <Check className="h-3 w-3 text-emerald-400" />
                ) : (
                  <span className="font-mono text-[9px] font-bold opacity-80">{s.n}</span>
                )}
                <span className="whitespace-nowrap text-[10.5px] font-medium tracking-wide">{s.label}</span>
              </div>
              {n < STEPS.length && <span className="h-px w-2 shrink-0 bg-white/10" />}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
