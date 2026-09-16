/**
 * GenLayer runtime — the REAL adjudication path (server-only).
 *
 * Talks to the LIVE single-receipt Intelligent Contract (see ./contract.ts)
 * using the real, installed genlayer-js SDK:
 *
 *   adjudicateOnChain(): create_receipt → challenge → adjudicate (writes,
 *     signed by AGENTBEE_ACCOUNT_PRIVATE_KEY, each awaited to FINALIZED).
 *   readOnChainReceipt(): get_receipt() → parsed Status / Score / Reason.
 *     Reading needs NO key — the address is public.
 *
 * Imported ONLY by Next.js route handlers (server side): the private signing
 * key lives in a server-only env var and never reaches the browser.
 *
 * Verified against the installed `genlayer-js@2.0.0-rc.1` types:
 *   - createClient({ chain, account }) / createAccount(privateKey)
 *   - estimateTransactionFeesForWrite({ address, functionName, args, value })
 *     then writeContract({ address, functionName, args, value: 0n, fees })
 *     — the fee is NOT optional: a write without one is rejected by the chain
 *     with `FeeValueMustBeNonZero`, and simulateWriteContract will not reveal
 *     that, because simulation does not charge fees.
 *   - waitForTransactionReceipt({ hash, waitUntil: "finalized", interval, retries })
 *   - readContract({ ..., transactionHashVariant: TransactionHashVariant.LATEST_FINAL })
 *   - isSuccessful(transaction) judges success (exported only from >= 2.0.0-rc.1).
 *     It is the ONLY success check used — see writeSucceeded below for why a
 *     statusName guard must not be layered on top of it.
 *   - getContractSchema(address) — a POSITIONAL argument — verifies the contract
 *     surface we are about to call, so a mis-pointed address is reported rather
 *     than silently read.
 *
 * @server-only — importing this module pulls genlayer-js + viem into the bundle,
 * so client components must go through the API routes in src/app/api/genlayer.
 */
import { createAccount, createClient, isSuccessful } from "genlayer-js";
import { localnet, studioDevnet, studionet, testnetAsimov, testnetBradbury } from "genlayer-js/chains";
import {
  TransactionHashVariant,
  type GenLayerTransaction,
  type Hash,
} from "genlayer-js/types";

import { SIGNER_KEY_ENV_VARS, getGenLayerAccount, getGenLayerConfig } from "./config";
import {
  CONTRACT_METHODS,
  LIVE_CONTRACT,
  explorerTxUrl,
  parseReceiptLine,
  statusIsDecided,
  type OnchainReceiptRecord,
} from "./contract";

export type GenLayerOutcome =
  | { status: "not-configured"; reason: string }
  | { status: "adjudicated"; transactionHash: string; contractAddress: string; network: string; chainLabel: string; explorerUrl: string; note: string }
  | { status: "step-done"; step: AdjudicationStep; transactionHash: string; contractAddress: string; network: string; chainLabel: string; explorerUrl: string; note: string }
  | { status: "receipt"; record: OnchainReceiptRecord; contractAddress: string; network: string; chainLabel: string }
  | { status: "empty"; record: OnchainReceiptRecord; contractAddress: string; network: string; chainLabel: string; note: string }
  | { status: "error"; message: string };

const CHAINS = { localnet, studioDevnet, studionet, testnetAsimov, testnetBradbury };
type ChainKey = keyof typeof CHAINS;

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const PRIVATE_KEY_RE = /^0x[0-9a-fA-F]{64}$/;

function asAddress(addr: string): `0x${string}` {
  if (!ADDRESS_RE.test(addr)) {
    throw new Error(`Configured contract address is not a valid 0x address: ${addr.slice(0, 12)}…`);
  }
  return addr as `0x${string}`;
}

function asPrivateKey(key: string): `0x${string}` {
  if (!PRIVATE_KEY_RE.test(key)) {
    throw new Error(`${SIGNER_KEY_ENV_VARS[0]} must be a 64-hex 0x private key.`);
  }
  return key as `0x${string}`;
}

