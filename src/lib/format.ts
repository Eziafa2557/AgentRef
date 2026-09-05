/** Presentational formatting helpers. */

export function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const diff = Math.max(0, Date.now() - then);
  const s = Math.floor(diff / 1000);
  if (s < 8) return "just now";
  const m = Math.floor(s / 60);
  if (m < 1) return `${s}s ago`;
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function fmtUsd(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

/** First 5 + last 4 of a long hash/id, e.g. "REF-1A2B3…9F". */
export function shortKey(id: string, keep = 6, tail = 4): string {
  if (!id) return "—";
  if (id.length <= keep + tail + 1) return id;
  return `${id.slice(0, keep)}…${id.slice(-tail)}`;
}

export function truncate(s: string, n = 140): string {
  if (!s) return "";
  return s.length > n ? `${s.slice(0, n).trimEnd()}…` : s;
}

/** Deliberately honest adjudicator labels — never blurred. */
export function sourceLabel(source: "genlayer" | "simulated"): {
  short: string;
  full: string;
} {
  return source === "genlayer"
    ? {
        short: "GENLAYER",
        full: "Validator consensus (GenLayer)",
      }
    : {
        short: "SIMULATED",
        full: "SIMULATED — validators were not consulted",
      };
}
