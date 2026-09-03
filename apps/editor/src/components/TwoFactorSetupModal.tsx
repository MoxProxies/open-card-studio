import { useEffect, useMemo, useRef, useState } from "react";
import qrcode from "qrcode-generator";
import { Copy, Loader2, ShieldCheck } from "lucide-react";
import { apiErrorMessage } from "../api/client";
import { setCurrentUser, type AuthUser } from "../api/auth";
import { confirmSetup, startSetup, type TwoFactorSetup } from "../api/twoFactor";
import { Modal } from "./Modal";

/**
 * Turning the second factor on: scan, prove it works, write down the
 * recovery codes.
 *
 * The middle step is the one that matters. Enabling without checking a
 * generated code locks out anyone whose scan silently failed or whose
 * phone clock is off — the confirmation *is* the proof that the thing
 * they'll need at the next sign-in actually works.
 */
export function TwoFactorSetupModal({ user, onClose }: { user: AuthUser; onClose: () => void }) {
  const [setup, setSetup] = useState<TwoFactorSetup | null>(null);
  const [code, setCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // startSetup() isn't a plain fetch — it overwrites the account's pending
  // secret server-side on every call. StrictMode's mount/cleanup/remount
  // runs this effect twice, and without this guard that fires it twice too:
  // two secrets get minted, and whichever response resolves last wins the
  // displayed QR/key while whichever request the server *processed* last
  // wins the stored secret — not necessarily the same one. A ref (unlike
  // state) survives that double-invoke, so it makes the second call a
  // no-op instead of a race.
  const requested = useRef(false);
  useEffect(() => {
    if (requested.current) return;
    requested.current = true;
    startSetup()
      .then(setSetup)
      .catch((e) => setError(apiErrorMessage(e, "Couldn't start setup — try again shortly.")));
  }, []);

  // Drawn locally: the QR encodes a secret, and handing that to an
  // image-generating service to draw would be a strange way to protect
  // it.
  const qr = useMemo(() => (setup ? qrPath(setup.otpauth_url) : null), [setup]);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const { recovery_codes } = await confirmSetup(code);
      setRecoveryCodes(recovery_codes);
      setCurrentUser({ ...user, has_two_factor: true });
    } catch (e) {
      setError(apiErrorMessage(e, "That code didn't work. Check your phone's clock and try the next one."));
    } finally {
      setBusy(false);
    }
  };

  if (recoveryCodes) {
    return (
      <Modal
        title="Save your recovery codes"
        onClose={onClose}
        width="min(420px, 92vw)"
        testId="recovery-codes"
        stacked
        footer={
          <button type="button" className="cs-btn cs-active" onClick={onClose} data-testid="recovery-codes-done">
            I've saved them
          </button>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: 16, fontSize: 13 }}>
          <p style={{ margin: 0 }}>
            Two-factor authentication is on. These codes are the way back in if you lose your phone — each works once, and{" "}
            <strong>this is the only time they're shown.</strong>
          </p>
          <pre
            style={{
              margin: 0,
              padding: 12,
              borderRadius: 8,
              background: "var(--cs-surface-soft)",
              fontSize: 13,
              lineHeight: 1.7,
              userSelect: "all",
            }}
            data-testid="recovery-code-list"
          >
            {recoveryCodes.join("\n")}
          </pre>
          <button
            type="button"
            className="cs-btn"
            style={{ alignSelf: "flex-start" }}
            onClick={() => void navigator.clipboard?.writeText(recoveryCodes.join("\n"))}
          >
            <Copy size={14} /> Copy
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      title="Set up two-factor authentication"
      onClose={onClose}
      width="min(420px, 92vw)"
      testId="two-factor-setup"
      stacked
      footer={
        <>
          <button type="button" className="cs-btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="cs-btn cs-active"
            data-testid="two-factor-confirm"
            disabled={busy || !setup || code.trim().length < 6}
            onClick={() => void confirm()}
          >
            {busy ? <Loader2 size={14} className="cs-spin" /> : null} Turn it on
          </button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: 16, fontSize: 13 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
          <ShieldCheck size={20} style={{ flex: "none", color: "var(--cs-accent)" }} />
          <p style={{ margin: 0 }}>Scan this with an authenticator app (Google Authenticator, 1Password, Aegis — any of them), then enter the code it shows.</p>
        </div>

        {!setup && !error && <p style={{ margin: 0, color: "var(--cs-text-muted)" }}>Preparing…</p>}

        {qr && (
          <div style={{ alignSelf: "center", padding: 12, background: "#fff", borderRadius: 8 }} data-testid="two-factor-qr">
            <svg width={200} height={200} viewBox={`0 0 ${qr.size} ${qr.size}`} shapeRendering="crispEdges" role="img" aria-label="Two-factor setup QR code">
              <path d={qr.d} fill="#000" />
            </svg>
          </div>
        )}

        {setup && (
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--cs-text-muted)" }}>
            Can't scan? Type this key in instead
            <code style={{ userSelect: "all", fontSize: 13, wordBreak: "break-all" }} data-testid="two-factor-secret">
              {setup.secret}
            </code>
          </label>
        )}

        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--cs-text-muted)" }}>
          Code from the app
          <input
            className="cs-input"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="123456"
            inputMode="numeric"
            autoComplete="one-time-code"
            data-testid="two-factor-setup-code"
            style={{ fontSize: 16, letterSpacing: 2, textAlign: "center" }}
          />
        </label>

        {error && <p style={{ color: "var(--cs-danger)", margin: 0 }}>{error}</p>}
      </div>
    </Modal>
  );
}

/**
 * The otpauth URI as one SVG path — a `M x y h1 v1 h-1 z` square per dark
 * module.
 *
 * The library will emit its own `<svg>` string, but this codebase renders
 * markup as React elements rather than reaching for
 * dangerouslySetInnerHTML (see markdown.tsx), and a QR code isn't a good
 * reason to make the exception.
 *
 * Type 0 lets the library pick the smallest version that fits; 'M' is the
 * error-correction level authenticator apps' own docs use — enough
 * redundancy for a phone camera at an angle without inflating the grid.
 * QUIET is the 4-module margin the spec requires for a scanner to find
 * the code at all.
 */
function qrPath(uri: string): { d: string; size: number } {
  const QUIET = 4;
  const qr = qrcode(0, "M");
  qr.addData(uri);
  qr.make();

  const count = qr.getModuleCount();
  let d = "";
  for (let row = 0; row < count; row++) {
    for (let column = 0; column < count; column++) {
      if (qr.isDark(row, column)) d += `M${column + QUIET} ${row + QUIET}h1v1h-1z`;
    }
  }

  return { d, size: count + QUIET * 2 };
}
