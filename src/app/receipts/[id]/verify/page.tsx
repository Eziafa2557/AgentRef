"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Circle,
  Cpu,
  ExternalLink,
  FlaskConical,
  Gavel,
  LoaderCircle,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useAgentRef } from "@/lib/agentref-provider";
import { Badge, Btn, Card, LinkBtn, PulseDot, cx } from "@/components/ui";
import { simulateRuling } from "@/core/evaluate";
import { getGenLayerConfig } from "@/core/genlayer/config";
import { onchainRuling, LIVE_CONTRACT, explorerTxUrl, type OnchainReceiptRecord } from "@/core/genlayer/contract";
import { VERDICT_META } from "@/lib/labels";
import type { Ruling } from "@/core/types";
import { Journey } from "@/components/journey";
import { ReceiptView } from "@/components/receipt-view";

type Mode = "simulated" | "genlayer";
type Phase = "setup" | "running" | "done" | "error";

const SIM_STEPS = [
  { title: "Snapshot the dispute corpus", detail: "Builds the exact payload the adjudicator will see — brief, requirements, work, challenge and hashed evidence." },
  { title: "Simulated fallback — local rules model", detail: "GenLayer validators are NOT contacted. A transparent, inspectable model checks each requirement against the work so the flow still runs without a funded key." },
  { title: "Record the ruling", detail: "Persists the verdict on the receipt and advances the escrow state machine." },
];

const GL_STEPS = [
  { title: "Adjudicate on GenLayer validators", detail: `create_receipt → challenge → adjudicate() on the live ${LIVE_CONTRACT.chainLabel} contract. Validator consensus decides — not an in-app AI.` },
  { title: "Read the on-chain verdict", detail: "Calls get_receipt() and parses Status / Score / Reason from the contract's public record." },
  { title: "Record the verdict", detail: "Saves the GenLayer verdict + explorer link on the receipt and settles the escrow." },
];

