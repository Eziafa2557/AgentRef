import { test } from "node:test";
import assert from "node:assert/strict";
import { challengeReceipt } from "../challenge";
import { createReceipt } from "../receipt";
import { buildVerificationRequest, VerificationError } from "./request";

const base = {
  briefTitle: "B",
  brief: "Do X.",
  requirements: ["Do X."],
  riskRequirements: [],
  agentName: "a",
  requesterName: "r",
  workTitle: "W",
  work: "did X.",
  paymentAmountUsd: 50,
};

function challenged() {
  let r = createReceipt({ ...base });
  r = challengeReceipt(r, {
    reason: "not done",
    violatedRequirements: [],
    missedRiskRequirements: [],
    additionalContext: "",
    challengerName: "c",
    evidence: [{ label: "proof", content: "here is the evidence" }],
  }).receipt;
  return r;
}

test("buildVerificationRequest snapshots brief, work, challenge and evidence", () => {
  const req = buildVerificationRequest(challenged());
  assert.equal(req.receiptId.slice(0, 4), "REF-");
  assert.match(req.challengeId, /^CHL-/);
  assert.equal(req.brief, "Do X.");
  assert.equal(req.work, "did X.");
  assert.equal(req.challengeReason, "not done");
  assert.equal(req.evidence.length, 1);
  assert.equal(req.evidence[0].sha256.length, 64);
});

test("payloadHash is stable for identical input (same receipt → same hash)", () => {
  const same = challenged();
  const a = buildVerificationRequest(same);
  const b = buildVerificationRequest(same);
  assert.equal(a.payloadHash, b.payloadHash);
  // …and the hash binds the request to THIS challenge (another receipt differs).
  assert.notEqual(a.payloadHash, buildVerificationRequest(challenged()).payloadHash);
});

test("buildVerificationRequest requires a challenge", () => {
  assert.throws(() => buildVerificationRequest(createReceipt({ ...base })), VerificationError);
});
