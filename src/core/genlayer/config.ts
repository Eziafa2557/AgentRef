/**
 * GenLayer wiring config.
 *
 * AgentRef ships pointing AT THE LIVE deployed Intelligent Contract on GenLayer
 * Testnet — Bradbury (src/core/genlayer/contract.ts → LIVE_CONTRACT). The
 * address is public, so the config is `ready` out of the box and READING the
 * on-chain verdict needs no wallet or key.
 *
 * ADJUDICATING (create_receipt → challenge → adjudicate, i.e. writes) needs a
 * funded account server-side, set in env only:
 *   AGENTREF_ACCOUNT_PRIVATE_KEY   server-only signer key (never exposed)
 *
 * Env reference (see .env.example):
 *   NEXT_PUBLIC_AGENTREF_CONTRACT_ADDRESS   overrides the default live address
 *   NEXT_PUBLIC_AGENTREF_NETWORK            testnet_bradbury | studionet | localnet | testnet_asimov
 *   NEXT_PUBLIC_AGENTREF_CHAIN_KEY          OPTIONAL explicit genlayer-js/chains export name
 *                                           (testnetBradbury). Defaults to the export that matches
 *                                           the network above.
 */
import type { GenLayerConfigStatus } from "../types";
import { LIVE_CONTRACT } from "./contract";

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
    LIVE_CONTRACT.address;
  const network =
    process.env.NEXT_PUBLIC_AGENTREF_NETWORK?.trim() ||
    serverEnv()?.AGENTREF_NETWORK?.trim() ||
    LIVE_CONTRACT.network;
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
