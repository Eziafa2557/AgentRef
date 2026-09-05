import { hashJson } from "../hashing";
import type { Receipt, VerificationRequest } from "../types";

export class VerificationError extends Error {}

/**
 * Build the exact, immutable dispute payload sent to an adjudicator.
 *
 * The payload is fully derived from the receipt + its challenge (evidence
 * included verbatim with hashes), then fingerprinted. The fingerprint lets the
 * app confirm the material a ruling references is the material that was sent —
 * nothing is reconstructed ad hoc at verification time.
 */
export function buildVerificationRequest(r: Receipt): VerificationRequest {
  const c = r.challenge;
  if (!c) throw new VerificationError("Cannot build a verification request with no challenge.");

  const core = {
    receiptId: r.id,
    challengeId: c.id,
    briefTitle: r.briefTitle,
    brief: r.brief,
    requirements: r.requirements,
    riskRequirements: r.riskRequirements,
    workTitle: r.workTitle,
    work: r.work,
    challengeReason: c.reason,
    violatedRequirements: c.violatedRequirements,
    missedRiskRequirements: c.missedRiskRequirements,
    evidence: c.evidence.map((e) => ({ label: e.label, content: e.content, sha256: e.sha256 })),
  };

  const payloadHash = hashJson(core);
  return {
    ...core,
    requestedAt: new Date().toISOString(),
    payloadHash,
  };
}
