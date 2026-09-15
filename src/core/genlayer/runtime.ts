/**
 * GenLayer runtime — the REAL adjudication path (server-only).
 *
 * Talks to the deployed single-receipt Intelligent Contract (see ./contract.ts)
 * on **GenLayer Studio Next** (chain 61997) using the real, installed
 * genlayer-js SDK:
 *
 *   adjudicateOnChain(): create_receipt → challenge → adjudicate (writes,
 *     signed by the server-only signer key, each awaited to FINALIZED).
 *   readOnChainReceipt(): get_receipt() → parsed Status / Score / Reason.
 *     Reading needs NO key — the address is public.
 *
 * Imported ONLY by Next.js route handlers (server side): the private signing
 * key lives in a server-only env var and never reaches the browser.
 *
 * Verified against the installed `genlayer-js@2.0.0-rc.1` types:
 *   - createClient({ chain, account }) / createAccount(privateKey)
 *   - writeContract({ address, functionName, args, value })
 *   - waitForTransactionReceipt({ hash, waitUntil, interval, retries })
 *     (`status` is deprecated on this version in favour of waitUntil)
 *   - readContract({ ..., transactionHashVariant: TransactionHashVariant.LATEST_FINAL })
 *   - success is judged from the transaction's statusName + txExecutionResultName
 *
 * Studio chains run the Studio consensus ABI (addTransaction(_params) plus
 * deploySalted / topUpFees). Only genlayer-js >= 2.0.0-rc.1 ships it, which is
 * why this package is pinned to the RC rather than 1.1.x.
 *
 * @server-only — importing this module pulls genlayer-js + viem into the bundle,
 * so client components must go through the API routes in src/app/api/genlayer.
 */
import { createAccount, createClient } from "genlayer-js";
import { localnet, studionet, studioDevnet, testnetAsimov, testnetBradbury } from "genlayer-js/chains";
import {
  ExecutionResult,
  TransactionHashVariant,
  TransactionStatus,
  type GenLayerTransaction,
  type Hash,
} from "genlayer-js/types";

import { SIGNER_KEY_ENV_VARS, getGenLayerAccount, getGenLayerConfig } from "./config";
import { STUDIO_NEXT, explorerTxUrl, parseReceiptLine, statusIsDecided, type OnchainReceiptRecord } from "./contract";

export type GenLayerOutcome =
  | { status: "not-configured"; reason: string }
  | { status: "adjudicated"; transactionHash: string; contractAddress: string; network: string; chainLabel: string; explorerUrl: string; note: string }
  | { status: "receipt"; record: OnchainReceiptRecord; contractAddress: string; network: string; chainLabel: string }
  | { status: "empty"; record: OnchainReceiptRecord; contractAddress: string; network: string; chainLabel: string; note: string }
  | { status: "error"; message: string };

/**
 * Studio Next as a client-ready chain: the SDK's `studioDevnet` (same chain id)
 * repointed at the operator-specified RPC and given the Studio Dev explorer,
 * which the SDK leaves undefined because it doesn't index preview deployments.
 *
 * Exported so tests can assert the overrides without dialing out.
 */
export const studioNext = {
  ...studioDevnet,
  name: STUDIO_NEXT.chainLabel,
  rpcUrls: { default: { http: [STUDIO_NEXT.rpcUrl] } },
  blockExplorers: {
    default: { name: "GenLayer Studio Dev Explorer", url: STUDIO_NEXT.explorerBase },
  },
};

const CHAINS = { localnet, studionet, studioDevnet: studioNext, testnetAsimov, testnetBradbury };
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

