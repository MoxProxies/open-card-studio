import { Lock } from "lucide-react";
import { Modal } from "./Modal";

interface PremiumFeatureModalProps {
  /** Short name of the gated feature — becomes the dialog's headline, e.g.
   * "AI Art generation" or "Changing this frame". Keep it a noun phrase,
   * not a full sentence; the body below is where the explanation goes. */
  feature: string;
  /** One or two sentences on what's gated and why. Optional — a sensible
   * generic line is used when a call site doesn't need anything more
   * specific than "<feature> requires a premium account." */
  description?: string;
  onClose: () => void;
  /**
   * Called when someone taps the dialog's call-to-action. There's no
   * purchase flow anywhere in this package (see entitlements.ts's doc
   * comment — a host page owns entitlement state, this app never
   * authenticates or bills anyone), so the button only renders at all
   * when a caller actually passes a handler — never a "Buy now" that
   * goes nowhere. No current call site wires this yet: it exists so a
   * future one can, once a host page has somewhere to send the click,
   * without this component needing to change again.
   */
  onUpgradeClick?: () => void;
}

/**
 * The one dialog every premium-gated control opens when a viewer without
 * the entitlement tries to use it — see Toolbar.tsx's Rarity select and
 * AI Art button, and PropertiesPanel.tsx's content-lock toggle, "Change
 * frame…" button, and locked Content field. Same shell as every other
 * dialog (Modal.tsx), same "explain, don't dead-end" job everywhere it's
 * used: a viewer taps a gated control expecting *something* to happen,
 * and disabled-with-only-a-hover-title never fires on a tap in the first
 * place (see this PR's description).
 */
export function PremiumFeatureModal({ feature, description, onClose, onUpgradeClick }: PremiumFeatureModalProps) {
  return (
    <Modal
      title="Premium feature"
      onClose={onClose}
      width="min(380px, 92vw)"
      stacked
      testId="premium-feature-modal"
      footer={
        <>
          {onUpgradeClick && (
            <button type="button" className="cs-btn" onClick={onUpgradeClick} data-testid="premium-feature-modal-upgrade">
              Learn more
            </button>
          )}
          <button type="button" className="cs-btn cs-active" onClick={onClose} autoFocus>
            Got it
          </button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Lock size={18} color="var(--cs-accent)" />
          <strong style={{ fontSize: 15 }} data-testid="premium-feature-modal-title">
            {feature}
          </strong>
        </div>
        <p style={{ margin: 0, fontSize: 14, color: "var(--cs-text-muted)" }}>
          {description ?? `${feature} requires a premium account.`}
        </p>
      </div>
    </Modal>
  );
}
