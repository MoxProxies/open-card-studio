// Phase 4 in a real browser: one like button across content types, points
// and levels appearing on a profile, badges, and the featured shelf.
import { chromium } from "playwright";
import { reporter, openApp, go, signUp, fetchJson, me as whoami, addFrame, publishTemplate, toggleLike, API, SHOT_DIR } from "./helpers.mjs";

const stamp = Date.now();
const TEMPLATE = `Liked Layout ${stamp}`;
const { check, fail, finish } = reporter();

const browser = await chromium.launch();
const author = await openApp(browser);

try {
  await signUp(author, "Aut Hor", `aut${stamp}@example.com`);
  const me = await whoami(author);

  console.log("== a new account starts at level 1 with nothing ==");
  await go(author, "profile");
  await author.getByTestId("profile-stats").waitFor();
  check("shows level 1", true, (await author.getByTestId("profile-level").innerText()).includes("Level 1"));
  check("shows zero points", true, (await author.getByTestId("profile-points").innerText()).startsWith("0 points"));
  check("no badges yet", 0, await author.getByTestId("profile-badge").count());
  await author.screenshot({ path: `${SHOT_DIR}/g1-new-profile.png` });

  console.log("== publishing a template earns points and a badge ==");
  await addFrame(author);
  await publishTemplate(author, TEMPLATE);

  await go(author, "profile");
  await author.getByTestId("profile-stats").waitFor();
  check("points went up on publishing", true, (await author.getByTestId("profile-points").innerText()).startsWith("10 points"));
  check("earned a badge for it", 1, await author.getByTestId("profile-badge").count());
  check("the badge is the template one", true, (await author.getByTestId("profile-badges").innerText()).includes("Template Author"));
  await author.screenshot({ path: `${SHOT_DIR}/g2-after-publish.png` });

  console.log("== a fan likes it from the gallery ==");
  const fan = await openApp(browser);
  await go(fan, "templates");
  await fan.getByTestId("template-search").fill(TEMPLATE);
  const row = () => fan.locator(`[data-testid='template-row']:has-text("${TEMPLATE}")`);
  await row().waitFor();
  check("signed out, the like button is disabled", true, await row().getByTestId("reaction-button").isDisabled());
  check("and shows a zero count", "0", await row().getByTestId("reaction-count").innerText());
  await signUp(fan, "Fan Person", `fan${stamp}@example.com`);
  await go(fan, "templates");
  await fan.getByTestId("template-search").fill(TEMPLATE);
  await row().waitFor();
  await toggleLike(row(), true);
  check("liking updates the count", "1", await row().getByTestId("reaction-count").innerText());
  check("and marks it reacted", "true", await row().getByTestId("reaction-button").getAttribute("data-reacted"));
  await fan.screenshot({ path: `${SHOT_DIR}/g3-liked.png` });

  check("the author earned a point for it", 11, (await fetchJson(fan, `/api/users/${me.username}`)).stats.points);

  console.log("== unliking removes the like but not the point ==");
  await toggleLike(row(), false);
  check("count back to zero", "0", await row().getByTestId("reaction-count").innerText());
  check("the author keeps the point", 11, (await fetchJson(fan, `/api/users/${me.username}`)).stats.points);
  await toggleLike(row(), true);
  check("re-liking doesn't re-award", 11, (await fetchJson(fan, `/api/users/${me.username}`)).stats.points);

  console.log("== the like survives a reload (it's not just local state) ==");
  await fan.reload();
  await fan.getByTestId("app-shell").waitFor();
  await go(fan, "templates");
  await fan.getByTestId("template-search").fill(TEMPLATE);
  await row().waitFor();
  check("still shown as liked", "true", await row().getByTestId("reaction-button").getAttribute("data-reacted"));

  console.log("== featuring is level-gated ==");
  await go(author, "profile");
  await author.getByTestId("profile-stats").waitFor();
  await author.getByTestId("feature-toggle").click();
  await author.waitForTimeout(700);
  const refusal = await author.getByTestId("page-profile").innerText();
  check("level 1 is refused, with the reason", true, /unlocks at level 2/.test(refusal));
  check("nothing got featured", 0, await author.getByTestId("profile-featured").count());
  await author.screenshot({ path: `${SHOT_DIR}/g4-feature-gated.png` });

  console.log("== cross the threshold, then feature ==");
  // From 11 to 32: publish a design (+2), a collection (+5) and a second
  // template (+10), the fan uses the first template (+2) and likes the
  // design and the collection (+1 each). Level 2 starts at 25.
  await go(author, "library");
  await author.getByPlaceholder("Design name").fill(`Card ${stamp}`);
  await author.getByRole("button", { name: "Save" }).click();
  await author.locator("[data-testid='saved-design-row']").first().waitFor();
  await author.getByTestId("design-visibility").first().selectOption("published");
  await author.waitForTimeout(400);
  await author.getByTestId("tab-collections").click();
  await author.getByTestId("collection-new-name").fill(`Shelf ${stamp}`);
  await author.getByTestId("collection-create").click();
  await author.getByTestId("collection-detail").waitFor();
  await author.getByTestId("collection-detail-visibility").selectOption("published");
  await author.waitForTimeout(500);

  await publishTemplate(author, `Second Layout ${stamp}`);

  await row().getByTestId("template-use").click();
  await fan.waitForTimeout(900);
  const owned = await fetchJson(fan, `/api/users/${me.username}`);
  const react = (type, id) =>
    fan.evaluate(
      async ({ api, type, id }) => {
        const t = localStorage.getItem("card-studio:auth-token:v1");
        await fetch(`${api}/api/reactions`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${t}` },
          body: JSON.stringify({ type, id }),
        });
      },
      { api: API, type, id },
    );
  for (const d of owned.designs) await react("design", d.id);
  for (const c of owned.collections) await react("collection", c.id);

  const crossed = await fetchJson(fan, `/api/users/${me.username}`);
  check("the author is past the level-2 threshold", true, crossed.stats.points >= 25);
  check("and is level 2", 2, crossed.stats.level);

  await author.reload();
  await author.getByTestId("app-shell").waitFor();
  await go(author, "profile");
  await author.getByTestId("profile-stats").waitFor();
  check("the profile shows level 2", true, (await author.getByTestId("profile-level").innerText()).includes("Level 2"));
  check("with more badges now", true, (await author.getByTestId("profile-badge").count()) >= 2);
  await author.getByTestId("feature-toggle").first().click();
  await author.getByTestId("profile-featured").waitFor();
  check("featuring now works", 1, await author.locator("[data-testid='featured-row']").count());
  await author.screenshot({ path: `${SHOT_DIR}/g5-featured.png` });

  console.log("== the featured shelf is public ==");
  check("a stranger sees the shelf", 1, (await fetchJson(fan, `/api/users/${me.username}`)).featured.length);
} catch (e) {
  fail(`threw: ${e.message}`);
  await author.screenshot({ path: `${SHOT_DIR}/g99-failure.png` }).catch(() => {});
} finally {
  await browser.close();
}

process.exit(finish() === 0 ? 0 : 1);
