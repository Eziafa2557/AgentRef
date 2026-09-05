/**
 * GenLayer adapter — the REAL verification path.
 *
 * When the contract address is configured and genlayer-js is installed, these
 * functions submit the exact verification payload (src/core/verify/request.ts)
 * to the deployed AgentRefAdjudicator Intelligent Contract and read the
 * validator-consensus ruling back. When it is NOT configured, they return an
 * honest `not-configured` outcome — they never fabricate a ruling, transaction
 * hash or finality round.
 *
 * @verified-against — official docs surface:
 *   genlayer-js `createClient`, `createAccount`, `readContract({ address,
 *   functionName, args, transactionHashVariant })`, `writeContract`,
 *   `isSuccessful`, and chains exports (`localnet`, `studionet`). genlayer-js
 *   is NOT a dependency of this repo (it is optional), so these calls are
 *   reached via dynamic import only when configured.
 * @not-run-here — no network/credentials exist in this environment. The exact
 *   per-call parameter spellings marked ⚠ are written to the documented surface
 *   but must be confirmed against the installed SDK version on first live run.
 */
import type { Receipt, Ruling } from "../types";
import { buildVerificationRequest } from "../verify/request";
import { parseRulingJson } from "../verify/parser";
import { getGenLayerAccount, getGenLayerConfig } from "./config";

export type AdapterOutcome =
  | { status: "not-configured"; reason: string }
  | { status: "submitted"; challengeId: string; transactionHash?: string; note: string }
  | { status: "ruling"; challengeId: string; ruling: Ruling }
  | { status: "error"; message: string };

interface GenLayerJsModule {
  createClient: (opts: Record<string, unknown>) => any;
  createAccount: (privateKey?: string) => any;
  TransactionHashVariant?: { LATEST_FINAL: string };
  isSuccessful: (tx: unknown) => boolean;
}

interface ChainsModule {
  [key: string]: unknown;
}

async function loadSdk(): Promise<
  | { ok: true; sdk: GenLayerJsModule; chains: ChainsModule }
  | { ok: false; reason: string }
> {
  try {
    // webpackIgnore: genlayer-js is an OPTIONAL runtime dep. We never let the
    // bundler try to resolve it at build time — if it isn't installed this
    // import rejects at runtime and we fall back to the SIMULATED path.
    const sdkSpec = "genlayer-js";
    const chainsSpec = "genlayer-js/chains";
    const sdk = (await import(/* webpackIgnore: true */ sdkSpec)) as unknown as GenLayerJsModule;
    let chains: ChainsModule = {};
    try {
      chains = (await import(/* webpackIgnore: true */ chainsSpec)) as unknown as ChainsModule;
    } catch {
      chains = {};
    }
    return { ok: true, sdk, chains };
  } catch {
    return {
      ok: false,
      reason:
        "genlayer-js is not installed. Add it when you intend to verify on-chain (npm i genlayer-js); until then the app uses the SIMULATED adjudicator.",
    };
  }
}

function clientConfig(): { config: ReturnType<typeof getGenLayerConfig>; account: ReturnType<typeof getGenLayerAccount> } {
  return { config: getGenLayerConfig(), account: getGenLayerAccount() };
}

/** Read the consensus ruling for a challenge already on the contract. */
export async function readRuling(receipt: Receipt): Promise<AdapterOutcome> {
  const challenge = receipt.challenge;
  if (!challenge) return { status: "error", message: "No challenge to read a ruling for." };

  const { config, account } = clientConfig();
  if (config.kind !== "ready") return { status: "not-configured", reason: config.reason };
  const sdkLoad = await loadSdk();
  if (!sdkLoad.ok) return { status: "not-configured", reason: sdkLoad.reason };

  try {
    const chain = sdkLoad.chains[account.chainKey] ?? sdkLoad.chains.studionet;
    if (!chain) {
      return {
        status: "error",
        message: `Chain "${account.chainKey}" not exported by genlayer-js/chains.`,
      };
    }
    const client = sdkLoad.sdk.createClient({ chain });
    // ⚠ transactionHashVariant param — confirmed on docs; verify against SDK.
    const result = await client.readContract({
      address: config.contractAddress,
      functionName: "get_ruling",
      args: [challenge.id],
      transactionHashVariant: sdkLoad.sdk.TransactionHashVariant?.LATEST_FINAL ?? "LatestFinal",
    });
    const raw = typeof result === "string" ? result : JSON.stringify(result ?? "");
    if (!raw || raw === '""' || raw === "") {
      return {
        status: "error",
        message: "The contract has no ruling for this challenge yet (was it submitted?).",
      };
    }
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && typeof parsed.verdict === "undefined") {
      // result was already an object wrapper; unwrap string content if present
      return {
        status: "error",
        message: `Contract returned an unexpected shape: ${raw.slice(0, 120)}…`,
      };
    }
    const ruling = parseRulingJson(raw, "genlayer", {
      contractAddress: config.contractAddress,
    });
    return { status: "ruling", challengeId: challenge.id, ruling };
  } catch (e) {
    return { status: "error", message: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Submit the dispute to the contract. Requires a server-only signer key
 * (AGENTREF_ACCOUNT_PRIVATE_KEY) so the app never ships a key to the browser.
 * After finality, call `readRuling` to fetch the consensus verdict.
 */
export async function submitDispute(receipt: Receipt): Promise<AdapterOutcome> {
  const challenge = receipt.challenge;
  if (!challenge) return { status: "error", message: "No challenge to adjudicate." };

  const { config, account } = clientConfig();
  if (config.kind !== "ready") return { status: "not-configured", reason: config.reason };

  if (!account.privateKey) {
    return {
      status: "not-configured",
      reason:
        "No signer key (AGENTREF_ACCOUNT_PRIVATE_KEY) is set. Submitting a dispute needs a funded account on the target network; set it server-side only (see .env.example).",
    };
  }
  const sdkLoad = await loadSdk();
  if (!sdkLoad.ok) return { status: "not-configured", reason: sdkLoad.reason };

  const request = buildVerificationRequest(receipt); // throws if malformed — fine
  const payload = JSON.stringify(request, null, 2);

  try {
    const chain = sdkLoad.chains[account.chainKey] ?? sdkLoad.chains.studionet;
    if (!chain) return { status: "error", message: `Chain "${account.chainKey}" not exported.` };
    // ⚠ createAccount(privateKey) — verified no-arg form exists; confirm keyed form.
    const signer = sdkLoad.sdk.createAccount(account.privateKey);
    const client = sdkLoad.sdk.createClient({ chain, account: signer });

    const tx = await client.writeContract({
      address: config.contractAddress,
      functionName: "submit_dispute",
      args: [challenge.id, request.payloadHash, payload],
    });

    if (!sdkLoad.sdk.isSuccessful(tx)) {
      return { status: "error", message: "Submit transaction was not successful." };
    }
    const txHash: string | undefined =
      tx && typeof tx === "object"
        ? ((tx as { transactionHash?: string }).transactionHash ?? undefined)
        : undefined;
    return {
      status: "submitted",
      challengeId: challenge.id,
      transactionHash: txHash,
      note: "Dispute submitted — the contract records the consensus ruling on finality.",
    };
  } catch (e) {
    return { status: "error", message: e instanceof Error ? e.message : String(e) };
  }
}
