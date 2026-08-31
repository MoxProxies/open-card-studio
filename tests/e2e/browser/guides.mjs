// Phase 5 in a real browser: write a guide, publish it, read it as
// someone else, comment, and check the markdown renders safely.
import { chromium } from "playwright";
import { reporter, openApp, go, signUp, fetchJson, me as whoami, toggleLike, SHOT_DIR } from "./helpers.mjs";

const stamp = Date.now();
const TITLE = `Cutting cards at home ${stamp}`;
const { check, fail, finish } = reporter();

const BODY = [
  "# What you'll need",
  "",
  "A **guillotine** cutter and *matte* 300gsm stock.",
  "",
  "- Score first",
  "- Then cut",
  "",
  "> Take your time on the corners.",
  "",
  "Use `bleed` of 3mm. See [the wiki](https://example.com/wiki).",
  "",
  "[not a link](javascript:alert(1))",
  "",
  "[not same-site either](//evil.example.com/steal)",
].join("\n");

const browser = await chromium.launch();
const author = await openApp(browser);
const shot = (n) => author.screenshot({ path: `${SHOT_DIR}/${n}.png` });

try {
  console.log("== guides are readable signed out, writing needs an account ==");
  await go(author, "guides");
  check("the guides tab is a destination", true, await author.getByTestId("page-guides").isVisible());
  check("writing is disabled signed out", true, await author.getByTestId("guide-write").isDisabled());

  await signUp(author, "Guide Writer", `guide${stamp}@example.com`);
  const account = await whoami(author);
  await go(author, "guides");
  check("writing is enabled once signed in", false, await author.getByTestId("guide-write").isDisabled());

  console.log("== write and preview ==");
  await author.getByTestId("guide-write").click();
  await author.getByTestId("post-title").fill(TITLE);
  await author.getByTestId("post-body").fill(BODY);
  await author.getByTestId("post-category").selectOption("cutting");
  await author.getByTestId("post-tags").fill("Cutting, Budget");
  await author.getByTestId("post-preview-toggle").click();
  const preview = author.getByTestId("post-preview");
  await preview.waitFor();
  check("preview renders a heading", 1, await preview.locator("h2").count());
  check("preview renders the list", 2, await preview.locator("li").count());
  check("preview renders bold and italic", true, (await preview.locator("strong").count()) === 1 && (await preview.locator("em").count()) === 1);
  check("preview renders inline code", 1, await preview.locator("code").count());
  check("a safe link becomes an anchor", 1, await preview.locator('a[href="https://example.com/wiki"]').count());
  check("a javascript: link does NOT", 0, await preview.locator('a[href^="javascript:"]').count());
  check("and shows as inert text instead", true, (await preview.innerText()).includes("[not a link](javascript:alert(1))"));
  check("a protocol-relative link does NOT become an anchor either", 0, await preview.locator('a[href^="//"]').count());
  check("and also shows as inert text", true, (await preview.innerText()).includes("[not same-site either](//evil.example.com/steal)"));
  await shot("k1-preview");

  await author.getByTestId("post-visibility").selectOption("published");
  await author.getByTestId("post-save").click();
  await author.getByTestId("post-reader").waitFor();
  check("saving opens the guide", true, (await author.getByTestId("post-heading").innerText()) === TITLE);
  check("and deep-links to its slug", true, /#\/guides\/cutting-cards-at-home/.test(author.url()));
  await shot("k2-published-guide");

  console.log("== the author's controls ==");
  check("the author can edit", 1, await author.getByTestId("post-edit").count());
  check("and see history", 1, await author.getByTestId("post-history").count());
  check("but not report their own guide", 0, await author.getByTestId("post-report").count());
  await author.getByTestId("post-history").click();
  await author.getByTestId("post-revisions").waitFor();
  check("history starts empty", true, (await author.getByTestId("post-revisions").innerText()).includes("this is the original"));

  console.log("== editing records the previous version ==");
  await author.getByTestId("post-edit").click();
  await author.getByTestId("post-body").fill("Completely rewritten advice.");
  await author.getByTestId("post-save").click();
  await author.waitForTimeout(900);
  await author.getByTestId("post-history").click();
  await author.getByTestId("post-revisions").waitFor();
  const history = await author.getByTestId("post-revisions").innerText();
  check("the old version is kept", true, history.includes("Before"));
  check("the guide itself shows the new text", true, (await author.getByTestId("post-reader").innerText()).includes("Completely rewritten advice"));
  await shot("k3-edit-history");

  console.log("== a reader finds it, likes it and comments ==");
  const reader = await openApp(browser);
  await signUp(reader, "Cur Ious", `cur${stamp}@example.com`);
  await go(reader, "guides");
  await reader.getByTestId("guides-search").fill(TITLE);
  const row = reader.locator(`[data-testid='guide-row']:has-text("${TITLE}")`);
  await row.waitFor();
  check("the guide is in the public index", 1, await reader.locator("[data-testid='guide-row']").count());
  await toggleLike(row, true);
  check("liking a guide works from the index", "1", await row.getByTestId("reaction-count").innerText());

  await row.click();
  await reader.getByTestId("post-reader").waitFor();
  check("opening it navigates to the slug", true, /#\/guides\//.test(reader.url()));
  check("a reader can report it", 1, await reader.getByTestId("post-report").count());
  check("but can't edit it", 0, await reader.getByTestId("post-edit").count());
  await reader.getByTestId("comment-draft").fill("This worked, thanks!");
  await reader.getByTestId("comment-submit").click();
  await reader.locator("[data-testid='comment']").waitFor();
  check("the comment appears", 1, await reader.locator("[data-testid='comment']").count());
  await reader.screenshot({ path: `${SHOT_DIR}/k4-reader-comment.png` });

  console.log("== the author moderates their own thread ==");
  await author.reload();
  await author.getByTestId("post-reader").waitFor();
  // The thread is a second fetch after the post itself, so the reader
  // shell being up says nothing about the comments having arrived.
  await author.locator("[data-testid='comment']").first().waitFor();
  check("the author sees the comment", 1, await author.locator("[data-testid='comment']").count());
  check("and can delete it", 1, await author.locator("[data-testid='comment-delete']").count());
  await author.locator("[data-testid='comment-delete']").first().click();
  await author.waitForFunction(() => document.querySelectorAll("[data-testid='comment']").length === 0);
  check("deleting it removes it", 0, await author.locator("[data-testid='comment']").count());

  console.log("== the guide reached the profile and the ledger ==");
  const profile = await fetchJson(author, `/api/users/${account.username}`);
  check("published guides show on the profile", 1, profile.posts.filter((p) => p.title === TITLE).length);
  check("publishing a guide earned points", true, profile.stats.points >= 15);
  check(
    "and the knowledge badge",
    true,
    profile.badges.some((b) => b.id === "first-post"),
  );

  console.log("== a draft stays private ==");
  await go(author, "guides");
  await author.getByTestId("guide-write").click();
  await author.getByTestId("post-title").fill(`Secret draft ${stamp}`);
  await author.getByTestId("post-body").fill("Not ready yet.");
  await author.getByTestId("post-save").click();
  await author.getByTestId("post-reader").waitFor();
  const index = await fetchJson(reader, "/api/posts");
  check("a draft is absent from the public index", 0, index.filter((p) => p.title === `Secret draft ${stamp}`).length);
  await go(author, "guides");
  await author.getByTestId("guides-tab-mine").click();
  await author.waitForTimeout(600);
  check("but shows in My guides", true, (await author.getByTestId("page-guides").innerText()).includes("Secret draft"));
  await shot("k5-my-guides");
} catch (e) {
  fail(`threw: ${e.message}`);
  await shot("k99-failure").catch(() => {});
} finally {
  await browser.close();
}

process.exit(finish() === 0 ? 0 : 1);
