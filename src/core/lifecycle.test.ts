import { test } from "node:test";
import assert from "node:assert/strict";
import { createReceipt } from "./receipt";
import { challengeReceipt, ChallengeError } from "./challenge";
import { applyRuling, markChallenged, markUnderReview, SettlementError } from "./settlement";
import { verifyIntegrity } from "./receipt";
import type { Ruling } from "./types";

const base = {
  briefTitle: "B",
  brief: "Do X and disclose the risks.",
  requirements: ["Do X."],
  riskRequirements: ["Disclose risks."],
  agentName: "A",
  requesterName: "R",
  workTitle: "W",
  work: "Here is X and the risks.",
  paymentAmountUsd: 100,
};

const chInput = {
  reason: "X was not done.",
  violatedRequirements: ["Do X."],
  missedRiskRequirements: [],
  additionalContext: "look at the evidence",
  challengerName: "Judge",
  evidence: [{ label: "exhibit-a", content: "the actual evidence text" }],
};

function ruling(v: Ruling["verdict"], extra?: Partial<Ruling>): Ruling {
  return {
    verdict: v,
    briefFollowed: true,
    requirementsMet: true,
    materialRiskDisclosed: true,
    failedRequirements: [],
    missedMaterialRisks: [],
    reasoning: "because",
    source: "simulated",
    receivedAt: new Date().toISOString(),
    ...extra,
  };
}

test("a receipt can be challenged exactly once", () => {
  const r = createReceipt({ ...base });
  const { receipt } = challengeReceipt(r, chInput);
  assert.equal(receipt.settlement, "CHALLENGED");
  assert.ok(receipt.challenge);
  assert.match(receipt.challenge.id, /^CHL-/);
  assert.throws(() => challengeReceipt(receipt, chInput), ChallengeError);
});

test("challenge preserves exact reason, evidence and requirement snapshots", () => {
  const r = createReceipt({ ...base });
  const { challenge } = challengeReceipt(r, chInput);
  assert.equal(challenge.reason, chInput.reason);
  assert.deepEqual(challenge.violatedRequirements, ["Do X."]);
  assert.equal(challenge.evidence.length, 1);
  assert.equal(challenge.evidence[0].content, "the actual evidence text");
  assert.equal(challenge.evidence[0].sha256.length, 64);
  assert.ok(challenge.bodyHash.length === 64);
});

test("challenge evidence integrity survives intact copy but fails tampering", () => {
  const r = createReceipt({ ...base });
  const { receipt } = challengeReceipt(r, chInput);
  assert.equal(verifyIntegrity(receipt).valid, true);

  // Tamper with an evidence item.
  const tampered = structuredClone(receipt);
  tampered.challenge!.evidence[0].content += " …changed";
  const report = verifyIntegrity(tampered);
  assert.equal(report.valid, false);
  assert.ok(report.checks.some((c) => c.label.startsWith("evidence") && !c.ok));
});

test("a challenge cannot be raised on an already-settled receipt", () => {
  const r = applyRuling(markUnderReview(challengeReceipt(createReceipt({ ...base }), chInput).receipt), ruling("PASS"));
  assert.throws(() => challengeReceipt(r, chInput), ChallengeError);
});

test("challenge requires a reason", () => {
  assert.throws(() => challengeReceipt(createReceipt({ ...base }), { ...chInput, reason: "   " }), ChallengeError);
});

test("markChallenged guards the state machine", () => {
  const open = createReceipt({ ...base });
  assert.throws(() => markChallenged(markChallenged(open)), SettlementError); // PENDING→CHALLENGED once
});

test("PASS releases payment (simulated escrow) and logs both PASSED and RELEASED", () => {
  let r = createReceipt({ ...base });
  r = challengeReceipt(r, chInput).receipt;
  r = markUnderReview(r);
  assert.equal(r.settlement, "UNDER_REVIEW");
  r = applyRuling(r, ruling("PASS"));
  assert.equal(r.ruling!.verdict, "PASS");
  assert.equal(r.settlement, "RELEASED");
  const states = r.settlementLog.map((e) => e.state);
  assert.ok(states.includes("PASSED") && states.includes("RELEASED"));
});

test("FAIL locks payment and logs both FAILED and LOCKED", () => {
  let r = createReceipt({ ...base });
  r = challengeReceipt(r, chInput).receipt;
  r = markUnderReview(r);
  r = applyRuling(r, ruling("FAIL"));
  assert.equal(r.settlement, "LOCKED");
  const states = r.settlementLog.map((e) => e.state);
  assert.ok(states.includes("FAILED") && states.includes("LOCKED"));
});

test("PASS_WITH_MATERIAL_RISK releases with a flagged-material-risk note", () => {
  let r = createReceipt({ ...base });
  r = challengeReceipt(r, chInput).receipt;
  r = markUnderReview(r);
  r = applyRuling(
    r,
    ruling("PASS_WITH_MATERIAL_RISK", { missedMaterialRisks: ["Disclose risks."] })
  );
  assert.equal(r.settlement, "RELEASED");
  const note = r.settlementLog[r.settlementLog.length - 1].note ?? "";
  assert.match(note, /MATERIAL RISK/i);
});

test("a FAIL receipt stays visible and locked (never disappears)", () => {
  let r = createReceipt({ ...base });
  r = applyRuling(markUnderReview(challengeReceipt(r, chInput).receipt), ruling("FAIL"));
  assert.equal(r.ruling!.verdict, "FAIL");
  assert.equal(r.settlement, "LOCKED");
  assert.ok(r.challenge); // still here
});

test("a second ruling is rejected", () => {
  let r = createReceipt({ ...base });
  r = applyRuling(markUnderReview(challengeReceipt(r, chInput).receipt), ruling("PASS"));
  assert.throws(() => applyRuling(r, ruling("FAIL")), SettlementError);
});

test("cannot rule without a challenge", () => {
  assert.throws(() => applyRuling(createReceipt({ ...base }), ruling("PASS")), SettlementError);
});