function readyConfigOr(
  reason: string
): { ok: true; config: Extract<ReturnType<typeof getGenLayerConfig>, { kind: "ready" }> } | { ok: false; reason: string } {
  const config = getGenLayerConfig();
  if (config.kind !== "ready") return { ok: false, reason: config.reason };
  return { ok: true, config };
}

function pickChain(chainKey: string): { ok: true; chain: (typeof CHAINS)[ChainKey] } | { ok: false; reason: string } {
  const chain = CHAINS[chainKey as ChainKey];
  if (!chain) {
    return {
      ok: false,
      reason: `Chain "${chainKey}" is not a known genlayer-js/chains export. Use one of: ${Object.keys(CHAINS).join(", ")}.`,
    };
  }
  return { ok: true, chain };
}

/**
 * Whether a write that reached FINALIZED actually succeeded.
 *
 * A transaction can be finalized with its execution having reverted, and a
 * reverted write must never be reported as a verdict — so this is checked
 * explicitly. `isSuccessful` is the SDK's own judgement of that, and it is the
 * ONLY check here.
 *
 * Do not add a `receipt.statusName === FINALIZED` guard alongside it. It reads
 * as harmless belt-and-braces and it is not: `waitForTransactionReceipt`
 * returns a *simplified* receipt by default, and that shape drops `statusName`
 * while keeping the numeric `status` (observed on Studio Dev: `status=7`,
 * `statusName=undefined`, `txExecutionResultName="FINISHED_WITH_RETURN"`). A
 * statusName guard therefore evaluates undefined-because-absent as
 * not-finalized and fails every genuinely successful write. `isSuccessful`
 * resolves the status itself — including the numeric form — so deferring to it
 * is both correct and the one place this judgement should live.
 *
 * Finalization itself needs no check: the `waitUntil: "finalized"` wait above
 * only returns once the transaction has reached it.
 */
export function writeSucceeded(receipt: GenLayerTransaction): boolean {
  return isSuccessful(receipt);
}

/**
 * Serialize challenge evidence into the single string the contract's
 * create_receipt/challenge `evidence` argument expects. Single source of truth
 * so a one-line tweak here changes every caller.
 */
export function evidenceText(items: Array<{ label?: string; content?: string }> | string | undefined): string {
  if (typeof items === "string") return items;
  if (!Array.isArray(items)) return "";
  return items
    .map((it) => {
      const label = (it?.label ?? "").trim();
      const content = (it?.content ?? "").trim();
      if (!content) return "";
      return label ? `[${label}]\n${content}` : content;
    })
    .filter(Boolean)
    .join("\n\n");
}

/** How long to keep polling a single write for finalization before giving up on it. */
const FINALIZATION_BUDGET_MS = 90_000;
const POLL_INTERVAL_MS = 5_000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Wait for a submitted write to reach FINALIZED, tolerating a flaky poll.
 *
 * `waitForTransactionReceipt` abandons the wait on the FIRST RPC error, and the
 * Studio RPC intermittently answers a poll with an HTML error page instead of
 * JSON — surfacing as `Unexpected token '<', "<!DOCTYPE "... is not valid JSON`.
 * Observed in production: the `adjudicate` write had been submitted and went on
 * to FINALIZE with FINISHED_WITH_RETURN, and the live contract did reach
 * NOT_VERIFIED, while the route told the user the adjudication had failed.
 *
 * A poll that errors says nothing about the transaction, so it must not be
 * believed. `retries: 1` keeps the SDK owning the status judgement while this
 * loop owns tolerance for transport errors.
 *
 * The budget is per write and deliberately under a third of the route's 300s
 * `maxDuration`: three writes that all burn their full budget stay inside the
 * function's declared limit instead of being killed mid-response.
 */