function finalizedSucceeded(receipt: GenLayerTransaction): boolean {
  const status = receipt.statusName;
  if (status !== TransactionStatus.FINALIZED && status !== TransactionStatus.ACCEPTED) return false;
  // A write that reverted reports FINISHED_WITH_ERROR. A normal return (even a
  // Python `None`) reports FINISHED_WITH_RETURN (or is absent on older nodes).
  return receipt.txExecutionResultName !== ExecutionResult.FINISHED_WITH_ERROR;
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

async function writeAndWait(
  client: ReturnType<typeof createClient>,
  contractAddress: `0x${string}`,
  functionName: string,
  args: string[]
): Promise<string> {
  const txHash = (await client.writeContract({
    address: contractAddress,
    functionName,
    args,
    value: 0n, // required by genlayer-js 1.1.8 for a non-payable write
  })) as `0x${string}`;

  if (typeof txHash !== "string" || !txHash.startsWith("0x")) {
    throw new Error(`${functionName} did not return a transaction id.`);
  }

  let receipt: GenLayerTransaction;
  try {
    receipt = await client.waitForTransactionReceipt({
      hash: txHash as Hash,
      // waitUntil replaces the deprecated `status` arg on genlayer-js 2.x.
      waitUntil: "finalized",
      interval: 5_000,
      retries: 120, // up to ~10 min: consensus on a public network runs real validators
    });
  } catch (e) {
    throw new Error(
      `${functionName} was submitted (${txHash}) but finalization timed out: ${e instanceof Error ? e.message : String(e)}. ` +
        "The contract may still finalize — check the transaction on the explorer."
    );
  }

  if (!finalizedSucceeded(receipt)) {
    throw new Error(
      `${functionName} did not succeed. statusName=${receipt.statusName ?? "?"}, txExecutionResultName=${receipt.txExecutionResultName ?? "?"} (tx ${txHash}).`
    );
  }
  return txHash as string;
}

export interface AdjudicateArgs {
  brief: string;
  work: string;
  reason: string;
  agent?: string;
  evidence?: Array<{ label?: string; content?: string }> | string;
}

/**
 * Run the full on-chain judgement for the single-receipt contract:
 * create_receipt(brief, work, evidence, agent) → challenge(reason, evidence) →
 * adjudicate(), each write awaited to FINALIZED. Needs a funded signer key.
 */
export async function adjudicateOnChain(args: AdjudicateArgs): Promise<GenLayerOutcome> {
  const { brief, work, reason } = args;
  if (!brief?.trim() || !work?.trim() || !reason?.trim()) {
    return { status: "error", message: "brief, work and reason are all required to adjudicate." };
  }
  const ev = evidenceText(args.evidence);
  const agent = (args.agent ?? "").trim();

  const ready = readyConfigOr("GenLayer is not configured.");
  if (!ready.ok) return { status: "not-configured", reason: ready.reason };

  const account = getGenLayerAccount();
  if (!account.privateKey) {
    return {
      status: "not-configured",
      reason:
        `This deployment has no signer key (${SIGNER_KEY_ENV_VARS[0]}), so it cannot sign the on-chain writes. ` +
        "Set it server-side only (see .env.example) to adjudicate — or use the read-only path, which needs no key.",
    };
  }

  const chainPick = pickChain(ready.config.chainKey);
  if (!chainPick.ok) return { status: "error", message: chainPick.reason };

  try {
    const contractAddress = asAddress(ready.config.contractAddress);
    const signer = createAccount(asPrivateKey(account.privateKey));
    const client = createClient({ chain: chainPick.chain, account: signer });

    // One adjudication = three writes; adjudicate() is the one that makes
    // validators rule, so its transaction is the provenance we show.
    const calls: Array<[string, string[]]> = [
      ["create_receipt", [brief, work, ev, agent]],
      ["challenge", [reason, ev]],
      ["adjudicate", []],
    ];
    let adjudicateTx = "";
    for (const [fn, callArgs] of calls) {
      adjudicateTx = await writeAndWait(client, contractAddress, fn, callArgs);
    }

    return {
      status: "adjudicated",
      transactionHash: adjudicateTx,
      contractAddress,
      network: ready.config.network,
      chainLabel: ready.config.chainLabel,
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
