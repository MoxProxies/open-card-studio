// Regression for the crypto.randomUUID whitescreen: `crypto.randomUUID()`
// only exists in a secure context (https://, or the special-cased
// http://localhost) — browsers remove the function entirely on plain
// http://<lan-ip>:port, which is exactly how a developer testing on a real
// phone over the local network hits the dev server (see uuid.ts). Simulate
// that via `page.addInitScript()` before any app code runs.
//
// `delete window.crypto.randomUUID` doesn't work for this: Chromium's
// binding reinstalls it as a fresh own property the next time it's read,
// so the very next access sees a function again. Overriding the property
// with `undefined` via `defineProperty` is what actually sticks, and it
// reproduces the real failure exactly — the app's direct calls throw
// `TypeError: ... is not a function`, same as calling a missing method on
// an insecure origin.
import { chromium } from "playwright";
import { reporter, EDITOR, SHOT_DIR, addFrame } from "./helpers.mjs";

const { check, fail, finish } = reporter();
const browser = await chromium.launch();

try {
  console.log("== the editor still mounts when crypto.randomUUID doesn't exist (plain http://<lan-ip>) ==");
  const context = await browser.newContext();
  await context.addInitScript(() => {
    Object.defineProperty(window.crypto, "randomUUID", { value: undefined, configurable: true, writable: true });
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  await page.goto(EDITOR);
  check(
    "crypto.randomUUID is really gone in this context",
    "undefined",
    await page.evaluate(() => typeof window.crypto.randomUUID),
  );
  // main.tsx calls randomUUID() at module init to seed the empty design, so
  // if the fallback isn't wired up this never resolves — app-shell never
  // appears and this throws a timeout, caught below.
  await page.getByTestId("app-shell").waitFor();
  check("the app mounts with no uncaught page errors", [], pageErrors);
  check("the canvas renders", true, await page.locator("canvas").first().isVisible());

  console.log("== building on the card still works, exercising randomUUID() indirectly ==");
  await addFrame(page);
  check("a frame layer was actually created", 1, await page.locator("[data-testid='layer-row']").count());
  check("still no uncaught page errors", [], pageErrors);
  await page.screenshot({ path: `${SHOT_DIR}/insecure-context.png` });

  await context.close();
} catch (e) {
  fail(`threw: ${e.message}`);
} finally {
  await browser.close();
}

process.exit(finish() === 0 ? 0 : 1);
