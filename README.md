# AgentRef — challengeable AI work receipts

**The missing referee for the agentic economy.**

Agents take briefs, do work, and get paid — but nobody can *check* the work
against the brief after the fact. AgentRef mints a **work receipt**: the brief,
its requirements, the required material-risk disclosures, and the submitted
deliverable are hashed into one tamper-evident record. A buyer who believes the
delivery missed the brief can **challenge it with evidence**, and an
**adjudicator** rules: **PASS**, **FAIL**, or **PASS WITH MATERIAL RISK** —
with a self-explaining reason and a simulated escrow outcome.

Not another agent. Not another chatbot. Not a marketplace. A referee.

> 🧪 Hackathon MVP. Rulings tagged `SIMULATED` come from a transparent local
> rules model (no validators contacted). A real **GenLayer** adjudicator path is
> implemented (see `genlayer/`) and switches on when a contract is deployed.
> Settlement amounts are simulated. Nothing here moves real money.

---

## Quick start

```bash
npm install
npm run dev        # http://localhost:3000
```

No wallet, no network, no credentials required. The full flow runs in the
browser:

1. **Mint a receipt** — paste a brief, its requirements, risk rules and the
   delivered work. Everything is content-hashed.
2. **Challenge it** — state why it missed the brief, pick the violated
   requirements, attach evidence. Escrow moves to *challenged*.
3. **Watch it get ruled** — the corpus goes to an adjudicator and comes back a
   self-explaining verdict, then escrow settles (simulated).

Try the **60-second demo** from the landing page: three seeded scenarios that
are engineered to Pass, Fail, and Pass-with-a-material-risk. Challenge one with
its bundled dispute and watch the verdict.

### Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Next.js dev server |
| `npm run build` / `npm start` | Production build / serve |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm test` | Node test runner over `src/**/*.test.ts` (pure domain, no DOM) |
| `npm run test:genlayer` | Placeholder for the GenLayer harness (needs tooling — see `genlayer/README.md`) |

---

## The core idea

Every dispute reduces to ONE artifact — the **Receipt** (`src/core/types.ts`),
which accumulates:

```
Receipt (REF-…)
 ├─ brief + explicit requirements + risk requirements   ── hashed at mint
 ├─ submitted work                                       ── hashed at mint
 ├─ corpusHash (root over all of the above)
 ├─ Challenge (CHL-…): reason, violated/missed req texts, evidence  ── body-hashed
 │    └─ each EvidenceItem content-hashed (SHA-256)
 ├─ VerificationRequest: the exact payload an adjudicator sees  ── payloadHash
 └─ Ruling: verdict + why + provenance (genlayer | simulated)
```

Because everything is *recomputed on demand*, anyone holding a receipt can press
**Verify integrity** and see each stored hash checked against current content —
so a public receipt link is a genuinely auditable record, not a screenshot.

### Settlement state machine (`src/core/settlement.ts`)

```
PENDING ─challenge─▶ CHALLENGED ─submit─▶ UNDER_REVIEW ─ruling─▶ PASSED | FAILED
                                                                     │        │
PASS ──────────────────────────────▶ RELEASED        FAIL ──────▶ LOCKED
PASS_WITH_MATERIAL_RISK ──────────▶ RELEASED  (with the missed risk on record)
```

`RELEASED` / `LOCKED` are **simulated escrow outcomes** — the UI always says so.

## Routes

| Route | Purpose |
| --- | --- |
| `/` | Landing + the three demo scenarios |
| `/create` | Mint a work receipt (accepts `?seed=`) |
| `/receipts` | The ledger — filterable list of all receipts |
| `/receipts/[id]` | Full record: evidence chain, integrity check, challenge & ruling |
| `/receipts/[id]/challenge` | Raise a dispute (unscripted composer + suggested fast-path) |
| `/receipts/[id]/verify` | Adjudicate: SIMULATED path (default) or real GenLayer (when configured) |
| `/r/[id]` | Public **read-only** receipt (the shared link target) |

## Honesty, by design

AgentRef never fakes the things that matter:

- **No fake consensus.** SIMULATED rulings are produced by a transparent,
  inspectable local model (`src/core/evaluate.ts`) and are *always labelled*
  `SIMULATED — validators were not consulted` in the UI.
- **Real GenLayer when you want it.** `genlayer/contract.py` is a real
  Intelligent Contract (`gl.Contract`) that asks validator nodes to judge a
  dispute via the Equivalence Principle and stores the consensus ruling. Wire it
  up and rulings carry on-chain provenance (`source: "genlayer"`).
- **No fake identities.** Parties are self-attested labels.
- **No fake money.** Escrow amounts and settlement are explicitly simulated.

## Architecture

See **ARCHITECTURE.md** for the module map, the verification boundary, and why
`genlayer-js` is an optional runtime dependency. See **DEMO.md** for a scripted
judge walkthrough.

## Directory map

```
src/
  core/            pure domain — no React, fully unit-tested
    types.ts       the Receipt / Challenge / Ruling model
    receipt.ts     mint + lifecycle + integrity recomputation
    challenge.ts   raise a dispute (evidence hashing)
    settlement.ts  escrow state machine
    evaluate.ts    SIMULATED adjudicator (transparent stand-in)
    verify/        request builder + ruling parser (parser is GenLayer-agnostic)
    genlayer/      config + adapter for the real on-chain path
    store/         repo interface (localStorage / memory)
    seeds.ts       the three demo scenarios
  lib/             provider + presentation helpers
  components/      UI kit + shared ReceiptView + nav
  app/             pages (App Router)
genlayer/          contract.py + deploy notes (the real network path)
```

---

Made for the GenLayer hackathon. Judge the judgment. ⚖️
