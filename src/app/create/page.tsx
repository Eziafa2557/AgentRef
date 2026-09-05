"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { FilePlus2, Info, ReceiptText, Wand2 } from "lucide-react";
import { Suspense, useMemo, useState } from "react";
import { useAgentRef } from "@/lib/agentref-provider";
import { Btn, Card, Field, Label, inputCls } from "@/components/ui";
import { DEMO_SEEDS } from "@/core/seeds";

function lines(s: string): string[] {
  return s
    .split(/\n+/)
    .map((x) => x.replace(/^[-•\d.)\s]+/, "").trim())
    .filter(Boolean);
}

export default function CreatePage() {
  return (
    <Suspense>
      <CreateInner />
    </Suspense>
  );
}

function CreateInner() {
  const router = useRouter();
  const search = useSearchParams();
  const seed = search.get("seed");
  const demo = useMemo(() => DEMO_SEEDS.find((s) => s.seedId === seed), [seed]);
  const { createReceipt } = useAgentRef();

  const [briefTitle, setBriefTitle] = useState(demo?.briefTitle ?? "");
  const [brief, setBrief] = useState(demo?.brief ?? "");
  const [requirements, setRequirements] = useState((demo?.requirements ?? []).join("\n"));
  const [riskRequirements, setRiskRequirements] = useState((demo?.riskRequirements ?? []).join("\n"));
  const [agentName, setAgentName] = useState(demo?.agentName ?? "");
  const [requesterName, setRequesterName] = useState(demo?.requesterName ?? "");
  const [workTitle, setWorkTitle] = useState(demo?.workTitle ?? "");
  const [work, setWork] = useState(demo?.work ?? "");
  const [amount, setAmount] = useState(String(demo?.paymentAmountUsd ?? "1000"));
  const [asset, setAsset] = useState("USDC");
  const [error, setError] = useState<string | null>(null);

  const reqs = lines(requirements);
  const riskReqs = lines(riskRequirements);

  const submit = () => {
    setError(null);
    if (!brief.trim()) return setError("The brief is required — it is what gets hashed and challenged against.");
    if (!work.trim()) return setError("The submitted work is required — this is the deliverable under review.");
    try {
      const r = createReceipt({
        briefTitle: briefTitle.trim(),
        brief: brief.trim(),
        requirements: reqs,
        riskRequirements: riskReqs,
        agentName: agentName.trim(),
        requesterName: requesterName.trim(),
        workTitle: workTitle.trim(),
        work: work.trim(),
        paymentAmountUsd: Math.max(0, Number(amount) || 0),
        paymentAsset: asset,
        createdBy: demo ? "demo" : "user",
        seedId: demo?.seedId,
      });
      router.push(`/receipts/${r.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not mint the receipt.");
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <div>
        <div className="flex items-center gap-2 text-violet-300">
          <ReceiptText className="h-5 w-5" />
          <h1 className="text-xl font-extrabold text-white">Mint a work receipt</h1>
        </div>
        <p className="mt-1 max-w-xl text-sm text-slate-400">
          Capture an AI delivery the way the requester saw it. The brief, its requirements, the risk rules and the
          submitted work are all hashed into one tamper-evident record.
        </p>
      </div>

      {demo && (
        <Card className="flex flex-wrap items-center gap-2 border-violet-400/25 p-3.5">
          <Wand2 className="h-4 w-4 text-violet-300" />
          <p className="text-xs text-slate-300">
            <b className="text-white">Demo scenario loaded:</b> {demo.title} — you can edit everything below or mint as-is
            and challenge it.
          </p>
          <button
            onClick={() => router.replace("/create")}
            className="ml-auto rounded-lg px-2 py-1 text-xs font-medium text-slate-400 hover:text-white"
          >
            start blank
          </button>
        </Card>
      )}

      <Card className="p-5">
        <div className="flex flex-col gap-5">
          <Field>
            <Label>Brief title</Label>
            <input className={inputCls} value={briefTitle} onChange={(e) => setBriefTitle(e.target.value)} placeholder="e.g. Six-month ETH analysis" />
          </Field>

          <Field>
            <Label hint="required · hashed verbatim">The brief</Label>
            <textarea
              className={inputCls + " min-h-[120px]"}
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              placeholder="The instruction the agent was given. Be precise — every clause can be challenged later."
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <Label hint={`one per line · ${reqs.length} total`}>Explicit requirements</Label>
              <textarea
                className={inputCls + " min-h-[96px]"}
                value={requirements}
                onChange={(e) => setRequirements(e.target.value)}
                placeholder={"Analyze ETH for six months.\nDo not recommend leverage.\nDisclose the major risks."}
              />
            </Field>
            <Field>
              <Label hint={`optional · one per line · ${riskReqs.length} total`}>Required material-risk disclosures</Label>
              <textarea
                className={inputCls + " min-h-[96px]"}
                value={riskRequirements}
                onChange={(e) => setRiskRequirements(e.target.value)}
                placeholder={"Clearly disclose the downside risks.\nState the maximum realistic drawdown."}
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <Label hint="optional">Agent / deliverer label</Label>
              <input className={inputCls} value={agentName} onChange={(e) => setAgentName(e.target.value)} placeholder="e.g. Solis Research" />
            </Field>
            <Field>
              <Label hint="optional">Requester label</Label>
              <input className={inputCls} value={requesterName} onChange={(e) => setRequesterName(e.target.value)} placeholder="e.g. Arcadia Capital" />
            </Field>
          </div>

          <Field>
            <Label hint="required · hashed verbatim">Submitted work</Label>
            <textarea
              className={inputCls + " min-h-[150px]"}
              value={work}
              onChange={(e) => setWork(e.target.value)}
              placeholder="Paste the actual deliverable the agent produced — verbatim. This is what a buyer can dispute."
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <Label hint="demo escrow — never real">Escrow amount</Label>
              <div className="relative">
                <span className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-sm text-slate-500">$</span>
                <input
                  className={inputCls + " pl-7"}
                  type="number"
                  inputMode="decimal"
                  min={0}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </div>
            </Field>
            <Field>
              <Label hint="demo convention">Asset</Label>
              <select className={inputCls} value={asset} onChange={(e) => setAsset(e.target.value)}>
                {["USDC", "USDT", "sUSD", "ETH"].map((a) => (
                  <option key={a} value={a} className="bg-base-900">
                    {a}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          {error && <p className="rounded-xl border border-rose-400/20 bg-rose-500/10 px-3.5 py-2.5 text-xs text-rose-200">{error}</p>}

          <Btn size="lg" block onClick={submit}>
            <FilePlus2 className="h-4.5 w-4.5" /> Mint receipt — hash the record
          </Btn>

          <p className="flex items-start gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3.5 py-2.5 text-[11px] leading-relaxed text-slate-500">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Minting hashes the material locally and holds escrow in a simulated state. No wallet, no chain, no real money
            — the record is designed to be challenged and ruled on right here.
          </p>
        </div>
      </Card>
    </div>
  );
}
