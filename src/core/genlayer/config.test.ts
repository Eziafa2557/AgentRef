/**
 * Offline tests for the GenLayer wiring.
 *
 * These run WITHOUT any network, key, or deployed contract — the point is to
 * prove the real genlayer-js SDK resolves and imports cleanly under Node, that
 * an unconfigured app reports `not-configured` (never throws, never dials out),
 * and that network labels map to the correct camelCase chain exports.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { getGenLayerAccount, getGenLayerConfig, resolveChainKey } from "./config";
// Importing runtime.ts is the real import check: it statically imports
// genlayer-js@1.1.8 + its chains + types. If those resolved names were wrong,
// this file would fail to load before a single assertion ran.
import { readRuling, submitDispute } from "./runtime";

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
  it("reports not-configured with an actionable reason", () => {
    const saved = clearGenLayerEnv();
    try {
      const config = getGenLayerConfig();
      assert.equal(config.kind, "not-configured");
      assert.match(config.reason, /NEXT_PUBLIC_AGENTREF_CONTRACT_ADDRESS/);
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
  it("submitDispute returns not-configured instead of dialing out", async () => {
    const saved = clearGenLayerEnv();
    try {
      const out = await submitDispute({ challengeId: "CHL-1", payloadHash: "h", payload: "{}" });
      assert.equal(out.status, "not-configured");
    } finally {
      restoreGenLayerEnv(saved);
    }
  });

  it("readRuling returns not-configured instead of dialing out", async () => {
    const saved = clearGenLayerEnv();
    try {
      const out = await readRuling({ challengeId: "CHL-1" });
      assert.equal(out.status, "not-configured");
    } finally {
      restoreGenLayerEnv(saved);
    }
  });
});
