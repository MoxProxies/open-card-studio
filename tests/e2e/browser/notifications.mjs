// The feedback loop: someone likes and remixes your template, and you
// find out without being told to go looking.
import { chromium } from "playwright";
import { reporter, openApp, go, signUp, addFrame, publishTemplate, SHOT_DIR } from "./helpers.mjs";

const stamp = Date.now();
const TEMPLATE = `Noticed Layout ${stamp}`;
const { check, fail, finish } = reporter();
const browser = await chromium.launch();

try {
  console.log("== an author publishes something ==");
  const author = await openApp(browser);
  await signUp(author, "Aut Hor", `nauth${stamp}@example.com`);
  await addFrame(author);
  await publishTemplate(author, TEMPLATE);

  console.log("== a stranger likes and remixes it ==");
  const fan = await openApp(browser);
  await signUp(fan, "Fa N", `nfan${stamp}@example.com`);
  await go(fan, "templates");
  await fan.getByTestId("template-search").fill(TEMPLATE);
  const row = fan.locator(`[data-testid='template-row']:has-text("${TEMPLATE}")`);
  await row.waitFor();
  await row.getByTestId("reaction-button").click();
  await row.locator("[data-testid='reaction-button'][data-busy='false'][data-reacted='true']").waitFor();
  await row.getByTestId("template-remix").click();
  await fan.getByTestId("template-remix-notice").waitFor();

  console.log("== the author is told, without going looking ==");
  await author.reload();
  await author.getByTestId("account-button").waitFor();
  await author.getByTestId("notifications-badge").waitFor();
  const badge = await author.getByTestId("notifications-badge").innerText();
  check("the bell carries an unread count", true, Number(badge) >= 2);

  await author.getByTestId("notifications-button").click();
  await author.getByTestId("notifications").waitFor();
  // The dialog is up before its fetch resolves, so waiting for the shell
  // says nothing about the rows being in it.
  await author.getByTestId("notification-row").first().waitFor();
  const feed = await author.getByTestId("notifications").innerText();
  check("the like is in the feed", true, feed.includes("Fa N liked"));
  check("so is the remix", true, feed.includes("Fa N remixed"));
  check("and the template it was about", true, feed.includes(TEMPLATE));
  // Publishing earns a badge, and being told about it is the point.
  check("badges show up too", true, feed.includes("badge"));
  await author.screenshot({ path: `${SHOT_DIR}/n1-notifications.png` });

  console.log("== marking them read ==");
  check("unread rows are marked as such", true, (await author.locator("[data-testid='notification-row'][data-read='false']").count()) >= 2);
  await author.getByTestId("notifications-read-all").click();
  await author.waitForFunction(() => document.querySelectorAll("[data-testid='notification-row'][data-read='false']").length === 0);
  check("marking all clears them", 0, await author.locator("[data-testid='notification-row'][data-read='false']").count());
  check("the rows stay, just read", true, (await author.getByTestId("notification-row").count()) >= 2);
  await author.keyboard.press("Escape");
  check("and the bell's badge goes", 0, await author.getByTestId("notifications-badge").count());

  console.log("== your own actions are not news ==");
  await go(fan, "templates");
  const fanNotifications = await fan.evaluate(async () => {
    const token = localStorage.getItem("card-studio:auth-token:v1");
    const res = await fetch(`${window.location.protocol}//127.0.0.1:8001/api/notifications`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      cache: "no-store",
    });
    return res.json();
  });
  check("the person doing the liking hears nothing", 0, fanNotifications.notifications.filter((n) => n.type === "reaction").length);
} catch (e) {
  fail(`threw: ${e.message}`);
} finally {
  await browser.close();
}

process.exit(finish() === 0 ? 0 : 1);
