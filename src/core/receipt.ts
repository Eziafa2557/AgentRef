import { hashJson, hashText } from "./hashing";
import { newReceiptId } from "./ids";
import type { Challenge, Receipt, Ruling, SettlementState } from "./types";

export interface NewReceiptInput {
  briefTitle: string;
  brief: string;
  requirements: string[];
  riskRequirements: string[];
  agentName: string;
  requesterName: string;
  workTitle: string;
  work: string;
  paymentAmountUsd: number;
  paymentAsset?: string;
  createdBy?: "demo" | "user";
  id?: string;
  seedId?: string;
}

/** Every corpus hash is recomputed at creation so tampering is detectable. */
export function createReceipt(input: NewReceiptInput): Receipt {
  if (!input.brief.trim() || !input.work.trim()) {
    throw new Error("A brief and submitted work are required to mint a receipt.");
  }
  const now = new Date().toISOString();
  const clean = (a: string[]) => a.map((s) => s.trim()).filter(Boolean);
  const requirements = clean(input.requirements);
  const riskRequirements = clean(input.riskRequirements);

  const corpus = {
    briefTitle: input.briefTitle.trim(),
    brief: input.brief.trim(),
    requirements,
    riskRequirements,
    workTitle: input.workTitle.trim(),
    work: input.work.trim(),
  };

  const receipt: Receipt = {
    id: input.id ?? newReceiptId(),
    briefTitle: corpus.briefTitle,
    brief: corpus.brief,
    requirements,
    riskRequirements,
    agentName: input.agentName.trim() || "Unnamed agent",
    requesterName: input.requesterName.trim() || "Unnamed requester",
    workTitle: corpus.workTitle,
    work: corpus.work,
    paymentAmountUsd: Math.max(0, input.paymentAmountUsd || 0),
    paymentAsset: input.paymentAsset ?? "USDC",
    createdAt: now,
    updatedAt: now,
    briefHash: hashText(corpus.brief),
    requirementHashes: requirements.map((r) => hashText(r)),
    riskRequirementHashes: riskRequirements.map((r) => hashText(r)),
    workHash: hashText(corpus.work),
    corpusHash: hashJson(corpus),
    settlement: "PENDING",
    settlementLog: [{ at: now, state: "PENDING", note: "Receipt created — escrow is pending." }],
    challenge: null,
    ruling: null,
    createdBy: input.createdBy ?? "user",
    seedId: input.seedId,
    synced: false,
  };
  return receipt;
}

/** High-level lifecycle derived from the stored state. */
export type Lifecycle = "OPEN" | "CHALLENGED" | "UNDER_REVIEW" | "SETTLED";

export function lifecycleOf(r: Receipt): Lifecycle {
  if (r.ruling) return "SETTLED";
  if (r.challenge) {
    return r.settlement === "UNDER_REVIEW" ? "UNDER_REVIEW" : "CHALLENGED";
  }
  return "OPEN";
}

export function canChallenge(r: Receipt): boolean {
  return !r.challenge && !r.ruling;
}

export function canVerify(r: Receipt): boolean {
  return !!r.challenge && !r.ruling;
}

/* ------------------------------------------------------------------ */
/* Integrity                                                           */
/* ------------------------------------------------------------------ */

export interface IntegrityReport {
  valid: boolean;
  checks: Array<{ label: string; ok: boolean; expected: string; found: string }>;
}

/**
 * Recompute every stored hash from current content and report mismatches.
 * Lets anyone holding a receipt confirm the challenged material corresponds
 * to what was originally submitted.
 */
export function verifyIntegrity(r: Receipt): IntegrityReport {
  const checks: IntegrityReport["checks"] = [];
  const cmp = (label: string, expected: string, found: string) => {
    checks.push({ label, ok: expected === found, expected, found });
    return expected === found;
  };

  cmp("brief", r.briefHash, hashText(r.brief));
  r.requirements.forEach((req, i) =>
    cmp(`requirement ${i + 1}`, r.requirementHashes[i] ?? "", hashText(req))
  );
  r.riskRequirements.forEach((risk, i) =>
    cmp(`risk requirement ${i + 1}`, r.riskRequirementHashes[i] ?? "", hashText(risk))
  );
  cmp("work", r.workHash, hashText(r.work));
  cmp(
    "corpus root",
    r.corpusHash,
    hashJson({
      briefTitle: r.briefTitle,
      brief: r.brief,
      requirements: r.requirements,
      riskRequirements: r.riskRequirements,
      workTitle: r.workTitle,
      work: r.work,
    })
  );

  if (r.challenge) {
    const c = r.challenge;
    const recomputed = hashJson({
      reason: c.reason,
      violatedRequirements: c.violatedRequirements,
      missedRiskRequirements: c.missedRiskRequirements,
      additionalContext: c.additionalContext,
      evidence: c.evidence.map((e) => ({ label: e.label, content: e.content, sha256: e.sha256 })),
    });
    cmp("challenge body", c.bodyHash, recomputed);
    c.evidence.forEach((ev, i) => cmp(`evidence ${i + 1} (${ev.label})`, ev.sha256, hashText(ev.content)));
  }

  return { valid: checks.every((c) => c.ok), checks };
}

/** Mutating convenience used by the store. */
export function touched(r: Receipt, patch: Partial<Receipt>): Receipt {
  return { ...r, ...patch, updatedAt: new Date().toISOString() };
}

export function withRuling(r: Receipt, ruling: Ruling): Receipt {
  return { ...r, ruling, updatedAt: new Date().toISOString() };
}

export function withChallenge(r: Receipt, challenge: Challenge): Receipt {
  return { ...r, challenge, updatedAt: new Date().toISOString() };
}

export function withSettlement(
  r: Receipt,
  state: SettlementState,
  note?: string
): Receipt {
  return {
    ...r,
    settlement: state,
    updatedAt: new Date().toISOString(),
    settlementLog: [
      ...r.settlementLog,
      { at: new Date().toISOString(), state, note: note ?? undefined },
    ],
  };
}
