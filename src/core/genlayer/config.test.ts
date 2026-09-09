/**
 * Offline tests for the GenLayer wiring.
 *
 * These run WITHOUT any network, key, or deployed contract — the point is to
 * prove the real genlayer-js SDK resolves and imports cleanly under Node, that
 * the config points at the LIVE deployed contract by default (public address —
 * reads work out of the box), that an unsigned runtime never dials out, and that
 * network labels map to the correct camelCase chain exports.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { getGenLayerAccount, getGenLayerConfig, resolveChainKey } from "./config";
import { LIVE_CONTRACT } from "./contract";
// Importing runtime.ts is the real import check: it statically imports
// genlayer-js@1.1.8 + its chains + types. If those resolved names were wrong,
// this file would fail to load before a single assertion ran.
import { adjudicateOnChain, readOnChainReceipt } from "./runtime";

const GL_ENV_KEYS = [
  "NEXT_PUBLIC_AGENTREF_CONTRACT_ADDRESS",
  "NEXT_PUBLIC_AGENTREF_NETWORK",
  "NEXT_PUBLIC_AGENTREF_CHAIN_KEY",
  "AGENTREF_CONTRACT_ADDRESS",
  "AGENTREF_NETWORK",
  "AGENTREF_CHAIN_KEY",
  "AGENTREF_ACCOUNT_PRIVATE_KEY",
  "AGENTREF_ACCOUNT_NAME",
];

function clearGenLayerEnv() {
  const saved: Record<string, string | undefined> = {};
  for (const key of GL_ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  return saved;
}

function restoreGenLayerEnv(saved: Record<string, string | undefined>) {
  for (const key of GL_ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
}

describe("resolveChainKey", () => {
  it("maps accepted network labels to camelCase genlayer-js/chains exports", () => {
    assert.equal(resolveChainKey("testnet_bradbury"), "testnetBradbury");
    assert.equal(resolveChainKey("testnet_asimov"), "testnetAsimov");
    assert.equal(resolveChainKey("studionet"), "studionet");
    assert.equal(resolveChainKey("localnet"), "localnet");
  });

  it("accepts an explicit chain-key override", () => {
    assert.equal(resolveChainKey("studionet", "testnetBradbury"), "testnetBradbury");
  });

  it("passes unknown labels through rather than guessing", () => {
    assert.equal(resolveChainKey("whatever_net"), "whatever_net");
  });
});

describe("getGenLayerConfig (no env)", () => {
  it("defaults to the LIVE deployed contract — reads work out of the box", () => {
    const saved = clearGenLayerEnv();
    try {
      const config = getGenLayerConfig();
      assert.equal(config.kind, "ready");
      if (config.kind !== "ready") return;
      assert.equal(config.contractAddress, LIVE_CONTRACT.address);
      assert.equal(config.network, LIVE_CONTRACT.network);
      assert.equal(config.chainKey, LIVE_CONTRACT.chainKey);
      assert.match(config.chainLabel, /Bradbury/i);
    } finally {
      restoreGenLayerEnv(saved);
    }
  });

  it("honors an explicit NEXT_PUBLIC address/network override", () => {
    const saved = clearGenLayerEnv();
    try {
      process.env.NEXT_PUBLIC_AGENTREF_CONTRACT_ADDRESS = "0x1111111111111111111111111111111111111111";
      process.env.NEXT_PUBLIC_AGENTREF_NETWORK = "studionet";
      const config = getGenLayerConfig();
      assert.equal(config.kind, "ready");
      if (config.kind !== "ready") return;
      assert.equal(config.contractAddress, "0x1111111111111111111111111111111111111111");
      assert.equal(config.chainKey, "studionet");
    } finally {
      restoreGenLayerEnv(saved);
    }
  });
});

describe("getGenLayerAccount (no env)", () => {
  it("exposes no private key unless server env provides one", () => {
    const saved = clearGenLayerEnv();
    try {
      const account = getGenLayerAccount();
      assert.equal(account.privateKey, undefined);
      assert.equal(account.accountName, "agentref");
    } finally {
      restoreGenLayerEnv(saved);
    }
  });
});

describe("runtime (real genlayer-js import, no env)", () => {
  it("adjudicateOnChain returns not-configured (no signer key) instead of dialing out", async () => {
    const saved = clearGenLayerEnv();
    try {
      const out = await adjudicateOnChain({
        brief: "Research the top 5 DeFi protocols by TVL and compare them using current data.",
        work: "The largest DeFi protocols are liquid-staking platforms and lending markets.",
        reason: "TVL figures outdated.",
        agent: "Orbit Research AI",
        evidence: [{ label: "excerpt", content: "some evidence" }],
      });
      assert.equal(out.status, "not-configured");
      if (out.status === "not-configured") assert.match(out.reason, /AGENTREF_ACCOUNT_PRIVATE_KEY/);
    } finally {
      restoreGenLayerEnv(saved);
    }
  });

  it("exposes the read + write functions as the live single-receipt surface", () => {
    assert.equal(typeof readOnChainReceipt, "function");
    assert.equal(typeof adjudicateOnChain, "function");
  });
});
