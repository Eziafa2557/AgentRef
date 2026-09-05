import { test } from "node:test";
import assert from "node:assert/strict";
import { createReceipt } from "../receipt";
import { createLocalRepo, createMemoryRepo } from "./repo";

const base = {
  briefTitle: "B",
  brief: "Do X.",
  requirements: ["Do X."],
  riskRequirements: [],
  agentName: "a",
  requesterName: "r",
  workTitle: "W",
  work: "did X.",
  paymentAmountUsd: 10,
};

function make(id: string) {
  return createReceipt({ ...base, id });
}

test("memory repo stores, lists newest-first, gets, removes and clears", () => {
  const repo = createMemoryRepo();
  repo.upsert(make("REF-A"));
  repo.upsert(make("REF-B"));
  assert.equal(repo.list().length, 2);
  assert.equal(repo.list()[0].id, "REF-B"); // newest createdAt first

  assert.equal(repo.get("REF-A")?.id, "REF-A");
  assert.equal(repo.get("REF-MISSING"), null);

  // upsert replaces by id, does not duplicate
  const updated = { ...repo.get("REF-A")!, work: "redid X." };
  repo.upsert(updated);
  assert.equal(repo.list().length, 2);
  assert.equal(repo.get("REF-A")!.work, "redid X.");

  assert.equal(repo.remove("REF-A"), true);
  assert.equal(repo.remove("REF-A"), false);
  assert.equal(repo.list().length, 1);

  repo.replaceAll([make("REF-C"), make("REF-D")]);
  assert.equal(repo.list().length, 2);

  repo.clear();
  assert.equal(repo.list().length, 0);
});

test("createLocalRepo falls back to memory in a non-browser environment", () => {
  // Node has no window.localStorage → the browser repo must degrade gracefully.
  const repo = createLocalRepo();
  repo.upsert(make("REF-L"));
  assert.equal(repo.get("REF-L")?.id, "REF-L");
  assert.equal(repo.list().length, 1);
});

test("repo returns defensive copies (mutating a get result does not corrupt state)", () => {
  const repo = createMemoryRepo();
  repo.upsert(make("REF-A"));
  const got = repo.get("REF-A")!;
  got.work = "mutated outside";
  assert.equal(repo.get("REF-A")!.work, "did X.");
});
