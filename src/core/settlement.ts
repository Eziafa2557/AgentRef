import type { Receipt, Ruling, SettlementState, Verdict } from "./types";

export class SettlementError extends Error {}

function guard(r: Receipt, legal: SettlementState[], action: string): void {
  if (r.ruling) throw new SettlementError(`Already settled — cannot ${action}.`);
  if (!legal.includes(r.settlement)) {
    throw new SettlementError(
      `Cannot ${action} from state "${r.settlement}" (expected ${legal.join(" or ")}).`
    );
  }
}

/** PENDING → CHALLENGED (a challenge now exists). */
export function markChallenged(r: Receipt): Receipt {
  guard(r, ["PENDING"], "challenge");
  return {
    ...r,
    settlement: "CHALLENGED",
    updatedAt: new Date().toISOString(),
    settlementLog: [
      ...r.settlementLog,
      { at: new Date().toISOString(), state: "CHALLENGED", note: "Under dispute." },
    ],
  };
}

/** CHALLENGED → UNDER_REVIEW (submitted to an adjudicator). */
export function markUnderReview(r: Receipt): Receipt {
  guard(r, ["CHALLENGED"], "submit for verification");
  return {
    ...r,
    settlement: "UNDER_REVIEW",
    updatedAt: new Date().toISOString(),
    settlementLog: [
      ...r.settlementLog,
      { at: new Date().toISOString(), state: "UNDER_REVIEW", note: "Verification requested." },
    ],
  };
}

export interface VerdictPolicy {
  verdictState: SettlementState; // PASSED | FAILED
  finalState: SettlementState; // RELEASED | LOCKED
  note: string;
}

/**
 * Product settlement policy. GenLayer returns the *verdict*; this function maps
 * it to escrow outcomes (RELEASED / LOCKED — simulated in the MVP):
 *
 *   PASS                        → PASSED → RELEASED
 *   FAIL                        → FAILED → LOCKED
 *   PASS_WITH_MATERIAL_RISK     → PASSED → RELEASED, with the missed risk
 *                                surfaced (qualified release)
 */
export function policyForVerdict(v: Verdict, missedCount: number): VerdictPolicy {
  switch (v) {
    case "PASS":
      return {
        verdictState: "PASSED",
        finalState: "RELEASED",
        note: "PASS — work satisfies the brief. Escrow released (simulated).",
      };
    case "FAIL":
      return {
        verdictState: "FAILED",
        finalState: "LOCKED",
        note: "FAIL — work materially deviates from the brief. Escrow locked.",
      };
    case "PASS_WITH_MATERIAL_RISK":
      return {
        verdictState: "PASSED",
        finalState: "RELEASED",
        note: `PASS WITH MATERIAL RISK — work followed the brief but ${
          missedCount > 0
            ? `${missedCount} required material risk${missedCount > 1 ? "s" : ""} went undisclosed`
            : "a material risk was flagged"
        }. Payment released with the risk recorded for follow-up.`,
      };
  }
}

/**
 * Apply a ruling: freeze it on the receipt and advance the settlement machine.
 * The verdict state (PASSED/FAILED) is logged first, then the escrow outcome.
 */
export function applyRuling(r: Receipt, ruling: Ruling): Receipt {
  if (r.ruling) throw new SettlementError("A ruling is already recorded.");
  if (!r.challenge) throw new SettlementError("Cannot rule on a receipt with no challenge.");
  if (r.settlement !== "UNDER_REVIEW" && r.settlement !== "CHALLENGED") {
    throw new SettlementError(`Cannot apply a ruling from state "${r.settlement}".`);
  }

  const policy = policyForVerdict(ruling.verdict, ruling.missedMaterialRisks.length);
  const now = new Date().toISOString();
  return {
    ...r,
    ruling,
    settlement: policy.finalState,
    updatedAt: now,
    settlementLog: [
      ...r.settlementLog,
      { at: now, state: policy.verdictState, note: `Ruling: ${ruling.verdict}.` },
      { at: now, state: policy.finalState, note: policy.note },
    ],
  };
}
