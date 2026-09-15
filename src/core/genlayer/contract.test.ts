/**
 * Offline tests for the LIVE single-receipt contract model (src/core/genlayer/contract.ts).
 *
 * The parser is tested against the exact pipe-delimited format get_receipt()
 * returns. The first fixture below is the VERBATIM string read from the live
 * deployed contract before any dispute was raised:
 *
 *   "Status: EMPTY | Agent:  | Brief:  | Work:  | No challenge | Score:  | Reason: "
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  CONTRACT_METHODS,
  LIVE_CONTRACT,
  STUDIO_DEV,
  onchainRuling,
  parseReceiptLine,
  statusIsDecided,
  verdictForStatus,
} from "./contract";

const EMPTY_LIVE_LINE = "Status: EMPTY | Agent:  | Brief:  | Work:  | No challenge | Score:  | Reason: ";

const NOT_VERIFIED_KEYED =
  "Status: NOT_VERIFIED | Agent: Orbit Research AI | Brief: Research the top 5 DeFi protocols by TVL and compare them using current data. | " +
  "Work: The largest DeFi protocols by total value locked are a mix of liquid-staking platforms. | " +
  "Challenge: TVL figures outdated. | Score: 41 | Reason: The work never names a single protocol or a current TVL figure, so the comparison cannot be verified against current data.";

const NOT_VERIFIED_LOOSE =
  "Status: NOT_VERIFIED | Agent: Orbit Research AI | Brief: Research the top 5 DeFi protocols by TVL and compare them using current data. | " +
  "Work: The largest DeFi protocols by total value locked are a mix of liquid-staking platforms. | " +
  "TVL figures outdated. | Score: 41 | Reason: The work never names a single protocol or a current TVL figure.";

describe("LIVE_CONTRACT", () => {
  it("points at the deployed Studio Dev contract (chain 61997)", () => {
    assert.match(LIVE_CONTRACT.address, /^0x[0-9a-fA-F]{40}$/);
    assert.equal(LIVE_CONTRACT.network, "studio_dev");
    assert.equal(LIVE_CONTRACT.chainKey, "studioDevnet");
    assert.equal(STUDIO_DEV.chainId, 61997);
    // deployTxHash is only set once a deploy tx is confirmed; when present it
    // must be a real hash — the explorer links are guarded on it being set.
    if (LIVE_CONTRACT.deployTxHash) assert.match(LIVE_CONTRACT.deployTxHash, /^0x[0-9a-fA-F]{64}$/);
  });

  it("declares the exact contract surface runtime.ts verifies", () => {
    // These four are what the deployed contract must expose; runtime.ts reads
    // the node's schema and refuses any contract that does not.
    assert.equal(CONTRACT_METHODS.read.name, "get_receipt");
    assert.equal(CONTRACT_METHODS.read.readonly, true);
    assert.deepEqual(
      CONTRACT_METHODS.writes.map((w) => [w.name, w.params]),
      [
        ["create_receipt", 4],
        ["challenge", 2],
        ["adjudicate", 0],
      ]
    );
  });
});

describe("parseReceiptLine", () => {
  it("parses the verbatim EMPTY live line", () => {
    const r = parseReceiptLine(EMPTY_LIVE_LINE);
    assert.equal(r.status, "EMPTY");
    assert.equal(r.agent, "");
    assert.equal(r.brief, "");
    assert.equal(r.work, "");
    assert.equal(r.challenge, null);
    assert.equal(r.hasChallenge, false);
    assert.equal(r.score, "");
    assert.equal(r.reason, "");
  });

  it("parses a NOT_VERIFIED record with a 'Challenge:'-prefixed line", () => {
    const r = parseReceiptLine(NOT_VERIFIED_KEYED);
    assert.equal(r.status, "NOT_VERIFIED");
    assert.equal(r.agent, "Orbit Research AI");
    assert.match(r.brief, /top 5 DeFi protocols/);
    assert.match(r.work, /liquid-staking/);
    assert.equal(r.challenge, "TVL figures outdated.");
    assert.equal(r.hasChallenge, true);
    assert.equal(r.score, "41");
    assert.match(r.reason, /never names a single protocol/);
  });

  it("parses a NOT_VERIFIED record whose challenge line has no 'Challenge:' prefix", () => {
    const r = parseReceiptLine(NOT_VERIFIED_LOOSE);
    assert.equal(r.status, "NOT_VERIFIED");
    assert.equal(r.challenge, "TVL figures outdated.");
    assert.equal(r.hasChallenge, true);
  });

  it("peels a single layer of SDK quotes", () => {
    const r = parseReceiptLine(`"${EMPTY_LIVE_LINE}"`);
    assert.equal(r.status, "EMPTY");
  });

  it("returns an empty record for an empty / null raw string", () => {
    const a = parseReceiptLine("");
    assert.equal(a.status, "");
    assert.equal(parseReceiptLine("").hasChallenge, false);
  });
});

describe("statusIsDecided / verdictForStatus", () => {
  it("treats EMPTY and friends as not-decided", () => {
    assert.equal(statusIsDecided("EMPTY"), false);
    assert.equal(statusIsDecided(""), false);
    assert.equal(statusIsDecided("NOT_CREATED"), false);
  });

  it("treats the contract's in-flight states as not-decided", () => {
    // create_receipt writes OPEN and challenge writes CHALLENGED. Neither is a
    // verdict — reporting them as "unmapped status" would misdescribe a dispute
    // that is simply still in flight.
    assert.equal(statusIsDecided("OPEN"), false);
    assert.equal(statusIsDecided("CHALLENGED"), false);
    assert.equal(verdictForStatus("OPEN"), null);
    assert.equal(verdictForStatus("CHALLENGED"), null);
  });

  it("treats NOT_VERIFIED / VERIFIED as decided", () => {
    assert.equal(statusIsDecided("NOT_VERIFIED"), true);
    assert.equal(statusIsDecided("VERIFIED"), true);
  });

  it("maps statuses onto AgentRef verdicts and refuses to guess", () => {
    assert.equal(verdictForStatus("NOT_VERIFIED"), "FAIL");
    assert.equal(verdictForStatus("VERIFIED"), "PASS");
    assert.equal(verdictForStatus("PASSED"), "PASS");
    assert.equal(verdictForStatus("FAILED"), "FAIL");
    assert.equal(verdictForStatus("unmapped_thing"), null);
  });
});

describe("onchainRuling", () => {
  it("builds a genlayer Ruling from a NOT_VERIFIED record", () => {
    const record = parseReceiptLine(NOT_VERIFIED_KEYED);
    const ruling = onchainRuling(record, {
      receivedAt: "2026-09-09T00:00:00.000Z",
      transactionHash: "0x" + "a".repeat(64),
      contractAddress: LIVE_CONTRACT.address,
    });
    assert.ok(ruling);
    if (!ruling) return;
    assert.equal(ruling.verdict, "FAIL");
    assert.equal(ruling.source, "genlayer");
    assert.equal(ruling.genlayerStatus, "NOT_VERIFIED");
    assert.equal(ruling.genlayerScore, "41");
    assert.match(ruling.reasoning, /never names a single protocol/);
    assert.match(ruling.explorerUrl ?? "", /explorer-studio-dev\.genlayer\.com\/tx\//);
  });

  it("refuses to build a ruling for an unmapped status", () => {
    const r = onchainRuling(parseReceiptLine("Status: WEIRD | Agent:  | Brief:  | Work:  | No challenge | Score:  | Reason: "), {
      receivedAt: "2026-09-09T00:00:00.000Z",
    });
    assert.equal(r, null);
  });
});
