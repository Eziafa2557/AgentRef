# AgentRef — Architecture

## 1. Shape of the system

The whole product is built around one persisted artifact — the **Receipt** — so
a dispute is never reconstructed from logs: it *is* the record. Every byte that
matters (brief, requirements, risk rules, work, challenge, evidence) is hashed
when it enters the record, and every hash can be recomputed on demand.

```
            ┌──────────────────────────── pure core (no React, unit-tested) ────────────────────────────┐
   UI pages ─▶ AgentRefProvider ──▶ src/core (mint · challenge · settle · evaluate)                       │
       │                              │                                                                 │
       │                              ├─ buildVerificationRequest(r)  ──►  exact payload + payloadHash    │
       │                              │                                        │                         │
       │                              ▼                                        ▼                         │
   localStorage ◀── repo.write ── Receipt (REF-…)              ┌──────────────┴──────────────┐           │
       │                                                       │ SIMULATED        │ GENLAYER │           │
   /r/[id] public read-only view                               │ local model      │ contract.py         │
                                                               │ (evaluate.ts)    │ + runtime.ts         │
                                                               │ source:"simulated"│  → API routes       │
                                                               │                  │  (server signs)     │
                                                               │ source:"simulated"│ source:"genlayer"   │
                                                               └──────────────────┴──────────────────────┘
   ruling ─▶ SIMULATED: parseRulingJson (RulingSchema)  ·  GENLAYER: onchainRuling (live get_receipt() record)
```

### The two adjudicator paths

Both produce an AgentRef **`Ruling`** (`src/core/types.ts`), so the app never
forks on where a verdict came from — only on how it labels it. The SIMULATED
path derives one through the snake_case `RulingSchema` (`parseRulingJson`); the
live GenLayer path builds one from the flat `get_receipt()` record
(`contract.ts` → `onchainRuling`).

| | SIMULATED fallback | GENLAYER (live) |
| --- | --- | --- |
| Where | `src/core/evaluate.ts` | live Bradbury contract via `src/core/genlayer/runtime.ts` |
| Who decides | transparent local rules model | GenLayer validators on Testnet — Bradbury |
| `Ruling.source` | `"simulated"` | `"genlayer"` |
| Labelled in UI | `Simulated fallback` | `GENLAYER` + on-chain `Status` / `Score` / `Reason` |
| Needs | nothing | reads: nothing · writes: `AGENTREF_ACCOUNT_PRIVATE_KEY` (funded) |

**Which one runs:** `/api/genlayer/status` exposes `canAdjudicate`
(`adjudicationCapability()` in `config.ts`) — a boolean derived from server env.
Without a signer key the verify page defaults to the labelled fallback and
disables the GenLayer write button with the reason attached, so the demo always
completes instead of dead-ending; the read-only on-chain path stays available.
The key never crosses to the client.

**Honesty rule:** consensus is never faked. The SIMULATED path never claims to
contact validators; the GENLAYER path never runs without the live contract, and
**the moment an on-chain verdict is shown the SIMULATED result is hidden.** The
`source` field is the single source of truth the whole UI reads.

## 2. Module map

### `src/core` — pure domain
- **`types.ts`** — `Receipt`, `Challenge`, `EvidenceItem`, `Ruling`,
  `SettlementState`, `VerificationRequest`, `RulingSchema`,
  `VerificationSource`, `GenLayerConfigStatus`.
- **`hashing.ts`** — synchronous SHA-256 + canonical JSON (`sort_keys` style),
  no WebCrypto dependency, so it runs on plain-http demo phones and in Node.
- **`receipt.ts`** — `createReceipt` mints and hashes the corpus;
  `verifyIntegrity` recomputes *every* stored hash and reports per-label checks.
- **`challenge.ts`** — `challengeReceipt` freezes reason/requirements/evidence,
  content-hashes each evidence item and body-hashes the whole challenge. A
  receipt can be challenged exactly once.
- **`settlement.ts`** — the escrow state machine
  (`PENDING→CHALLENGED→UNDER_REVIEW→PASSED/FAILED→RELEASED/LOCKED`) with guard
  functions that throw typed errors on illegal transitions.
- **`evaluate.ts`** — the SIMULATED adjudicator: checks each explicit
  requirement (forbid rules via negation detection, obligations via term
  coverage) and each risk requirement against the submitted work, then produces
  a ruling **tagged simulated**. Deterministic and inspectable.
- **`verify/request.ts`** — `buildVerificationRequest(r)` derives the exact
  dispute payload (brief, work, challenge, hashed evidence) and fingerprints it
  (`payloadHash`). Pure function — the payload is reproducible from the record.
- **`verify/parser.ts`** — `normalizeVerdict`, `parseRuling`,
  `parseRulingJson`; lenient on booleans, strict on the verdict. The SIMULATED
  path and legacy JSON rulings go through here; the live GenLayer path builds
  its Ruling from the flat on-chain record via `genlayer/contract.ts`.
- **`genlayer/contract.ts`** — pure model of the **live** deployed contract:
  `LIVE_CONTRACT` (address, network, deploy tx), the `get_receipt()` pipe-delimited
  format parser (`parseReceiptLine`), `verdictForStatus` and `onchainRuling`.
