/**
 * GenLayer wiring config.
 *
 * AgentRef runs WITHOUT any GenLayer credentials out of the box: the app uses
 * the transparently-labelled SIMULATED adjudicator (src/core/evaluate.ts) until
 * a contract is deployed and these variables are provided. When they are set,
 * the adapter (./adapter.ts) uses the real genlayer-js client — and the UI
 * labels rulings source: "genlayer".
 *
 * Env reference (see .env.example):
 *   NEXT_PUBLIC_AGENTREF_CONTRACT_ADDRESS   deployed AgentRefAdjudicator address
 *   NEXT_PUBLIC_AGENTREF_NETWORK            localnet | testnet_bradbury | studionet
 *   NEXT_PUBLIC_AGENTREF_CHAIN_KEY          genlayer-js/chains export name (studionet)
 *   AGENTREF_ACCOUNT_PRIVATE_KEY            server-only signer key (never exposed)
 */
import type { GenLayerConfigStatus } from "../types";

const has = (v?: string): boolean => !!v && v.trim().length > 0;

/** Server-only env — safe to touch non-NEXT_PUBLIC_* vars. */
function serverEnv(): NodeJS.ProcessEnv | undefined {
  return typeof window === "undefined" ? process.env : undefined;
}

function chainLabelFor(network: string): string {
  if (network === "localnet") return "Local — GenLayer Studio";
  if (network === "testnet_bradbury") return "Testnet — Bradbury";
  if (network === "studionet") return "Studio network";
  return `Network — ${network}`;
}

export function getGenLayerConfig(): GenLayerConfigStatus {
  const address =
    process.env.NEXT_PUBLIC_AGENTREF_CONTRACT_ADDRESS?.trim() ||
    serverEnv()?.AGENTREF_CONTRACT_ADDRESS?.trim() ||
    "";
  if (!has(address)) {
    return {
      kind: "not-configured",
      reason:
        "No AgentRefAdjudicator address is configured. Deploy genlayer/contract.py, then set NEXT_PUBLIC_AGENTREF_CONTRACT_ADDRESS (see genlayer/README.md and .env.example).",
    };
  }
  const network =
    process.env.NEXT_PUBLIC_AGENTREF_NETWORK?.trim() ||
    serverEnv()?.AGENTREF_NETWORK?.trim() ||
    "testnet_bradbury";
  return {
    kind: "ready",
    network,
    contractAddress: address,
    chainLabel: chainLabelFor(network),
  };
}

export interface GenLayerAccount {
  /** Server-only signer key; undefined when the app should not sign. */
  privateKey?: string;
  /** genlayer-js/chains export to use when building the client. */
  chainKey: string;
  accountName: string;
}

export function getGenLayerAccount(): GenLayerAccount {
  const env = serverEnv();
  return {
    privateKey: env?.AGENTREF_ACCOUNT_PRIVATE_KEY,
    chainKey:
      process.env.NEXT_PUBLIC_AGENTREF_CHAIN_KEY?.trim() ||
      env?.AGENTREF_CHAIN_KEY?.trim() ||
      "studionet",
    accountName: env?.AGENTREF_ACCOUNT_NAME?.trim() || "agentref",
  };
}
