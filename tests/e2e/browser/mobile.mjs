// Phase 6a: the editor on a phone. Run in a real touch context, because
// the touch-target rules key on the pointer, not the viewport.
import { chromium } from "playwright";
import { reporter, EDITOR, SHOT_DIR } from "./helpers.mjs";

const { check, fail, finish } = reporter();
const browser = await chromium.launch();

const phone = async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("  [pageerror]", e.message));
  await page.goto(EDITOR);
  await page.getByTestId("app-shell").waitFor();
  return page;
};

try {
  console.log("== the editor collapses to canvas + sheet on a phone ==");
  const page = await phone();
  check("a touch context reports a coarse pointer", true, await page.evaluate(() => matchMedia("(pointer: coarse)").matches));
  check("the editor uses its narrow layout", 1, await page.getByTestId("editor-narrow").count());
  check("the side panels aren't columns any more", 0, await page.locator("[data-testid='layer-row']").count());
  check("a sheet switcher is present", 1, await page.getByTestId("editor-sheet-tabs").count());
  check("and no sheet is open by default", 0, await page.getByTestId("editor-sheet").count());
  await page.screenshot({ path: `${SHOT_DIR}/m1-editor-phone.png` });

  console.log("== touch targets clear the 44px floor ==");
  const heights = await page.locator(".cs-btn").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
  check("every toolbar button is at least 44px tall", true, heights.length > 0 && heights.every((h) => h >= 44));
  const tabBox = await page.getByTestId("editor-sheet-layers").boundingBox();
  check("the sheet tabs are too", true, (tabBox?.height ?? 0) >= 44);
  const navBox = await page.getByTestId("tab-design").boundingBox();
  check("so are the app's bottom tabs", true, (navBox?.height ?? 0) >= 44);

  console.log("== the toolbar scrolls rather than eating the canvas ==");
  const toolbar = await page
    .getByTestId("toolbar")
    .evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth, height: el.getBoundingClientRect().height }));
  check("it overflows horizontally", true, toolbar.scroll > toolbar.client);
  check("and stays one row tall", true, toolbar.height < 120);
  const lastTool = page.getByRole("button", { name: /Export/ });
  await lastTool.scrollIntoViewIfNeeded();
  check("the far end of the toolbar is reachable by scrolling", true, await lastTool.isVisible());

  console.log("== the sheet opens, switches and closes ==");
  await page.getByTestId("editor-sheet-layers").click();
  await page.getByTestId("editor-sheet").waitFor();
  check("tapping Layers opens the sheet", true, await page.getByTestId("editor-sheet").isVisible());
  check("with the layers panel in it", "true", await page.getByTestId("editor-sheet-layers").getAttribute("data-active"));
  await page.getByTestId("editor-sheet-properties").click();
  await page.waitForTimeout(200);
  check("tapping Properties switches without closing", true, (await page.getByTestId("editor-sheet").innerText()).includes("Select a layer"));
  await page.getByTestId("editor-sheet-properties").click();
  await page.waitForTimeout(200);
  check("tapping the open tab again closes it", 0, await page.getByTestId("editor-sheet").count());
  await page.getByTestId("editor-sheet-layers").click();
  await page.getByTestId("editor-sheet-close").click();
  check("and so does the close button", 0, await page.getByTestId("editor-sheet").count());

  // Zoomed in past the viewport, the zoom in/out/reset buttons alone can't
  // reach the rest of the card — only a drag can. Konva's mouse-only pan
  // (space+drag, middle-mouse-drag) doesn't fire from a touch gesture, so
  // this exercises the touch equivalent through the same CDP channel real
  // touch input goes through (Playwright's `touchscreen` helper only taps,
  // it can't hold and move). Done before any layer exists, so every point
  // in the viewport is empty canvas space and unambiguously a pan, not a
  // layer drag.
  console.log("== a single-finger drag pans the canvas on touch ==");
  const zoomInButton = page.getByTitle("Zoom in");
  // Just enough to overflow the viewport without the empty, all-white card
  // filling it completely — a blank card with nothing on it renders as one
  // uniform color once it's zoomed in that far, and a before/after
  // screenshot of solid color can't tell a pan happened from a no-op.
  // Some background margin (or a card edge) has to stay in frame so the
  // drag has something visible to move.
  for (let i = 0; i < 2; i++) await zoomInButton.click();
  const zoomLabel = page.getByTitle("Reset to 100%");
  const zoomBefore = await zoomLabel.innerText();
  const stageCanvas = page.locator("canvas").first();
  const cdp = await page.context().newCDPSession(page);
  const stageBox = await stageCanvas.boundingBox();
  const beforePan = await stageCanvas.screenshot();
  const startX = stageBox.x + 20;
  const startY = stageBox.y + 20;
  const endX = startX + 120;
  const endY = startY + 90;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: startX, y: startY }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: (startX + endX) / 2, y: (startY + endY) / 2 }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: endX, y: endY }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(100);
  const afterPan = await stageCanvas.screenshot();
  check("the view visibly moved", true, !beforePan.equals(afterPan));
  check("panning didn't change the zoom level", zoomBefore, await zoomLabel.innerText());
  await zoomLabel.click(); // back to 100% / re-centered, for the sections below

  console.log("== you can actually build something on a phone ==");
  await page.getByRole("button", { name: "Frame", exact: true }).click();
  await page.locator("button.cs-swatch").first().click();
  await page.getByRole("button", { name: "Text", exact: true }).click();
  await page.getByTestId("editor-sheet-layers").click();
  await page.getByTestId("editor-sheet").waitFor();
  await page.waitForFunction(() => document.querySelectorAll("[data-testid='layer-row']").length === 2);
  check("both new layers are listed in the sheet", 2, await page.locator("[data-testid='layer-row']").count());

  console.log("== top-level layers reorder with touch-usable buttons, not just drag ==");
  const layerRows = () => page.locator("[data-testid='layer-row']");
  const idsInOrder = () => layerRows().evaluateAll((els) => els.map((e) => e.getAttribute("data-layer-id")));
  const orderBeforeMove = await idsInOrder();
  await layerRows().nth(0).getByTitle("Move down").click();
  const orderAfterMove = await idsInOrder();
  check("tapping Move down on the front-most row swaps it with the one below", [orderBeforeMove[1], orderBeforeMove[0]], orderAfterMove);
  await layerRows().nth(1).getByTitle("Move up").click();
  check("tapping Move up on it undoes the swap", orderBeforeMove, await idsInOrder());

  await page.locator("[data-testid='layer-row']").first().click();
  await page.getByTestId("editor-sheet-properties").click();
  await page.getByTestId("properties-panel").waitFor();
  check("selecting a layer and switching shows its properties", true, (await page.getByTestId("properties-panel").innerText()).includes("Text"));
  await page.screenshot({ path: `${SHOT_DIR}/m2-editing-on-phone.png` });

  console.log("== the canvas stays visible while the sheet is open ==");
  const canvas = await page.locator("canvas").first().boundingBox();
  check("the canvas keeps real estate", true, (canvas?.height ?? 0) > 150);

  console.log("== nothing changed on a desktop ==");
  const desktop = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const wide = await desktop.newPage();
  await wide.goto(EDITOR);
  await wide.getByTestId("app-shell").waitFor();
  check("the three-pane layout is intact", 0, await wide.getByTestId("editor-narrow").count());
  check("no sheet switcher", 0, await wide.getByTestId("editor-sheet-tabs").count());
  check("the properties panel is a column", true, await wide.getByTestId("properties-panel").isVisible());
  const wideButtons = await wide.locator(".cs-btn").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
  check(
    "a mouse-driven window keeps compact buttons",
    true,
    wideButtons.some((h) => h < 40),
  );
  await wide.screenshot({ path: `${SHOT_DIR}/m3-editor-desktop.png` });

  // The three-pane layout (and its resize dividers) renders on any
  // viewport ≥768px wide — including a landscape tablet, which is
  // touch-only. A wide *and* touch-capable context, distinct from both
  // `page` (narrow+touch) and `wide` (desktop-width+mouse) above.
  console.log("== the resize divider between the panes drags under touch too ==");
  const tabletCtx = await browser.newContext({ viewport: { width: 1024, height: 800 }, hasTouch: true });
  const tablet = await tabletCtx.newPage();
  await tablet.goto(EDITOR);
  await tablet.getByTestId("app-shell").waitFor();
  check("a touch-capable ≥768px viewport still gets the desktop layout", 0, await tablet.getByTestId("editor-narrow").count());

  const handle = tablet.locator(".cs-resize-handle").first();
  const handleBox = await handle.boundingBox();
  const canvasBefore = await tablet.locator("canvas").first().boundingBox();
  const tabletCdp = await tablet.context().newCDPSession(tablet);
  const hx = handleBox.x + handleBox.width / 2;
  const hy = handleBox.y + handleBox.height / 2;
  // This handle owns the layer panel to its right — dragging it right
  // shrinks that panel and grows the canvas area, per App.tsx's comment.
  await tabletCdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: hx, y: hy }] });
  await tabletCdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: hx + 50, y: hy }] });
  await tabletCdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: hx + 100, y: hy }] });
  await tabletCdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  const canvasAfter = await tablet.locator("canvas").first().boundingBox();
  check("dragging the divider by touch resizes the panes", true, canvasAfter.width > canvasBefore.width + 50);
  await tablet.screenshot({ path: `${SHOT_DIR}/m4-tablet-touch-resize.png` });

  // Regression for the leaked-listener bug: trackDrag() used to attach both
  // the mouse and touch listener pairs on every drag start, but each end
  // handler only tore down its own pair — so ending a touch-drag left a
  // stale `mousemove` listener on `window` forever, holding a stale
  // reference point that later fired on unrelated mouse movement and
  // resized the panes with no user intent. Move the (virtual) mouse well
  // away from the handle, with no mousedown, and the canvas must not budge.
  console.log("== ending a touch-drag doesn't leave a stale mousemove listener behind ==");
  await tabletCdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: hx + 300, y: hy + 100, button: "none" });
  await tabletCdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: hx + 400, y: hy + 150, button: "none" });
  const canvasAfterStrayMouse = await tablet.locator("canvas").first().boundingBox();
  check("unrelated mouse movement after a touch-drag leaves the panes alone", canvasAfter.width, canvasAfterStrayMouse.width);
  await tabletCtx.close();
} catch (e) {
  fail(`threw: ${e.message}`);
} finally {
  await browser.close();
}

process.exit(finish() === 0 ? 0 : 1);
