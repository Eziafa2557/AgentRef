import { NextResponse } from "next/server";
import { adjudicationCapability, getGenLayerConfig } from "@/core/genlayer/config";

// Capability is read from server env at request time — never prerendered.
export const dynamic = "force-dynamic";

/**
 * Tells the browser which adjudication paths this deployment can run:
 *   - reading the on-chain verdict is always available (public address)
 *   - the WRITE path (create_receipt → challenge → adjudicate) needs a funded
 *     server-side signer key
 *
 * Only the boolean + a reason cross the wire; AGENTREF_ACCOUNT_PRIVATE_KEY
 * never leaves the server.
 */
export async function GET() {
  const { canAdjudicate, reason } = adjudicationCapability();
  const config = getGenLayerConfig();
  const live = config.kind === "ready" ? config : null;

  return NextResponse.json({
    canAdjudicate,
    reason,
    contractAddress: live?.contractAddress ?? null,
    chainLabel: live?.chainLabel ?? null,
    network: live?.network ?? null,
  });
}
