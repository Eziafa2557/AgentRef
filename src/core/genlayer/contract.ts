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
 * Status lifecycle written by the contract: EMPTY (never used) → OPEN
 * (create_receipt) → CHALLENGED (challenge) → VERIFIED / NOT_VERIFIED
 * (adjudicate). Only the last two are verdicts; the earlier three mean "no
 * ruling yet" and are treated as such by statusIsDecided.
 *
 * The address below is PUBLIC and reading it needs no wallet and no key. This
 * module is deliberately pure (no SDK, no React) so the same parser that the
 * server route uses is unit-tested against the exact live get_receipt() format.
 */
import type { Ruling, Verdict } from "../types";

/**
 * GenLayer **Studio Dev** — the network AgentRef targets (chain 61997).
 *
 * genlayer-js ships this as the `studioDevnet` chain export; its bundled RPC is
 * exactly https://studio-dev.genlayer.com/api. The export carries no block
 * explorer, so we attach the Studio Dev explorer ourselves. Studio chains use
 * the Studio consensus ABI, which requires genlayer-js >= 2.0.0-rc.1 (see
 * runtime.ts).
 */
export const STUDIO_DEV = {
  chainId: 61997,
  network: "studio_dev",
  /** genlayer-js/chains export name this network uses. */
  chainKey: "studioDevnet",
  chainLabel: "Studio Dev",
  explorerBase: "https://explorer-studio-dev.genlayer.com",
} as const;

/**
 * The deployed AgentRef single-receipt contract on Studio Dev.
 *
 * runtime.ts re-checks this address's schema on every read (CONTRACT_METHODS
 * below), so an address that does not actually hold AgentRef is reported
 * instead of silently returning an unrelated contract's state.
 */
export const LIVE_CONTRACT = {
  address: "0xaF982d37492368e03413DaCe68E8525bf97f822B",
  network: STUDIO_DEV.network,
  chainKey: STUDIO_DEV.chainKey,
  chainLabel: STUDIO_DEV.chainLabel,
  /** Deploy tx of the Studio Dev contract (explorer link). */
  deployTxHash: "0x815961aca415bc42301dd322a591ae3cbd2af10e8962dcfe93b289ed3f11a2af",
  methods: [
    "create_receipt(brief, work, evidence, agent)",
    "challenge(reason, evidence)",
    "adjudicate()",
    "get_receipt() -> string",
  ],
} as const;

/**
 * The contract surface AgentRef depends on, as the GenVM schema reports it.
 * runtime.ts refuses to interpret a contract that does not expose these, so a
 * wrong address fails loudly rather than reading an unrelated contract.
 */
export const CONTRACT_METHODS = {
  /** Read path — must exist and must be a view. */
  read: { name: "get_receipt", readonly: true, params: 0 },
  /** Write path — create_receipt → challenge → adjudicate. */
  writes: [
    { name: "create_receipt", params: 4 },
    { name: "challenge", params: 2 },
    { name: "adjudicate", params: 0 },
  ],
} as const;

export const EXPLORER_BASE = STUDIO_DEV.explorerBase;

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

/**
 * Statuses that mean "the contract has not ruled yet".
 *
 * OPEN and CHALLENGED are the deployed contract's own in-flight states
 * (create_receipt sets OPEN, challenge sets CHALLENGED); only adjudicate()
 * writes VERIFIED / NOT_VERIFIED. Treating them as undecided is what stops the
 * UI from reporting "the contract returned an unmapped status" while a dispute
 * is simply still mid-flight.
 */
const START_STATUSES = new Set([
  "",
  "EMPTY",
  "NOT_CREATED",
  "UNINITIALIZED",
  "INITIAL",
  "IDLE",
  "OPEN",
  "CHALLENGED",
]);

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
