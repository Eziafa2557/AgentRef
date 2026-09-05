"use client";

/**
 * Minimal design-system primitives for AgentRef (dark, mobile-first, premium).
 * Kept tiny on purpose — each page composes these rather than duplicating
 * Tailwind strings.
 */
import React from "react";
import Link from "next/link";

/* ---------------------------------------------------------------- helpers */

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/* ---------------------------------------------------------------- Button */

type Tone = "violet" | "ghost" | "pass" | "fail" | "amber" | "subtle" | "cyan" | "danger";
type Size = "xs" | "sm" | "md" | "lg";

const TONES: Record<Tone, string> = {
  violet:
    "bg-gradient-to-b from-violet-500 to-violet-600 text-white shadow-glow hover:from-violet-400 hover:to-violet-600 active:translate-y-px border border-violet-400/40",
  ghost:
    "bg-white/5 text-slate-200 border border-white/10 hover:bg-white/10 hover:border-white/20 active:translate-y-px",
  pass:
    "bg-emerald-500/15 text-emerald-200 border border-emerald-400/30 hover:bg-emerald-500/25 shadow-glow-pass",
  fail: "bg-rose-500/15 text-rose-200 border border-rose-400/30 hover:bg-rose-500/25 shadow-glow-fail",
  amber:
    "bg-amber-500/15 text-amber-200 border border-amber-400/30 hover:bg-amber-500/25",
  cyan: "bg-cyan-500/15 text-cyan-100 border border-cyan-400/30 hover:bg-cyan-500/25",
  subtle: "text-slate-400 hover:text-slate-100",
  danger: "bg-rose-600/20 text-rose-200 border border-rose-500/30 hover:bg-rose-600/30",
};

const SIZES: Record<Size, string> = {
  xs: "text-[11px] px-2.5 py-1.5 rounded-lg gap-1.5",
  sm: "text-xs px-3 py-2 rounded-xl gap-1.5",
  md: "text-sm px-4 py-2.5 rounded-xl gap-2",
  lg: "text-[15px] px-5 py-3 rounded-2xl gap-2",
};

const base =
  "inline-flex items-center justify-center font-medium tracking-tight transition-all duration-150 select-none disabled:opacity-40 disabled:pointer-events-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-400";

interface BtnProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: Tone;
  size?: Size;
  block?: boolean;
}

export function Btn({ tone = "violet", size = "md", block, className, children, ...rest }: BtnProps) {
  return (
    <button
      className={cx(base, TONES[tone], SIZES[size], block && "w-full", className)}
      {...rest}
    >
      {children}
    </button>
  );
}

interface LinkBtnProps {
  href: string;
  tone?: Tone;
  size?: Size;
  block?: boolean;
  className?: string;
  children: React.ReactNode;
  onClick?: () => void;
  target?: string;
}

export function LinkBtn({ href, tone = "violet", size = "md", block, className, children, onClick, target }: LinkBtnProps) {
  return (
    <Link
      href={href}
      target={target}
      onClick={onClick}
      className={cx(base, TONES[tone], SIZES[size], block && "w-full", className)}
    >
      {children}
    </Link>
  );
}

/* ---------------------------------------------------------------- Card */

export function Card({
  className,
  children,
  glow,
  ...rest
}: React.HTMLAttributes<HTMLDivElement> & { glow?: "pass" | "fail" | "cyan" | "violet" | "none" }) {
  return (
    <div
      className={cx(
        "relative rounded-2xl border border-white/[0.08] bg-panel/80 backdrop-blur-sm shadow-card overflow-hidden",
        glow === "pass" && "border-emerald-400/25",
        glow === "fail" && "border-rose-400/25",
        glow === "cyan" && "border-cyan-400/25",
        glow === "violet" && "border-violet-400/25",
        className
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

/* ---------------------------------------------------------------- Badge */

export type BadgeTone = "neutral" | "violet" | "cyan" | "amber" | "pass" | "fail" | "risk" | "rose" | "emerald";

const BADGES: Record<BadgeTone, string> = {
  neutral: "bg-white/5 text-slate-300 border-white/10",
  violet: "bg-violet-500/15 text-violet-200 border-violet-400/25",
  cyan: "bg-cyan-500/12 text-cyan-200 border-cyan-400/25",
  amber: "bg-amber-500/15 text-amber-200 border-amber-400/25",
  pass: "bg-emerald-500/15 text-emerald-200 border-emerald-400/30",
  risk: "bg-orange-500/15 text-orange-200 border-orange-400/30",
  fail: "bg-rose-500/15 text-rose-200 border-rose-400/30",
  rose: "bg-rose-500/15 text-rose-200 border-rose-400/30",
  emerald: "bg-emerald-500/15 text-emerald-200 border-emerald-400/30",
};

export function Badge({
  tone = "neutral",
  className,
  children,
  dot,
}: {
  tone?: BadgeTone;
  className?: string;
  children: React.ReactNode;
  dot?: boolean;
}) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.08em]",
        BADGES[tone],
        className
      )}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" />}
      {children}
    </span>
  );
}

/* ---------------------------------------------------------------- Chip (selectable) */

export function Chip({
  selected,
  className,
  children,
  onClick,
}: {
  selected?: boolean;
  className?: string;
  children: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-all duration-150",
        selected
          ? "border-violet-400/50 bg-violet-500/15 text-violet-100"
          : "border-white/10 bg-white/[0.03] text-slate-400 hover:border-white/20 hover:text-slate-200",
        className
      )}
    >
      {children}
    </button>
  );
}

/* ---------------------------------------------------------------- Mono / hash */

export function Mono({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <span className={cx("font-mono text-[11px] tracking-tight text-slate-400", className)}>
      {children}
    </span>
  );
}

/* ---------------------------------------------------------------- Field */

export function Label({
  children,
  hint,
}: {
  children: React.ReactNode;
  hint?: React.ReactNode;
}) {
  return (
    <div className="mb-1.5 flex items-baseline justify-between gap-2">
      <span className="text-xs font-semibold uppercase tracking-[0.09em] text-slate-400">
        {children}
      </span>
      {hint && <span className="text-[11px] text-slate-500">{hint}</span>}
    </div>
  );
}

export function Field({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return <label className={cx("block", className)}>{children}</label>;
}

export const inputCls =
  "w-full rounded-xl border border-white/10 bg-base-900/70 px-3.5 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 outline-none transition-colors focus:border-violet-400/60 focus:ring-2 focus:ring-violet-500/20";

/* ---------------------------------------------------------------- Status dot pulse */

export function PulseDot({ tone }: { tone: "violet" | "cyan" | "emerald" | "amber" | "rose" }) {
  const map = {
    violet: "bg-violet-400",
    cyan: "bg-cyan-400",
    emerald: "bg-emerald-400",
    amber: "bg-amber-400",
    rose: "bg-rose-400",
  };
  return (
    <span className="relative inline-flex h-2 w-2">
      <span className={cx("absolute inline-flex h-full w-full animate-ping rounded-full opacity-60", map[tone])} />
      <span className={cx("relative inline-flex h-2 w-2 rounded-full", map[tone])} />
    </span>
  );
}

/* ---------------------------------------------------------------- Empty state */

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-3xl border border-dashed border-white/10 bg-white/[0.02] px-6 py-16 text-center">
      <div className="rounded-2xl border border-white/10 bg-base-900/80 p-3.5 text-violet-300">{icon}</div>
      <h3 className="text-base font-semibold text-slate-100">{title}</h3>
      <p className="max-w-sm text-sm text-slate-400">{body}</p>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
