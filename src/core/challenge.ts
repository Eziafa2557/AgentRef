import { hashJson, hashText } from "./hashing";
import { newChallengeId, newEvidenceId } from "./ids";
import { withChallenge, withSettlement } from "./receipt";
import type { Challenge, EvidenceItem, Receipt } from "./types";

export interface ChallengeInput {
  reason: string;
  /** Exact text of explicit requirements allegedly violated. */
  violatedRequirements: string[];
  /** Exact text of material-risk requirements allegedly missed. */
  missedRiskRequirements: string[];
  additionalContext: string;
  challengerName: string;
  /** Raw evidence captured from the challenger. */
  evidence: Array<{ label: string; content: string }>;
}

export class ChallengeError extends Error {}

/** A challenge is only legal against an OPEN (unchallenged, unrulled) receipt. */
export function assertCanChallenge(r: Receipt): void {
  if (r.ruling) throw new ChallengeError("This receipt is already settled.");
  if (r.challenge) throw new ChallengeError("This receipt already has a challenge.");
}

/**
 * Create a challenge and bind it to the receipt.
 *
 * The exact reason, referenced requirements, evidence and context are frozen:
 * every evidence item gets a content hash and the whole challenge payload gets
 * a body hash, so the record can later prove the material under review is the
 * material that was actually submitted (see `verifyIntegrity`).
 */
export function challengeReceipt(
  r: Receipt,
  input: ChallengeInput
): { receipt: Receipt; challenge: Challenge } {
  assertCanChallenge(r);
  const reason = input.reason.trim();
  if (!reason) throw new ChallengeError("A dispute reason is required.");

  const now = new Date().toISOString();
  const evidence: EvidenceItem[] = input.evidence
    .map((ev) => ({
      id: newEvidenceId(),
      label: ev.label.trim() || "Unlabelled evidence",
      content: ev.content,
      sha256: hashText(ev.content),
      addedAt: now,
    }))
    .filter((ev) => ev.content.trim().length > 0);

  const violatedRequirements = input.violatedRequirements.map((s) => s.trim()).filter(Boolean);
  const missedRiskRequirements = input.missedRiskRequirements.map((s) => s.trim()).filter(Boolean);
  const additionalContext = input.additionalContext.trim();

  const challenge: Challenge = {
    id: newChallengeId(),
    receiptId: r.id,
    reason,
    violatedRequirements,
    missedRiskRequirements,
    additionalContext,
    challengerName: input.challengerName.trim(),
    evidence,
    createdAt: now,
    bodyHash: hashJson({
      reason,
      violatedRequirements,
      missedRiskRequirements,
      additionalContext,
      evidence: evidence.map((e) => ({ label: e.label, content: e.content, sha256: e.sha256 })),
    }),
  };

  const receipt = withSettlement(
    withChallenge(r, challenge),
    "CHALLENGED",
    "Receipt challenged — evidence preserved, escrow remains pending."
  );
  return { receipt, challenge };
}
