# AgentRef × GenLayer — live Studio Next verdicts

AgentRef's core rule: **never fake validator consensus.** The app ships wired to
the deployed **single-receipt Intelligent Contract** on **GenLayer Studio Next**:

- **Network:** Studio Next — chain id `61997`
- **RPC:** `https://studio-next.genlayer.com/api`
- **Explorer:** `https://explorer-studio-dev.genlayer.com`
- **Contract:** set `NEXT_PUBLIC_AGENTREF_CONTRACT_ADDRESS` (or
  `STUDIO_NEXT_CONTRACT_ADDRESS` in `src/core/genlayer/contract.ts`) once the
  deployment address is confirmed. While it is unset the app reports
  `not-configured` and refuses to read or write any contract rather than guess.
- **Surface:** `create_receipt(brief, work, evidence, agent)` →
  `challenge(reason, evidence)` → `adjudicate()` → `get_receipt() → "Status: … | … | Score: … | Reason: …"`
- **Judge:** GenLayer validator consensus — *not* an in-app AI. The app never
  labels anything a GenLayer verdict unless it was read from this contract.

The address is **public**, so *reading* the on-chain verdict needs no wallet and
no key. *Adjudicating* (the three writes) needs a funded account whose key lives
server-side in `AGENTBEE_ACCOUNT_PRIVATE_KEY` (`AGENTREF_ACCOUNT_PRIVATE_KEY` is
still honoured as a legacy alias).

```
browser (verify page)                        Node server (route handlers)
        │  POST /api/genlayer/adjudicate            │
        ▼                                          ▼
   [Judge on GenLayer validators] ──► src/core/genlayer/runtime.ts ──(genlayer-js@2.0.0-rc.1)──► Studio Next contract
        │                                          │ create_receipt → challenge → adjudicate (server signs)
        │  GET /api/genlayer/receipt ◄──────────────┘ get_receipt() read (free, no key)
        ▼
   parseReceiptLine → Status / Score / Reason → source:"genlayer" ruling, recorded on the receipt
```

## Why genlayer-js is pinned to 2.0.0-rc.1

Studio networks run a **different consensus ABI** from the older testnets:
`addTransaction` takes a `_params` tuple, and `deploySalted` / `topUpFees` are
added. `genlayer-js` only ships that ABI (and the `studioDevnet` chain export
for chain 61997) from **2.0.0-rc.1** onward — 1.1.x and 1.2.0 cannot encode a
write to Studio Next at all. The pin is therefore a requirement, not a
preference; revisit it once a stable release carries the Studio ABI.

Chain id 61997 is served by both `studio-next.genlayer.com` and
`studio-dev.genlayer.com`; the SDK's bundled `studioDevnet` names the latter and
deliberately ships **no block explorer**. `runtime.ts` derives its client chain
from `studioDevnet` and overrides the RPC and explorer to the values above.

## Layout

| File | Purpose |
| --- | --- |
| `src/core/genlayer/contract.ts` | **Pure** model of the live contract: `STUDIO_NEXT` (chain id, RPC, explorer), `LIVE_CONTRACT` (address + network), `parseReceiptLine` (the exact `get_receipt()` format), `verdictForStatus`, `onchainRuling`. Unit-tested offline. |
| `src/core/genlayer/config.ts` | Client-safe env → `ready` (or an honest `not-configured` when no address/key is present). Also `adjudicationCapability()` — the pure check for whether this deployment can sign writes at all. |
| `src/core/genlayer/runtime.ts` | **Server-only** real SDK calls: `adjudicateOnChain` (writes) and `readOnChainReceipt` (free read). Includes the Studio Next client chain. |
| `src/app/api/genlayer/{adjudicate,receipt,status}/route.ts` | HTTP bridge so the client never touches the SDK or the key. `status` reports *whether* writes are possible — never the key. |

`genlayer-js@2.0.0-rc.1` is a real, pinned dependency (see `package.json`) and is
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
| Needs | nothing | reads: nothing · writes: `AGENTBEE_ACCOUNT_PRIVATE_KEY` |

The SIMULATED path exists only as a **clearly labelled safety net** when live
adjudication cannot run — a deploy without a funded key, or a live call that
fails. It is never presented as a fresh validator verdict: the fallback badge
reads *"Simulated fallback — GenLayer validators were not consulted"*, and **the
moment an on-chain verdict is shown it replaces/hides the SIMULATED result**.

## Which path a deployment actually runs

The verify page asks `/api/genlayer/status` what this deployment can do, so it
never offers a button that is guaranteed to fail:

| Deployment | Reads (`get_receipt`) | Writes (adjudicate) | What the demo does |
| --- | --- | --- | --- |
| No address configured | ❌ | ❌ | Reports `not-configured`; only the labelled SIMULATED path is available |
| Address, no signer key | ✅ available | ❌ unavailable | Offers the **Simulated fallback** (labelled); the GenLayer option stays visible but disabled with the reason |
| Address + funded `AGENTBEE_ACCOUNT_PRIVATE_KEY` | ✅ | ✅ | Defaults to **GenLayer validators** and signs the three writes |

Either way the app never claims a validator verdict it did not read from the
contract. Set the key and the live path takes over with no code change.

> Note on `genlayer/contract.py`: the repo also carries a richer reference
> contract (AgentRefAdjudicator, `submit_dispute` / `get_ruling` — a
> multi-challenge design). The app targets the **single-receipt contract**
> above; `contract.py` is kept as reference, not as the deployment source.

## Deploying

Deployment needs a funded Studio Next account. The app already points at the
configured address, so this is only needed for your *own* copy:

```bash
npm i -g genlayer                       # deploy CLI on the machine with the funded key
genlayer deploy --contract genlayer/contract.py   # or your single-receipt contract
# then point the app at your address:
#   NEXT_PUBLIC_AGENTREF_CONTRACT_ADDRESS=0x<yours>   (required while no default is built in)
#   NEXT_PUBLIC_AGENTREF_NETWORK=studio_next
#   AGENTBEE_ACCOUNT_PRIVATE_KEY=0x<funded key>       (server-only signer)
```

Fund the key on Studio Next; deploy and write calls consume GEN, reads are free.

## Tests

- `src/core/genlayer/contract.test.ts` — parser against the verbatim live
  `get_receipt()` string, status mapping, `onchainRuling`, Studio Next
  targeting. Runs in `npm test`.
- `src/core/genlayer/config.test.ts` — config targeting, the address/key gates,
  and that the unsigned runtime never dials out. Runs in `npm test`.
- `tests/genlayer/contract.test.py` — the reference contract's tests for the
  official GenLayer harness (not run in this repo's sandbox).
