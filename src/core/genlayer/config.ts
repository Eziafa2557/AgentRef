/**
 * GenLayer wiring config.
 *
 * AgentRef runs WITHOUT any GenLayer credentials out of the box: the app uses
 * the transparently-labelled SIMULATED adjudicator (src/core/evaluate.ts) until
 * a contract is deployed and these variables are provided. When they are set,
 * the server-side runtime (./runtime.ts) uses the real genlayer-js client — and
 * the UI labels rulings source: "genlayer".
 *
 * Env reference (see .env.example):
 *   NEXT_PUBLIC_AGENTREF_CONTRACT_ADDRESS   deployed AgentRefAdjudicator address
 *   NEXT_PUBLIC_AGENTREF_NETWORK            testnet_bradbury | studionet | localnet | testnet_asimov
 *   NEXT_PUBLIC_AGENTREF_CHAIN_KEY          OPTIONAL explicit genlayer-js/chains export name
 *                                           (testnetBradbury). Defaults to the export that matches
 *                                           the network above.
 *   AGENTREF_ACCOUNT_PRIVATE_KEY            server-only signer key (never exposed)
 */
import type { GenLayerConfigStatus } from "../types";

const has = (v?: string): boolean => !!v && v.trim().length > 0;

/** Server-only env — safe to touch non-NEXT_PUBLIC_* vars. */
function serverEnv(): NodeJS.ProcessEnv | undefined {
  return typeof window === "undefined" ? process.env : undefined;
}

/**
 * genlayer-js/chains exports are camelCase (testnetBradbury, studionet, localnet,
 * testnetAsimov). Map every accepted network label to its chain export so a user
 * only ever has to name the network.
 */
const NETWORK_CHAIN_KEYS: Record<string, string> = {
  localnet: "localnet",
  studionet: "studionet",
  testnet_bradbury: "testnetBradbury",
  testnetBradbury: "testnetBradbury",
  testnet_asimov: "testnetAsimov",
  testnetAsimov: "testnetAsimov",
};

const NETWORK_LABELS: Record<string, string> = {
  localnet: "Local — GenLayer Studio",
  studionet: "Studio network",
  testnet_bradbury: "Testnet — Bradbury",
  testnet_asimov: "Testnet — Asimov",
};

export function resolveChainKey(network: string, explicit?: string): string {
  if (has(explicit)) return explicit!.trim();
  const norm = network.trim();
  return NETWORK_CHAIN_KEYS[norm] ?? norm;
}

function chainLabelFor(network: string): string {
  return NETWORK_LABELS[network.trim()] ?? `Network — ${network}`;
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
  const chainKey = resolveChainKey(network, process.env.NEXT_PUBLIC_AGENTREF_CHAIN_KEY);
  return {
    kind: "ready",
    network,
    contractAddress: address,
    chainKey,
    chainLabel: chainLabelFor(network),
  };
}

export interface GenLayerAccount {
  /** Server-only signer key; undefined when the app should not sign. */
  privateKey?: string;
  /** Explicit genlayer-js/chains export override (defaults from the network). */
  chainKey?: string;
  accountName: string;
}

export function getGenLayerAccount(): GenLayerAccount {
  const env = serverEnv();
  return {
    privateKey: env?.AGENTREF_ACCOUNT_PRIVATE_KEY,
    chainKey: env?.AGENTREF_CHAIN_KEY?.trim(),
    accountName: env?.AGENTREF_ACCOUNT_NAME?.trim() || "agentref",
  };
}
