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

  console.log("== you can actually build something on a phone ==");
  await page.getByRole("button", { name: "Frame", exact: true }).click();
  await page.locator("button.cs-swatch").first().click();
  await page.getByTestId("editor-sheet-layers").click();
  await page.getByTestId("editor-sheet").waitFor();
  check("the new layer is listed in the sheet", 1, await page.locator("[data-testid='layer-row']").count());
  await page.locator("[data-testid='layer-row']").first().click();
  await page.getByTestId("editor-sheet-properties").click();
  await page.getByTestId("properties-panel").waitFor();
  check("selecting it and switching shows its properties", true, (await page.getByTestId("properties-panel").innerText()).includes("Frame"));
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
} catch (e) {
  fail(`threw: ${e.message}`);
} finally {
  await browser.close();
}

process.exit(finish() === 0 ? 0 : 1);
