"use client";

import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, FileSearch, Gavel, Plus, Trash2, Wand2 } from "lucide-react";
import { useState } from "react";
import Link from "next/link";
import { useAgentRef } from "@/lib/agentref-provider";
import { Btn, Card, Chip, Field, Label, LinkBtn, inputCls } from "@/components/ui";
import { suggestedChallengeFor } from "@/core/seeds";
import type { ChallengeInput } from "@/core/challenge";

export default function ChallengePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params?.id ?? "";
  const { getReceipt, hydrated, challenge } = useAgentRef();
  const receipt = getReceipt(id);

  const suggested = receipt?.seedId ? suggestedChallengeFor(receipt.seedId) : null;

  const [reason, setReason] = useState("");
  const [violated, setViolated] = useState<string[]>([]);
  const [missed, setMissed] = useState<string[]>([]);
  const [context, setContext] = useState("");
  const [challenger, setChallenger] = useState("");
  const [evidence, setEvidence] = useState<Array<{ label: string; content: string }>>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const toggle = (list: string[], set: (v: string[]) => void, value: string) =>
    set(list.includes(value) ? list.filter((x) => x !== value) : [...list, value]);

  if (!hydrated) return <div className="shimmer h-72 rounded-3xl border border-white/[0.06]" />;
  if (!receipt) {
    return (
      <div className="flex flex-col items-center gap-3 py-24 text-center">
        <p className="text-4xl">🔍</p>
        <h1 className="text-lg font-bold text-white">Receipt not found</h1>
        <LinkBtn href="/receipts" tone="ghost">Back to the ledger</LinkBtn>
      </div>
    );
  }

  if (receipt.ruling || receipt.challenge) {
    return (
      <div className="flex flex-col items-center gap-3 py-24 text-center">
        <p className="text-4xl">⚖️</p>
        <h1 className="text-lg font-bold text-white">
          {receipt.ruling ? "This receipt is already settled" : "This receipt is already under challenge"}
        </h1>
        <p className="max-w-sm text-sm text-slate-400">
          A receipt can only be challenged once — that&apos;s what keeps the record tamper-proof.
        </p>
        <div className="flex gap-2">
          <LinkBtn href={`/receipts/${receipt.id}`} tone="ghost">View record</LinkBtn>
          {receipt.challenge && !receipt.ruling && (
            <LinkBtn href={`/receipts/${receipt.id}/verify`} tone="cyan">Review it</LinkBtn>
          )}
        </div>
      </div>
    );
  }

  const prefill = (input: ChallengeInput) => {
    setReason(input.reason);
    setViolated(input.violatedRequirements);
    setMissed(input.missedRiskRequirements);
    setContext(input.additionalContext);
    setChallenger(input.challengerName);
    setEvidence(input.evidence.map((e) => ({ label: e.label, content: e.content })));
    setError(null);
  };

  const submit = () => {
    setError(null);
    if (!reason.trim()) {
      setError("Write a reason for the dispute — this is what gets judged.");
      return;
    }
    setBusy(true);
    try {
      const input: ChallengeInput = {
        reason: reason.trim(),
        violatedRequirements: violated,
        missedRiskRequirements: missed,
        additionalContext: context.trim(),
        challengerName: challenger.trim(),
        evidence: evidence.filter((e) => e.content.trim()),
      };
      const { receipt: updated } = challenge(receipt.id, input);
      router.push(`/receipts/${updated.id}/verify`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not raise the challenge.");
      setBusy(false);
    }
  };

  const addEvidenceRow = () => setEvidence((rows) => [...rows, { label: "", content: "" }]);

  return (
    <div className="flex flex-col gap-4">
      <Link href={`/receipts/${receipt.id}`} className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-400 hover:text-slate-200">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to receipt
      </Link>

      <div>
        <div className="flex items-center gap-2 text-amber-300">
          <Gavel className="h-5 w-5" />
          <h1 className="text-xl font-extrabold text-white">Raise a dispute</h1>
        </div>
        <p className="mt-1 text-sm text-slate-400">
          {receipt.briefTitle || receipt.id} — state why the delivered work missed the brief. Everything you write is
          preserved verbatim and hashed.
        </p>
      </div>

      <Card className="p-5">
        <div className="flex flex-col gap-5">
          <Field>
            <Label hint="required">Reason for the dispute</Label>
            <textarea
              className={inputCls + " min-h-[104px]"}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. The delivered analysis never actually compared the downside risk the brief required…"
            />
          </Field>

          {suggested && (
            <button
              onClick={() => prefill(suggested)}
              className="inline-flex items-center gap-2 self-start rounded-xl border border-violet-400/30 bg-violet-500/10 px-3.5 py-2 text-xs font-semibold text-violet-200 transition-colors hover:bg-violet-500/20"
            >
              <Wand2 className="h-3.5 w-3.5" />
              Pre-fill with this demo&apos;s bundled dispute
            </button>
          )}

          <div>
            <Label hint="pick the exact texts you allege were broken">
              Alleged violations — explicit requirements
            </Label>
            {receipt.requirements.length === 0 ? (
              <p className="text-xs text-slate-500">This brief has no explicit requirements to flag.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {receipt.requirements.map((req) => (
                  <Chip key={req} selected={violated.includes(req)} onClick={() => toggle(violated, setViolated, req)}>
                    {violated.includes(req) ? "✓ " : ""}
                    {req.length > 60 ? req.slice(0, 60) + "…" : req}
                  </Chip>
                ))}
              </div>
            )}
          </div>

          <div>
            <Label hint="optional">Alleged missed material-risk disclosures</Label>
            {receipt.riskRequirements.length === 0 ? (
              <p className="text-xs text-slate-500">No material-risk disclosures were demanded by this brief.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {receipt.riskRequirements.map((req) => (
                  <Chip key={req} selected={missed.includes(req)} onClick={() => toggle(missed, setMissed, req)}>
                    {missed.includes(req) ? "✓ " : ""}
                    {req.length > 60 ? req.slice(0, 60) + "…" : req}
                  </Chip>
                ))}
              </div>
            )}
          </div>

          <Field>
            <Label hint="optional">Additional context</Label>
            <textarea
              className={inputCls + " min-h-[72px]"}
              value={context}
              onChange={(e) => setContext(e.target.value)}
              placeholder="Anything that helps the adjudicator see why this delivery missed."
            />
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field>
              <Label hint="optional">Your label</Label>
              <input className={inputCls} value={challenger} onChange={(e) => setChallenger(e.target.value)} placeholder="e.g. Acme Compliance" />
            </Field>
          </div>

          {/* evidence */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <Label hint="optional but powerful">Evidence — attached verbatim, content-hashed</Label>
              <button onClick={addEvidenceRow} className="inline-flex items-center gap-1 text-xs font-semibold text-violet-300 hover:text-violet-200">
                <Plus className="h-3.5 w-3.5" /> Add evidence
              </button>
            </div>
            {evidence.length === 0 ? (
              <p className="rounded-xl border border-dashed border-white/10 px-3.5 py-4 text-center text-xs text-slate-500">
                Paste the exact passage that proves your point. It is preserved byte-for-byte and hashed so it can&apos;t
                be quietly edited later.
              </p>
            ) : (
              <div className="space-y-2.5">
                {evidence.map((ev, idx) => (
                  <div key={idx} className="rounded-xl border border-white/[0.07] bg-base-900/50 p-3">
                    <div className="mb-2 flex items-center gap-2">
                      <FileSearch className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                      <input
                        className={inputCls + " !py-1.5"}
                        value={ev.label}
                        placeholder="Label (e.g. memo excerpt)"
                        onChange={(e) => {
                          const rows = [...evidence];
                          rows[idx] = { ...rows[idx], label: e.target.value };
                          setEvidence(rows);
                        }}
                      />
                      <button
                        onClick={() => setEvidence((rows) => rows.filter((_, i) => i !== idx))}
                        className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-white/10 text-slate-400 hover:text-rose-300"
                        aria-label="Remove evidence"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <textarea
                      className={inputCls + " min-h-[64px]"}
                      value={ev.content}
                      placeholder="Paste the exact content being offered as evidence…"
                      onChange={(e) => {
                        const rows = [...evidence];
                        rows[idx] = { ...rows[idx], content: e.target.value };
                        setEvidence(rows);
                      }}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>

          {error && <p className="rounded-xl border border-rose-400/20 bg-rose-500/10 px-3.5 py-2.5 text-xs text-rose-200">{error}</p>}

          <Btn onClick={submit} disabled={busy} block size="lg" tone="amber">
            <Gavel className="h-4.5 w-4.5" />
            {busy ? "Raising dispute…" : "Freeze this challenge on the record"}
          </Btn>
          <p className="text-center text-[11px] leading-relaxed text-slate-500">
            The dispute, its evidence and the requirement texts are snapshotted and hashed now. Once raised, a receipt
            can be challenged only once.
          </p>
        </div>
      </Card>
    </div>
  );
}