export default function VerifyPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  const { getReceipt, hydrated, submitForReview, recordRuling } = useAgentRef();
  const receipt = getReceipt(id);

  const [glConfig] = useState(() => getGenLayerConfig());
  const isGenReady = glConfig.kind === "ready";
  const glChainLabel = glConfig.kind === "ready" ? glConfig.chainLabel : LIVE_CONTRACT.chainLabel;
  const glContractAddr = glConfig.kind === "ready" ? glConfig.contractAddress : LIVE_CONTRACT.address;

  /* The WRITE path (create_receipt → challenge → adjudicate) is signed by a
     server-side key. Until we know whether this deployment has one, start on
     the SIMULATED fallback so the demo never dead-ends on a missing key. */
  const [writesReady, setWritesReady] = useState<boolean | null>(null);
  const userChose = useRef(false);
  const [mode, setMode] = useState<Mode>("simulated");
  const [phase, setPhase] = useState<Phase>("setup");
  const [step, setStep] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/genlayer/status")
      .then((r) => r.json())
      .then((s: { canAdjudicate?: boolean }) => {
        if (!alive) return;
        const can = s.canAdjudicate === true;
        setWritesReady(can);
        if (can && !userChose.current) setMode("genlayer");
      })
      .catch(() => {
        if (alive) setWritesReady(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const writesAvailable = writesReady === true;
  const pickMode = (m: Mode) => {
    userChose.current = true;
    setMode(m);
  };

  const sleep = (ms: number) => new Promise<void>((res) => setTimeout(res, ms));
  const freshChallenge = !!receipt?.challenge && !receipt?.ruling;

  /* ------------------------------------------------------------- */
  /* SIMULATED — labelled fallback only. Never claims validators.  */
  async function runSimulated() {
    const cur = getReceipt(id);
    if (!cur?.challenge || cur.ruling) return;
    setErrorMsg(null);
    pickMode("simulated");
    setPhase("running");
    setStep(0);
    for (let i = 0; i < SIM_STEPS.length; i++) {
      setStep(i);
      await sleep(i === 1 ? 1100 : 620);
    }
    try {
      let latest = getReceipt(id)!;
      if (latest.settlement !== "UNDER_REVIEW") latest = submitForReview(id);
      recordRuling(id, simulateRuling(latest));
      setPhase("done");
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Verification failed.");
      setPhase("error");
    }
  }

  /* ------------------------------------------------------------- */
  /* REAL GenLayer: adjudicate (server-signed writes) then read.    */
  async function adjudicateOnGenLayer() {
    const cur = getReceipt(id);
    if (!cur?.challenge || cur.ruling) return;
    setErrorMsg(null);
    pickMode("genlayer");
    setPhase("running");
    setStep(0);

    let latest = cur;
    if (latest.settlement !== "UNDER_REVIEW") latest = submitForReview(id);
    const challenge = latest.challenge!;
    const evidence = challenge.evidence.map((e) => ({ label: e.label, content: e.content }));

    // 1) adjudicate — server signs create_receipt → challenge → adjudicate
    setStep(1);
    let out: { status?: string; message?: string; reason?: string; transactionHash?: string; contractAddress?: string };
    try {
      const res = await fetch("/api/genlayer/adjudicate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brief: latest.brief,
          work: latest.work,
          agent: latest.agentName,
          reason: challenge.reason,
          evidence,
        }),
      });
      out = (await res.json()) as typeof out;
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Submitting the dispute to GenLayer failed.");
      setPhase("error");
      return;
    }
    if (out.status === "error" || out.status === "not-configured") {
      setErrorMsg(out.message ?? out.reason ?? "Adjudication on GenLayer failed.");
      setPhase("error");
      return;
    }
    const txHash = out.transactionHash!;

    // 2) read get_receipt until the verdict is on the record
    setStep(2);
    let record: OnchainReceiptRecord | null = null;
    try {
      for (let attempt = 0; attempt < 8; attempt++) {
        const r = await fetch("/api/genlayer/receipt");
        const ro = (await r.json()) as { status: string; message?: string; record?: OnchainReceiptRecord };
        if (ro.status === "receipt" && ro.record) {
          record = ro.record;
          break;
        }
        if (ro.status === "error") throw new Error(ro.message ?? "Reading the verdict failed.");
        await sleep(attempt === 0 ? 1500 : 3000);
      }
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Reading the GenLayer verdict failed.");
      setPhase("error");
      return;
    }
    if (!record) {
      setErrorMsg(
        "The dispute was adjudicated on-chain, but the verdict has not reached a readable FINAL state yet. Follow the transaction on the explorer and come back — the verdict may still finalize."
      );
      setPhase("error");
      return;
    }

    const ruling = onchainRuling(record, {
      receivedAt: new Date().toISOString(),
      transactionHash: txHash,
      contractAddress: out.contractAddress ?? (glConfig.kind === "ready" ? glConfig.contractAddress : undefined),
    });
    if (!ruling) {
      setErrorMsg(`The contract returned an unmapped status (“${record.status}”). No verdict was recorded.`);
      setPhase("error");
      return;
    }
    setStep(3);
    recordRuling(id, ruling);
    setPhase("done");
  }

  /* ------------------------------------------------------------- */
  /* REAL GenLayer (read-only): show whatever the shared live       */
  /* contract currently holds — needs no wallet or key.             */
  async function readSharedVerdict() {
    const cur = getReceipt(id);
    if (!cur?.challenge || cur.ruling) return;
    setErrorMsg(null);
    pickMode("genlayer");
    setPhase("running");
    setStep(1);
    let ro: { status: string; message?: string; note?: string; record?: OnchainReceiptRecord; contractAddress?: string };
    try {
      const r = await fetch("/api/genlayer/receipt");
      ro = (await r.json()) as typeof ro;
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Reading the shared on-chain record failed.");
      setPhase("error");
      return;
    }
    if (ro.status === "error") {
      setErrorMsg(ro.message ?? "Reading the shared on-chain record failed.");
      setPhase("error");
      return;
    }
    if (ro.status !== "receipt" || !ro.record) {
      setErrorMsg(
        ro.note ??
          "The shared live contract has no adjudicated verdict to read yet. Run the full adjudication (needs a funded server key) or come back once one has been ruled."
      );
      setPhase("error");
      return;
    }
    let latest = getReceipt(id)!;
    if (latest.settlement !== "UNDER_REVIEW") latest = submitForReview(id);
    const ruling = onchainRuling(ro.record, {
      receivedAt: new Date().toISOString(),
      contractAddress: ro.contractAddress ?? (glConfig.kind === "ready" ? glConfig.contractAddress : undefined),
    });
    if (!ruling) {
      setErrorMsg(`The contract returned an unmapped status (“${ro.record.status}”). No verdict was recorded.`);
      setPhase("error");
      return;
    }
    setStep(3);
    recordRuling(id, ruling);
    setPhase("done");
  }

  /* ------------------------------------------------------------- */

  function renderNothing() {
    return <div className="shimmer h-72 rounded-3xl border border-white/[0.06]" />;
  }

  if (!hydrated) return renderNothing();
  if (!receipt) {
    return (
      <div className="flex flex-col items-center gap-3 py-24 text-center">
        <p className="text-4xl">🔍</p>
        <h1 className="text-lg font-bold text-white">Receipt not found</h1>
        <LinkBtn href="/receipts" tone="ghost">Back to the ledger</LinkBtn>
      </div>
    );
  }

  const journeyStep = receipt.ruling ? 6 : 5;

  return (
    <div className="flex flex-col gap-4">
      <Journey step={journeyStep} accent={mode === "simulated" ? "violet" : "cyan"} />
      <Link href={`/receipts/${receipt.id}`} className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-400 hover:text-slate-200">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to receipt
      </Link>

      <div>
        <div className="flex items-center gap-2 text-cyan-300">
          <Gavel className="h-5 w-5" />
          <h1 className="text-xl font-extrabold text-white">Verification</h1>
        </div>
        <p className="mt-1 text-sm text-slate-400">
          {receipt.briefTitle || receipt.id} · challenge {receipt.challenge?.id ?? "—"} · the work, the dispute and the
          evidence go to an adjudicator together.
        </p>
      </div>

      {/* what will be sent */}
      <Card className="p-3.5">
        <p className="text-[11px] leading-relaxed text-slate-400">
          {mode === "genlayer" || receipt.ruling?.source === "genlayer" ? (
            <>
              <span className="font-semibold text-cyan-200/90">Judged by GenLayer validators</span> — the app calls{" "}
              <code className="font-mono text-[10px] text-slate-300">create_receipt(brief, work, evidence, agent)</code> →{" "}
              <code className="font-mono text-[10px] text-slate-300">challenge(reason, evidence)</code> →{" "}
              <code className="font-mono text-[10px] text-slate-300">adjudicate()</code> on the live Intelligent Contract, then reads{" "}
              <code className="font-mono text-[10px] text-slate-300">get_receipt()</code>. No in-app AI is consulted.
            </>
          ) : (
            <>
              <span className="font-semibold text-violet-200/90">Simulated fallback</span> — a transparent local model
              judges this dispute. GenLayer validators are <em>not</em> contacted, and the verdict is labelled as a
              Simulated fallback. Once a real on-chain verdict is shown, this fallback is hidden.
            </>
          )}
        </p>
      </Card>

      {receipt.ruling ? (
        /* ---------------- already ruled ---------------- */
        <div className="flex flex-col gap-4">
          {receipt.ruling.source === "genlayer" ? (
            <OnchainVerdictCard ruling={receipt.ruling} receiptId={receipt.id} />
          ) : (
            <Card
              className="p-5 text-center"
              glow={receipt.ruling.verdict === "PASS" ? "pass" : receipt.ruling.verdict === "FAIL" ? "fail" : undefined}
            >
              <div
                className={cx(
                  "mx-auto mb-3 grid h-14 w-14 place-items-center rounded-2xl border",
                  receipt.ruling.verdict === "PASS"
                    ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-300"
                    : "border-rose-400/30 bg-rose-500/10 text-rose-300"
                )}
              >
                <ShieldCheck className="h-7 w-7" />
              </div>
              <Badge tone={VERDICT_META[receipt.ruling.verdict].tone}>{VERDICT_META[receipt.ruling.verdict].label}</Badge>
              <p className="mt-2 text-lg font-bold text-white">This dispute is settled by the Simulated fallback</p>
              <p className="mx-auto mt-1 max-w-md text-sm text-slate-400">
                {VERDICT_META[receipt.ruling.verdict].detail}
              </p>
              <p className="mx-auto mt-2 max-w-md rounded-xl border border-amber-400/15 bg-amber-500/[0.05] px-3.5 py-2 text-[11px] leading-relaxed text-amber-200/80">
                No GenLayer validator was consulted for this verdict — it came from AgentRef&apos;s transparent local
                model. The live GenLayer path stays integrated and takes over the moment a signer key is configured.
              </p>
            </Card>
          )}
          <ReceiptView receipt={receipt} />
        </div>
      ) : phase === "setup" ? (
        /* ---------------- choose & start ---------------- */
        <Card className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-bold text-white">Which adjudicator should rule?</p>
            {writesReady === false && (
              <span className="rounded-full border border-violet-400/25 bg-violet-500/10 px-2.5 py-1 text-[10.5px] font-semibold uppercase tracking-wider text-violet-200">
                Fallback active
              </span>
            )}
          </div>
          <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
            <button
              onClick={() => pickMode("simulated")}
              className={cx(
                "rounded-2xl border p-4 text-left transition-all",
                mode === "simulated" ? "border-violet-400/50 bg-violet-500/10 shadow-glow" : "border-white/10 bg-white/[0.02] hover:border-white/20"
              )}
            >
              <div className="flex items-center justify-between">
                <span className="grid h-9 w-9 place-items-center rounded-xl border border-violet-400/30 bg-violet-500/15 text-violet-200">
                  <FlaskConical className="h-4.5 w-4.5" />
                </span>
                {mode === "simulated" && <CheckCircle2 className="h-4 w-4 text-violet-300" />}
              </div>
              <p className="mt-2.5 text-sm font-semibold text-white">Simulated fallback</p>
              <p className="mt-1 text-xs leading-relaxed text-slate-400">
                Transparent local rules model — instant and deterministic. GenLayer validators are NOT contacted.
                {writesReady !== true && (
                  <span className="mt-1 block font-semibold text-violet-300/90">
                    Recommended here — this deployment has no signer key.
                  </span>
                )}
              </p>
            </button>

            <button
              onClick={() => pickMode("genlayer")}
              disabled={!isGenReady || !writesAvailable}
              className={cx(
                "rounded-2xl border p-4 text-left transition-all",
                mode === "genlayer" ? "border-cyan-400/50 bg-cyan-500/10 shadow-glow-cyan" : "border-white/10 bg-white/[0.02] hover:border-white/20",
                (!isGenReady || !writesAvailable) && "cursor-not-allowed opacity-60"
              )}
            >
              <div className="flex items-center justify-between">
                <span className="grid h-9 w-9 place-items-center rounded-xl border border-cyan-400/30 bg-cyan-500/15 text-cyan-200">
                  <Cpu className="h-4.5 w-4.5" />
                </span>
                {mode === "genlayer" && <CheckCircle2 className="h-4 w-4 text-cyan-300" />}
              </div>
              <p className="mt-2.5 text-sm font-semibold text-white">GenLayer validators — live contract</p>
              <p className="mt-1 text-xs leading-relaxed text-slate-400">
                {!isGenReady
                  ? "GenLayer is not configured."
                  : writesAvailable
                    ? `Judge on the live Intelligent Contract (${glChainLabel}). Real validator consensus — not an in-app AI.`
                    : "Wired to the live contract, but signing the writes needs a server key (AGENTREF_ACCOUNT_PRIVATE_KEY) that this deployment does not have."}
              </p>
            </button>
          </div>

          {writesReady === false && (
            <p className="mt-3 rounded-xl border border-violet-400/15 bg-violet-500/[0.05] px-3.5 py-2 text-[11px] leading-relaxed text-violet-200/85">
              The live GenLayer path is fully integrated and stays in the app — it is only switched off because this
              deployment has no funded signer key. Everything below runs on the <b>Simulated fallback</b>, and every
              verdict is labelled as such. Nothing here is claimed to be a GenLayer validator verdict.
            </p>
          )}

          <div className="mt-5 flex flex-col gap-2">
            <Btn
              size="lg"
              block
              tone={mode === "simulated" ? "violet" : "cyan"}
              disabled={mode === "genlayer" && !writesAvailable}
              onClick={mode === "simulated" ? runSimulated : adjudicateOnGenLayer}
            >
              {mode === "simulated" ? (
                <>
                  <FlaskConical className="h-4.5 w-4.5" /> Run Simulated fallback
                </>
              ) : (
                <>
                  <Cpu className="h-4.5 w-4.5" /> Adjudicate on GenLayer validators
                </>
              )}
            </Btn>

            {mode === "genlayer" && (
              <Btn size="lg" block tone="ghost" onClick={readSharedVerdict}>
                Read the shared on-chain verdict <ExternalLink className="h-4 w-4" />
              </Btn>
            )}

            {mode === "genlayer" && (
              <p className="rounded-xl border border-cyan-400/15 bg-cyan-500/[0.04] px-3.5 py-2 text-[11px] leading-relaxed text-cyan-200/80">
                Adjudicating sends <b>real transactions</b> to {glChainLabel} (contract{" "}
                <span className="font-mono">{glContractAddr.slice(0, 10)}…</span>), signed server-side by
                <span className="font-mono"> AGENTREF_ACCOUNT_PRIVATE_KEY</span>. The button below it reads whatever the
                shared contract already holds — free, no wallet.
              </p>
            )}
            {freshChallenge && (
              <p className="text-center text-[11px] text-slate-500">
                You are the buyer here — this will move the receipt to UNDER_REVIEW, then record a final ruling.
              </p>
            )}
          </div>
        </Card>
      ) : phase === "running" ? (
        /* ---------------- staged progress ---------------- */
        <Card className="p-5">
          <div className="flex items-center gap-2">
            <PulseDot tone={mode === "simulated" ? "violet" : "cyan"} />
            <p className="text-sm font-bold text-white">
              {mode === "simulated"
                ? "Simulated fallback — local rules model"
                : step >= 2
                  ? "Reading the verdict from GenLayer validators"
                  : `Adjudicating on GenLayer validators — ${LIVE_CONTRACT.chainLabel}`}
            </p>
          </div>
          <div className="mt-4 space-y-0">
            {(mode === "simulated" ? SIM_STEPS : GL_STEPS).map((s, i) => {
              const steps = mode === "simulated" ? SIM_STEPS : GL_STEPS;
              return (
                <div key={i} className="relative flex gap-3 pb-4 last:pb-0">
                  {i < steps.length - 1 && <span className="absolute left-[7px] top-5 h-full w-px bg-white/10" />}
                  <span className="mt-0.5">
                    {i < step ? (
                      <CheckCircle2 className="h-[15px] w-[15px] text-emerald-400" />
                    ) : i === step ? (
                      <LoaderCircle className="h-[15px] w-[15px] animate-spin text-cyan-300" />
                    ) : (
                      <Circle className="h-[15px] w-[15px] text-slate-600" />
                    )}
                  </span>
                  <div className={cx("min-w-0", i > step && "opacity-40")}>
                    <p className="text-[13px] font-semibold text-slate-200">{s.title}</p>
                    <p className="text-xs leading-relaxed text-slate-500">{s.detail}</p>
                  </div>
                </div>
              );
            })}
          </div>
          {mode === "simulated" && (
            <p className="mt-3 rounded-xl border border-amber-400/15 bg-amber-500/[0.04] px-3.5 py-2 text-[11px] leading-relaxed text-amber-200/80">
              Honesty note: the pacing is animated for the demo; the SIMULATED computation itself is instantaneous. This
              verdict is replaced by the real on-chain verdict the moment one is recorded.
            </p>
          )}
          {mode === "genlayer" && (
            <p className="mt-3 rounded-xl border border-cyan-400/15 bg-cyan-500/[0.04] px-3.5 py-2 text-[11px] leading-relaxed text-cyan-200/80">
              The judge here is <b>GenLayer validator consensus</b> on the live contract — no in-app AI. The ruling is
              only recorded once <code className="font-mono text-[10px]">get_receipt()</code> reports a final Status.
            </p>
          )}
        </Card>
      ) : (
        /* ---------------- error ---------------- */
        <Card className="p-5 text-center">
          <p className="text-3xl">⚠️</p>
          <p className="mt-2 text-base font-bold text-white">
            {mode === "simulated" ? "The Simulated fallback did not complete" : "The GenLayer adjudication did not complete"}
          </p>
          <p className="mx-auto mt-1 max-w-md whitespace-pre-line text-sm text-slate-400">{errorMsg}</p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {mode === "genlayer" && (
              <Btn tone="violet" onClick={runSimulated}>
                <FlaskConical className="h-4 w-4" /> Run the Simulated fallback instead
              </Btn>
            )}
            <Btn tone="ghost" onClick={() => setPhase("setup")}>
              Back to choose
            </Btn>
            {mode === "genlayer" && (
              <Btn tone="cyan" onClick={readSharedVerdict}>
                Read the shared on-chain verdict instead
              </Btn>
            )}
            <LinkBtn href={`/receipts/${receipt.id}`} tone="ghost">Open the record</LinkBtn>
          </div>
        </Card>
      )}

      {!receipt.ruling && (
        <div className="mt-2 flex items-center justify-between rounded-2xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
          <p className="text-xs text-slate-400">Want to judge another one?</p>
          <Link href="/" className="inline-flex items-center gap-1 text-xs font-semibold text-violet-300 hover:text-violet-200">
            Try the demo scenarios <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

/** Step 06 — the on-chain verdict, front and centre. */
function OnchainVerdictCard({ ruling, receiptId }: { ruling: Ruling; receiptId: string }) {
  const positive = ruling.verdict === "PASS";
  const status = ruling.genlayerStatus ?? (positive ? "VERIFIED" : "NOT_VERIFIED");
  const Icon = positive ? ShieldCheck : XCircle;
  return (
    <Card className={cx("p-5", positive ? "border-emerald-400/20" : "border-rose-400/25")} glow={positive ? "pass" : "fail"}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-center gap-3">
          <div
            className={cx(
              "grid h-12 w-12 shrink-0 place-items-center rounded-2xl border",
              positive ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-300" : "border-rose-400/30 bg-rose-500/10 text-rose-300"
            )}
          >
            <Icon className="h-6 w-6" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={positive ? "pass" : "fail"}>{status}</Badge>
              <Badge tone="violet">GENLAYER</Badge>
            </div>
            <p className="mt-1 text-base font-bold text-white">
              {positive ? "The work verified on-chain." : "The work did not verify on-chain."}
            </p>
          </div>
        </div>
        <div className="text-left sm:text-right">
          <p className="text-[10.5px] font-semibold uppercase tracking-wider text-slate-500">Ruled by</p>
          <p className="text-[13px] font-medium text-slate-200">GenLayer validators</p>
        </div>
      </div>

      <p className="mt-3 rounded-xl border border-violet-400/20 bg-violet-500/[0.06] px-3.5 py-2 text-xs leading-relaxed text-violet-200/90">
        Read from the live Intelligent Contract on {LIVE_CONTRACT.chainLabel}. Judged by GenLayer validators — no in-app AI.
        {!ruling.explorerUrl && " This is the most recent adjudication held by the shared contract."}
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {ruling.genlayerScore && (
          <div className="rounded-xl border border-white/[0.06] bg-base-900/50 px-3.5 py-2.5">
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-slate-500">Validator score</p>
            <p className="mt-0.5 font-mono text-base font-bold text-white">{ruling.genlayerScore}</p>
          </div>
        )}
        <div className="rounded-xl border border-white/[0.06] bg-base-900/50 px-3.5 py-2.5">
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-slate-500">On-chain status</p>
          <p className="mt-0.5 text-sm font-semibold text-white">{status}</p>
        </div>
      </div>

      <div className="mt-4">
        <p className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-slate-500">Validator reason</p>
        <p className="preserve-breaks rounded-xl bg-base-900/60 px-3.5 py-2.5 text-sm leading-relaxed text-slate-200">
          {ruling.reasoning || "The validators returned no written reason."}
        </p>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-white/[0.06] pt-3.5">
        {ruling.explorerUrl && (
          <a
            href={ruling.explorerUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs font-semibold text-cyan-200 underline-offset-2 hover:underline"
          >
            View the adjudication transaction <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
        {LIVE_CONTRACT.deployTxHash && (
          <a
            href={explorerTxUrl(LIVE_CONTRACT.deployTxHash)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 underline-offset-2 hover:text-cyan-200 hover:underline"
          >
            Contract deploy on the explorer <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
        {ruling.contractAddress && (
          <span className="font-mono text-[10.5px] text-slate-500">contract {ruling.contractAddress.slice(0, 10)}…{ruling.contractAddress.slice(-6)}</span>
        )}
        <LinkBtn href={`/receipts/${receiptId}`} tone="ghost" className="ml-auto">
          Open the full record <ArrowRight className="h-4 w-4" />
        </LinkBtn>
      </div>
    </Card>
  );
}
