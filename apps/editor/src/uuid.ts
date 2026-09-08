/**
 * `crypto.randomUUID()` only exists in a secure context (https://, or the
 * special-cased http://localhost) — browsers remove it entirely on plain
 * http://<lan-ip>:port, which is exactly how a developer testing on a real
 * phone over the local network hits the dev server. Calling it directly
 * throws before React ever mounts. Use this everywhere an id is generated
 * client-side (design/template/upload/layer ids, request correlation ids)
 * instead of calling `crypto.randomUUID()` directly.
 */
export function randomUUID(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6]! & 0x0f) | 0x40; // version 4
    bytes[8] = (bytes[8]! & 0x3f) | 0x80; // variant 10
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  // Last-resort fallback with no crypto API at all. Math.random() is not
  // cryptographically strong, but these ids are only ever client-generated
  // object identifiers (design/template/upload/layer ids), never security
  // tokens, so the reduced randomness is an acceptable tradeoff here.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
