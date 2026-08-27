// Authentication in a real browser: the sign-in dialog's extras, the
// unconfirmed-email prompt, and the password-reset link end to end.
import { chromium } from "playwright";
import { readFile } from "node:fs/promises";
import { reporter, openApp, go, signUp, signIn, statusAs, me as whoami, resetLinkFor, API, SHOT_DIR, EDITOR } from "./helpers.mjs";

const stamp = Date.now();
const EMAIL = `authui${stamp}@example.com`;
const { check, fail, finish } = reporter();
const browser = await chromium.launch();

try {
  const page = await openApp(browser);

  console.log("== the sign-in dialog ==");
  await page.getByTestId("sign-in").click();
  await page.getByPlaceholder("Email", { exact: true }).waitFor();
  // No OAuth credentials configured in a test run, so no buttons — the
  // form still has to work on its own.
  check("no provider buttons when none are configured", 0, await page.getByTestId("social-providers").count());
  check("but the email form is there", true, await page.getByPlaceholder("Email", { exact: true }).isVisible());

  console.log("== forgot password never says whether the address exists ==");
  await page.getByPlaceholder("Email", { exact: true }).fill(`nobody${stamp}@example.com`);
  await page.getByTestId("forgot-password").click();
  await page.getByTestId("reset-notice").waitFor();
  const unknownAnswer = await page.getByTestId("reset-notice").innerText();
  check("an unknown address gets the neutral answer", true, /if that address has an account/i.test(unknownAnswer));
  await page.keyboard.press("Escape");

  console.log("== sign up, and be told the address isn't confirmed ==");
  await signUp(page, "Auth Tester", EMAIL);
  await page.getByTestId("account-button").click();
  await page.getByTestId("unverified-email").waitFor();
  check("the profile flags an unconfirmed address", true, (await page.getByTestId("unverified-email").innerText()).includes(EMAIL));
  await page.getByTestId("resend-verification").click();
  await page.waitForTimeout(600);
  check("and can resend the confirmation", true, (await page.getByTestId("unverified-email").innerText()).includes("Confirmation email sent"));
  await page.screenshot({ path: `${SHOT_DIR}/a1-unverified.png` });
  await page.keyboard.press("Escape");

  console.log("== sign out everywhere ==");
  await page.getByTestId("account-button").click();
  check("the control is offered", 1, await page.getByTestId("sign-out-everywhere").count());
  await page.keyboard.press("Escape");

  console.log("== signed-in devices ==");
  // A second browser context is a second session on the same account —
  // the case the list exists for.
  const second = await openApp(browser);
  await signIn(second, EMAIL, "password123");
  await page.getByTestId("account-button").click();
  await page.getByTestId("account-sessions").waitFor();
  check("both sessions are listed", 2, await page.getByTestId("session-row").count());
  check("exactly one is this device", 1, await page.locator("[data-testid='session-row'][data-current='true']").count());
  await page.screenshot({ path: `${SHOT_DIR}/a2-sessions.png` });

  const other = page.locator("[data-testid='session-row'][data-current='false']");
  await other.getByTestId("session-revoke").click();
  await other.waitFor({ state: "detached" });
  check("revoking one leaves only this device", 1, await page.getByTestId("session-row").count());
  check("and the other browser's token is dead", 401, await statusAs(second, "/api/auth/me"));
  check("while this one still works", 200, await statusAs(page, "/api/auth/me"));
  await page.keyboard.press("Escape");

  console.log("== data rights ==");
  await page.getByTestId("account-button").click();
  const download = page.waitForEvent("download");
  await page.getByTestId("export-data").click();
  const file = await download;
  check("the export downloads as a file", true, file.suggestedFilename().startsWith("open-card-studio-export"));
  const exported = JSON.parse(await readFile(await file.path(), "utf8"));
  check("and contains this account", EMAIL, exported.account.email);
  check("with every section present", true, ["designs", "templates", "collections", "posts", "comments", "appeals"].every((k) => k in exported));
  await page.getByTestId("export-notice").waitFor();

  await page.getByTestId("delete-account-open").click();
  await page.getByTestId("delete-account").waitFor();
  check("deleting asks for the password", 1, await page.getByTestId("delete-account-confirmation").count());
  await page.getByTestId("delete-account-confirmation").fill("not-the-password");
  await page.getByTestId("delete-account-confirm").click();
  await page.waitForTimeout(600);
  check("a wrong password is refused", true, (await page.getByTestId("delete-account").innerText()).includes("incorrect"));
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  check("and the account survives it", 200, await statusAs(page, "/api/auth/me"));

  console.log("== the reset link opens a form and changes the password ==");
  const link = resetLinkFor(EMAIL);
  const fresh = await openApp(browser);
  await fresh.goto(link);
  await fresh.getByTestId("reset-password").waitFor();
  check("the link opens the reset dialog", true, await fresh.getByTestId("reset-password").isVisible());
  check("the token is scrubbed from the address bar", false, fresh.url().includes("token="));
  await fresh.screenshot({ path: `${SHOT_DIR}/a3-reset-form.png` });

  await fresh.getByTestId("reset-password").fill("brandnew123");
  await fresh.getByTestId("reset-submit").click();
  await fresh.getByTestId("reset-done").waitFor();
  check("it confirms the change", true, (await fresh.getByTestId("reset-done").innerText()).includes("Sign in with your new password"));
  await fresh.getByTestId("reset-done-close").click();
  await fresh.getByPlaceholder("Email", { exact: true }).waitFor();
  check("and hands you to the sign-in form", true, await fresh.getByPlaceholder("Email", { exact: true }).isVisible());

  console.log("== the reset revoked the original session ==");
  check("the old session is dead", 401, await statusAs(page, "/api/auth/me"));

  await fresh.getByPlaceholder("Email", { exact: true }).fill(EMAIL);
  await fresh.getByPlaceholder("Password", { exact: true }).fill("brandnew123");
  await fresh.locator("form").getByRole("button", { name: "Sign in", exact: true }).click();
  await fresh.getByTestId("account-button").waitFor();
  check("the new password signs in", true, await fresh.getByTestId("account-button").isVisible());
  await fresh.screenshot({ path: `${SHOT_DIR}/a4-signed-in-again.png` });

  console.log("== and the account can be closed for good ==");
  await fresh.getByTestId("account-button").click();
  await fresh.getByTestId("delete-account-open").click();
  await fresh.getByTestId("delete-account-confirmation").fill("brandnew123");
  await fresh.getByTestId("delete-account-confirm").click();
  await fresh.getByTestId("sign-in").waitFor();
  check("deleting signs you out", 1, await fresh.getByTestId("sign-in").count());
  const signInStatus = await fresh.evaluate(
    ({ api, email }) =>
      fetch(`${api}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ email, password: "brandnew123" }),
      }).then((r) => r.status),
    { api: API, email: EMAIL }
  );
  check("and the address can't sign in any more", 422, signInStatus);
} catch (e) {
  fail(`threw: ${e.message}`);
} finally {
  await browser.close();
}

process.exit(finish() === 0 ? 0 : 1);
