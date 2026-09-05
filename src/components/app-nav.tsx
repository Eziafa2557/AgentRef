"use client";

import Link from "next/link";
import { Plus, Receipt } from "lucide-react";
import { useAgentRef } from "@/lib/agentref-provider";
import { cx } from "@/components/ui";

export function AppNav() {
  const { receipts } = useAgentRef();
  const active = receipts.filter((r) => r.settlement === "CHALLENGED" || r.settlement === "UNDER_REVIEW").length;

  return (
    <header className="sticky top-0 z-40 border-b border-white/[0.06] bg-base-950/70 backdrop-blur-xl">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center gap-2 px-4">
        <Link href="/" className="group flex items-center gap-2.5" aria-label="AgentRef home">
          <span className="grid h-8 w-8 place-items-center rounded-xl border border-violet-400/30 bg-gradient-to-br from-violet-500/25 to-cyan-500/10 text-violet-200 shadow-glow transition-transform group-hover:scale-105">
            <ReceiptIcon />
          </span>
          <span className="flex flex-col leading-none">
            <span className="text-[15px] font-bold tracking-tight text-white">
              Agent<span className="gradient-text">Ref</span>
            </span>
            <span className="hidden text-[9.5px] font-medium uppercase tracking-[0.16em] text-slate-500 sm:block">
              work receipts · verified
            </span>
          </span>
        </Link>

        <div className="ml-auto flex items-center gap-2">
          <Link
            href="/receipts"
            aria-label="Receipts"
            className={cx(
              "relative grid h-9 w-9 place-items-center rounded-xl border border-white/10 bg-white/[0.03] text-slate-300 transition-colors hover:border-white/20 hover:text-white"
            )}
          >
            <Receipt className="h-[17px] w-[17px]" />
            {receipts.length > 0 && (
              <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-violet-500 px-1 text-[9px] font-bold text-white">
                {receipts.length > 99 ? "99+" : receipts.length}
              </span>
            )}
          </Link>
          {active > 0 && (
            <Link
              href="/receipts"
              className="hidden items-center gap-1.5 rounded-full border border-amber-400/30 bg-amber-500/10 px-2.5 py-1 text-[10.5px] font-semibold text-amber-200 sm:inline-flex"
            >
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute h-full w-full animate-ping rounded-full bg-amber-400 opacity-70" />
                <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
              </span>
              {active} active
            </Link>
          )}
          <Link
            href="/create"
            className="inline-flex items-center gap-1.5 rounded-xl border border-violet-400/40 bg-gradient-to-b from-violet-500 to-violet-600 px-3 py-1.5 text-xs font-semibold text-white shadow-glow transition-all hover:from-violet-400 hover:to-violet-600 active:translate-y-px"
          >
            <Plus className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">New receipt</span>
          </Link>
        </div>
      </div>
    </header>
  );
}

function ReceiptIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-[17px] w-[17px]">
      <path d="M5 3h14v18l-3-1.6L13 21l-2-1.6L9 21l-4-1.6V3Z" strokeLinejoin="round" />
      <path d="M9 8h6M9 12h6" strokeLinecap="round" />
    </svg>
  );
}