export async function waitForFinalized(
  client: ReturnType<typeof createClient>,
  txHash: string,
  functionName: string,
  opts: { intervalMs?: number; budgetMs?: number } = {}
): Promise<GenLayerTransaction> {
  const intervalMs = opts.intervalMs ?? POLL_INTERVAL_MS;
  const budgetMs = opts.budgetMs ?? FINALIZATION_BUDGET_MS;
  const deadline = Date.now() + budgetMs;
  let lastMessage = "";
  for (;;) {
    try {
      return await client.waitForTransactionReceipt({
        hash: txHash as Hash,
        waitUntil: "finalized", // `status` is deprecated in genlayer-js >= 2.0.0-rc.1
        interval: intervalMs,
        retries: 1,
      });
    } catch (e) {
      lastMessage = e instanceof Error ? e.message : String(e);
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `${functionName} was submitted (${txHash}) but finalization could not be confirmed within ` +
          `${Math.round(budgetMs / 1000)}s (last poll error: ${lastMessage}). ` +
          "That is a failure to CONFIRM, not proof the write failed — a submitted write can still finalize. " +
          "Check the transaction on the explorer, and re-read the receipt to see the contract's real state."
      );
    }
    await sleep(intervalMs);
  }
}

async function writeAndWait(
  client: ReturnType<typeof createClient>,
  contractAddress: `0x${string}`,
  functionName: string,
  args: string[]
): Promise<string> {
  // Quote the protocol fee for this exact call before signing it.
  //
  // A write with no fee is REJECTED by the chain — the node answers
  // `FeeValueMustBeNonZero(1)` and the transaction reverts. That failure is
  // invisible to simulateWriteContract, which does not charge fees, so a
  // simulation passing proves nothing about whether the real write will be
  // accepted; the estimate below is what makes the write payable.
  const fees = await client
    .estimateTransactionFeesForWrite({
      address: contractAddress,
      functionName,
      args,
      value: 0n,
    })
    .catch((e: unknown) => {
      throw new Error(
        `Could not quote the network fee for ${functionName}: ${e instanceof Error ? e.message : String(e)}. ` +
          "The write was NOT submitted."
      );
    });

  const txHash = (await client.writeContract({
    address: contractAddress,
    functionName,
    args,
    value: 0n, // no native token is transferred; the protocol fee is `fees` below
    fees: {
      distribution: fees.distribution,
      messageAllocations: fees.messageAllocations,
      feeValue: fees.feeValue,
    },
  })) as `0x${string}`;

  if (typeof txHash !== "string" || !txHash.startsWith("0x")) {
    throw new Error(`${functionName} did not return a transaction id.`);
  }

  const receipt = await waitForFinalized(client, txHash, functionName);

  if (!writeSucceeded(receipt)) {
    throw new Error(
      `${functionName} did not succeed. status=${receipt.status ?? "?"} (${receipt.statusName ?? "no statusName"}), ` +
        `txExecutionResult=${receipt.txExecutionResult ?? "?"} (${receipt.txExecutionResultName ?? "no txExecutionResultName"}) (tx ${txHash}).`
    );
  }
  return txHash as string;
}

/**
 * Assert the address really holds the AgentRef contract before calling it.
 *
 * The schema is the NODE's answer about the deployed code, not our assumption
 * about it. A contract built from a different source — Studio's hello_world
 * example, say — reports a different method set. Without this check the read
 * path would happily return that contract's state, and the UI would render the
 * blank it got back as "not adjudicated yet", which is a lie about the chain.
 *
 * Returns a human-readable problem, or null when the surface is right — or when
 * we could not obtain a schema at all. A transient schema-read failure must not
 * block a read that would otherwise work: we only reject on POSITIVE evidence
 * that the contract is the wrong one.
 */
async function agentRefSurfaceProblem(
  client: ReturnType<typeof createClient>,
  contractAddress: `0x${string}`
): Promise<string | null> {
  let methods: Record<string, { readonly?: boolean; params?: unknown[] }>;
  try {
    const schema = await client.getContractSchema(contractAddress);
    methods = (schema?.methods ?? {}) as typeof methods;
  } catch {
    return null; // could not verify — the call itself will report the real error
  }

  const required = [CONTRACT_METHODS.read.name, ...CONTRACT_METHODS.writes.map((w) => w.name)];
  const missing = required.filter((name) => !methods[name]);
  if (!Object.keys(methods).length) return null; // empty schema: nothing proven
  if (missing.length) {
    const found = Object.keys(methods);
    return (
      `The contract at ${contractAddress} does not expose ${missing.join(", ")}. ` +
      `It exposes: ${found.length ? found.join(", ") : "(no methods)"}. ` +
      "This address does not hold the AgentRef contract — check the deployed address."
    );
  }

  // get_receipt must be a VIEW: if it is a write, reading it would not return
  // the stored receipt and every read would look empty.
  if (methods[CONTRACT_METHODS.read.name]?.readonly !== true) {
    return `The contract at ${contractAddress} exposes ${CONTRACT_METHODS.read.name} as a write method, not a view — it is not the AgentRef contract.`;
  }
  return null;
}

