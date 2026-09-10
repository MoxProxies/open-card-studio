import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createEmptyDesign, STANDARD_CARD_SIZE_MM } from "@card-studio/scene-schema";
import { DesignProvider } from "./store/DesignProvider";
import { AppShell } from "./shell/AppShell";
import { DEFAULT_ENTITLEMENTS } from "./entitlements";
import "./styles.css";
import "./fonts.generated.css";
import { preloadEmbeddedFonts } from "./loadEmbeddedFonts";
import { randomUUID } from "./uuid";

preloadEmbeddedFonts();

const design = createEmptyDesign(randomUUID(), STANDARD_CARD_SIZE_MM);
// Dev-only way to preview contentLocked behavior without wiring real auth
// — the embed element (embed.ts) is the actual integration surface and
// has its own can-edit-locked-content attribute/setEntitlements() method;
// this query param only exists for `pnpm dev:editor`.
const entitlements = { ...DEFAULT_ENTITLEMENTS, canEditLockedContent: new URLSearchParams(location.search).has("premium") };

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("#root element not found");

// 100vh on a mobile browser is the *layout* viewport — sized as if the
// address bar/toolbar were already hidden, even while it's still showing.
// Setting it once at load time pins the whole app (BottomTabs included,
// via the height:100% chain down from here) to whatever that was at that
// instant. ToolbarDrawer.tsx's `position: fixed` backdrop, by contrast,
// always sizes itself against the *current* viewport — so if the
// browser's chrome later shows/hides, the two diverge, and the backdrop
// stops short of (or overshoots) the real bottom of the screen, leaving
// BottomTabs visible, undimmed, underneath it. 100dvh tracks the actual
// visible viewport continuously instead, so both stay in agreement; set
// after the 100vh fallback since an unsupported unit is simply ignored,
// leaving the previous value in place rather than erroring.
document.body.style.height = "100vh";
document.body.style.height = "100dvh";
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
