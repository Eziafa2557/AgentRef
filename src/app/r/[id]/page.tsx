"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { Eye, Globe } from "lucide-react";
import { useAgentRef } from "@/lib/agentref-provider";
import { Card } from "@/components/ui";
import { ReceiptView } from "@/components/receipt-view";
import { shortKey } from "@/lib/format";

/**
 * Public read-only receipt — the shared link target.
 *
 * In this local MVP the public record is served from the same device store the
 * link was minted on, so a link opens the identical immutable record. (On a
 * self-hosted deployment this route would read the server mirror — see the API
 * route notes in ARCHITECTURE.md.) The page renders no mint/challenge/verify
 * actions: a public receipt is a record, not a cockpit.
 */
export default function PublicReceiptPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  const { getReceipt, hydrated } = useAgentRef();
  const receipt = getReceipt(id);

  if (!hydrated) {
    return <div className="shimmer h-72 rounded-3xl border border-white/[0.06]" />;
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      {/* public marker */}
      <Card className="flex items-center gap-3 p-3.5">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-cyan-400/25 bg-cyan-500/10 text-cyan-300">
          <Globe className="h-4.5 w-4.5" />
        </span>
        <div className="min-w-0">
          <p className="text-[13px] font-bold text-white">Public receipt — read-only</p>
          <p className="truncate text-xs text-slate-500">
            {receipt ? `Record ${receipt.id}` : `record ${shortKey(id, 8, 4)}`} · anyone with this link can view it
          </p>
        </div>
        {receipt && (
          <span className="ml-auto flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[10px] font-medium text-slate-400">
            <Eye className="h-3 w-3" /> read-only
          </span>
        )}
      </Card>

      {receipt ? (
        <ReceiptView receipt={receipt} />
      ) : (
        <Card className="flex flex-col items-center gap-3 px-6 py-16 text-center">
          <p className="text-4xl">🕳️</p>
          <h1 className="text-base font-bold text-white">This record is not reachable here</h1>
          <p className="max-w-sm text-sm leading-relaxed text-slate-400">
            AgentRef&apos;s public links are stored on the device that minted them for this demo, so a link only opens on
            that device. Deploy with the server mirror to make receipts resolvable from any device.
          </p>
          <Link href="/" className="text-xs font-semibold text-violet-300 hover:text-violet-200">
            ← Back to AgentRef
          </Link>
        </Card>
      )}
    </div>
  );
}