export interface AdjudicateArgs {
  brief: string;
  work: string;
  reason: string;
  agent?: string;
  evidence?: Array<{ label?: string; content?: string }> | string;
}

/** The three writes the contract requires, in the order it requires them. */
export type AdjudicationStep = "create" | "challenge" | "adjudicate";

export const ADJUDICATION_STEPS: readonly AdjudicationStep[] = ["create", "challenge", "adjudicate"] as const;

export function isAdjudicationStep(v: string): v is AdjudicationStep {
  return (ADJUDICATION_STEPS as readonly string[]).includes(v);
}

/** Call arguments, already normalized to the strings the contract takes. */
export interface NormalizedArgs {
  brief: string;
  work: string;
  reason: string;
  agent: string;
  evidence: string;
}

/**
 * Which contract method a step calls, and with what.
 *
 * Pure and exported so the arity can be unit-tested: a wrong argument count is
 * a silent revert on-chain, which is an expensive way to find a typo.
 */
export function stepCallFor(step: AdjudicationStep, a: NormalizedArgs): [string, string[]] {
  switch (step) {
    case "create":
      return ["create_receipt", [a.brief, a.work, a.evidence, a.agent]];
    case "challenge":
      return ["challenge", [a.reason, a.evidence]];
    case "adjudicate":
      return ["adjudicate", []];
  }
}

interface Prepared {
  client: ReturnType<typeof createClient>;
  contractAddress: `0x${string}`;
  network: string;
  chainLabel: string;
  args: NormalizedArgs;
}

/**
 * Everything both entry points must do before signing: validate, resolve
 * config, find the key, pick the chain, and confirm the contract really is
 * AgentRef. Shared so the one-shot and step-wise paths cannot drift apart.
 */
async function prepareAdjudication(
  args: AdjudicateArgs
): Promise<{ ok: true; prepared: Prepared } | { ok: false; outcome: GenLayerOutcome }> {
  const { brief, work, reason } = args;
  if (!brief?.trim() || !work?.trim() || !reason?.trim()) {
    return { ok: false, outcome: { status: "error", message: "brief, work and reason are all required to adjudicate." } };
  }

  const ready = readyConfigOr("GenLayer is not configured.");
  if (!ready.ok) return { ok: false, outcome: { status: "not-configured", reason: ready.reason } };

  const account = getGenLayerAccount();
  if (!account.privateKey) {
    return {
      ok: false,
      outcome: {
        status: "not-configured",
        reason:
          `This deployment has no signer key (${SIGNER_KEY_ENV_VARS[0]}), so it cannot sign the on-chain writes. ` +
          "Set it server-side only (see .env.example) to adjudicate — or use the read-only path, which needs no key.",
      },
    };
  }

  const chainPick = pickChain(ready.config.chainKey);
  if (!chainPick.ok) return { ok: false, outcome: { status: "error", message: chainPick.reason } };

  try {
    const contractAddress = asAddress(ready.config.contractAddress);
    const signer = createAccount(asPrivateKey(account.privateKey));
    const client = createClient({ chain: chainPick.chain, account: signer });

    // Confirm the surface BEFORE signing anything: a write that cannot succeed
    // would burn fees and time only to fail at the call.
    const surfaceProblem = await agentRefSurfaceProblem(client, contractAddress);
    if (surfaceProblem) return { ok: false, outcome: { status: "error", message: surfaceProblem } };

    return {
      ok: true,
      prepared: {
        client,
        contractAddress,
        network: ready.config.network,
        chainLabel: ready.config.chainLabel,
        args: {
          brief: brief.trim(),
          work: work.trim(),
          reason: reason.trim(),
          agent: (args.agent ?? "").trim(),
          evidence: evidenceText(args.evidence),
        },
      },
    };
  } catch (e) {
    return { ok: false, outcome: { status: "error", message: e instanceof Error ? e.message : String(e) } };
  }
}

