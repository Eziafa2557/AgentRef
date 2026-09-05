import { NextRequest, NextResponse } from "next/server";
import { readRuling } from "@/core/genlayer/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/genlayer/ruling?challengeId=CHL-…
 *
 * Reads AgentRefAdjudicator.get_ruling at the latest FINAL round. No account
 * needed — only the network + contract address from server env.
 */
export async function GET(req: NextRequest) {
  const challengeId = req.nextUrl.searchParams.get("challengeId") ?? "";
  const out = await readRuling({ challengeId });
  return NextResponse.json(out, { status: out.status === "error" ? 422 : 200 });
}
