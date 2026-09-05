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
  Lock,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useAgentRef } from "@/lib/agentref-provider";
import { Badge, Btn, Card, LinkBtn, PulseDot, cx } from "@/components/ui";
import { simulateRuling } from "@/core/evaluate";
import { buildVerificationRequest } from "@/core/verify/request";
import { getGenLayerConfig } from "@/core/genlayer/config";
import { readRuling, submitDispute } from "@/core/genlayer/adapter";
import { VERDICT_META } from "@/lib/labels";
import { shortKey } from "@/lib/format";
import { ReceiptView } from "@/components/receipt-view";

type Mode = "simulated" | "genlayer";
type Phase = "setup" | "running" | "done" | "error";

const SIM_STEPS = [
  { title: "Snapshot the dispute corpus", detail: "Builds the exact payload the adjudicator will see — brief, requirements, work, challenge and hashed evidence." },
  { title: "SIMULATED — local rules model", detail: "No GenLayer validators are contacted. A transparent, inspectable model checks each requirement against the work." },
  { title: "Record the ruling", detail: "Persists the verdict on the receipt and advances the escrow state machine." },
];

const GL_STEPS = [
  { title: "Build & fingerprint payload", detail: "Computes the payload hash that binds the ruling to exactly this material." },
  { title: "Submit dispute to the contract", detail: "Calls submit_dispute on AgentRefAdjudicator with the server-side signer." },
  { title: "Await validator consensus", detail: "Reads get_ruling at the latest finalized round until the ruling is available." },
  { title: "Record the ruling", detail: "Stores the on-chain verdict and its provenance on the receipt." },
];

