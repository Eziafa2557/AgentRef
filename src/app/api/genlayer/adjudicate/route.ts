import { NextResponse } from "next/server";
import { ADJUDICATION_STEPS, adjudicateOnChain, adjudicateStep, isAdjudicationStep } from "@/core/genlayer/runtime";
import type { GenLayerOutcome } from "@/core/genlayer/runtime";

/**
 * One adjudication is THREE writes (create_receipt → challenge → adjudicate),
 * each awaited to FINALIZED, and each of those runs real validator consensus —
 * roughly 45s apiece.
 *
 * So the browser drives the writes one per request via `step`, and only the
 * whole-sequence form (no `step`, used by curl/scripts) needs a long budget.
 * A single request held open for all three is ~140s of idle connection, which
 * intermediaries cut or hold open indefinitely — the UI then spins forever and
 * a verdict that really is on-chain never reaches the page.
 *
 * 300s is Vercel's ceiling on Pro; Hobby caps lower and will still clamp it. The
 * route degrades honestly either way: a write that is submitted but not yet
 * finalized reports its transaction hash rather than claiming a verdict.
 */
export const maxDuration = 300;
export const dynamic = "force-dynamic";

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

  const args = {
    brief,
    work,
    reason,
    agent: typeof body.agent === "string" ? body.agent.trim() : "",
    evidence: Array.isArray(body.evidence) ? (body.evidence as Array<{ label?: string; content?: string }>) : typeof body.evidence === "string" ? body.evidence : undefined,
  };

  // An unknown step is a caller bug — reject it rather than silently running
  // the whole sequence, which would reintroduce the long request by accident.
  const step = typeof body.step === "string" ? body.step.trim() : "";
  if (step) {
    if (!isAdjudicationStep(step)) {
      return NextResponse.json(
        {
          status: "error",
          message: `Unknown step "${step}". Expected one of: ${ADJUDICATION_STEPS.join(", ")} — or omit step to run all three.`,
        } satisfies GenLayerOutcome,
        { status: 400 }
      );
    }
    return NextResponse.json(await adjudicateStep(step, args));
  }

  return NextResponse.json(await adjudicateOnChain(args));
}
