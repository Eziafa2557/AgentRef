import { test } from "node:test";
import assert from "node:assert/strict";
import { createReceipt, lifecycleOf, verifyIntegrity, withSettlement } from "./receipt";

const base = {
  briefTitle: "Six-month ETH analysis",
  brief: "Analyze ETH for six months.",
  requirements: ["Do not recommend leverage."],
  riskRequirements: ["Disclose downside risks."],
  agentName: "Agent A",
  requesterName: "Requester B",
  workTitle: "Memo",
  work: "ETH is fine for six months.",
  paymentAmountUsd: 100,
};

test("createReceipt assigns REF id, hashes and PENDING settlement", () => {
  const r = createReceipt({ ...base });
  assert.match(r.id, /^REF-/);
  assert.equal(r.settlement, "PENDING");
  assert.equal(lifecycleOf(r), "OPEN");
  assert.equal(r.corpusHash.length, 64);
  assert.equal(r.workHash.length, 64);
  assert.equal(r.settlementLog.length, 1);
});

test("a receipt survives a JSON round-trip with identical hashes", () => {
  const r = createReceipt({ ...base });
  const clone = JSON.parse(JSON.stringify(r)) as typeof r;
  assert.equal(clone.id, r.id);
  assert.equal(clone.corpusHash, r.corpusHash);
  assert.equal(verifyIntegrity(clone).valid, true);
});

test("verifyIntegrity flags a tampered work field", () => {
  const r = createReceipt({ ...base });
  const tampered = { ...r, work: r.work + "  ADDED AFTER THE FACT" };
  const report = verifyIntegrity(tampered);
  assert.equal(report.valid, false);
  assert.ok(report.checks.some((c) => c.label === "work" && !c.ok));
});

test("verifyIntegrity flags a tampered requirement", () => {
  const r = createReceipt({ ...base });
  const tampered = { ...r, requirements: ["Do not recommend futures."] };
  assert.equal(verifyIntegrity(tampered).valid, false);
});

test("corpus hash changes when the brief changes (detects silent edits)", () => {
  const a = createReceipt({ ...base });
  const b = createReceipt({ ...base, brief: base.brief + " and clearly disclose all risks." });
  assert.notEqual(a.corpusHash, b.corpusHash);
});

test("withSettlement appends a timestamped log entry", () => {
  const r = withSettlement(createReceipt({ ...base }), "CHALLENGED", "Under dispute.");
  assert.equal(r.settlement, "CHALLENGED");
  assert.equal(r.settlementLog.length, 2);
  assert.equal(r.settlementLog[1].state, "CHALLENGED");
  assert.ok(r.updatedAt >= r.createdAt);
});