export default function VerifyPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  const { getReceipt, hydrated, submitForReview, recordRuling } = useAgentRef();
  const receipt = getReceipt(id);

  const [mode, setMode] = useState<Mode>("simulated");
  const [phase, setPhase] = useState<Phase>("setup");
  const [step, setStep] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [glConfig] = useState(() => getGenLayerConfig());

  const startedRef = useRef(false);
  const cancelRef = useRef(false);
  const finalReceipt = receipt?.ruling ? receipt : null;

  const canRun = !!receipt?.challenge && !receipt.ruling;
  const isGenReady = glConfig.kind === "ready";

  // Auto-run once when we land with a fresh challenge (fast demo path).
  useEffect(() => {
    if (!hydrated) return;
    if (receipt?.challenge && !receipt.ruling && receipt.settlement !== "UNDER_REVIEW" && !startedRef.current) {
      startedRef.current = true;
      begin(mode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, receipt?.id, receipt?.settlement]);

  const sleep = (ms: number) => new Promise<void>((res) => setTimeout(res, ms));

  async function begin(which: Mode) {
    cancelRef.current = false;
    setErrorMsg(null);
    const cur = getReceipt(id);
    if (!cur?.challenge || cur.ruling) return;
    setMode(which);
    setPhase("running");
    setStep(0);

    if (which === "simulated") {
      const steps = SIM_STEPS;
      for (let i = 0; i < steps.length; i++) {
        if (cancelRef.current) return;
        setStep(i);
        await sleep(i === 1 ? 1100 : 620);
      }
      if (cancelRef.current) return;
      try {
        let latest = getReceipt(id)!;
        if (latest.settlement !== "UNDER_REVIEW") latest = submitForReview(id);
        const ruling = simulateRuling(latest);
        recordRuling(id, ruling);
        setPhase("done");
      } catch (e) {
        setErrorMsg(e instanceof Error ? e.message : "Verification failed.");
        setPhase("error");
      }
      return;
    }

    // GenLayer path (real).
    const steps = GL_STEPS;
    const submitCur = getReceipt(id)!;
    for (let i = 0; i < steps.length; i++) {
      if (cancelRef.current) return;
      setStep(i);
      if (i === 1) {
        try {
          if (submitCur.settlement !== "UNDER_REVIEW") submitForReview(id);
          const out = await submitDispute(submitCur);
          if (out.status === "error") throw new Error(out.message);
          if (out.status === "not-configured") throw new Error(out.reason);
        } catch (e) {
          setErrorMsg(e instanceof Error ? e.message : "Submit failed.");
          setPhase("error");
          return;
        }
      }
      if (i === 2) {
        // poll until finality
        let rulingOut;
        for (let attempt = 0; attempt < 6; attempt++) {
          if (cancelRef.current) return;
          await sleep(attempt === 0 ? 800 : 1400);
          rulingOut = await readRuling(getReceipt(id)!);
          if (rulingOut.status === "ruling") break;
        }
        if (rulingOut?.status === "ruling") {
          recordRuling(id, rulingOut.ruling);
        } else {
          setErrorMsg(
            rulingOut?.status === "error"
              ? rulingOut.message
              : "Dispute submitted but the ruling has not reached finality yet. Check the contract in a moment."
          );
          setPhase("error");
          return;
        }
      }
    }
    setPhase("done");
  }

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

  const payload = receipt.challenge ? buildVerificationRequest(receipt) : null;
  const freshChallenge = !!receipt.challenge && !receipt.ruling;

  return (
    <div className="flex flex-col gap-4">
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

      {/* payload fingerprint */}
      {payload && (
        <Card className="flex flex-wrap items-center justify-between gap-2 p-3.5">
          <div className="flex items-center gap-2 text-[11.5px] text-slate-400">
            <Lock className="h-3.5 w-3.5 text-cyan-300" />
            What will be sent · payload fingerprint
          </div>
          <span className="font-mono text-[11px] text-slate-300">{shortKey(payload.payloadHash, 14, 8)}</span>
        </Card>
      )}

      {receipt.ruling ? (
        /* ------- already ruled ------- */
        <div className="flex flex-col gap-4">
          <Card className="p-5 text-center" glow={receipt.ruling.verdict === "PASS" ? "pass" : receipt.ruling.verdict === "FAIL" ? "fail" : undefined}>
            <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-2xl border border-emerald-400/30 bg-emerald-500/10 text-emerald-300">
              <ShieldCheck className="h-7 w-7" />
            </div>
            <Badge tone={VERDICT_META[receipt.ruling.verdict].tone}>{VERDICT_META[receipt.ruling.verdict].label}</Badge>
            <p className="mt-2 text-lg font-bold text-white">This dispute is settled</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-slate-400">{VERDICT_META[receipt.ruling.verdict].detail}</p>
            <LinkBtn href={`/receipts/${receipt.id}`} className="mt-4" tone="ghost">
              Open the full record <ExternalLink className="h-4 w-4" />
            </LinkBtn>
          </Card>
          <ReceiptView receipt={receipt} />
        </div>
      ) : phase === "setup" ? (
        /* ------- choose & start ------- */
        <Card className="p-5">
          <p className="text-sm font-bold text-white">Which adjudicator should rule?</p>
          <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
            <button
              onClick={() => setMode("simulated")}
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
              <p className="mt-2.5 text-sm font-semibold text-white">SIMULATED adjudicator</p>
              <p className="mt-1 text-xs leading-relaxed text-slate-400">
                Transparent local rules model. Instant, deterministic — validators are NOT consulted.
              </p>
            </button>

            <button
              onClick={() => setMode("genlayer")}
              disabled={!isGenReady}
              className={cx(
                "rounded-2xl border p-4 text-left transition-all",
                mode === "genlayer" ? "border-cyan-400/50 bg-cyan-500/10 shadow-glow-cyan" : "border-white/10 bg-white/[0.02] hover:border-white/20",
                !isGenReady && "cursor-not-allowed opacity-60"
              )}
            >
              <div className="flex items-center justify-between">
                <span className="grid h-9 w-9 place-items-center rounded-xl border border-cyan-400/30 bg-cyan-500/15 text-cyan-200">
                  <Cpu className="h-4.5 w-4.5" />
                </span>
                {mode === "genlayer" && <CheckCircle2 className="h-4 w-4 text-cyan-300" />}
              </div>
              <p className="mt-2.5 text-sm font-semibold text-white">GENLAYER validators</p>
              <p className="mt-1 text-xs leading-relaxed text-slate-400">
                {isGenReady ? `Real consensus on ${glConfig.chainLabel}.` : "Not configured — deploy the contract and set NEXT_PUBLIC_AGENTREF_CONTRACT_ADDRESS."}
              </p>
            </button>
          </div>

          <div className="mt-5 flex flex-col gap-2">
            <Btn
              size="lg"
              block
              tone={mode === "simulated" ? "violet" : "cyan"}
              onClick={() => begin(mode)}
              disabled={mode === "genlayer" && !isGenReady}
            >
              {mode === "simulated" ? (
                <>
                  <FlaskConical className="h-4.5 w-4.5" /> Run SIMULATED adjudication
                </>
              ) : (
                <>
                  <Cpu className="h-4.5 w-4.5" /> Submit to GenLayer validators
                </>
              )}
            </Btn>
            {freshChallenge && (
              <p className="text-center text-[11px] text-slate-500">
                You are the buyer here — this will move the receipt to UNDER_REVIEW, then record a final ruling.
              </p>
            )}
          </div>
        </Card>
      ) : phase === "running" ? (
        /* ------- staged progress ------- */
        <Card className="p-5">
          <div className="flex items-center gap-2">
            <PulseDot tone={mode === "simulated" ? "violet" : "cyan"} />
            <p className="text-sm font-bold text-white">
              {mode === "simulated" ? "SIMULATED adjudication" : "Submitting to GenLayer"}
            </p>
          </div>
          <div className="mt-4 space-y-0">
            {(mode === "simulated" ? SIM_STEPS : GL_STEPS).map((s, i) => (
              <div key={i} className={cx("relative flex gap-3 pb-4 last:pb-0", i < (mode === "simulated" ? SIM_STEPS : GL_STEPS).length - 1 && "")}>
                {i < (mode === "simulated" ? SIM_STEPS : GL_STEPS).length - 1 && (
                  <span className="absolute left-[7px] top-5 h-full w-px bg-white/10" />
                )}
                <span className="mt-0.5">
                  {i < step ? (
                    <CheckCircle2 className="h-[15px] w-[15px] text-emerald-400" />
                  ) : i === step ? (
                    <LoaderCircle className="h-[15px] w-[15px] animate-spin text-violet-300" />
                  ) : (
                    <Circle className="h-[15px] w-[15px] text-slate-600" />
                  )}
                </span>
                <div className={cx("min-w-0", i > step && "opacity-40")}>
                  <p className="text-[13px] font-semibold text-slate-200">{s.title}</p>
                  <p className="text-xs leading-relaxed text-slate-500">{s.detail}</p>
                </div>
              </div>
            ))}
          </div>
          {mode === "simulated" && (
            <p className="mt-3 rounded-xl border border-amber-400/15 bg-amber-500/[0.04] px-3.5 py-2 text-[11px] leading-relaxed text-amber-200/80">
              Honesty note: the pacing is animated for the demo; the SIMULATED computation itself is instantaneous and
              deterministic. GenLayer validators are never contacted on this path.
            </p>
          )}
        </Card>
      ) : (
        /* ------- error ------- */
        <Card className="p-5 text-center">
          <p className="text-3xl">⚠️</p>
          <p className="mt-2 text-base font-bold text-white">Verification did not complete</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-slate-400">{errorMsg}</p>
          <div className="mt-4 flex justify-center gap-2">
            <Btn tone="ghost" onClick={() => setPhase("setup")}>Back to choose</Btn>
            <LinkBtn href={`/receipts/${receipt.id}`} tone="ghost">Open the record</LinkBtn>
          </div>
        </Card>
      )}

      {/* small footer of currently settled demo scenarios */}
      {receipt.ruling && (
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
