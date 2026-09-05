/**
 * Receipt repository — a tiny storage abstraction so the same domain can run
 * in a browser (localStorage), in Node tests (memory), and on the server.
 * Framework-free and side-effect-light: it never mutates the returned objects.
 */
import type { Receipt } from "../types";

export interface ReceiptRepo {
  list(): Receipt[];
  get(id: string): Receipt | null;
  /** Insert or replace by id. Returns the stored receipt. */
  upsert(r: Receipt): Receipt;
  remove(id: string): boolean;
  /** Replace the whole set (used on first hydrate / reset). */
  replaceAll(items: Receipt[]): void;
  clear(): void;
}

/* ------------------------------------------------------------------ */
/* In-memory (Node tests, SSR fallback)                                */
/* ------------------------------------------------------------------ */

export function createMemoryRepo(): ReceiptRepo {
  const map = new Map<string, Receipt>();
  const clone = (r: Receipt): Receipt => structuredClone(r);
  return {
    list: () =>
      Array.from(map.values())
        .map(clone)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    get: (id) => (map.has(id) ? clone(map.get(id)!) : null),
    upsert: (r) => {
      const stored = clone(r);
      map.set(r.id, stored);
      return clone(stored);
    },
    remove: (id) => map.delete(id),
    replaceAll: (items) => {
      map.clear();
      items.forEach((r) => map.set(r.id, clone(r)));
    },
    clear: () => map.clear(),
  };
}

/* ------------------------------------------------------------------ */
/* localStorage (browser)                                              */
/* ------------------------------------------------------------------ */

export const LOCAL_KEY = "agentref:receipts:v1";

export function hasLocalStorage(): boolean {
  try {
    return typeof window !== "undefined" && !!window.localStorage;
  } catch {
    return false;
  }
}

/**
 * Browser repo backed by localStorage. Falls back to an in-memory repo when
 * storage is unavailable (private mode, SSR). Reading is lazy; every mutation
 * persists immediately.
 */
export function createLocalRepo(): ReceiptRepo {
  if (!hasLocalStorage()) return createMemoryRepo();
  const memory = createMemoryRepo();

  const persist = () => {
    try {
      window.localStorage.setItem(LOCAL_KEY, JSON.stringify(memory.list()));
    } catch {
      /* storage full / unavailable — keep the in-memory copy for the session */
    }
  };
  const hydrate = () => {
    try {
      const raw = window.localStorage.getItem(LOCAL_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) memory.replaceAll(parsed as Receipt[]);
      }
    } catch {
      /* corrupted value — start fresh */
    }
  };
  hydrate();

  return {
    list: () => memory.list(),
    get: (id) => memory.get(id),
    upsert: (r) => {
      const stored = memory.upsert(r);
      persist();
      return stored;
    },
    remove: (id) => {
      const ok = memory.remove(id);
      if (ok) persist();
      return ok;
    },
    replaceAll: (items) => {
      memory.replaceAll(items);
      persist();
    },
    clear: () => {
      memory.clear();
      persist();
    },
  };
}
