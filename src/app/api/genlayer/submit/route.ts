import { NextResponse } from "next/server";
import { submitDispute } from "@/core/genlayer/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/genlayer/submit
 *
 * Server-only bridge for the REAL GenLayer path. The browser sends the exact
 * dispute payload (built by buildVerificationRequest) + its fingerprint; this
 * handler signs the write with the server-only private key and waits for
 * validator finalization. The key never reaches the client.
 */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ status: "error", message: "Invalid JSON body." }, { status: 400 });
  }
  const { challengeId, payloadHash, payload } = (body ?? {}) as Record<string, unknown>;
  const out = await submitDispute({
    challengeId: typeof challengeId === "string" ? challengeId : "",
    payloadHash: typeof payloadHash === "string" ? payloadHash : "",
    payload: typeof payload === "string" ? payload : "",
  });
  return NextResponse.json(out, { status: out.status === "error" ? 422 : 200 });
}
