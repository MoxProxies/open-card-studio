// Phase 2 through the shell: profiles are a tab, and an author credit
// navigates to one rather than stacking a dialog.
import { chromium } from "playwright";
import { reporter, openApp, go, signUp, fetchJson, me, addFrame, publishTemplate, API, SHOT_DIR } from "./helpers.mjs";

const stamp = Date.now();
const HANDLE = `nib-${stamp}`;
const TEMPLATE_NAME = `Profile Template ${stamp}`;
const { check, fail, finish } = reporter();

const browser = await chromium.launch();
const page = await openApp(browser);
const shot = (n) => page.screenshot({ path: `${SHOT_DIR}/${n}.png` });

try {
  console.log("== sign up, then edit the profile ==");
  await signUp(page, "Nib Penman", `nib${stamp}@example.com`);
  check("signing up lands on the profile tab", true, await page.getByTestId("page-profile").isVisible());
  await page.getByTestId("account-button").click();
  check("username was assigned at signup", "nib-penman", (await page.getByTestId("profile-username").inputValue()).replace(/-\d+$/, ""));
  await page.getByTestId("profile-username").fill(HANDLE);
  await page.getByTestId("profile-bio").fill("I draw borders for a living.");
  await page.getByTestId("profile-avatar").fill("https://example.com/nib.png");
  await page.getByTestId("profile-save").click();
  await page.getByTestId("profile-saved").waitFor();
  check("profile saved", true, await page.getByTestId("profile-saved").isVisible());
  await shot("p1-profile-editor");

  console.log("== a bad handle is rejected ==");
  await page.getByTestId("profile-username").fill("admin");
  await page.getByTestId("profile-save").click();
  await page.waitForTimeout(600);
  check("still the chosen handle after a refused edit", HANDLE, (await fetchJson(page, `/api/users/${HANDLE}`)).profile.username);
  await page.getByTestId("profile-username").fill(HANDLE);

  console.log("== the public profile is a destination with its own URL ==");
  await page.getByRole("button", { name: "View public profile" }).click();
  await page.getByTestId("page-profile").waitFor();
  check("the URL deep-links to the profile", `#/u/${HANDLE}`, new URL(page.url()).hash);
  check("bio shows on the public profile", "I draw borders for a living.", await page.getByTestId("profile-bio-text").innerText());
  check("nothing published yet", true, (await page.getByTestId("profile-templates").innerText()).includes("Nothing published yet"));
  await shot("p2-empty-profile");

  console.log("== publish a template and a design ==");
  await addFrame(page);
  await publishTemplate(page, TEMPLATE_NAME);
  await go(page, "library");
  await page.getByPlaceholder("Design name").fill(`Profile Design ${stamp}`);
  await page.getByRole("button", { name: "Save" }).click();
  await page.locator("[data-testid='saved-design-row']").first().waitFor();
  check("saved designs expose a visibility control when signed in", true, await page.getByTestId("design-visibility").first().isVisible());
  await page.getByTestId("design-visibility").first().selectOption("published");
  await page.waitForTimeout(600);
  await shot("p3-design-visibility");

  const profile = await fetchJson(page, `/api/users/${HANDLE}`);
  check("both now appear on the public profile", [1, 1], [profile.templates.length, profile.designs.length]);
  check("the profile never carries an email", false, "email" in profile.profile);

  console.log("== a second account finds the author through the gallery ==");
  const other = await openApp(browser);
  await signUp(other, "Vera Verso", `vera${stamp}@example.com`);
  await go(other, "templates");
  await other.getByTestId("template-search").fill(TEMPLATE_NAME);
  const row = other.locator(`[data-testid='template-row']:has-text("${TEMPLATE_NAME}")`);
  await row.waitFor();
  check("the row credits the author by name", "Nib Penman", await row.getByTestId("template-author").innerText());
  await row.getByTestId("template-author").click();
  await other.getByTestId("page-profile").waitFor();
  check("clicking the credit navigates to their profile", `#/u/${HANDLE}`, new URL(other.url()).hash);
  await other.getByTestId("profile-templates").waitFor();
  check("their published template is listed there", true, (await other.getByTestId("profile-templates").innerText()).includes(TEMPLATE_NAME));
  await other.screenshot({ path: `${SHOT_DIR}/p4-author-profile.png` });

  console.log("== the deep link survives a reload ==");
  await other.reload();
  await other.getByTestId("page-profile").waitFor();
  await other.getByTestId("profile-templates").waitFor();
  check("reloading a profile URL reopens that profile", true, (await other.getByTestId("page-profile").innerText()).includes(HANDLE));

  console.log("== reporting ==");
  await other.getByTestId("report-user").click();
  await other.getByTestId("report-reason").selectOption("impersonation");
  await other.getByTestId("report-details").fill("Claims to be an official account.");
  await other.screenshot({ path: `${SHOT_DIR}/p5-report.png` });
  await other.getByTestId("report-submit").click();
  await other.getByTestId("report-done").waitFor();
  check("the report is acknowledged", true, (await other.getByTestId("report-done").innerText()).includes("sent for review"));
  check("and it says nothing was auto-hidden", true, (await other.getByTestId("report-done").innerText()).includes("Nothing is hidden automatically"));
  check("the reported profile is still up", 200, await other.evaluate((u) => fetch(u).then((r) => r.status), `${API}/api/users/${HANDLE}`));

  console.log("== Escape peels one dialog off, not the page under it ==");
  await other.keyboard.press("Escape");
  await other.waitForTimeout(400);
  check("Escape closed the report dialog", 0, await other.getByTestId("report-done").count());
  check("but left the profile page open", true, await other.getByTestId("page-profile").isVisible());

  console.log("== use a template straight from a profile ==");
  await other.getByTestId("profile-use-template").click();
  await other.getByTestId("page-design").waitFor({ state: "visible" });
  await other.waitForFunction(() => document.querySelectorAll("[data-testid='layer-row']").length === 1);
  check("using it from the profile loads the design on the canvas", 1, await other.locator("[data-testid='layer-row']").count());
  check("and counted as a use", 1, (await fetchJson(other, "/api/templates/browse")).find((t) => t.name === TEMPLATE_NAME)?.usage_count);
  await other.screenshot({ path: `${SHOT_DIR}/p6-used-from-profile.png` });

  console.log("== you can't report yourself ==");
  await go(page, "profile");
  await page.getByTestId("profile-templates").waitFor();
  check("no report button on your own profile", 0, await page.getByTestId("report-user").count());
} catch (e) {
  fail(`threw: ${e.message}`);
  await shot("p99-failure").catch(() => {});
} finally {
  await browser.close();
}

process.exit(finish() === 0 ? 0 : 1);
