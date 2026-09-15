# AgentRef × GenLayer — live Studio Dev verdicts

AgentRef's core rule: **never fake validator consensus.** The app is wired to a
deployed Intelligent Contract on **GenLayer Studio Dev (chain 61997)**:

- **Contract:** `0xaF982d37492368e03413DaCe68E8525bf97f822B`
  (set in `src/core/genlayer/contract.ts` → `LIVE_CONTRACT`)
- **Chain:** Studio Dev / Studio Next — chain id `61997` (`0xf22d`)
- **RPC:** `https://studio-dev.genlayer.com/api` (bundled by genlayer-js as the
  `studioDevnet` chain export; the app attaches the explorer itself)
- **Explorer:** https://explorer-studio-dev.genlayer.com
- **Source of truth:** [`agentref.py`](./agentref.py) — **byte-identical to the
  code deployed on chain.** Verified, not assumed:

  ```bash
  # the node's own copy of the deployed code, decoded
  curl -s -X POST https://studio-dev.genlayer.com/api \
    -H 'Content-Type: application/json' \
    -d '{"jsonrpc":"2.0","method":"gen_getContractCode",
         "params":["0xaF982d37492368e03413DaCe68E8525bf97f822B"],"id":1}' \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
        console.log(Buffer.from(JSON.parse(s).result,"base64").toString())})' > /tmp/onchain.py
  diff /tmp/onchain.py genlayer/agentref.py && echo "repo == chain"
  ```

  sha256 of the deployed source: `ea28bd51494907fde4f956ec1ca9397083fbedd478a4117ca515dc3b6ae3455b`

- **Surface:** `create_receipt(brief, work, evidence, agent)` →
  `challenge(reason, evidence)` → `adjudicate()` → `get_receipt() → "Status: … | … | Score: … | Reason: …"`
- **Judge:** GenLayer validator consensus — *not* an in-app AI. The app never
  labels anything a GenLayer verdict unless it was read from this contract.

## Status lifecycle

The contract holds **one** receipt at a time:

| Status | Written by | Means |
| --- | --- | --- |
| `EMPTY` | constructor | nothing submitted yet |
| `OPEN` | `create_receipt` | receipt stored, no dispute |
| `CHALLENGED` | `challenge` | dispute recorded, awaiting judgement |
| `VERIFIED` / `NOT_VERIFIED` | `adjudicate` | **the verdict** (score `1/1` / `0/1`) |

`contract.ts` treats `EMPTY` / `OPEN` / `CHALLENGED` as *not yet ruled*, so a
dispute still mid-flight reads as "no verdict yet" rather than being reported as
an unmapped status. Only `VERIFIED` / `NOT_VERIFIED` map to a `Ruling`.

## How `adjudicate()` reaches consensus

```python
def judge() -> str:
    return gl.nondet.exec_prompt(prompt)      # one word: PASS or FAIL

answer = str(gl.eq_principle.prompt_non_comparative(
    judge,
    task="Decide whether the work followed the brief",
    criteria="One word, PASS or FAIL, consistent with the brief, work and challenge.",
)).strip().upper()
```

`prompt_non_comparative` is the runner's Equivalence Principle: the leader runs
`judge()`, **every validator independently runs `judge()` in its own sandbox**,
and an NLP integrity step rules on equivalence. No agreement → the network does
not commit.

Two details that this runner punishes, both handled in `agentref.py`:

- `judge()` closes over a plain local `prompt` string, **never over `self`** —
  the function is pickled into a sandbox, and closing over the contract object
  would drag contract storage along with it.
- A storage field and a method **cannot share a name** (`challenge: str`
  alongside `def challenge(...)` makes the method vanish from the ABI silently),
  hence the field is called `challenge_text`.

Also note: **schema-valid ≠ runnable.** Schema generation compiles the module
but never executes method bodies, so a contract calling a non-existent API
returns a perfectly valid schema and then reverts on first call. Two earlier
drafts in this repo did exactly that (`gl.vm.run_nondet_unsafe` does not exist
on this runner) and have been removed rather than left as deployable traps.

## The app verifies the contract before trusting it

On every read (and before signing any write) `runtime.ts` asks the node for the
contract's schema and refuses to interpret an address that does not expose
`get_receipt` **as a view** plus `create_receipt` / `challenge` / `adjudicate`.
A mis-pointed address therefore reports exactly what it found instead of
rendering an unrelated contract's state as an empty verdict.

