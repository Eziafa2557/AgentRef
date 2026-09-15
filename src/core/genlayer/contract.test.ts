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
  EXPLORER_BASE,
  LIVE_CONTRACT,
  STUDIO_NEXT,
  explorerTxUrl,
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
  it("targets Studio Next (chain 61997), not Bradbury", () => {
    assert.equal(LIVE_CONTRACT.network, "studio_next");
    assert.equal(LIVE_CONTRACT.chainKey, "studioDevnet");
    assert.equal(STUDIO_NEXT.chainId, 61997);
    assert.equal(STUDIO_NEXT.rpcUrl, "https://studio-next.genlayer.com/api");
    assert.equal(EXPLORER_BASE, "https://explorer-studio-dev.genlayer.com");
  });

  it("only carries an address once one is deployed", () => {
    if (LIVE_CONTRACT.address) {
      assert.match(LIVE_CONTRACT.address, /^0x[0-9a-fA-F]{40}$/);
      assert.match(LIVE_CONTRACT.deployTxHash, /^0x[0-9a-fA-F]{64}$/);
    } else {
      // Unset is a valid, honest state: config reports not-configured.
      assert.equal(LIVE_CONTRACT.address, "");
    }
  });

  it("builds explorer transaction links on the Studio Dev explorer", () => {
    assert.equal(
      explorerTxUrl("0xabc"),
      "https://explorer-studio-dev.genlayer.com/tx/0xabc"
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