/**
 * Run ONE of the three writes and wait for it to finalize.
 *
 * Exists so the browser can drive the sequence as three short requests. Held
 * open as a single request, the full sequence is ~140s of idle connection —
 * each write waits for FINALIZED — which intermediaries cut or hold open
 * indefinitely, leaving the UI spinning forever while the verdict, really
 * on-chain, never reaches the page.
 */
export async function adjudicateStep(step: AdjudicationStep, args: AdjudicateArgs): Promise<GenLayerOutcome> {
  const prep = await prepareAdjudication(args);
  if (!prep.ok) return prep.outcome;
  const { client, contractAddress, network, chainLabel, args: normalized } = prep.prepared;

  try {
    const [functionName, callArgs] = stepCallFor(step, normalized);
    const transactionHash = await writeAndWait(client, contractAddress, functionName, callArgs);
    return {
      status: "step-done",
      step,
      transactionHash,
      contractAddress,
      network,
      chainLabel,
      explorerUrl: explorerTxUrl(transactionHash),
      note: `${functionName} finalized on-chain.`,
    };
  } catch (e) {
    return { status: "error", message: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Run the full on-chain judgement for the single-receipt contract:
 * create_receipt(brief, work, evidence, agent) → challenge(reason, evidence) →
 * adjudicate(), each write awaited to FINALIZED. Needs a funded signer key.
 *
 * Kept for callers that want the whole sequence in one request (curl, scripts).
 * The browser drives `adjudicateStep` three times instead — see its note on why
 * one long request is the wrong shape.
 */
export async function adjudicateOnChain(args: AdjudicateArgs): Promise<GenLayerOutcome> {
  const prep = await prepareAdjudication(args);
  if (!prep.ok) return prep.outcome;
  const { client, contractAddress, network, chainLabel, args: normalized } = prep.prepared;

  try {
    // adjudicate() is the write that makes validators rule, so its transaction
    // is the provenance we report.
    let adjudicateTx = "";
    for (const step of ADJUDICATION_STEPS) {
      const [functionName, callArgs] = stepCallFor(step, normalized);
      adjudicateTx = await writeAndWait(client, contractAddress, functionName, callArgs);
    }

    return {
      status: "adjudicated",
      transactionHash: adjudicateTx,
      contractAddress,
      network,
      chainLabel,
      explorerUrl: explorerTxUrl(adjudicateTx),
      note: "Receipt created, challenged and adjudicated by GenLayer validator consensus.",
    };
  } catch (e) {
    return { status: "error", message: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Read the live contract's get_receipt() at the latest FINAL round and parse
 * Status / Score / Reason. Reading needs NO account — the address is public.
 */
export async function readOnChainReceipt(): Promise<GenLayerOutcome> {
  const ready = readyConfigOr("GenLayer is not configured.");
  if (!ready.ok) return { status: "not-configured", reason: ready.reason };

  const chainPick = pickChain(ready.config.chainKey);
  if (!chainPick.ok) return { status: "error", message: chainPick.reason };

  try {
    const contractAddress = asAddress(ready.config.contractAddress);
    const client = createClient({ chain: chainPick.chain });

    // Never interpret a contract we have not confirmed is AgentRef.
    const surfaceProblem = await agentRefSurfaceProblem(client, contractAddress);
    if (surfaceProblem) return { status: "error", message: surfaceProblem };

    const res = (await client.readContract({
      address: contractAddress,
      functionName: "get_receipt",
      args: [],
      transactionHashVariant: TransactionHashVariant.LATEST_FINAL,
    })) as unknown;

    const raw = typeof res === "string" ? res : res == null ? "" : String(res);
    const record = parseReceiptLine(raw);
    const base = { record, contractAddress, network: ready.config.network, chainLabel: ready.config.chainLabel };

    if (!statusIsDecided(record.status)) {
      return {
        status: "empty",
        ...base,
        note: `The contract has not adjudicated a verdict yet (Status: ${record.status || "EMPTY"}).`,
      };
    }
    return { status: "receipt", ...base };
  } catch (e) {
    return { status: "error", message: e instanceof Error ? e.message : String(e) };
  }
}
