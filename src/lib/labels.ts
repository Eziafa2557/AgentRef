/**
 * Visual language for domain states. Pure mappings so pages stay consistent:
 * every settlement state and verdict renders the same pill/colour everywhere.
 */
import type { BadgeTone } from "../components/ui";
import type { SettlementState, Verdict } from "../core/types";

export const SETTLE_META: Record<SettlementState, { label: string; tone: BadgeTone; blurb: string }> = {
  PENDING: {
    label: "Pending",
    tone: "neutral",
    blurb: "Escrow held. The buyer can still challenge the delivery.",
  },
  CHALLENGED: {
    label: "Challenged",
    tone: "amber",
    blurb: "Dispute raised — evidence preserved, escrow still held.",
  },
  UNDER_REVIEW: {
    label: "Under review",
    tone: "cyan",
    blurb: "Submitted to an adjudicator. A ruling is pending.",
  },
  PASSED: {
    label: "Passed",
    tone: "pass",
    blurb: "Adjudicator ruled in favour of the work.",
  },
  FAILED: {
    label: "Failed",
    tone: "fail",
    blurb: "Adjudicator ruled against the work.",
  },
  RELEASED: {
    label: "Released",
    tone: "emerald",
    blurb: "Escrow released to the agent (simulated settlement).",
  },
  LOCKED: {
    label: "Locked",
    tone: "rose",
    blurb: "Escrow locked / returned to the buyer (simulated settlement).",
  },
};

export const VERDICT_META: Record<Verdict, { label: string; tone: BadgeTone; headline: string; detail: string }> = {
  PASS: {
    label: "PASS",
    tone: "pass",
    headline: "The work held up.",
    detail: "The submitted work follows the brief and satisfies the explicit requirements.",
  },
  FAIL: {
    label: "FAIL",
    tone: "fail",
    headline: "The work did not hold up.",
    detail: "The submitted work materially violates an explicit requirement of the brief.",
  },
  PASS_WITH_MATERIAL_RISK: {
    label: "PASS · MATERIAL RISK",
    tone: "risk",
    headline: "Passed, with a material risk on record.",
    detail:
      "The work satisfied the explicit requirements but failed to disclose a material risk the brief demanded.",
  },
};

export const lifeToneFor = (state: SettlementState): BadgeTone => SETTLE_META[state].tone;
export const lifeLabelFor = (state: SettlementState): string => SETTLE_META[state].label;