The address is **public**, so *reading* the on-chain verdict needs no wallet and
no key. *Adjudicating* (the three writes) needs a funded account whose key lives
server-side in `AGENTBEE_ACCOUNT_PRIVATE_KEY` (or the older
`AGENTREF_ACCOUNT_PRIVATE_KEY`).

```
browser (verify page)                        Node server (route handlers)
        │  POST /api/genlayer/adjudicate            │
        ▼                                          ▼
   [Judge on GenLayer validators] ──► src/core/genlayer/runtime.ts ──(genlayer-js 2.0.0-rc.1)──► LIVE contract
        │                                          │ create_receipt → challenge → adjudicate (server signs)
        │  GET /api/genlayer/receipt ◄──────────────┘ get_receipt() read (free, no key)
        ▼
   parseReceiptLine → Status / Score / Reason → source:"genlayer" ruling, recorded on the receipt
```

## Layout

| File | Purpose |
| --- | --- |
| `genlayer/agentref.py` | The deployed contract — byte-identical to chain. |
| `src/core/genlayer/contract.ts` | **Pure** model of the live contract: `LIVE_CONTRACT`, `parseReceiptLine` (the exact `get_receipt()` format), `verdictForStatus`, `onchainRuling`. Unit-tested offline. |
| `src/core/genlayer/config.ts` | Client-safe env → `ready`, defaulting to `LIVE_CONTRACT` (address + network). Also `adjudicationCapability()` — the pure check for whether this deployment can sign writes at all. |
| `src/core/genlayer/runtime.ts` | **Server-only** real SDK calls: `adjudicateOnChain` (writes) and `readOnChainReceipt` (free read). |
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
| Shown as | `Simulated fallback` | `GENLAYER` + on-chain `Status` (e.g. `NOT_VERIFIED`) |
| Needs | nothing | reads: nothing · writes: `AGENTBEE_ACCOUNT_PRIVATE_KEY` |

The SIMULATED path exists only so the whole flow still runs on a deploy without
a funded key. **The moment an on-chain verdict is shown it replaces/hides the
SIMULATED result**, and the receipt records the GenLayer Status, Score, Reason,
the adjudication transaction and an explorer link. It is never described as
validator consensus.

## Which path a deployment actually runs

The verify page asks `/api/genlayer/status` what this deployment can do, so it
never offers a button that is guaranteed to fail:

| Deployment | Reads (`get_receipt`) | Writes (adjudicate) | What the demo does |
| --- | --- | --- | --- |
| No signer key | ✅ available | ❌ unavailable | Defaults to the **Simulated fallback**, labelled as such; the GenLayer option stays visible but disabled with the reason |
| Funded `AGENTBEE_ACCOUNT_PRIVATE_KEY` | ✅ | ✅ | Defaults to **GenLayer validators** and signs the three writes |

Either way the app never claims a validator verdict it did not read from the
contract: the fallback badge reads *"Simulated fallback — GenLayer validators
were not consulted"*. Set the key and the live path takes over with no code
change.

> The signer account must be **funded on Studio Dev** — test GEN does not carry
> across networks, so a key that pays for writes on another chain still needs
> funds on chain 61997.

## Deploying your own copy (optional)

The app already points at the live contract, so this is only needed if you want
your *own* deployment:

```bash
npm i -g genlayer                       # deploy CLI on the machine with the funded key
genlayer deploy --contract genlayer/agentref.py
# then point the app at your address:
#   NEXT_PUBLIC_AGENTREF_CONTRACT_ADDRESS=0x<yours>   (default = live address)
#   NEXT_PUBLIC_AGENTREF_NETWORK=studio_dev
#   AGENTBEE_ACCOUNT_PRIVATE_KEY=0x<funded key>       (server-only signer)
```

Deploy + any write call consume test GEN; reads are free. The deployed contract
must expose `get_receipt`/`create_receipt`/`challenge`/`adjudicate`, and the app
checks that before it will read or write.

**Validate without deploying.** `gen_getContractSchemaForCode(contract_code_hex)`
compiles a source file on the node and returns its schema — no wallet, no
deploy, no fees. Use it to confirm a candidate contract's surface (and that its
`Depends` runner hash is well-formed) before spending anything.

## Tests

- `src/core/genlayer/contract.test.ts` — parser against the **verbatim live
  `get_receipt()` string**, the status lifecycle, `onchainRuling`. Runs in `npm test`.
- `src/core/genlayer/config.test.ts` — config defaults to the live contract and
  the unsigned runtime never dials out. Runs in `npm test`.
