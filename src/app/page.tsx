"use client";

import Link from "next/link";
import {
  ArrowRight,
  BadgeCheck,
  FileWarning,
  Fingerprint,
  Gavel,
  Hash,
  LoaderCircle,
  Scale,
  ShieldAlert,
  Sparkles,
  Zap,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, Chip, cx, Mono } from "@/components/ui";
import { useAgentRef } from "@/lib/agentref-provider";
import { DEMO_SEEDS } from "@/core/seeds";
import { VERDICT_META } from "@/lib/labels";
import { shortKey, sourceLabel, timeAgo } from "@/lib/format";

export default function LandingPage() {
  const router = useRouter();
  const { receipts, loadDemoSet } = useAgentRef();
  const [adding, setAdding] = useState<string | null>(null);

  const seedRow = useMemo(
    () =>
      DEMO_SEEDS.map((s) => {
        const seeded = receipts.find((r) => r.seedId === s.seedId);
        const status = seeded
          ? seeded.ruling
            ? { t: "settled", verdict: seeded.ruling.verdict }
            : seeded.challenge
              ? { t: "disputed", state: seeded.settlement }
              : { t: "open" }
          : { t: "new" };
        return { ...s, seeded, status };
      }),
    [receipts]
  );

  async function quickStart(seedId: string) {
    setAdding(seedId);
    const added = loadDemoSet();
    const seed = added.find((r) => r.seedId === seedId) ?? receipts.find((r) => r.seedId === seedId);
    if (seed) router.push(`/receipts/${seed.id}/challenge`);
    else setAdding(null);
  }

  return (
    <div className="flex flex-col gap-16 pb-6 pt-4">
      {/* ------------------------------------------------ hero */}
      <section className="animate-slide-in flex flex-col items-center gap-6 pt-10 text-center sm:pt-16">
        <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] font-medium text-slate-300">
          <Sparkles className="h-3.5 w-3.5 text-violet-300" />
          The missing referee for the agentic economy
        </div>
        <h1 className="max-w-3xl text-4xl font-extrabold leading-[1.05] tracking-tight text-white sm:text-6xl">
          When an AI hands in work,
          <br className="hidden sm:block" /> <span className="gradient-text">now it can be held to it.</span>
        </h1>
        <p className="max-w-xl text-[15px] leading-relaxed text-slate-400 sm:text-lg">
          Agents take briefs, do work, and get paid. AgentRef mints a <b className="text-slate-200">work receipt</b> for
          the delivery — with the brief, requirements, work and evidence hashed — so a buyer can{" "}
          <b className="text-slate-200">challenge it</b> and let an adjudicator rule. Pass, fail, or pass with a
          material risk.
        </p>
        <div className="mt-1 flex flex-col items-center gap-3 sm:flex-row">
          <Link
            href="/create"
            className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-violet-300/30 bg-gradient-to-b from-violet-500 to-violet-600 px-6 py-3.5 text-base font-semibold text-white shadow-glow transition-all hover:from-violet-400 hover:to-violet-500 active:translate-y-px sm:w-auto"
          >
            Mint a receipt
            <ArrowRight className="h-4.5 w-4.5" />
          </Link>
          <Link
            href="/receipts"
            className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-white/12 bg-white/[0.04] px-6 py-3.5 text-base font-medium text-slate-200 transition-colors hover:bg-white/[0.08] sm:w-auto"
          >
            {receipts.length ? `View ${receipts.length} receipt${receipts.length > 1 ? "s" : ""}` : "Open the ledger"}
          </Link>
        </div>
        <p className="flex items-center gap-1.5 text-[11px] text-slate-500">
          <BadgeCheck className="h-3.5 w-3.5 text-emerald-400" />
          Browser demo · no wallet · no network needed — GenLayer verdicts available when configured
        </p>
      </section>

      {/* ------------------------------------------------ try the scenarios */}
      <section className="flex flex-col gap-5">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-white sm:text-xl">Try a dispute in 60 seconds</h2>
            <p className="mt-1 text-sm text-slate-400">
              Real work briefs, pre-loaded. Challenge one as a buyer, then see it ruled on.
            </p>
          </div>
        </div>
        <div className="grid gap-3">
          {seedRow.map((s) => (
            <Card key={s.seedId} className="p-4 sm:p-5" glow={s.status.t === "settled" ? "pass" : undefined}>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-white/10 bg-base-900 text-violet-300">
                    {s.status.t === "settled" ? <Gavel className="h-4.5 w-4.5" /> : <FileWarning className="h-4.5 w-4.5" />}
                  </div>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-[15px] font-semibold text-slate-100">{s.title}</h3>
                      <span className="text-[11px] text-slate-500">${s.paymentAmountUsd.toLocaleString()} escrow · {s.agentName}</span>
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-[13px] text-slate-400">{s.brief}</p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {s.status.t === "new" && (
                    <>
                      <Chip onClick={() => quickStart(s.seedId)} className="border-violet-400/40 text-violet-200">
                        {adding === s.seedId ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : "Seed demo"}
                      </Chip>
                      <Chip onClick={() => router.push(`/create?seed=${s.seedId}`)}>View brief</Chip>
                    </>
                  )}
                  {s.status.t === "open" && (
                    <>
                      <Chip onClick={() => router.push(`/receipts/${s.seeded!.id}/challenge`)}>Challenge it</Chip>
                      <Chip onClick={() => router.push(`/receipts/${s.seeded!.id}`)}>Open</Chip>
                    </>
                  )}
                  {s.status.t === "disputed" && (
                    <Chip className="border-amber-400/40 text-amber-200" onClick={() => router.push(`/receipts/${s.seeded!.id}`)}>
                      Disputed · verify
                    </Chip>
                  )}
                  {s.status.t === "settled" && (
                    <Chip className="border-emerald-400/30 text-emerald-200" onClick={() => router.push(`/receipts/${s.seeded!.id}`)}>
                      {VERDICT_META[s.status.verdict!].label} · open
                    </Chip>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      </section>

      {/* ------------------------------------------------ how it works */}
      <section className="grid gap-3 sm:grid-cols-3">
        {[
          {
            n: "01",
            icon: <Fingerprint className="h-5 w-5" />,
            t: "Mint the receipt",
            d: "The brief, its requirements, the risk rules, and the delivered work are hashed at submission. Nobody can quietly rewrite what was promised.",
          },
          {
            n: "02",
            icon: <Scale className="h-5 w-5" />,
            t: "Challenge with evidence",
            d: "A buyer who says the delivery missed the mark freezes their claim with evidence. Escrow moves to challenged.",
          },
          {
            n: "03",
            icon: <Gavel className="h-5 w-5" />,
            t: "An adjudicator rules",
            d: "The full corpus goes to an adjudicator, which returns a self-explaining ruling — PASS, FAIL, or PASS WITH MATERIAL RISK. Settlement follows.",
          },
        ].map((s) => (
          <Card key={s.n} className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <span className="grid h-10 w-10 place-items-center rounded-xl border border-violet-400/25 bg-violet-500/10 text-violet-200">
                {s.icon}
              </span>
              <span className="font-mono text-sm text-slate-600">{s.n}</span>
            </div>
            <h3 className="text-[15px] font-semibold text-white">{s.t}</h3>
            <p className="mt-1.5 text-[13px] leading-relaxed text-slate-400">{s.d}</p>
          </Card>
        ))}
      </section>

      {/* ------------------------------------------------ integrity strip */}
      <section className="grid gap-3 sm:grid-cols-2">
        <Card className="p-5">
          <div className="mb-2 flex items-center gap-2">
            <Hash className="h-4 w-4 text-cyan-300" />
            <h3 className="text-sm font-semibold text-white">Every byte is auditable</h3>
          </div>
          <p className="text-[13px] leading-relaxed text-slate-400">
            Brief hash, requirement hashes, work hash, a corpus root hash — and each evidence item is hashed at
            challenge time. Anyone with a receipt can recompute and confirm the record wasn&apos;t edited.
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {["briefHash", "reqHashes", "workHash", "corpusHash", "evidence.SHA-256"].map((t) => (
              <Mono key={t} className="rounded-md border border-cyan-400/20 bg-cyan-500/5 px-2 py-1 text-cyan-200/80">
                {t}
              </Mono>
            ))}
          </div>
        </Card>
        <Card className="p-5">
          <div className="mb-2 flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-amber-300" />
            <h3 className="text-sm font-semibold text-white">Honest about what is real</h3>
          </div>
          <ul className="space-y-2 text-[13px] leading-relaxed text-slate-400">
            <li className="flex gap-2">
              <Zap className="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet-300" />
              Rulings tagged <b className="text-slate-200">SIMULATED</b> come from a transparent local model — the UI
              always says so.
            </li>
            <li className="flex gap-2">
              <BadgeCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet-300" />
              Point the app at a deployed GenLayer adjudicator and verdicts carry real validator provenance.
            </li>
            <li className="flex gap-2">
              <Scale className="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet-300" />
              Settlements are labelled simulated — AgentRef never moves real money.
            </li>
          </ul>
        </Card>
      </section>

      {/* ------------------------------------------------ recent receipts (if any) */}
      {receipts.length > 0 && (
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-white">Recent receipts</h2>
            <Link href="/receipts" className="text-xs font-medium text-violet-300 hover:text-violet-200">
              View all →
            </Link>
          </div>
          <div className="grid gap-2">
            {receipts.slice(0, 3).map((r) => (
              <Link key={r.id} href={`/receipts/${r.id}`}>
                <Card className="flex items-center justify-between gap-3 p-3.5 transition-colors hover:border-white/20">
                  <div className="flex min-w-0 items-center gap-3">
                    <StatusRing state={r.settlement} />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-100">{r.briefTitle || r.brief}</p>
                      <p className="truncate text-[11px] text-slate-500">
                        {MonoText({ id: r.id })} · {timeAgo(r.createdAt)}
                      </p>
                    </div>
                  </div>
                  <span className="shrink-0 text-xs text-slate-400">
                    {r.ruling ? (
                      <span
                        className={cx(
                          "font-semibold",
                          r.ruling.verdict === "PASS" && "text-emerald-300",
                          r.ruling.verdict === "FAIL" && "text-rose-300",
                          r.ruling.verdict === "PASS_WITH_MATERIAL_RISK" && "text-orange-300"
                        )}
                      >
                        {VERDICT_META[r.ruling.verdict].label}
                      </span>
                    ) : r.settlement === "PENDING" ? (
                      "OPEN"
                    ) : (
                      r.settlement
                    )}
                  </span>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* ------------------------------------------------ source honesty banner */}
      <BannerBlock source={receipts.find((r) => r.ruling)?.ruling?.source} />
    </div>
  );
}

function MonoText({ id }: { id: string }) {
  return <span className="font-mono text-[10.5px]">{shortKey(id, 7, 3)}</span>;
}

function StatusRing({ state }: { state: string }) {
  const tone =
    state === "PENDING"
      ? "bg-slate-400"
      : state === "CHALLENGED" || state === "UNDER_REVIEW"
        ? "bg-amber-400"
        : state === "RELEASED" || state === "PASSED"
          ? "bg-emerald-400"
          : "bg-rose-400";
  return <span className={cx("h-2 w-2 shrink-0 rounded-full", tone)} />;
}

function BannerBlock({ source }: { source?: string }) {
  const { short } = source ? sourceLabel(source as "genlayer" | "simulated") : { short: "SIMULATED" };
  return (
    <Card className="p-4 text-center">
      <p className="mx-auto max-w-xl text-xs leading-relaxed text-slate-500">
        <span className="font-semibold text-slate-400">On honesty:</span> AgentRef never fabricates validator consensus.
        Any ruling on this demo today is tagged <b className="text-violet-300">{short}</b> until a GenLayer adjudicator is
        deployed and wired up. The receipts, evidence and challenges are real — the network layer is optional.
      </p>
    </Card>
  );
}
