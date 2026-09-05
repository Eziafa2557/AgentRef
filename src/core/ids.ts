/** Human-friendly, collision-safe identifiers. */
import { sha256Hex } from "./hashing";

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // no I/L/O/U
function randChars(n: number): string {
  let s = "";
  const rnd = new Uint8Array(n);
  try {
    crypto.getRandomValues(rnd);
  } catch {
    // Non-secure fallback (plain http on a phone).
    for (let i = 0; i < n; i++) rnd[i] = Math.floor(Math.random() * 256);
  }
  for (let i = 0; i < n; i++) s += ALPHABET[rnd[i] % ALPHABET.length];
  return s;
}

/** "REF-7K2MQX" — public receipt identifier. */
export function newReceiptId(): string {
  return `REF-${randChars(6)}`;
}

/** "CHL-4P3FGH" — challenge identifier. */
export function newChallengeId(): string {
  return `CHL-${randChars(6)}`;
}

/** "EV-X1Y2Z3" — evidence item identifier. */
export function newEvidenceId(): string {
  return `EV-${randChars(5)}`;
}

/** "AR-<8>" — stable instance/device id for the public store namespace. */
export function instanceId(): string {
  try {
    const s = (navigator.userAgent || "") + (window.location?.origin || "");
    return sha256Hex(s).slice(0, 8);
  } catch {
    return "local";
  }
}
