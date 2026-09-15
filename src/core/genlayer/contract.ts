/**
 * Live GenLayer "single work receipt" Intelligent Contract — the deployed
 * surface AgentRef now wires to.
 *
 * The live contract keeps ONE receipt at a time and judges it with GenLayer
 * validator consensus (no in-app AI):
 *
 *   create_receipt(brief, work, evidence, agent)
 *   challenge(reason, evidence)
 *   adjudicate()                       -> validators rule VERIFIED / NOT_VERIFIED
 *   get_receipt() -> "Status: … | Agent: … | Brief: … | Work: … | … | Score: … | Reason: …"
 *
 * The address below is PUBLIC and reading it needs no wallet and no key. This
 * module is deliberately pure (no SDK, no React) so the same parser that the
 * server route uses is unit-tested against the exact live get_receipt() format.
 */
import type { Ruling, Verdict } from "../types";

export const LIVE_CONTRACT = {
  /** Deployed on GenLayer Testnet — Bradbury (chain 4221). */
  address: "0x648a2C783d3ED63fF47E1d5A4C90AF4714931c6f",
  network: "testnet_bradbury",
  chainKey: "testnetBradbury",
  chainLabel: "Testnet — Bradbury",
  deployTxHash: "0x64519fc90c8a0960943158e33c8efb6e04890dd7d4d4ac7e896d7880ba26a5e5",
  methods: [
    "create_receipt(brief, work, evidence, agent)",
    "challenge(reason, evidence)",
    "adjudicate()",
    "get_receipt() -> string",
  ],
} as const;

export const EXPLORER_BASE = "https://explorer-bradbury.genlayer.com";

export function explorerTxUrl(txHash: string): string {
  return `${EXPLORER_BASE}/tx/${txHash}`;
}

/** The parsed view of a get_receipt() return. */
export interface OnchainReceiptRecord {
  /** Verbatim Status field, e.g. EMPTY | VERIFIED | NOT_VERIFIED. */
  status: string;
  agent: string;
  brief: string;
  work: string;
  /** Challenge description; null when the contract reports "No challenge". */
  challenge: string | null;
  hasChallenge: boolean;
  score: string;
  reason: string;
  /** The exact string get_receipt() returned. */
  raw: string;
}

export function emptyRecord(raw = ""): OnchainReceiptRecord {
  return {
    status: "",
    agent: "",
    brief: "",
    work: "",
    challenge: null,
    hasChallenge: false,
    score: "",
    reason: "",
    raw,
  };
}

/** Field keys get_receipt() emits (pipe-delimited, each value ends at the next " | "). */
const KEYED = ["Status:", "Agent:", "Brief:", "Work:", "Score:", "Reason:"] as const;

/** Statuses that mean "the contract has not ruled yet". */
const START_STATUSES = new Set(["", "EMPTY", "NOT_CREATED", "UNINITIALIZED", "INITIAL", "IDLE"]);

/**
 * Parse the live pipe-delimited get_receipt() string.
 *
 * The demo payloads are single-line per field; because values are separated by
 * " | " a value that itself contains " | " would split (a known contract
 * format limitation — reason text is written single-line on-chain).
 */
export function parseReceiptLine(raw: string): OnchainReceiptRecord {
  const out = emptyRecord(raw);
  if (!raw) return out;
  let line = raw.trim();
  // The SDK may wrap the returned string in quotes; peel one layer if present.
  if (line.length >= 2 && line.startsWith('"') && line.endsWith('"')) line = line.slice(1, -1);

  const value: Record<string, string> = {};
  const loose: string[] = [];
  for (const chunk of line.split(" | ")) {
    const t = chunk.trim();
    if (!t) continue;
    if (/^no challenge/i.test(t)) {
      value.challenge = "No challenge";
      continue;
    }
    if (t.startsWith("Challenge:")) {
      value.challenge = t.slice("Challenge:".length).trim();
      continue;
    }
    const keyed = KEYED.find((k) => t.startsWith(k));
    if (keyed) {
      value[keyed.slice(0, -1)] = t.slice(keyed.length).trim();
      continue;
    }
    loose.push(t); // a middle, un-prefixed challenge line
  }

  out.status = value["Status"] ?? "";
  out.agent = value["Agent"] ?? "";
  out.brief = value["Brief"] ?? "";
  out.work = value["Work"] ?? "";
  out.score = value["Score"] ?? "";
  out.reason = value["Reason"] ?? "";

  const challengeText = value["challenge"];
  const noChallenge = !!challengeText && /^no challenge/i.test(challengeText);
  const looseText = noChallenge ? "" : loose.join(" | ");
  out.hasChallenge = !noChallenge && (!!looseText || (!!challengeText && !noChallenge));
  if (out.hasChallenge) out.challenge = challengeText && !noChallenge ? challengeText : looseText || null;
  return out;
}

/** True when Status has moved past the "not started / not ruled yet" states. */
export function statusIsDecided(status: string): boolean {
  const st = (status ?? "").trim().toUpperCase();
  return !!st && !START_STATUSES.has(st);
}

/** Map the contract's coarse Status onto AgentRef's verdict vocabulary. */
export function verdictForStatus(status: string): Verdict | null {
  const st = (status ?? "").trim().toUpperCase();
  switch (st) {
    case "VERIFIED":
    case "PASSED":
    case "PASS":
      return "PASS";
    case "NOT_VERIFIED":
    case "FAILED":
    case "FAIL":
      return "FAIL";
    default:
      return null; // unknown / unmapped — never guess
  }
}

export interface OnchainVerdictMeta {
  receivedAt: string;
  /** Adjudication tx when this app signed it (absent on the shared read path). */
  transactionHash?: string;
  contractAddress?: string;
}

/**
 * Build an AgentRef Ruling from a live on-chain record. Returns null when the
 * contract's Status is not one we can map — we never guess a verdict.
 */
export function onchainRuling(record: OnchainReceiptRecord, meta: OnchainVerdictMeta): Ruling | null {
  const verdict = verdictForStatus(record.status);
  if (!verdict) return null;
  const passed = verdict === "PASS";
  const score = (record.score ?? "").trim();
  const reason = (record.reason ?? "").trim();
  const reasoning =
    reason ||
    (score
      ? `GenLayer validators returned ${record.status} (score ${score}).`
      : `GenLayer validators returned ${record.status}.`);
  return {
    verdict,
    briefFollowed: passed,
    requirementsMet: passed,
    materialRiskDisclosed: passed,
    failedRequirements: [],
    missedMaterialRisks: [],
    reasoning,
    source: "genlayer",
    receivedAt: meta.receivedAt,
    transactionHash: meta.transactionHash,
    contractAddress: meta.contractAddress,
    genlayerStatus: record.status,
    genlayerScore: score || undefined,
    explorerUrl: meta.transactionHash ? explorerTxUrl(meta.transactionHash) : undefined,
  };
}
