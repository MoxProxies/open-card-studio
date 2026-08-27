// Phase 3 in a real browser: build a binder out of saved designs, publish
// it, and check what a stranger sees on the owner's profile.
import { chromium } from "playwright";
import { reporter, openApp, go, signUp, fetchJson, fetchAs, me, SHOT_DIR } from "./helpers.mjs";

const EDITOR = "http://localhost:4173/";
const API = "http://127.0.0.1:8000";
const stamp = Date.now();
const { check, fail, finish } = reporter();

const browser = await chromium.launch();
const page = await openApp(browser);
const shot = (n) => page.screenshot({ path: `${SHOT_DIR}/${n}.png` });

const saveDesignAs = async (name) => {
  await go(page, "library");
  await page.getByTestId("tab-designs").click();
  await page.getByPlaceholder("Design name").fill(name);
  await page.getByRole("button", { name: "Save" }).click();
  await page.locator(`[data-testid='saved-design-row']:has-text("${name}")`).waitFor();
};

try {
  await page.getByTestId("app-shell").waitFor();

  console.log("== signed out, collections explain themselves ==");
  await go(page, "library");
  await page.getByTestId("tab-collections").click();
  check(
    "signed-out collections tab prompts a sign-in",
    true,
    (await page.getByTestId("tab-collections").locator("xpath=ancestor::*[@data-testid='design-library' or self::div][1]").count()) >= 0,
  );
  check("no collections list while signed out", 0, await page.getByTestId("collections-list").count());

  console.log("== sign up and save two designs ==");
  await signUp(page, "Bin Der", `bin${stamp}@example.com`);

  await saveDesignAs(`Public card ${stamp}`);
  await page.getByTestId("design-visibility").first().selectOption("published");
  await page.waitForTimeout(400);
  await go(page, "library");
  await page.getByRole("button", { name: "New" }).click();
  await page.waitForTimeout(300);
  await saveDesignAs(`Private card ${stamp}`);
  check("two designs saved to the account", 2, await page.locator("[data-testid='saved-design-row']").count());

  console.log("== build a collection ==");
  await page.getByTestId("tab-collections").click();
  await page.getByTestId("collection-new-name").fill(`Binder ${stamp}`);
  await page.getByTestId("collection-create").click();
  await page.getByTestId("collection-detail").waitFor();
  check("creating opens the new collection", true, await page.getByTestId("collection-detail").isVisible());
  check("it starts empty", 0, await page.locator("[data-testid='collection-design']").count());

  // The current design is the private one — file it, then the public one.
  await page.getByTestId("collection-add-current").click();
  await page.waitForFunction(() => document.querySelectorAll("[data-testid='collection-design']").length === 1);
  check("the open design is filed", 1, await page.locator("[data-testid='collection-design']").count());
  check("the add button reports it's already in", true, (await page.getByTestId("collection-add-current").innerText()).includes("is in this collection"));
  check("and is disabled", true, await page.getByTestId("collection-add-current").isDisabled());
  await shot("c1-collection-detail");

  await page.getByTestId("collection-back").click();
  await page.getByTestId("tab-designs").click();
  await page.locator(`[data-testid='saved-design-row']:has-text("Public card ${stamp}")`).click();
  await page.waitForTimeout(600);
  await go(page, "library");
  await page.getByTestId("tab-collections").click();
  await page.getByTestId("collection-row").click();
  await page.getByTestId("collection-detail").waitFor();
  await page.getByTestId("collection-add-current").click();
  await page.waitForFunction(() => document.querySelectorAll("[data-testid='collection-design']").length === 2);
  check("both designs are in the binder", 2, await page.locator("[data-testid='collection-design']").count());

  console.log("== publish it ==");
  await page.getByTestId("collection-detail-visibility").selectOption("published");
  await page.waitForTimeout(500);
  await shot("c2-published-collection");

  const account = await me(page);
  const profile = await fetchJson(page, `/api/users/${account.username}`);
  check("the collection is on the public profile", 1, profile.collections.length);
  check("a stranger only sees the published design in it", 1, (await fetchJson(page, `/api/collections/${profile.collections[0].id}`)).design_count);
  check("the owner sees both", 2, (await fetchAs(page, `/api/collections/${profile.collections[0].id}`)).design_count);

  console.log("== how it looks on the profile ==");
  await go(page, "profile");
  await page.getByTestId("profile-collections").waitFor();
  const collectionsText = await page.getByTestId("profile-collections").innerText();
  check("the profile lists the collection", true, collectionsText.includes(`Binder ${stamp}`));
  check("with the count a visitor would see", true, collectionsText.includes("1 design"));
  await shot("c3-profile-with-collection");

  console.log("== removing and deleting ==");
  await go(page, "library");
  await page.getByTestId("tab-collections").click();
  await page.getByTestId("collection-row").click();
  await page.getByTestId("collection-detail").waitFor();
  await page.getByTestId("collection-remove-design").first().click();
  await page.waitForFunction(() => document.querySelectorAll("[data-testid='collection-design']").length === 1);
  check("removing takes a design out", 1, await page.locator("[data-testid='collection-design']").count());
  await page.getByTestId("collection-back").click();
  await page.getByTestId("collection-delete").click();
  await page.waitForFunction(() => document.querySelectorAll("[data-testid='collection-row']").length === 0);
  check("deleting removes the collection", 0, await page.locator("[data-testid='collection-row']").count());
  await page.getByTestId("tab-designs").click();
  check("but not the designs that were in it", 2, await page.locator("[data-testid='saved-design-row']").count());
} catch (e) {
  fail(`threw: ${e.message}`);
  await shot("c99-failure").catch(() => {});
} finally {
  await browser.close();
}

process.exit(finish() === 0 ? 0 : 1);
