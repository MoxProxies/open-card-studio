// Art no longer travels inside the design JSON. This drives the real
// file picker in the toolbar and checks where the bytes ended up.
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { reporter, openApp, go, signUp, signIn, fetchAs, saveDesignAs, SHOT_DIR } from "./helpers.mjs";

const stamp = Date.now();
const EMAIL = `art${stamp}@example.com`;
const { check, fail, finish } = reporter();
const work = mkdtempSync(path.join(tmpdir(), "uploads-"));
const artwork = path.join(work, "artwork.png");
// Distinctive size so the stored image can be told apart from anything
// else the run happens to create.
execFileSync("php", ["-r", `$i=imagecreatetruecolor(900,1300);imagefill($i,0,0,imagecolorallocate($i,120,40,160));imagepng($i,'${artwork}');`]);

const browser = await chromium.launch();

try {
  const page = await openApp(browser);
  await signUp(page, "Art Ist", EMAIL);

  console.log("== adding art uploads it instead of inlining it ==");
  // Signed in, the toolbar's Image button opens the art library — where
  // uploading is one option and reusing something already there is the
  // other.
  await go(page, "design");
  await page.getByTestId("toolbar-image").click();
  await page.getByTestId("art-picker").waitFor();
  await page.locator("[data-testid='art-upload'] input[type=file]").setInputFiles(artwork);
  await page.getByTestId("art-item").first().waitFor();
  check("the upload appears in the picker", 1, await page.getByTestId("art-item").count());
  await page.getByTestId("art-use").first().click();
  await page.waitForFunction(() => document.querySelectorAll("[data-testid='layer-row']").length > 0);
  check("using it becomes a layer", 1, await page.getByTestId("layer-row").count());

  const { uploads, used_bytes } = await fetchAs(page, "/api/uploads");
  check("and the file reached storage", 1, uploads.length);
  check("kept as art", "art", uploads[0]?.kind);
  check("at its own size", 900, uploads[0]?.width);
  check("counted against the quota", true, used_bytes > 0);

  console.log("== the design references it rather than carrying it ==");
  await saveDesignAs(page, `Art design ${stamp}`);
  const saved = (await fetchAs(page, "/api/card-designs")).find((d) => d.name === `Art design ${stamp}`);
  const design = await fetchAs(page, `/api/card-designs/${saved.id}`);
  const image = design.design.layers.find((l) => l.type === "image");
  check("the layer's src is a URL", true, image.src.startsWith("http"));
  check("not a base64 blob", false, image.src.startsWith("data:"));
  check("pointing at the upload", true, image.src.endsWith(uploads[0].id));
  // The whole point: the row stays small no matter how big the art is.
  check("so the stored design is small", true, JSON.stringify(design.design).length < 4000);
  await page.screenshot({ path: `${SHOT_DIR}/u1-art-layer.png` });

  console.log("== the art loads for a signed-out visitor ==");
  const visitor = await openApp(browser);
  const status = await visitor.evaluate((url) => fetch(url, { cache: "no-store" }).then((r) => r.status), image.src);
  check("the image is public", 200, status);

  console.log("== signed out, art still works without an account ==");
  // No account, no library — so the button is still a plain file input.
  check("signed out the button is still a plain file picker", 1, await visitor.locator("[data-testid='toolbar-image'] input[type=file]").count());
  await visitor.locator("[data-testid='toolbar-image'] input[type=file]").setInputFiles(artwork);
  await visitor.waitForFunction(() => document.querySelectorAll("[data-testid='layer-row']").length > 0);
  const anonSrc = await visitor.evaluate(() => document.querySelector("[data-testid='layer-row']") !== null);
  check("an anonymous layer is still added", true, anonSrc);

  console.log("== the art library keeps it for reuse ==");
  await go(page, "library");
  await page.getByTestId("tab-art").click();
  await page.getByTestId("art-grid").waitFor();
  check("the upload is in the library", 1, await page.getByTestId("art-item").count());
  check("with storage accounted for", true, (await page.getByTestId("art-usage").innerText()).includes("used"));
  await page.screenshot({ path: `${SHOT_DIR}/u3-art-library.png` });

  // The whole point of a library: a second design reuses the art without
  // sending the file again.
  await go(page, "design");
  await page.getByTestId("toolbar-image").click();
  await page.getByTestId("art-picker").waitFor();
  await page.getByTestId("art-use").first().click();
  await page.waitForFunction(() => document.querySelectorAll("[data-testid='layer-row']").length > 1);
  check("picking from the library adds a layer", 2, await page.getByTestId("layer-row").count());
  const after = await fetchAs(page, "/api/uploads");
  check("and uploads nothing new", 1, after.uploads.length);

  console.log("== deleting art from the library ==");
  await go(page, "library");
  await page.getByTestId("tab-art").click();
  await page.getByTestId("art-item").first().getByTestId("art-delete").click();
  await page.getByTestId("art-empty").waitFor();
  check("the library empties", 0, await page.getByTestId("art-item").count());
  check("and the file is gone from storage", 0, (await fetchAs(page, "/api/uploads")).uploads.length);

  console.log("== avatars upload too ==");
  await page.getByTestId("account-button").click();
  await page.locator("[data-testid='avatar-upload'] input[type=file]").setInputFiles(artwork);
  await page.waitForFunction(() => {
    const field = document.querySelector("[data-testid='profile-avatar']");
    return field instanceof HTMLInputElement && field.value.includes("/api/uploads/");
  });
  check("the upload fills the avatar field", true, (await page.getByTestId("profile-avatar").inputValue()).includes("/api/uploads/"));
  await page.getByTestId("profile-save").click();
  await page.getByTestId("profile-saved").waitFor();
  const account = await fetchAs(page, "/api/auth/me");
  check("and the profile keeps it", true, (account.avatar_url ?? "").includes("/api/uploads/"));
  await page.screenshot({ path: `${SHOT_DIR}/u2-avatar.png` });
} catch (e) {
  fail(`threw: ${e.message}`);
} finally {
  await browser.close();
  rmSync(work, { recursive: true, force: true });
}

process.exit(finish() === 0 ? 0 : 1);
