// Shared driving helpers for the e2e suites — the app is a shell with
// tabs now, so "open the templates gallery" is a navigation, not a modal.
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { fileURLToPath } from "node:url";

/** Where the two servers are. Overridable so CI (and anyone running these
 * against a staging box) doesn't have to match the dev ports. */
export const EDITOR = process.env.E2E_EDITOR_URL ?? "http://localhost:4173/";
export const API = process.env.E2E_API_URL ?? "http://127.0.0.1:8000";

/** The backend's artisan, for the few things only a founder can do (see
 * moderation.mjs's staff promotion). */
/** Where suites drop screenshots. Gitignored — they're for eyeballing a
 * failure, not artefacts to keep. */
export const SHOT_DIR = process.env.SHOT_DIR ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../screenshots");

export const ARTISAN = process.env.E2E_ARTISAN ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../backend/artisan");

export function reporter() {
  const results = [];
  return {
    results,
    check(label, expected, actual) {
      const ok = JSON.stringify(expected) === JSON.stringify(actual);
      results.push(ok);
      console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : ` — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`);
    },
    /** Records a failure without an expected/actual pair — for a suite
     * that threw before it could assert anything. */
    fail(label) {
      results.push(false);
      console.log(`  FAIL  ${label}`);
    },
    finish() {
      const failed = results.filter((r) => !r).length;
      console.log(`\n== ${results.length - failed} passed, ${failed} failed ==`);
      return failed;
    },
  };
}

export async function openApp(browser, { width = 1500, height = 900, autoDialog = true } = {}) {
  const page = await browser.newPage({ viewport: { width, height } });
  page.on("pageerror", (e) => console.log("  [pageerror]", e.message));
  page.on("console", (m) => m.type() === "error" && !m.text().includes("ERR_TUNNEL") && console.log("  [console.error]", m.text()));
  // autoDialog:false for a page that needs to answer a prompt with real
  // text — a blanket accept() returns "" for a prompt, which reads as a
  // cancelled prompt to the code under test.
  if (autoDialog) page.on("dialog", (d) => d.accept());
  await page.goto(EDITOR);
  await page.getByTestId("app-shell").waitFor();
  return page;
}

export const go = async (page, tab) => {
  await page.getByTestId(`tab-${tab}`).click();
  // The editor stays mounted and is hidden rather than unmounted (see
  // AppShell), so wait for it to become visible rather than attached.
  await page.getByTestId(`page-${tab}`).waitFor({ state: "visible" });
};

export async function signUp(page, name, email) {
  await page.getByTestId("sign-in").click();
  await page.getByRole("button", { name: /Need an account/ }).click();
  // exact: the collections panel underneath has a "New collection name"
  // field, and getByPlaceholder matches substrings by default.
  await page.getByPlaceholder("Name", { exact: true }).fill(name);
  await page.getByPlaceholder("Email", { exact: true }).fill(email);
  await page.getByPlaceholder("Password", { exact: true }).fill("password123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByTestId("account-button").waitFor();
}

/**
 * A TOTP code for a base32 secret, computed here rather than asked of the
 * backend: generating and verifying with the same implementation would
 * pass even if that implementation were wrong.
 */
export function totp(secret, offset = 0) {
  const key = base32Decode(secret);
  const counter = Math.floor(Date.now() / 30_000) + offset;
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", key).update(message).digest();
  const start = digest[digest.length - 1] & 0x0f;
  const code = digest.readUInt32BE(start) & 0x7fffffff;
  return String(code % 1_000_000).padStart(6, "0");
}

function base32Decode(secret) {
  const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const character of secret.toUpperCase().replace(/=+$/, "")) {
    bits += ALPHABET.indexOf(character).toString(2).padStart(5, "0");
  }
  const bytes = bits.match(/.{8}/g) ?? [];
  return Buffer.from(bytes.map((byte) => parseInt(byte, 2)));
}

/** Signs in an existing account through the dialog. */
export async function signIn(page, email, password) {
  await page.getByTestId("sign-in").click();
  await page.getByPlaceholder("Email", { exact: true }).fill(email);
  await page.getByPlaceholder("Password", { exact: true }).fill(password);
  await page.locator("form").getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByTestId("account-button").waitFor();
}

