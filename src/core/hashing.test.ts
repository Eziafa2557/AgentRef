import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalStringify, hashJson, sha256Hex } from "./hashing";

test("sha256 matches the standard test vector", () => {
  assert.equal(
    sha256Hex("abc"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
  );
});

test("sha256 differs when content changes", () => {
  assert.notEqual(sha256Hex("brief A"), sha256Hex("brief B"));
});

test("canonicalStringify is stable across key order", () => {
  const a = canonicalStringify({ b: 1, a: [2, { d: 1, c: true }] });
  const b = canonicalStringify({ a: [2, { c: true, d: 1 }], b: 1 });
  assert.equal(a, b);
});

test("hashJson of logically-equal payloads is identical", () => {
  assert.equal(
    hashJson({ verdict: "PASS", requirements: ["x"], nested: { y: 1 } }),
    hashJson({ nested: { y: 1 }, requirements: ["x"], verdict: "PASS" })
  );
});

test("hashing is deterministic across calls", () => {
  assert.equal(sha256Hex("same input"), sha256Hex("same input"));
});
