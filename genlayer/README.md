# AgentRef × GenLayer — live Testnet Bradbury verdicts

AgentRef's core rule: **never fake validator consensus.** The app ships wired to
a **live deployed Intelligent Contract** on GenLayer Testnet — Bradbury:

- **Contract:** `0x648a2C783d3ED63fF47E1d5A4C90AF4714931c6f`
- **Deploy tx:** `0x64519fc90c8a0960943158e33c8efb6e04890dd7d4d4ac7e896d7880ba26a5e5`
  ([explorer](https://explorer-bradbury.genlayer.com/tx/0x64519fc90c8a0960943158e33c8efb6e04890dd7d4d4ac7e896d7880ba26a5e5))
- **Surface:** `create_receipt(brief, work, evidence, agent)` →
  `challenge(reason, evidence)` → `adjudicate()` → `get_receipt() → "Status: … | … | Score: … | Reason: …"`
- **Judge:** GenLayer validator consensus — *not* an in-app AI. The app never
  labels anything a GenLayer verdict unless it was read from this contract.

The address is **public**, so *reading* the on-chain verdict needs no wallet and
no key. *Adjudicating* (the three writes) needs a funded account whose key lives
server-side in `AGENTREF_ACCOUNT_PRIVATE_KEY`.

```
browser (verify page)                        Node server (route handlers)
        │  POST /api/genlayer/adjudicate            │
        ▼                                          ▼
   [Judge on GenLayer validators] ──► src/core/genlayer/runtime.ts ──(genlayer-js@1.1.8)──► LIVE contract
        │                                          │ create_receipt → challenge → adjudicate (server signs)
        │  GET /api/genlayer/receipt ◄──────────────┘ get_receipt() read (free, no key)
        ▼
   parseReceiptLine → Status / Score / Reason → source:"genlayer" ruling, recorded on the receipt
```

## Layout

| File | Purpose |
| --- | --- |
| `src/core/genlayer/contract.ts` | **Pure** model of the live contract: `LIVE_CONTRACT`, `parseReceiptLine` (the exact `get_receipt()` format), `verdictForStatus`, `onchainRuling`. Unit-tested offline. |
| `src/core/genlayer/config.ts` | Client-safe env → `ready`, defaulting to `LIVE_CONTRACT` (address + network). Also `adjudicationCapability()` — the pure check for whether this deployment can sign writes at all. |
| `src/core/genlayer/runtime.ts` | **Server-only** real SDK calls: `adjudicateOnChain` (writes) and `readOnChainReceipt` (free read). |
| `src/app/api/genlayer/{adjudicate,receipt,status}/route.ts` | HTTP bridge so the client never touches the SDK or the key. `status` reports *whether* writes are possible — never the key. |

`genlayer-js@1.1.8` is a real, pinned dependency (see `package.json`) and is
imported only by `runtime.ts`. Because `runtime.ts` is server-only, its static
imports never reach the client bundle — that is what keeps the signing key and
the SDK weight off the phone.

## The two adjudicator paths

| | SIMULATED fallback | GENLAYER (live) |
| --- | --- | --- |
| Where | `src/core/evaluate.ts` | live contract via `runtime.ts` |
| Who decides | transparent local rules model | GenLayer validators (Equivalence Principle) |
| `Ruling.source` | `"simulated"` | `"genlayer"` |
| Shown as | `SIMULATED fallback` | `GENLAYER` + on-chain `Status` (e.g. `NOT_VERIFIED`) |
| Needs | nothing | reads: nothing · writes: `AGENTREF_ACCOUNT_PRIVATE_KEY` |

The SIMULATED path exists only so the whole flow still runs on a deploy without
a funded key. **The moment an on-chain verdict is shown it replaces/hides the
SIMULATED result**, and the receipt records the GenLayer Status, Score, Reason,
the adjudication transaction and an explorer link.

## Which path a deployment actually runs

The verify page asks `/api/genlayer/status` what this deployment can do, so it
never offers a button that is guaranteed to fail:

| Deployment | Reads (`get_receipt`) | Writes (adjudicate) | What the demo does |
| --- | --- | --- | --- |
| No `AGENTREF_ACCOUNT_PRIVATE_KEY` | ✅ available | ❌ unavailable | Defaults to the **Simulated fallback**, labelled as such; the GenLayer option stays visible but disabled with the reason |
| Funded `AGENTREF_ACCOUNT_PRIVATE_KEY` | ✅ | ✅ | Defaults to **GenLayer validators** and signs the three writes |

Either way the app never claims a validator verdict it did not read from the
contract: the fallback badge reads *"Simulated fallback — GenLayer validators
were not consulted"*. Set the key and the live path takes over with no code
change.

> Note on `genlayer/contract.py`: the repo also carries a richer reference
> contract (AgentRefAdjudicator) used in earlier work. The app now targets the
> **live single-receipt contract** above; `contract.py` is kept as reference, not
> as the deployment source.

## Deploying your own copy (optional)

The app already points at the live contract, so this is only needed if you want
your *own* deployment:

```bash
npm i -g genlayer                       # deploy CLI on the machine with the funded key
genlayer deploy --contract genlayer/contract.py
# then point the app at your address:
#   NEXT_PUBLIC_AGENTREF_CONTRACT_ADDRESS=0x<yours>   (default = live address)
#   NEXT_PUBLIC_AGENTREF_NETWORK=testnet_bradbury
#   AGENTREF_ACCOUNT_PRIVATE_KEY=0x<funded key>       (server-only signer)
```

Fund the key via the official faucet: testnet-faucet.genlayer.foundation
(~100 GEN/week, Bradbury). Deploy + any write call consume test GEN; reads are
free.

## Tests

- `src/core/genlayer/contract.test.ts` — parser against the **verbatim live
  `get_receipt()` string**, status mapping, `onchainRuling`. Runs in `npm test`.
- `src/core/genlayer/config.test.ts` — config defaults to the live contract and
  the unsigned runtime never dials out. Runs in `npm test`.
- `tests/genlayer/contract.test.py` — the reference contract's tests for the
  official GenLayer harness (not run in this repo's sandbox).
