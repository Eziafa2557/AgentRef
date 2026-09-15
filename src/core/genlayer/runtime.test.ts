/**
 * Offline tests for the on-chain WRITE success check.
 *
 * These exist because of a real production false negative. `create_receipt`
 * executed successfully on Studio Dev — the transaction was FINALIZED with
 * FINISHED_WITH_RETURN — and the app reported it as a failure, so the
 * adjudication never advanced past its first write.
 *
 * The cause was a redundant `receipt.statusName === FINALIZED` guard layered on
 * top of the SDK's `isSuccessful`. `waitForTransactionReceipt` returns a
 * SIMPLIFIED receipt by default, and that shape drops `statusName` while
 * keeping the numeric `status`. The guard read "absent" as "not finalized" and
 * rejected every successful write.
 *
 * The fixtures below are the field values read from the live transaction
 * `0x13ab2adbddd100075df1e475db233d63f604c571fa69bcc6ee973fa01421893e` on
 * Studio Dev, not invented shapes. No network, key, or contract is needed.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import type { GenLayerTransaction } from "genlayer-js/types";

import { waitForFinalized, writeSucceeded } from "./runtime";

/** `status` is the enum INDEX on the wire: FINALIZED=7, ACCEPTED=5. */
const asReceipt = (fields: Record<string, unknown>): GenLayerTransaction =>
  fields as unknown as GenLayerTransaction;

/** The simplified shape `waitForTransactionReceipt` actually returns: `statusName` dropped. */
const SIMPLIFIED_FINALIZED_RETURN = {
  status: 7, // FINALIZED
  txExecutionResult: 1, // FINISHED_WITH_RETURN
  txExecutionResultName: "FINISHED_WITH_RETURN",
};

const FULL_FINALIZED_RETURN = {
  ...SIMPLIFIED_FINALIZED_RETURN,
  statusName: "FINALIZED",
};

describe("writeSucceeded — the on-chain write success check", () => {
  it("accepts the SIMPLIFIED finalized receipt the SDK actually returns", () => {
    // The regression. A statusName-based guard returned false here and stalled
    // every adjudication at create_receipt.
    assert.equal(writeSucceeded(asReceipt(SIMPLIFIED_FINALIZED_RETURN)), true);
  });

  it("pins the assumption that makes the guard wrong: the simplified receipt has no statusName", () => {
    // If the SDK ever starts carrying statusName through simplification, this
    // fails and the comment on writeSucceeded is stale — not the behaviour.
    assert.equal(asReceipt(SIMPLIFIED_FINALIZED_RETURN).statusName, undefined);
    assert.equal(asReceipt(FULL_FINALIZED_RETURN).statusName, "FINALIZED");
  });

  it("accepts the full (unsimplified) finalized receipt too", () => {
    assert.equal(writeSucceeded(asReceipt(FULL_FINALIZED_RETURN)), true);
  });

  it("accepts an ACCEPTED receipt, which the SDK also counts as success", () => {
    assert.equal(writeSucceeded(asReceipt({ ...SIMPLIFIED_FINALIZED_RETURN, status: 5 })), true);
  });

  it("rejects a finalized write whose execution reverted", () => {
    // A reverted write must never be reported as a verdict.
    assert.equal(
      writeSucceeded(asReceipt({ status: 7, txExecutionResult: 2, txExecutionResultName: "FINISHED_WITH_ERROR" })),
      false
    );
  });

  it("rejects a finalized write that was never voted on", () => {
    assert.equal(
      writeSucceeded(asReceipt({ status: 7, txExecutionResult: 0, txExecutionResultName: "NOT_VOTED" })),
      false
    );
  });

  it("rejects a receipt that has not reached a decided state", () => {
    assert.equal(writeSucceeded(asReceipt({ ...SIMPLIFIED_FINALIZED_RETURN, status: 1 })), false); // PENDING
    assert.equal(writeSucceeded(asReceipt({ ...SIMPLIFIED_FINALIZED_RETURN, status: 8 })), false); // CANCELED
  });

  it("rejects a receipt carrying no status at all rather than guessing success", () => {
    assert.equal(writeSucceeded(asReceipt({ txExecutionResultName: "FINISHED_WITH_RETURN" })), false);
  });
});

/**
 * A poll that errors says nothing about the transaction, so it must not be
 * believed. This is the second production false negative: the adjudicate write
 * was submitted and went on to FINALIZE with FINISHED_WITH_RETURN while the RPC
 * answered a poll with an HTML error page, and the route reported the
 * adjudication as failed.
 */
describe("waitForFinalized — tolerating a flaky poll", () => {
  const FAST = { intervalMs: 1, budgetMs: 5_000 };
  const FINALIZED = asReceipt(SIMPLIFIED_FINALIZED_RETURN);

  it("retries past a transient RPC error instead of reporting the write as failed", async () => {
    let calls = 0;
    const client = {
      waitForTransactionReceipt: async () => {
        calls += 1;
        if (calls === 1) throw new Error(`Unexpected token '<', "<!DOCTYPE "... is not valid JSON`);
        return FINALIZED;
      },
    };

    const receipt = await waitForFinalized(client as never, "0xabc", "adjudicate", FAST);

    assert.equal(calls, 2, "it should have polled again after the error");
    assert.equal(writeSucceeded(receipt), true);
  });

  it("returns without an extra poll when the write is already finalized", async () => {
    let calls = 0;
    const client = {
      waitForTransactionReceipt: async () => {
        calls += 1;
        return FINALIZED;
      },
    };

    await waitForFinalized(client as never, "0xabc", "create_receipt", FAST);
    assert.equal(calls, 1);
  });

  it("gives up once the budget is spent, and says it is a failure to CONFIRM", async () => {
    const client = {
      waitForTransactionReceipt: async () => {
        throw new Error("HTML error page");
      },
    };

    await assert.rejects(
      () => waitForFinalized(client as never, "0xdeadbeef", "challenge", { intervalMs: 1, budgetMs: 25 }),
      (e: Error) => {
        assert.match(e.message, /could not be confirmed/);
        // It must not claim the write failed — it only failed to confirm it.
        assert.match(e.message, /failure to CONFIRM, not proof the write failed/);
        assert.match(e.message, /0xdeadbeef/);
        return true;
      }
    );
  });
});
