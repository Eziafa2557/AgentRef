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
                                                               │ (evaluate.ts)    │ + adapter.ts        │
                                                               │ source:"simulated"│ source:"genlayer"   │
                                                               └──────────────────┴──────────────────────┘
   ruling ─▶ parseRulingJson (verify/parser.ts)  ◀── same snake_case schema both paths produce
```

### The two adjudicator paths

Both produce a **ruling in the exact same shape** (`RulingSchema`,
`src/core/types.ts`), so the app never forks on where a verdict came from — only
on how it labels it.

| | SIMULATED | GENLAYER |
| --- | --- | --- |
| Where | `src/core/evaluate.ts` | `genlayer/contract.py` |
| Who decides | transparent local rules model | validator nodes (Equivalence Principle) |
| `Ruling.source` | `"simulated"` | `"genlayer"` |
| Labelled in UI | `SIMULATED — validators not consulted` | `GENLAYER · validator consensus` |
| Needs | nothing | deployed contract + env + optional `genlayer-js` |

**Honesty rule:** consensus is never faked. The SIMULATED path never claims to
contact validators; the GENLAYER path never runs without a real network. The
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
  `parseRulingJson`; lenient on booleans, strict on the verdict. This is the
  single consumer for a ruling from *either* path.
- **`genlayer/config.ts`** — env → `{kind:"not-configured"} | {kind:"ready"}`.
- **`genlayer/adapter.ts`** — the real path. `submitDispute` writes the payload
  to the contract (needs a server-side signer key), `readRuling` reads
  `get_ruling` at the latest finalized round. `genlayer-js` is reached via
  `webpackIgnore` dynamic import so the app builds **without** it installed.
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

## 3. Why `genlayer-js` is optional

Installing a heavy SDK the app never uses (without a deployed contract) would
bake a fake network dependency into the demo. Instead:

- `genlayer/contract.py` is the *source of truth* for what validators return.
- `src/core/genlayer/adapter.ts` only imports the SDK at runtime, and the import
  is `webpackIgnore`d so the build never tries to resolve it.
- Without the SDK or env, `getGenLayerConfig()` returns `not-configured` and the
  UI routes every ruling through the clearly-labelled SIMULATED path.
- Add `genlayer-js` + env when you deploy the contract; the same UI then shows
  real `source:"genlayer"` rulings.

This keeps one guarantee: **the demo is never accidentally lying about
consensus** — there is no half-configured default that silently does nothing.

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
