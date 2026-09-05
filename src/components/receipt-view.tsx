"use client";

/**
 * ReceiptView — the full public record, rendered read-only. Used by the detail
 * page and the /r/[id] public page (identical markup), so a receipt on a
 * phone and the same receipt at its public link look exactly alike. Editing
 * actions (challenge / verify) never live here.
 */
import Link from "next/link";
import {
  AlertTriangle,
  BadgeCheck,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDashed,
  Copy,
  FileText,
  Fingerprint,
  Gavel,
  ListChecks,
  ShieldAlert,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { useMemo, useState } from "react";
import type { Receipt, SettlementState } from "@/core/types";
import { verifyIntegrity } from "@/core/receipt";
import { canChallenge } from "@/core/receipt";
import { Badge, Card, Mono, cx } from "@/components/ui";
import { SETTLE_META, VERDICT_META } from "@/lib/labels";
import { fmtTime, shortKey, sourceLabel } from "@/lib/format";

const DOT: Record<SettlementState, string> = {
  PENDING: "bg-slate-400",
  CHALLENGED: "bg-amber-400",
  UNDER_REVIEW: "bg-cyan-400",
  PASSED: "bg-emerald-400",
  FAILED: "bg-rose-400",
  RELEASED: "bg-emerald-400",
  LOCKED: "bg-rose-400",
};

const VERDICT_TONE = {
  PASS: "text-emerald-300 border-emerald-400/30 bg-emerald-500/10",
  FAIL: "text-rose-300 border-rose-400/30 bg-rose-500/10",
  PASS_WITH_MATERIAL_RISK: "text-orange-300 border-orange-400/30 bg-orange-500/10",
} as const;

export function ReceiptView({
  receipt: r,
  actions,
}: {
  receipt: Receipt;
  actions?: React.ReactNode;
}) {
  const [integrity, setIntegrity] = useState<ReturnType<typeof verifyIntegrity> | null>(null);
  const [showHashes, setShowHashes] = useState(false);
  const [copied, setCopied] = useState(false);

  const integrityChecks = useMemo(() => (integrity ? integrity.checks : null), [integrity]);
  const canChallengeIt = canChallenge(r);

  const runIntegrity = () => setIntegrity(verifyIntegrity(r));

  const copyId = async () => {
    try {
      await navigator.clipboard?.writeText(r.id);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard unavailable */
    }
  };

  const hashes = useMemo(() => {
    const h: Array<[string, string]> = [["brief", r.briefHash]];
    r.requirements.forEach((_, i) => h.push([`requirement ${i + 1}`, r.requirementHashes[i] ?? ""]));
    r.riskRequirements.forEach((_, i) => h.push([`risk req ${i + 1}`, r.riskRequirementHashes[i] ?? ""]));
    h.push(["work", r.workHash]);
    h.push(["corpus root", r.corpusHash]);
    if (r.challenge) {
      r.challenge.evidence.forEach((e, i) => h.push([`evidence ${i + 1} (${e.label})`, e.sha256]));
      h.push(["challenge body", r.challenge.bodyHash]);
    }
    return h;
  }, [r]);

  return (
    <div className="flex flex-col gap-4">
      {/* ------------------------------------------------ header card */}
      <Card className="overflow-visible p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div
              className={cx(
                "grid h-11 w-11 place-items-center rounded-2xl border text-violet-200",
                r.ruling
                  ? "border-violet-400/30 bg-violet-500/10"
                  : r.challenge
                    ? "border-amber-400/25 bg-amber-500/10 text-amber-200"
                    : "border-white/10 bg-base-900"
              )}
            >
              {r.ruling ? (
                <Gavel className="h-5 w-5" />
              ) : r.challenge ? (
                <ShieldAlert className="h-5 w-5" />
              ) : (
                <FileText className="h-5 w-5" />
              )}
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-lg font-bold leading-tight text-white">{r.briefTitle || "Untitled brief"}</h1>
                <Badge tone={SETTLE_META[r.settlement].tone} dot>
                  {SETTLE_META[r.settlement].label}
                </Badge>
              </div>
              <p className="mt-0.5 flex items-center gap-1.5 font-mono text-[11px] text-slate-400">
                {r.id}
                <button onClick={copyId} className="text-slate-500 transition-colors hover:text-slate-200" aria-label="Copy receipt id">
                  {copied ? <CheckCircle2 className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                </button>
              </p>
            </div>
          </div>
          {actions && <div className="shrink-0">{actions}</div>}
        </div>

        {/* parties + escrow */}
        <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <KV k="Requester" v={r.requesterName} />
          <KV k="Agent (deliverer)" v={r.agentName} />
          <KV k="Escrow" v={`${r.paymentAsset ?? "USDC"} · ${usd(r.paymentAmountUsd)}`} />
          <KV k="Minted" v={fmtTime(r.createdAt)} />
        </div>

        {/* settlement log */}
        <div className="mt-5 border-t border-white/[0.06] pt-4">
          <p className="mb-2.5 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-slate-500">
            Settlement timeline
          </p>
          <ol className="space-y-0">
            {r.settlementLog.map((entry, i) => (
              <li key={`${entry.at}-${i}`} className="relative flex gap-3 pb-3 last:pb-0">
                {i < r.settlementLog.length - 1 && (
                  <span className="absolute left-[5px] top-4 h-full w-px bg-white/10" />
                )}
                <span className={cx("relative mt-1.5 h-[11px] w-[11px] shrink-0 rounded-full ring-4 ring-base-950/60", DOT[entry.state])} />
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold text-slate-200">{SETTLE_META[entry.state].label}</p>
                  {entry.note && <p className="text-xs text-slate-500">{entry.note}</p>}
                  <p className="mt-0.5 font-mono text-[10px] text-slate-600">{fmtTime(entry.at)}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </Card>

      {/* ------------------------------------------------ integrity strip */}
      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Fingerprint className="h-4 w-4 text-cyan-300" />
            <div>
              <p className="text-sm font-semibold text-white">Content integrity</p>
              <p className="text-xs text-slate-500">
                {hashes.length} hashes cover the brief, requirements, work and any evidence.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {integrity && (
              <Badge tone={integrity.valid ? "pass" : "fail"}>
                {integrity.valid ? "All hashes verify" : "MISMATCH DETECTED"}
              </Badge>
            )}
            <button
              onClick={runIntegrity}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:border-cyan-400/40 hover:text-cyan-200"
            >
              {integrity ? "Re-check" : "Verify integrity"}
            </button>
          </div>
        </div>

        {integrityChecks && (
          <div className="mt-4 grid gap-1 sm:grid-cols-2">
            {integrityChecks.map((c, i) => (
              <div key={i} className="flex items-start gap-2 rounded-lg bg-base-900/50 px-2.5 py-1.5">
                {c.ok ? (
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
                ) : (
                  <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-400" />
                )}
                <div className="min-w-0">
                  <p className="text-xs font-medium text-slate-300">{c.label}</p>
                  <p className="break-all font-mono text-[9.5px] text-slate-500">{c.found}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        <button
          onClick={() => setShowHashes((v) => !v)}
          className="mt-3 inline-flex items-center gap-1 text-[11.5px] font-medium text-cyan-300/90 hover:text-cyan-200"
        >
          {showHashes ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          {showHashes ? "Hide hash register" : "Show full hash register"}
        </button>
        {showHashes && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {hashes.map(([label, hash], i) => (
              <div key={i} className="flex items-center gap-1.5 rounded-lg border border-white/[0.06] bg-base-900/60 px-2 py-1">
                <span className="text-[9.5px] font-medium uppercase tracking-wider text-slate-500">{label}</span>
                <Mono className="text-[9.5px] text-slate-300">{shortKey(hash, 10, 6)}</Mono>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* ------------------------------------------------ brief */}
      <Section icon={<FileText className="h-4 w-4 text-violet-300" />} title="The brief" hash={r.briefHash} tag="verbatim">
        <p className="preserve-breaks text-sm leading-relaxed text-slate-200">{r.brief}</p>
        {r.requirements.length > 0 && (
          <div className="mt-4">
            <p className="mb-2 flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-slate-500">
              <ListChecks className="h-3.5 w-3.5" /> Explicit requirements
            </p>
            <ul className="space-y-1.5">
              {r.requirements.map((req, i) => (
                <li key={i} className="flex items-start gap-2.5 rounded-lg border border-white/[0.05] bg-white/[0.02] px-3 py-2">
                  <span className="mt-0.5 font-mono text-[10px] text-slate-600">{i + 1}</span>
                  <span className="text-[13px] text-slate-300">{req}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {r.riskRequirements.length > 0 && (
          <div className="mt-3">
            <p className="mb-2 flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-orange-300/80">
              <ShieldAlert className="h-3.5 w-3.5" /> Required material-risk disclosures
            </p>
            <ul className="space-y-1.5">
              {r.riskRequirements.map((req, i) => (
                <li key={i} className="flex items-start gap-2.5 rounded-lg border border-orange-400/10 bg-orange-500/[0.04] px-3 py-2">
                  <span className="mt-0.5 font-mono text-[10px] text-slate-600">{i + 1}</span>
                  <span className="text-[13px] text-slate-300">{req}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Section>

      {/* ------------------------------------------------ work */}
      <Section icon={<BadgeCheck className="h-4 w-4 text-cyan-300" />} title={r.workTitle || "Submitted work"} hash={r.workHash} tag="verbatim">
        <p className="preserve-breaks text-sm leading-relaxed text-slate-200">{r.work}</p>
      </Section>

      {/* ------------------------------------------------ challenge */}
      {r.challenge && <ChallengeBlock r={r} />}

      {/* ------------------------------------------------ ruling */}
      {r.ruling && <RulingBlock r={r} />}

      {/* ------------------------------------------------ open path hint */}
      {canChallengeIt && (
        <Card className="border-dashed p-5 text-center">
          <CircleDashed className="mx-auto h-6 w-6 text-amber-300/70" />
          <p className="mt-2 text-sm font-semibold text-slate-100">This delivery has not been challenged.</p>
          <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-slate-400">
            Escrow is pending. The buyer can raise a dispute against this work while the record is still open.
          </p>
          <div className="mt-3">
            <Link href={`/receipts/${r.id}/challenge`} className="text-xs font-semibold text-amber-300 hover:text-amber-200">
              Challenge this work →
            </Link>
          </div>
        </Card>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Section({
  icon,
  title,
  tag,
  hash,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  tag?: string;
  hash?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center justify-between gap-2 border-b border-white/[0.06] pb-3">
        <div className="flex items-center gap-2">
          {icon}
          <h2 className="text-sm font-bold text-white">{title}</h2>
        </div>
        <div className="flex items-center gap-2">
          {tag && (
            <span className="rounded-md bg-white/[0.04] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-widest text-slate-500">
              {tag}
            </span>
          )}
          {hash && <Mono className="text-[9.5px] text-slate-500">{shortKey(hash, 8, 4)}</Mono>}
        </div>
      </div>
      {children}
    </Card>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-xl border border-white/[0.05] bg-white/[0.02] px-3 py-2">
      <p className="text-[9.5px] font-semibold uppercase tracking-[0.12em] text-slate-500">{k}</p>
      <p className="mt-0.5 truncate text-[13px] font-medium text-slate-100">{v}</p>
    </div>
  );
}

function ChallengeBlock({ r }: { r: Receipt }) {
  const c = r.challenge!;
  return (
    <Card className="border-amber-400/15 p-5">
      <div className="flex items-center justify-between gap-2 border-b border-white/[0.06] pb-3">
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-4 w-4 text-amber-300" />
          <h2 className="text-sm font-bold text-white">Challenge · {c.id}</h2>
        </div>
        <Badge tone="amber">CHALLENGED</Badge>
      </div>
      <div className="mt-4 space-y-4">
        <div>
          <p className="mb-1 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-slate-500">Dispute raised by</p>
          <p className="text-sm font-medium text-slate-200">{c.challengerName || "An unnamed challenger"} · {fmtTime(c.createdAt)}</p>
        </div>
        <div>
          <p className="mb-1 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-slate-500">Reason</p>
          <p className="preserve-breaks rounded-xl bg-base-900/60 px-3.5 py-2.5 text-sm text-slate-200">{c.reason}</p>
        </div>
        {c.violatedRequirements.length > 0 && (
          <Reqs title="Alleged violations" tone="rose" items={c.violatedRequirements} />
        )}
        {c.missedRiskRequirements.length > 0 && (
          <Reqs title="Alleged missed risk disclosures" tone="amber" items={c.missedRiskRequirements} />
        )}
        {c.additionalContext && (
          <div>
            <p className="mb-1 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-slate-500">Additional context</p>
            <p className="preserve-breaks text-[13px] text-slate-400">{c.additionalContext}</p>
          </div>
        )}
        {c.evidence.length > 0 && (
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-slate-500">
              <Fingerprint className="h-3.5 w-3.5" /> Evidence ({c.evidence.length}) — each item content-hashed
            </p>
            <div className="space-y-2">
              {c.evidence.map((ev) => (
                <div key={ev.id} className="rounded-xl border border-white/[0.06] bg-base-900/50 px-3.5 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-slate-200">{ev.label}</p>
                    <Mono className="text-[9px] text-slate-500">sha256 {shortKey(ev.sha256, 8, 6)}</Mono>
                  </div>
                  <p className="preserve-breaks mt-1.5 border-l-2 border-white/10 pl-3 text-[12.5px] italic leading-relaxed text-slate-400">
                    {ev.content}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
        <p className="border-t border-white/[0.06] pt-3">
          <Mono className="text-[9.5px] text-slate-600">
            challenge bodyHash {c.bodyHash}
          </Mono>
        </p>
      </div>
    </Card>
  );
}

function Reqs({ title, tone, items }: { title: string; tone: "rose" | "amber"; items: string[] }) {
  return (
    <div>
      <p className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-slate-500">{title}</p>
      <ul className="space-y-1">
        {items.map((it, i) => (
          <li
            key={i}
            className={cx(
              "rounded-lg border px-3 py-1.5 text-[12.5px]",
              tone === "rose"
                ? "border-rose-400/15 bg-rose-500/[0.05] text-rose-100/90"
                : "border-amber-400/15 bg-amber-500/[0.05] text-amber-100/90"
            )}
          >
            {it}
          </li>
        ))}
      </ul>
    </div>
  );
}

function RulingBlock({ r }: { r: Receipt }) {
  const ruling = r.ruling!;
  const meta = VERDICT_META[ruling.verdict];
  const sLabel = sourceLabel(ruling.source);
  const Icon =
    ruling.verdict === "PASS" ? ShieldCheck : ruling.verdict === "FAIL" ? XCircle : AlertTriangle;

  return (
    <Card
      className={cx("p-5", ruling.verdict === "FAIL" && "border-rose-400/20", ruling.verdict === "PASS" && "border-emerald-400/20")}
      glow={ruling.verdict === "FAIL" ? "fail" : ruling.verdict === "PASS" ? "pass" : undefined}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className={cx("grid h-12 w-12 shrink-0 place-items-center rounded-2xl border", VERDICT_TONE[ruling.verdict])}>
            <Icon className="h-6 w-6" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={meta.tone}>{meta.label}</Badge>
              <Badge tone={ruling.source === "genlayer" ? "violet" : "neutral"}>
                {sLabel.short}
              </Badge>
            </div>
            <p className="mt-1 text-sm font-bold text-white">{meta.headline}</p>
          </div>
        </div>
        <div className="text-left sm:text-right">
          <p className="text-[10.5px] font-semibold uppercase tracking-wider text-slate-500">Ruled</p>
          <p className="text-[13px] font-medium text-slate-200">{fmtTime(ruling.receivedAt)}</p>
        </div>
      </div>

      {/* honesty line */}
      <p
        className={cx(
          "mt-3 rounded-xl border px-3.5 py-2 text-xs leading-relaxed",
          ruling.source === "genlayer"
            ? "border-violet-400/20 bg-violet-500/[0.06] text-violet-200/90"
            : "border-amber-400/15 bg-amber-500/[0.05] text-amber-200/80"
        )}
      >
        {ruling.source === "genlayer"
          ? "This ruling was produced by GenLayer validator consensus and read from the on-chain record."
          : `${sLabel.full}. This verdict came from AgentRef's transparent local model so the full flow can run without a network.`}
      </p>

      <div className="mt-4 grid gap-4">
        <div>
          <p className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-slate-500">Why</p>
          <p className="preserve-breaks rounded-xl bg-base-900/60 px-3.5 py-2.5 text-sm leading-relaxed text-slate-200">
            {ruling.reasoning || "No reasoning was provided."}
          </p>
        </div>
        {(ruling.failedRequirements.length > 0 || ruling.missedMaterialRisks.length > 0) && (
          <div className="grid gap-3 sm:grid-cols-2">
            {ruling.failedRequirements.length > 0 && (
              <div className="rounded-xl border border-rose-400/15 bg-rose-500/[0.04] p-3.5">
                <p className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-rose-300/80">
                  Failed requirements
                </p>
                <ul className="space-y-1">
                  {ruling.failedRequirements.map((f, i) => (
                    <li key={i} className="text-[12.5px] text-slate-300">· {f}</li>
                  ))}
                </ul>
              </div>
            )}
            {ruling.missedMaterialRisks.length > 0 && (
              <div className="rounded-xl border border-orange-400/15 bg-orange-500/[0.04] p-3.5">
                <p className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-orange-300/80">
                  Missed material risks
                </p>
                <ul className="space-y-1">
                  {ruling.missedMaterialRisks.map((f, i) => (
                    <li key={i} className="text-[12.5px] text-slate-300">· {f}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

      {/* provenance grid */}
      <div className="mt-4 grid grid-cols-2 gap-2 border-t border-white/[0.06] pt-3.5 sm:grid-cols-3">
        <Prov k="Source" v={sLabel.full} />
        {ruling.transactionHash && <Prov k="Transaction" v={shortKey(ruling.transactionHash, 10, 6)} />}
        {ruling.contractAddress && <Prov k="Contract" v={shortKey(ruling.contractAddress, 10, 4)} />}
        {ruling.finalizedRound !== undefined && <Prov k="Finalized round" v={String(ruling.finalizedRound)} />}
        <Prov k="Flags" v={briefFollowedLabels(ruling)} />
      </div>
    </Card>
  );
}

function briefFollowedLabels(ruling: { briefFollowed: boolean; requirementsMet: boolean; materialRiskDisclosed: boolean }) {
  const flags: string[] = [];
  flags.push(ruling.briefFollowed ? "followed" : "≠ brief");
  flags.push(ruling.requirementsMet ? "reqs met" : "reqs missed");
  flags.push(ruling.materialRiskDisclosed ? "risks disclosed" : "risk omitted");
  return flags.join(" · ");
}

function Prov({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-600">{k}</p>
      <p className="mt-0.5 font-mono text-[11px] text-slate-300">{v}</p>
    </div>
  );
}

function usd(n: number) {
  if (!Number.isFinite(n)) return "—";
  return `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}
