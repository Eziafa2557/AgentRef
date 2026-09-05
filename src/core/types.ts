/**
 * AgentRef core domain types.
 *
 * The whole product is built around ONE persisted artifact — the Work
 * Receipt — which accumulates: the brief, the submitted work, any challenge,
 * its evidence, the verification request, and the ruling. Everything a viewer
 * needs to reconstruct a dispute lives on this object, which is what makes a
 * receipt a shareable "public record" rather than a log line.
 */

/* ------------------------------------------------------------------ */
/* Verdicts & settlement                                               */
/* ------------------------------------------------------------------ */

export const VERDICTS = ["PASS", "FAIL", "PASS_WITH_MATERIAL_RISK"] as const;
export type Verdict = (typeof VERDICTS)[number];

/**
 * Settlement state machine (spec §8). Transitions:
 *   PENDING ──challenge──▶ CHALLENGED ──submit──▶ UNDER_REVIEW ──ruling──▶ PASSED | FAILED
 *   PASSED ────────────────────────────────────────────────────────────▶ RELEASED
 *   FAILED ─────────────────────────────────────────────────────────────▶ LOCKED
 *   PASS_WITH_MATERIAL_RISK → PASSED (qualified) then RELEASED, with the
 *   missed material risk surfaced prominently. `RELEASED`/`LOCKED` are the
 *   simulated escrow outcomes — never a real transfer.
 */
export type SettlementState =
  | "PENDING"
  | "CHALLENGED"
  | "UNDER_REVIEW"
  | "PASSED"
  | "FAILED"
  | "RELEASED"
  | "LOCKED";

/** Where a ruling actually came from. Never blurred in the UI. */
export type VerificationSource = "genlayer" | "simulated";

export interface SettlementLogEntry {
  at: string;
  state: SettlementState;
  note?: string;
}

/* ------------------------------------------------------------------ */
/* Evidence                                                            */
/* ------------------------------------------------------------------ */

export interface EvidenceItem {
  id: string;
  label: string;
  /** Raw text captured at challenge time (verbatim submission). */
  content: string;
  /** SHA-256 of `content` — recomputable, detects silent edits. */
  sha256: string;
  addedAt: string;
}

/* ------------------------------------------------------------------ */
/* Challenge & ruling                                                  */
/* ------------------------------------------------------------------ */

export interface Challenge {
  id: string; // CHL-…
  receiptId: string; // REF-…
  /** Dispute reason (the challenger's case). */
  reason: string;
  /**
   * Exact text of the explicit requirements the challenger alleges were
   * violated — snapshotted from the brief so later brief edits can't blur
   * what was challenged.
   */
  violatedRequirements: string[];
  /** Exact text of material-risk requirements allegedly missed. */
  missedRiskRequirements: string[];
  additionalContext: string;
  /** Self-attested challenger label (never verified identity). */
  challengerName: string;
  evidence: EvidenceItem[];
  createdAt: string;
  /** Hash over the canonical challenge payload — the challenge is immutable. */
  bodyHash: string;
}

export interface Ruling {
  verdict: Verdict;
  /** Did the submitted work follow the original brief? */
  briefFollowed: boolean;
  /** Were the explicit requirements satisfied? */
  requirementsMet: boolean;
  /** Were material risks disclosed where the brief required them? */
  materialRiskDisclosed: boolean;
  /** Explicit requirements the adjudicator found violated. */
  failedRequirements: string[];
  /** Material risks the adjudicator found undisclosed/missed. */
  missedMaterialRisks: string[];
  /** Human-readable explanation of WHY. */
  reasoning: string;
  source: VerificationSource;
  receivedAt: string;
  /** GenLayer provenance — present ONLY when source === "genlayer". */
  transactionHash?: string;
  contractAddress?: string;
  /** Latest finalized block/round the ruling was read at. */
  finalizedRound?: number;
}

/* ------------------------------------------------------------------ */
/* The Work Receipt                                                    */
/* ------------------------------------------------------------------ */

export interface Receipt {
  id: string; // REF-…
  briefTitle: string;
  /** The original brief, verbatim. */
  brief: string;
  /** Explicit requirements the agent must satisfy. */
  requirements: string[];
  /** Material-risk requirements (disclosures the brief demands). */
  riskRequirements: string[];
  /** Self-attested agent label, where available. Never verified identity. */
  agentName: string;
  /** Self-attested requester label, where available. */
  requesterName: string;
  workTitle: string;
  /** The submitted work / advice, verbatim. */
  work: string;
  paymentAmountUsd: number;
  /** Payment unit label (demo convention — no real escrow). */
  paymentAsset: string;
  createdAt: string;
  updatedAt: string;

  /* Evidence integrity — every corpus piece hashed at creation. */
  briefHash: string;
  requirementHashes: string[];
  riskRequirementHashes: string[];
  workHash: string;
  /** Root hash of the canonical dispute corpus (brief+reqs+risks+work). */
  corpusHash: string;

  /* Lifecycle. */
  settlement: SettlementState;
  settlementLog: SettlementLogEntry[];
  challenge: Challenge | null;
  ruling: Ruling | null;

  /** Provenance of the record itself (demo seed vs. user-created). */
  createdBy: "demo" | "user";
  /** Stable key for demo seeds / optional server sync. */
  seedId?: string;
  /** Best-effort sync marker (server store). */
  synced?: boolean;
}

/* ------------------------------------------------------------------ */
/* Verification payloads (GenLayer adapter boundary)                   */
/* ------------------------------------------------------------------ */

/** Structured dispute handed to an adjudicator (simulated or GenLayer). */
export interface VerificationRequest {
  receiptId: string;
  challengeId: string;
  briefTitle: string;
  brief: string;
  requirements: string[];
  riskRequirements: string[];
  workTitle: string;
  work: string;
  challengeReason: string;
  violatedRequirements: string[];
  missedRiskRequirements: string[];
  evidence: Array<{ label: string; content: string; sha256: string }>;
  requestedAt: string;
  /** Payload hash — sent with the request so the ruling can name it. */
  payloadHash: string;
}

/**
 * The structured verdict schema we ask validators to produce. This is the
 * machine-readable contract between the adjudicator and the parser; the
 * GenLayer Intelligent Contract reproduces this exact shape (see
 * genlayer/contract.py) so a ruling is directly usable by the app.
 */
export interface RulingSchema {
  verdict: Verdict;
  brief_followed: boolean;
  requirements_met: boolean;
  material_risk_disclosed: boolean;
  failed_requirements: string[];
  missed_material_risks: string[];
  reasoning: string;
}

/** Adjudicator configuration state. */
export type GenLayerConfigStatus =
  | { kind: "not-configured"; reason: string }
  | { kind: "ready"; network: string; contractAddress: string; chainLabel: string };
