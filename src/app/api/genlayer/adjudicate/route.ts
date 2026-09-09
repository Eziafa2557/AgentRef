import { NextResponse } from "next/server";
import { adjudicateOnChain } from "@/core/genlayer/runtime";
import type { GenLayerOutcome } from "@/core/genlayer/runtime";

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ status: "error", message: "Body must be JSON." } satisfies GenLayerOutcome, { status: 400 });
  }

  const brief = typeof body.brief === "string" ? body.brief.trim() : "";
  const work = typeof body.work === "string" ? body.work.trim() : "";
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (!brief || !work || !reason) {
    return NextResponse.json(
      { status: "error", message: "brief, work and reason are required." } satisfies GenLayerOutcome,
      { status: 400 }
    );
  }

  const out = await adjudicateOnChain({
    brief,
    work,
    reason,
    agent: typeof body.agent === "string" ? body.agent.trim() : "",
    evidence: Array.isArray(body.evidence) ? (body.evidence as Array<{ label?: string; content?: string }>) : typeof body.evidence === "string" ? body.evidence : undefined,
  });
  return NextResponse.json(out);
}
