"use client";

/**
 * AgentRef state provider.
 *
 * One source of truth: the ReceiptRepo (localStorage in the browser). The
 * provider hydrates once on mount (never during SSR/hydration render), keeps a
 * React snapshot for the UI, and persists every change. All transitions run
 * through the pure core domain (src/core) so a transition that is illegal
 * throws the same typed error everywhere — the UI just surfaces it.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ChallengeInput } from "../core/challenge";
import { challengeReceipt } from "../core/challenge";
import type { Challenge as ReceiptChallenge, Receipt, Ruling } from "../core/types";
import type { NewReceiptInput } from "../core/receipt";
import { createReceipt as createCoreReceipt } from "../core/receipt";
import { buildDemoReceipts, suggestedChallengeFor } from "../core/seeds";
import { applyRuling, markUnderReview } from "../core/settlement";
import { createLocalRepo } from "../core/store/repo";

export interface AgentRefApi {
  hydrated: boolean;
  receipts: Receipt[];
  getReceipt: (id: string) => Receipt | undefined;
  createReceipt: (input: NewReceiptInput) => Receipt;
  challenge: (id: string, input: ChallengeInput) => { receipt: Receipt; challenge: ReceiptChallenge };
  /** CHALLENGED → UNDER_REVIEW. */
  submitForReview: (id: string) => Receipt;
  /** Persist a ruling that has ALREADY been produced (simulated or GenLayer). */
  recordRuling: (id: string, ruling: Ruling) => Receipt;
  /** Load the three seed scenarios (fresh receipts) without clobbering progress. */
  loadDemoSet: () => Receipt[];
  /** Suggested challenge for a seed, for a ~60-90s judge walkthrough. */
  suggestedChallengeFor: (seedId: string) => ChallengeInput | null;
  deleteReceipt: (id: string) => void;
  resetAll: () => void;
}

const Ctx = createContext<AgentRefApi | null>(null);

function upsert(list: Receipt[], next: Receipt): Receipt[] {
  return list.some((r) => r.id === next.id)
    ? list.map((r) => (r.id === next.id ? next : r))
    : [next, ...list];
}

export function AgentRefProvider({ children }: { children: React.ReactNode }) {
  const repo = useMemo(() => createLocalRepo(), []);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [hydrated, setHydrated] = useState(false);

  // Hydrate exactly once, after first paint, so SSR HTML matches.
  useEffect(() => {
    setReceipts(repo.list());
    setHydrated(true);
  }, [repo]);

  // Persist every change (skipped until hydration so we don't clobber storage
  // with the empty initial snapshot).
  const hydratedRef = useRef(hydrated);
  hydratedRef.current = hydrated;
  useEffect(() => {
    if (hydratedRef.current) repo.replaceAll(receipts);
  }, [repo, receipts]);

  const receiptsRef = useRef(receipts);
  receiptsRef.current = receipts;
  const commit = useCallback((next: Receipt | Receipt[]) => {
    setReceipts((prev) => {
      const arr = Array.isArray(next) ? next : upsert(prev, next);
      return arr;
    });
  }, []);

  const getReceipt = useCallback(
    (id: string) => receiptsRef.current.find((r) => r.id === id),
    []
  );

  const createReceipt = useCallback(
    (input: NewReceiptInput) => {
      const r = createCoreReceipt(input);
      commit(r);
      return r;
    },
    [commit]
  );

  const challenge = useCallback(
    (id: string, input: ChallengeInput) => {
      const current = getReceipt(id);
      if (!current) throw new Error("Receipt not found.");
      const { receipt, challenge } = challengeReceipt(current, input);
      commit(receipt);
      return { receipt, challenge };
    },
    [commit, getReceipt]
  );

  const submitForReview = useCallback(
    (id: string) => {
      const current = getReceipt(id);
      if (!current) throw new Error("Receipt not found.");
      const next = markUnderReview(current);
      commit(next);
      return next;
    },
    [commit, getReceipt]
  );

  const recordRuling = useCallback(
    (id: string, ruling: Ruling) => {
      const current = getReceipt(id);
      if (!current) throw new Error("Receipt not found.");
      const next = applyRuling(current, ruling);
      commit(next);
      return next;
    },
    [commit, getReceipt]
  );

  const loadDemoSet = useCallback(() => {
    const existing = receiptsRef.current;
    const added = buildDemoReceipts().filter(
      (demo) => !existing.some((r) => r.seedId === demo.seedId)
    );
    if (added.length) commit(added);
    return added;
  }, [commit]);

  const deleteReceipt = useCallback(
    (id: string) => setReceipts((prev) => prev.filter((r) => r.id !== id)),
    []
  );

  const resetAll = useCallback(() => {
    repo.clear();
    setReceipts([]);
  }, [repo]);

  const api: AgentRefApi = {
    hydrated,
    receipts,
    getReceipt,
    createReceipt,
    challenge,
    submitForReview,
    recordRuling,
    loadDemoSet,
    suggestedChallengeFor,
    deleteReceipt,
    resetAll,
  };

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useAgentRef(): AgentRefApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAgentRef must be used inside <AgentRefProvider>.");
  return ctx;
}
