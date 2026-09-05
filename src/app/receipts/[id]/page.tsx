"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { CheckCircle2, Copy, Gavel, RotateCcw, Share2, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { useAgentRef } from "@/lib/agentref-provider";
import { Btn, LinkBtn, PulseDot } from "@/components/ui";
import { ReceiptView } from "@/components/receipt-view";
import { suggestedChallengeFor } from "@/core/seeds";
import type { ChallengeInput } from "@/core/challenge";

export default function ReceiptDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params?.id ?? "";
  const { getReceipt, hydrated, challenge, receipts } = useAgentRef();
  const receipt = getReceipt(id);
  const [copied, setCopied] = useState<"id" | "link" | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Live-update when the record changes underneath (e.g. after challenge submit).
  useEffect(() => {
    // no-op — receipts state is reactive; kept for clarity of intent
  }, [receipts]);

  const copy = async (what: "id" | "link") => {
    const text =
      what === "id" ? receipt!.id : `${window.location.origin}/r/${encodeURIComponent(receipt!.id)}`;
    try {
      await navigator.clipboard?.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(null), 1400);
    } catch {
      /* noop */
    }
  };

  if (!hydrated) {
    return <div className="shimmer h-72 rounded-3xl border border-white/[0.06]" />;
  }
  if (!receipt) {
    return (
      <div className="flex flex-col items-center gap-3 py-24 text-center">
        <p className="text-4xl">🧾</p>
        <h1 className="text-lg font-bold text-white">Receipt not found</h1>
        <p className="max-w-sm text-sm text-slate-400">
          No receipt with id <code className="font-mono text-slate-300">{id}</code> exists in this store. It may have
          been created on another device.
        </p>
        <LinkBtn href="/receipts" tone="ghost">Back to the ledger</LinkBtn>
      </div>
    );
  }

  const quickSeed =
    receipt.seedId && !receipt.challenge && !receipt.ruling ? suggestedChallengeFor(receipt.seedId) : null;
  const canQuick = !!quickSeed && !receipt.challenge;

  const runQuickChallenge = () => {
    if (!quickSeed) return;
    try {
      const { receipt: updated } = challenge(receipt.id, quickSeed as ChallengeInput);
      router.push(`/receipts/${updated.id}/verify`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Challenge failed.");
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {/* context bar */}
      <div className="flex items-center justify-between gap-3">
        <Link href="/receipts" className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-400 hover:text-slate-200">
          <RotateCcw className="h-3.5 w-3.5" />
          Ledger
        </Link>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => copy("link")}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:border-white/20 hover:text-white"
          >
            {copied === "link" ? (
              <>
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /> Copied
              </>
            ) : (
              <>
                <Share2 className="h-3.5 w-3.5" /> Public link
              </>
            )}
          </button>
          <button
            onClick={() => copy("id")}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:border-white/20 hover:text-white"
          >
            {copied === "id" ? (
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
      </div>

      <ReceiptView receipt={receipt} />

      {/* action rail */}
      <div className="flex flex-col gap-2.5">
        {error && (
          <p className="rounded-xl border border-rose-400/20 bg-rose-500/10 px-3.5 py-2.5 text-xs text-rose-200">{error}</p>
        )}

        {!receipt.challenge && !receipt.ruling && (
          <>
            <LinkBtn href={`/receipts/${receipt.id}/challenge`} tone="amber" block>
              <ShieldCheck className="h-4 w-4" /> Challenge this delivery
            </LinkBtn>
            {canQuick && (
              <Btn tone="ghost" block onClick={runQuickChallenge}>
                <Gavel className="h-4 w-4" /> Quick demo — challenge with the suggested dispute
              </Btn>
            )}
          </>
        )}

        {receipt.challenge && !receipt.ruling && receipt.settlement !== "UNDER_REVIEW" && (
          <LinkBtn href={`/receipts/${receipt.id}/verify`} tone="cyan" block>
            <ShieldCheck className="h-4 w-4" /> Send to adjudicator
          </LinkBtn>
        )}

        {receipt.settlement === "UNDER_REVIEW" && (
          <LinkBtn href={`/receipts/${receipt.id}/verify`} tone="cyan" block>
            <PulseDot tone="cyan" /> Under review — open verification
          </LinkBtn>
        )}
      </div>
    </div>
  );
}
