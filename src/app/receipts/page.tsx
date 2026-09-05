"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FilePlus2, Inbox, LoaderCircle, Plus, Sparkles } from "lucide-react";
import { useState } from "react";
import { useAgentRef } from "@/lib/agentref-provider";
import { Badge, Card, Chip, EmptyState, LinkBtn } from "@/components/ui";
import { SETTLE_META, VERDICT_META } from "@/lib/labels";
import { fmtUsd, timeAgo } from "@/lib/format";
import type { Receipt } from "@/core/types";

type Filter = "all" | "open" | "disputed" | "settled";

const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: "all", label: "All" },
  { key: "open", label: "Open" },
  { key: "disputed", label: "In dispute" },
  { key: "settled", label: "Settled" },
];

function bucket(r: Receipt): Filter {
  if (r.ruling) return "settled";
  if (r.challenge) return "disputed";
  return "open";
}

export default function ReceiptsPage() {
  const router = useRouter();
  const { receipts, hydrated, loadDemoSet } = useAgentRef();
  const [filter, setFilter] = useState<Filter>("all");
  const [loading, setLoading] = useState(false);

  const counts = {
    all: receipts.length,
    open: receipts.filter((r) => bucket(r) === "open").length,
    disputed: receipts.filter((r) => bucket(r) === "disputed").length,
    settled: receipts.filter((r) => bucket(r) === "settled").length,
  };
  const visible = receipts.filter((r) => filter === "all" || bucket(r) === filter);

  async function demo() {
    setLoading(true);
    loadDemoSet();
    // small tick so the button gives feedback before the list re-renders
    setTimeout(() => setLoading(false), 350);
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-white">The ledger</h1>
          <p className="mt-1 text-sm text-slate-400">
            Every AI work delivery, its dispute status and its ruling — on one record.
          </p>
        </div>
        <LinkBtn href="/create" size="sm">
          <Plus className="h-4 w-4" /> New
        </LinkBtn>
      </div>

      {/* filter rail */}
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {FILTERS.map((f) => (
          <Chip key={f.key} selected={filter === f.key} onClick={() => setFilter(f.key)}>
            {f.label}
            <span className={filter === f.key ? "text-violet-200/70" : "text-slate-500"}>
              {counts[f.key]}
            </span>
          </Chip>
        ))}
      </div>

      {!hydrated ? (
        <div className="shimmer h-56 rounded-3xl border border-white/[0.06]" />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={<Inbox className="h-5 w-5" />}
          title={receipts.length === 0 ? "The ledger is empty" : "Nothing in this view"}
          body={
            receipts.length === 0
              ? "Mint a receipt for an AI delivery — or load the three demo scenarios and challenge one as a buyer."
              : "No receipts match this filter."
          }
          action={
            receipts.length === 0 ? (
              <div className="flex flex-col items-center gap-2 sm:flex-row">
                <LinkBtn href="/create" size="sm">
                  <FilePlus2 className="h-4 w-4" /> Mint a receipt
                </LinkBtn>
                <LinkBtn href="#" tone="ghost" size="sm" onClick={() => demo()}>
                  {loading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  Load demo dispute set
                </LinkBtn>
              </div>
            ) : undefined
          }
        />
      ) : (
        <div className="grid gap-2.5">
          {visible.map((r) => {
            const meta = r.ruling ? VERDICT_META[r.ruling.verdict] : null;
            const open = !r.ruling && !r.challenge;
            return (
              <Link key={r.id} href={`/receipts/${r.id}`} className="group">
                <Card
                  glow={meta?.tone === "pass" ? "pass" : meta?.tone === "fail" ? "fail" : undefined}
                  className="p-4 transition-colors group-hover:border-white/20"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="truncate text-[15px] font-semibold text-slate-100 group-hover:text-white">
                          {r.briefTitle || "Untitled brief"}
                        </h2>
                        {r.createdBy === "demo" && (
                          <span className="rounded-md bg-violet-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-widest text-violet-300">
                            demo
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 font-mono text-[10.5px] text-slate-500">
                        {r.id} · {timeAgo(r.createdAt)}
                      </p>
                      <p className="mt-1 line-clamp-1 text-xs text-slate-400">
                        {r.requesterName} ← {r.agentName} · {fmtUsd(r.paymentAmountUsd)} {r.paymentAsset ?? ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1.5">
                      {r.ruling ? (
                        <>
                          <Badge tone={meta!.tone}>{meta!.label}</Badge>
                          <span className="text-[10px] uppercase tracking-wider text-slate-600">
                            {r.settlement}
                          </span>
                        </>
                      ) : (
                        <Badge
                          tone={open ? "neutral" : SETTLE_META[r.settlement].tone}
                          dot={!open}
                        >
                          {open ? "Open" : SETTLE_META[r.settlement].label}
                        </Badge>
                      )}
                    </div>
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