// cache: "no-store" throughout — a suite re-reads the same URL after
// changing it server-side, and a cached 200 makes a passing assertion out
// of a stale response.
export const fetchJson = (page, path) =>
  page.evaluate((u) => fetch(u, { cache: "no-store", headers: { Accept: "application/json" } }).then((r) => r.json()), `${API}${path}`);

/** The status of an unauthenticated GET, uncached. */
export const statusOf = (page, path) =>
  page.evaluate((u) => fetch(u, { cache: "no-store", headers: { Accept: "application/json" } }).then((r) => r.status), `${API}${path}`);

/** The status of a GET as the page's signed-in account, uncached. */
export const statusAs = (page, path) =>
  page.evaluate(
    async ({ api, path }) => {
      const token = localStorage.getItem("card-studio:auth-token:v1");
      const res = await fetch(`${api}${path}`, { cache: "no-store", headers: { Accept: "application/json", Authorization: `Bearer ${token}` } });
      return res.status;
    },
    { api: API, path },
  );

/** An authenticated fetch from inside the page, using its stored token. */
export const fetchAs = (page, path, init = {}) =>
  page.evaluate(
    async ({ api, path, init }) => {
      const token = localStorage.getItem("card-studio:auth-token:v1");
      const res = await fetch(`${api}${path}`, {
        ...init,
        cache: "no-store",
        headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: init.body ? JSON.stringify(init.body) : undefined,
      });
      return res.json();
    },
    { api: API, path, init },
  );

export const me = (page) => fetchAs(page, "/api/auth/me");

/** Saves the current design under a name, from the Library tab. */
export async function saveDesignAs(page, name) {
  await go(page, "library");
  await page.getByTestId("tab-designs").click();
  await page.getByPlaceholder("Design name").fill(name);
  await page.getByRole("button", { name: "Save" }).click();
  await page.locator(`[data-testid='saved-design-row']:has-text("${name}")`).waitFor();
}

/** Adds a frame layer so the canvas isn't empty. */
export async function addFrame(page) {
  await go(page, "design");
  await page.getByRole("button", { name: "Frame", exact: true }).click();
  await page.locator("button.cs-swatch").first().click();
  await page.waitForFunction(() => document.querySelectorAll("[data-testid='layer-row']").length > 0);
}

/** Publishes the current design as a template via the Templates tab. */
export async function publishTemplate(page, name, visibility = "published") {
  await go(page, "templates");
  await page.getByTestId("template-save-current").click();
  await page.getByTestId("template-name").fill(name);
  await page.getByTestId("template-visibility").selectOption(visibility);
  await page.getByTestId("template-save-submit").click();
  await page.locator(`[data-testid='template-row']:has-text("${name}")`).waitFor();
}

/**
 * The reset link the email would carry, via the same support command an
 * operator would use (`php artisan auth:reset-link`). Delivery is Brevo's
 * job; the link itself is ours, so it's what gets tested.
 *
 * Deliberately not a `tinker --execute` one-liner: that returns a PHP
 * error message on stdout when anything is off, which then travels
 * downstream as a "token" and fails somewhere unrelated.
 */
export function resetLinkFor(email) {
  const out = execFileSync("php", [ARTISAN, "auth:reset-link", email]).toString().trim();
  const link = out
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.includes("#/reset-password?token="))
    .pop();

  if (!link) throw new Error(`auth:reset-link produced no link for ${email}: ${out}`);

  return link;
}

/**
 * Likes/unlikes within `scope` (a row locator or a page) and waits for the
 * request to actually settle on `expected`.
 *
 * Not just a click: ReactionButton is optimistic, so `data-reacted` flips
 * before the round trip — waiting on it alone lets a reload abort the
 * in-flight request, and lets the *next* click land while the component's
 * busy guard is still swallowing clicks. Waiting for data-busy="false"
 * with the expected data-reacted means the server answered and the
 * component took that answer.
 */
export async function toggleLike(scope, expected) {
  await scope.locator("[data-testid='reaction-button'][data-busy='false']").waitFor();
  await scope.getByTestId("reaction-button").click();
  await scope.locator(`[data-testid='reaction-button'][data-busy='false'][data-reacted='${expected}']`).waitFor();
}
