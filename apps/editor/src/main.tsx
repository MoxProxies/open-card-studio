import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createEmptyDesign, STANDARD_CARD_SIZE_MM } from "@card-studio/scene-schema";
import { DesignProvider } from "./store/DesignProvider";
import { AppShell } from "./shell/AppShell";
import { DEFAULT_ENTITLEMENTS } from "./entitlements";
import "./styles.css";
import "./fonts.generated.css";
import { preloadEmbeddedFonts } from "./loadEmbeddedFonts";

preloadEmbeddedFonts();

const design = createEmptyDesign(crypto.randomUUID(), STANDARD_CARD_SIZE_MM);
// Dev-only way to preview contentLocked behavior without wiring real auth
// — the embed element (embed.ts) is the actual integration surface and
// has its own can-edit-locked-content attribute/setEntitlements() method;
// this query param only exists for `pnpm dev:editor`.
const entitlements = { ...DEFAULT_ENTITLEMENTS, canEditLockedContent: new URLSearchParams(location.search).has("premium") };

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("#root element not found");

document.body.style.height = "100vh";
document.body.style.margin = "0";
rootEl.style.height = "100%";

createRoot(rootEl).render(
  <StrictMode>
    {/* hideLocalDesignLibrary: the shell provides navigation to the
        library, templates and the account, so the editor's own copies of
        those buttons would duplicate it. The embed, which has no shell,
        leaves the flag alone and keeps them. */}
    <DesignProvider initialDesign={design} initialEntitlements={entitlements} hideLocalDesignLibrary>
      <AppShell />
    </DesignProvider>
  </StrictMode>
);
