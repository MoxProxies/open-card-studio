// Phase 6b in a real browser: report something, work the queue as staff,
// take it down, and check the audit trail.
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { ARTISAN, SHOT_DIR } from "./helpers.mjs";
import { reporter, openApp, go, signUp, fetchJson, fetchAs, statusOf, statusAs, me as whoami, addFrame, publishTemplate, toggleLike } from "./helpers.mjs";

const stamp = Date.now();
const TEMPLATE = `Dodgy Layout ${stamp}`;
const { check, fail, finish } = reporter();

/** Promote an account the way a founder would — is_staff is deliberately
 * not mass-assignable, so this assigns it directly. */
const promote = (id) => execFileSync("php", [ARTISAN, "tinker", "--execute", `$u = App\\Models\\User::find(${id}); $u->is_staff = true; $u->save();`]);

const browser = await chromium.launch();

try {
  console.log("== an author publishes something, a reader reports it ==");
  const author = await openApp(browser);
  await signUp(author, "Off Ender", `off${stamp}@example.com`);
  const authorAccount = await whoami(author);
  await addFrame(author);
  await publishTemplate(author, TEMPLATE);

  const reader = await openApp(browser);
  await signUp(reader, "Rep Orter", `rep${stamp}@example.com`);
  await go(reader, "templates");
  await reader.getByTestId("template-search").fill(TEMPLATE);
  const row = reader.locator(`[data-testid='template-row']:has-text("${TEMPLATE}")`);
  await row.waitFor();
  await toggleLike(row, true);
  await row.getByTestId("template-report").click();
  await reader.getByTestId("report-reason").selectOption("infringement");
  await reader.getByTestId("report-details").fill("That's my artwork.");
  await reader.getByTestId("report-submit").click();
  await reader.getByTestId("report-done").waitFor();
  check("the report was filed", true, await reader.getByTestId("report-done").isVisible());
  await reader.keyboard.press("Escape");
  await reader.waitForTimeout(300);

  console.log("== moderation is invisible to everyone else ==");
  check("no moderation tab for a normal account", 0, await reader.getByTestId("tab-moderation").count());
  check("and the API 404s for them", 404, await statusAs(reader, "/api/moderation/reports"));

  console.log("== a staff account gets the queue ==");
  // The staff page answers prompts with real text, so it opts out of the
  // helper's blanket accept.
  let promptAnswer = "";
  const staff = await openApp(browser, { autoDialog: false });
  staff.on("dialog", (d) => d.accept(promptAnswer));
  await signUp(staff, "Mod Erator", `mod${stamp}@example.com`);
  const staffAccount = await whoami(staff);
  promote(staffAccount.id);
  await staff.reload();
  await staff.getByTestId("app-shell").waitFor();
  check("the moderation tab appears for staff", 1, await staff.getByTestId("tab-moderation").count());
  await go(staff, "moderation");
  const report = staff.locator(`[data-testid='report-row']:has-text("${TEMPLATE}")`).last();
  await report.waitFor();
  check("the report is in the queue", true, await report.isVisible());
  check("with the reporter's note", true, (await report.innerText()).includes("That's my artwork"));
  await staff.screenshot({ path: `${SHOT_DIR}/t1-report-queue.png` });

  console.log("== taking it down ==");
  const pointsBefore = (await fetchJson(staff, `/api/users/${authorAccount.username}`)).stats.points;
  check("the author had earned points from it", true, pointsBefore > 0);
  promptAnswer = "Confirmed infringement.";
  await report.getByTestId("mod-takedown").click();
  await staff.waitForTimeout(1200);
  check("it leaves the open queue", 0, await staff.locator(`[data-testid='report-row']:has-text("${TEMPLATE}")`).count());
  const gallery = await fetchJson(staff, "/api/templates/browse");
  check("and disappears from the gallery", 0, gallery.filter((t) => t.name === TEMPLATE).length);
  const after = await fetchJson(staff, `/api/users/${authorAccount.username}`);
  check("the points it earned are reversed", 0, after.points ?? after.stats.points);
  check("and it's off the author's profile", 0, after.templates.filter((t) => t.name === TEMPLATE).length);

  console.log("== the author sees it gone ==");
  await go(author, "templates");
  await author.getByTestId("template-tab-mine").click();
  await author.waitForTimeout(800);
  check("removed content is hidden from its own author too", false, (await author.getByTestId("page-templates").innerText()).includes(TEMPLATE));

  console.log("== the audit trail ==");
  await staff.getByTestId("mod-tab-audit").click();
  await staff.locator("[data-testid='audit-row']").first().waitFor();
  const trail = await staff.getByTestId("page-moderation").innerText();
  check("the takedown is logged", true, trail.includes("takedown"));
  check("with the moderator's name", true, trail.includes("Mod Erator"));
  check("and the reason they gave", true, trail.includes("Confirmed infringement"));
  await staff.screenshot({ path: `${SHOT_DIR}/t2-audit-trail.png` });

  console.log("== suspending an account ==");
  await go(reader, "profile");
  await reader.waitForTimeout(400);
  const userReportId = (
    await fetchAs(reader, "/api/reports", { method: "POST", body: { type: "user", id: String(authorAccount.id), reason: "impersonation" } })
  ).id;

  await go(staff, "moderation");
  await staff.getByTestId("mod-state").selectOption("open");
  // Addressed by report id, not by text: a dev database accumulates
  // reports from earlier runs against identically-named accounts, and
  // matching on the name suspends whichever one happens to be oldest.
  const userReport = staff.locator(`[data-report-id="${userReportId}"]`);
  await userReport.waitFor();
  promptAnswer = "Repeated infringement.";
  await userReport.getByTestId("mod-suspend").click();
  await staff.waitForTimeout(1200);
  check("the suspended account's profile is gone", 404, await statusOf(staff, `/api/users/${authorAccount.username}`));
  check("and their token stops working", 403, await statusAs(author, "/api/auth/me"));
  await staff.screenshot({ path: `${SHOT_DIR}/t3-after-suspend.png` });

  console.log("== dismissing a report leaves the content alone ==");
  const template2 = `Fine Layout ${stamp}`;
  const author2 = await openApp(browser);
  await signUp(author2, "Inn Ocent", `inn${stamp}@example.com`);
  await addFrame(author2);
  await publishTemplate(author2, template2);
  await go(reader, "templates");
  await reader.getByTestId("template-search").fill(template2);
  const row2 = reader.locator(`[data-testid='template-row']:has-text("${template2}")`);
  await row2.waitFor();
  await row2.getByTestId("template-report").click();
  await reader.getByTestId("report-submit").click();
  await reader.getByTestId("report-done").waitFor();
  await reader.keyboard.press("Escape");

  await go(staff, "moderation");
  const report2 = staff.locator(`[data-testid='report-row']:has-text("${template2}")`).last();
  await report2.waitFor();
  await report2.getByTestId("mod-dismiss").click();
  await staff.waitForTimeout(1000);
  check("the dismissed report leaves the queue", 0, await staff.locator(`[data-testid='report-row']:has-text("${template2}")`).count());
  const stillThere = await fetchJson(staff, "/api/templates/browse");
  check("but the template is untouched", 1, stillThere.filter((t) => t.name === template2).length);
} catch (e) {
  fail(`threw: ${e.message}`);
} finally {
  await browser.close();
}

process.exit(finish() === 0 ? 0 : 1);
