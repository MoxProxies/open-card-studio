// Phase 1 through the app shell: build a layout, lock it into chrome and a
// fill-in slot, publish it as a template, then rebuild a design from it.
import { chromium } from "playwright";
import { reporter, openApp, go, signUp, fetchJson, addFrame, publishTemplate, API, SHOT_DIR } from "./helpers.mjs";

const stamp = Date.now();
const TEMPLATE_NAME = `E2E Woodgrain ${stamp}`;
const { check, fail, finish } = reporter();

const browser = await chromium.launch();
const page = await openApp(browser);
const shot = (n) => page.screenshot({ path: `${SHOT_DIR}/${n}.png` });
const layerRows = () => page.locator("[data-testid='layer-row']");

async function setLocks(index, { locked, contentLocked }) {
  await layerRows().nth(index).click();
  const panel = page.getByTestId("properties-panel");
  if (locked) await panel.getByTitle("Unlocked (click to lock)", { exact: true }).click();
  if (contentLocked) await panel.getByTestId("content-lock-toggle").click();
}

try {
  console.log("== sign up ==");
  await signUp(page, "Eve Endtoend", `e2e${stamp}@example.com`);
  check("signed in against the real backend", true, await page.getByTestId("account-button").isVisible());

  console.log("== build a layout: frame (chrome) + text (fill-in slot) ==");
  await addFrame(page);
  await page.getByRole("button", { name: "Text", exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll("[data-testid='layer-row']").length === 2);
  await setLocks(0, { locked: true, contentLocked: false });
  await setLocks(1, { locked: true, contentLocked: true });
  await shot("01-editor-locked-layers");

  console.log("== save as a published template ==");
  await go(page, "templates");
  await page.getByTestId("template-save-current").click();
  await page.getByTestId("template-name").fill(TEMPLATE_NAME);
  await page.getByTestId("template-description").fill("End-to-end published layout");
  await page.getByTestId("template-tags").fill("E2E, Rustic");
  const breakdown = (await page.getByTestId("template-lock-breakdown").innerText()).replace(/\n/g, " | ");
  check("dialog reports 1 chrome layer", true, /1 fixed layer/.test(breakdown));
  check("dialog reports 1 fill-in slot", true, /1 fill-in slot/.test(breakdown));
  check("dialog reports 0 unlocked layers", true, /0 unlocked layers/.test(breakdown));
  await page.getByTestId("template-visibility").selectOption("published");
  await shot("02-save-as-template");
  await page.getByTestId("template-save-submit").click();

  await page.locator(`[data-testid='template-row']:has-text("${TEMPLATE_NAME}")`).waitFor();
  check("saving lands on the My templates tab", true, await page.getByTestId("template-tab-mine").evaluate((el) => el.className.includes("cs-active")));
  await shot("03-my-templates");

  console.log("== what actually reached the database ==");
  const gallery = await fetchJson(page, "/api/templates/browse");
  const row = gallery.find((r) => r.name === TEMPLATE_NAME);
  check("published template is in the public gallery", true, Boolean(row));
  check("attributed to its author by name", "Eve Endtoend", row?.author.name);
  check("tags normalized to lowercase", ["e2e", "rustic"], row?.tags);
  const detail = await fetchJson(page, `/api/templates/${row.id}`);
  const flags = detail.design.layers.map((l) => `${l.type}:${l.locked ? "L" : "-"}${l.contentLocked ? "C" : "-"}`);
  check("lock flags stored exactly as authored", ["frame:LC", "text:L-"], flags);

  console.log("== start a blank design, then rebuild it from the template ==");
  await go(page, "library");
  await page.getByRole("button", { name: "New" }).click();
  await page.getByTestId("page-design").waitFor();
  await page.waitForFunction(() => document.querySelectorAll("[data-testid='layer-row']").length === 0);
  check("New lands you back on the canvas", true, await page.getByTestId("page-design").isVisible());
  check("blank design really is blank", 0, await layerRows().count());
  await shot("04-blank-design");

  await go(page, "templates");
  check("opens on the Community tab", true, await page.getByTestId("template-tab-browse").evaluate((el) => el.className.includes("cs-active")));
  await page.getByTestId("template-search").fill(TEMPLATE_NAME);
  await page.locator(`[data-testid='template-row']:has-text("${TEMPLATE_NAME}")`).waitFor();
  check("search finds it in the community gallery", 1, await page.locator("[data-testid='template-row']").count());
  await shot("05-community-gallery");
  await page.locator(`[data-testid='template-row']:has-text("${TEMPLATE_NAME}")`).getByTestId("template-use").click();
  await page.getByTestId("page-design").waitFor();
  await page.waitForFunction(() => document.querySelectorAll("[data-testid='layer-row']").length === 2);
  check("using a template takes you to the canvas", true, await page.getByTestId("page-design").isVisible());
  await shot("06-design-from-template");

  console.log("== the lock model governs the design made from the template ==");
  check("the template's layers landed in the new design", 2, await layerRows().count());
  await layerRows().nth(0).click();
  const slotPanel = page.getByTestId("properties-panel");
  check("slot's X input is disabled (locked in place)", true, await slotPanel.locator("input").nth(1).isDisabled());
  check("slot's Content textarea is editable", true, await slotPanel.locator("textarea").isEditable());
  await slotPanel.locator("textarea").fill("Filled in from the template");
  await slotPanel.locator("textarea").blur();

  await layerRows().nth(1).click();
  const chromePanel = page.getByTestId("properties-panel");
  check("chrome's X input is disabled", true, await chromePanel.locator("input").nth(1).isDisabled());
  check("chrome's Change frame… is disabled", true, await chromePanel.getByRole("button", { name: "Change frame…" }).isDisabled());
  check("chrome's content lock can't be undone without premium", true, await chromePanel.getByTestId("content-lock-toggle").isDisabled());
  await shot("07-chrome-layer-locked");

  await go(page, "library");
  check("new design is named after the template", TEMPLATE_NAME, await page.getByPlaceholder("Design name").inputValue());
  await page.getByRole("button", { name: "Save" }).click();
  await page.locator(`[data-testid='saved-design-row']:has-text("${TEMPLATE_NAME}")`).waitFor();
  check("the filled-in design saves to the account", 1, await page.locator("[data-testid='saved-design-row']").count());
  await shot("08-saved-design");

  console.log("== dialogs are still dialogs, and Escape closes them ==");
  await go(page, "templates");
  await page.getByTestId("template-save-current").click();
  await page.getByTestId("template-name").waitFor();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  check("Escape closes a dialog opened but not clicked into", 0, await page.getByTestId("template-name").count());
  check("and leaves the page underneath", true, await page.getByTestId("page-templates").isVisible());

  console.log("== manage it from the My templates tab ==");
  await page.getByTestId("template-tab-mine").click();
  const mine = page.locator(`[data-testid='template-row']:has-text("${TEMPLATE_NAME}")`);
  await mine.waitFor();
  await mine.getByTestId("template-row-visibility").selectOption("private");
  await page.waitForTimeout(500);
  const afterUnpublish = await fetchJson(page, "/api/templates/browse");
  check(
    "unpublishing removes it from the public gallery",
    undefined,
    afterUnpublish.find((r) => r.name === TEMPLATE_NAME),
  );
  check("but it stays in My templates", 1, await page.locator("[data-testid='template-row']").count());
  await shot("09-unpublished");

  await mine.getByTestId("template-delete").click();
  await page.waitForFunction(() => document.querySelectorAll("[data-testid='template-row']").length === 0);
  check("deleting removes it from My templates", 0, await page.locator("[data-testid='template-row']").count());
  await go(page, "design");
  check("the design made from it is untouched", 2, await layerRows().count());
} catch (e) {
  fail(`threw: ${e.message}`);
  await shot("99-failure").catch(() => {});
} finally {
  await browser.close();
}

process.exit(finish() === 0 ? 0 : 1);