- **`genlayer/config.ts`** — client-safe env → `{kind:"ready"}`, defaulting to
  the live contract (address + `testnet_bradbury`), mapping each accepted
  network label to its camelCase `genlayer-js/chains` export so users only ever
  name a network.
- **`genlayer/runtime.ts`** — **server-only** real path. `adjudicateOnChain`
  runs `create_receipt → challenge → adjudicate()` on the live contract with a
  server-side signer, each write awaited to a FINALIZED, non-error receipt;
  `readOnChainReceipt` reads `get_receipt()` at the latest finalized round (no
  key needed). Static `genlayer-js@1.1.8` imports live here and only here.
- **`app/api/genlayer/{adjudicate,receipt}/route.ts`** — HTTP bridge: the
  browser calls these routes; the SDK and the signing key never cross into the
  client bundle.
- **`store/repo.ts`** — `ReceiptRepo` interface + memory + localStorage impls.
  Frameworks-free and clone-on-access (callers can’t corrupt state).
- **`seeds.ts`** — the three demo scenarios. Receipts, not scripts: they can be
  challenged with arbitrary input or with a bundled suggested dispute.

### `src/lib` — state + presentation glue
- **`agentref-provider.tsx`** — React provider. Hydrates from the repo exactly
  once post-mount (SSR-safe), keeps a reactive snapshot, and persists every
  change. All transitions call the pure core, so illegal transitions throw the
  same typed errors the pages surface.
- **`labels.ts` / `format.ts`** — state→pill mappings and formatting helpers.

### `src/components`
- **`ui.tsx`** — tiny design system (buttons, cards, badges, chips, fields).
- **`receipt-view.tsx`** — the *entire record* rendered read-only. The detail
  page and the public `/r/[id]` page render this same component, so a receipt
  looks identical everywhere. Integrity check, hash register, timeline,
  challenge, ruling and provenance all live here.
- **`app-nav.tsx`** — header with live counts.

### `src/app`
Standard App Router pages (see README → Routes). `verify/page.tsx` drives the
staged, honest adjudication flow; `challenge/page.tsx` is the unscripted
dispute composer.

## 3. Why `genlayer-js` is server-only

`genlayer-js` (pinned `1.1.8`, matching the stable testnet) is a real installed
dependency — the adapter is the genuine SDK, not an ambient declaration. To keep
the SDK weight and the signing key off the demo phone and out of the client
bundle, `src/core/genlayer/runtime.ts` is the *only* module that imports it, and
it is reachable exclusively through Next.js route handlers
(`app/api/genlayer/*`) on the server:

- `src/core/genlayer/contract.ts` is the *source of truth* for the live contract
  surface and the `get_receipt()` record format.
- The browser only ever calls the two JSON routes (`/api/genlayer/adjudicate`,
  `/api/genlayer/receipt`); `AGENTREF_ACCOUNT_PRIVATE_KEY` lives in server env
  and never reaches the client.
- Without a signer key the app can still **read** the shared on-chain verdict
  (the address is public); adjudicating (writes) additionally needs the key, and
  the UI is explicit about which is which.

This keeps one guarantee: **the demo is never accidentally lying about
consensus** — there is no half-configured default that silently does nothing,
and a real on-chain ruling is only ever recorded with `source:"genlayer"` after
`runtime.ts` read a FINALIZED `get_receipt()` reporting a decided Status
(`VERIFIED` / `NOT_VERIFIED`), which the UI shows alongside the contract's
Score, Reason and an explorer link.

## 4. Integrity model

`verifyIntegrity(r)` recomputes, and reports label-by-label:

- `briefHash`, each `requirementHashes[i]`, each `riskRequirementHashes[i]`,
  `workHash`, and the `corpusHash` root (canonical JSON of the whole corpus).
- Challenge: each evidence item’s `sha256` (over its verbatim content) and the
  challenge `bodyHash` (canonical JSON of reason + req texts + context +
  hashed evidence).

Because hashing is synchronous and framework-free, a visitor can audit the
record with one tap — including on a shared public link.

## 5. Settlement honesty

`policyForVerdict` maps a verdict to simulated escrow outcomes:

- PASS → `PASSED` → `RELEASED`
- FAIL → `FAILED` → `LOCKED`
- PASS_WITH_MATERIAL_RISK → `PASSED` → `RELEASED`, with the missed material
  risk surfaced prominently (qualified release)

The settlement log records both the verdict state and the escrow state, each
with a note that says “simulated”. No transfer is ever claimed to have happened.

## 6. Tests

`npm test` runs the pure core with Node’s test runner (no DOM): hashing vectors,
receipt minting, lifecycle/state-machine legality, challenge integrity
(tampering is detected), the simulated adjudicator’s verdicts, the verification
request’s payload hash stability, the ruling parser (leniency + strict verdict),
and repo semantics. Contract-level GenLayer tests live under `tests/genlayer/`
and run only in the GenLayer harness (see `genlayer/README.md`).
