/**
 * GenLayer runtime — the REAL verification path (server-only).
 *
 * This module talks to a deployed AgentRefAdjudicator Intelligent Contract using
 * the real, installed genlayer-js SDK. It is imported ONLY by Next.js route
 * handlers (server side): the private signing key lives in a server-only env var
 * and never reaches the browser.
 *
 * Verified against the installed `genlayer-js@1.1.8` types:
 *   - createClient({ chain, account }) / createAccount(privateKey)
 *   - writeContract({ address, functionName, args, value })  (value REQUIRED on 1.1.8)
 *   - waitForTransactionReceipt({ hash, status, interval, retries })
 *   - readContract({ ..., transactionHashVariant: TransactionHashVariant.LATEST_FINAL })
 *   - success is judged from the transaction's statusName + txExecutionResultName
 *     (there is no isSuccessful() export on 1.1.8).
 *
 * @server-only — importing this module pulls genlayer-js + viem into the bundle,
 * so client components must go through the API routes in src/app/api/genlayer.
 */
import { createAccount, createClient } from "genlayer-js";
import { localnet, studionet, testnetAsimov, testnetBradbury } from "genlayer-js/chains";
import {
  ExecutionResult,
  TransactionHashVariant,
  TransactionStatus,
  type GenLayerTransaction,
  type Hash,
} from "genlayer-js/types";

import { getGenLayerAccount, getGenLayerConfig } from "./config";

export type GenLayerOutcome =
  | { status: "not-configured"; reason: string }
  | { status: "submitted"; challengeId: string; transactionHash: string; note: string }
  | { status: "ruling"; challengeId: string; rawRuling: string }
  | { status: "not-ready"; challengeId: string }
  | { status: "error"; message: string };

const CHAINS = { localnet, studionet, testnetAsimov, testnetBradbury };
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
    throw new Error("AGENTREF_ACCOUNT_PRIVATE_KEY must be a 64-hex 0x private key.");
  }
  return key as `0x${string}`;
}

function readyConfigOr(reason: string): { ok: true; config: Extract<ReturnType<typeof getGenLayerConfig>, { kind: "ready" }> } | { ok: false; reason: string } {
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
 * Submit a dispute to AgentRefAdjudicator.submit_dispute and wait for the
 * transaction to reach FINALIZED. Needs a funded signer key server-side.
 */
export async function submitDispute(args: {
  challengeId: string;
  payloadHash: string;
  payload: string;
}): Promise<GenLayerOutcome> {
  const { challengeId, payloadHash, payload } = args;
  if (!challengeId || !payloadHash || !payload) {
    return { status: "error", message: "challengeId, payloadHash and payload are all required." };
  }
  try {
    JSON.parse(payload);
  } catch {
    return { status: "error", message: "payload is not valid JSON." };
  }

  const ready = readyConfigOr(
    "GenLayer is not configured. Set NEXT_PUBLIC_AGENTREF_CONTRACT_ADDRESS (and NETWORK) to submit a real dispute."
  );
  if (!ready.ok) return { status: "not-configured", reason: ready.reason };

  const account = getGenLayerAccount();
  if (!account.privateKey) {
    return {
      status: "not-configured",
      reason:
        "No signer key (AGENTREF_ACCOUNT_PRIVATE_KEY) is set. Submitting a dispute needs a funded account on the target network; set it server-side only (see .env.example).",
    };
  }

  const chainPick = pickChain(ready.config.chainKey);
  if (!chainPick.ok) return { status: "error", message: chainPick.reason };

  try {
    const contractAddress = asAddress(ready.config.contractAddress);
    const signer = createAccount(asPrivateKey(account.privateKey));
    const client = createClient({ chain: chainPick.chain, account: signer });

    // value is REQUIRED by genlayer-js 1.1.8; 0n for a non-payable write.
    const txHash = (await client.writeContract({
      address: contractAddress,
      functionName: "submit_dispute",
      args: [challengeId, payloadHash, payload],
      value: 0n,
    })) as `0x${string}`;

    if (typeof txHash !== "string" || !txHash.startsWith("0x")) {
      return { status: "error", message: "submit_dispute did not return a transaction id." };
    }

    let receipt: GenLayerTransaction;
    try {
      receipt = await client.waitForTransactionReceipt({
        hash: txHash as Hash,
        status: TransactionStatus.FINALIZED,
        interval: 5_000,
        retries: 120, // up to ~10 min: consensus on a public testnet runs real validators
      });
    } catch (e) {
      // Docs: a timeout after writeContract is NOT proof of non-submission — the
      // tx id is live and can be polled later with readRuling / the explorer.
      return {
        status: "error",
        message: `Dispute ${challengeId} was submitted (${txHash}) but finalization timed out: ${
          e instanceof Error ? e.message : String(e)
        }. The contract may still finalize — read the ruling again in a moment.`,
      };
    }

    if (!finalizedSucceeded(receipt)) {
      return {
        status: "error",
        message: `submit_dispute did not succeed. statusName=${receipt.statusName ?? "?"}, txExecutionResultName=${receipt.txExecutionResultName ?? "?"} (tx ${txHash}).`,
      };
    }

    return {
      status: "submitted",
      challengeId,
      transactionHash: txHash,
      note: "Dispute accepted and finalized by GenLayer validators.",
    };
  } catch (e) {
    return { status: "error", message: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Read the consensus ruling for a challenge from AgentRefAdjudicator.get_ruling
 * at the latest FINAL round. Reading needs no account.
 */
export async function readRuling(args: { challengeId: string }): Promise<GenLayerOutcome> {
  const { challengeId } = args;
  if (!challengeId) return { status: "error", message: "challengeId is required." };

  const ready = readyConfigOr(
    "GenLayer is not configured. Set NEXT_PUBLIC_AGENTREF_CONTRACT_ADDRESS to read a real ruling."
  );
  if (!ready.ok) return { status: "not-configured", reason: ready.reason };

  const chainPick = pickChain(ready.config.chainKey);
  if (!chainPick.ok) return { status: "error", message: chainPick.reason };

  try {
    const contractAddress = asAddress(ready.config.contractAddress);
    const client = createClient({ chain: chainPick.chain });

    const res = (await client.readContract({
      address: contractAddress,
      functionName: "get_ruling",
      args: [challengeId],
      transactionHashVariant: TransactionHashVariant.LATEST_FINAL,
    })) as unknown;

    const raw = typeof res === "string" ? res : res == null ? "" : String(res);
    if (raw === "" || raw === '""') {
      return { status: "not-ready", challengeId };
    }
    const obj = JSON.parse(raw); // throws if the contract returned garbage
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
      return { status: "error", message: `Contract returned an unexpected ruling shape: ${raw.slice(0, 120)}…` };
    }
    return { status: "ruling", challengeId, rawRuling: raw };
  } catch (e) {
    return { status: "error", message: e instanceof Error ? e.message : String(e) };
  }
}
