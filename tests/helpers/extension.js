// Launches Chromium with a test copy of the extension for the end-to-end
// tests. The copy differs from the shipped extension in three ways:
//   - every host is granted up front (a permission prompt cannot be clicked
//     from a headless test),
//   - the waits are shortened through FB.config,
//   - optionally only some features are loaded, so a test is not affected by
//     the others.
// Every http(s) request is answered with a small fake page, so no test
// touches the real sites.
//
//   const ext = await launchExtension({ features: ["todos"] });
//   const page = await ext.newPage("https://www.youtube.com/watch");
//   const popup = await ext.openPopup();
//   await ext.close();
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require("playwright-core");

const EXTENSION_DIR = path.join(__dirname, "..", "..", "extension");
const FAST_CONFIG = { WAIT_SECONDS: 2, TICK_MS: 500, MIN_LIMIT_MINUTES: 0.01 };
const FAKE_PAGE =
  '<!doctype html><html><head><meta charset="utf-8"><title>fake site</title></head>' +
  '<body><h1 id="real">real page</h1></body></html>';

function findChromium() {
  if (process.env.FB_CHROMIUM) {
    return process.env.FB_CHROMIUM;
  }
  try {
    const bundled = chromium.executablePath();
    if (bundled && fs.existsSync(bundled)) {
      return bundled;
    }
  } catch (error) {
    // Fall through to the cache lookup.
  }
  const cache = path.join(os.homedir(), "Library", "Caches", "ms-playwright");
  const builds = fs.existsSync(cache)
    ? fs.readdirSync(cache).filter((name) => /^chromium-\d+$/.test(name)).sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]))
    : [];
  for (const build of builds) {
    for (const arch of ["chrome-mac-arm64", "chrome-mac"]) {
      for (const app of ["Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing", "Chromium.app/Contents/MacOS/Chromium"]) {
        const candidate = path.join(cache, build, arch, app);
        if (fs.existsSync(candidate)) {
          return candidate;
        }
      }
    }
  }
  throw new Error("No Chromium found. Run `npx playwright-core install chromium`, or set FB_CHROMIUM to a Chromium binary.");
}

function buildTestCopy({ features, config }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "focus-buffer-ext-"));
  fs.cpSync(EXTENSION_DIR, dir, { recursive: true });

  const manifestPath = path.join(dir, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.host_permissions = ["*://*/*"];
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  let extra = "\nObject.assign(FB.config, " + JSON.stringify(Object.assign({}, FAST_CONFIG, config)) + ");\n";
  if (features) {
    extra += "FB.FEATURE_IDS = " + JSON.stringify(features) + ";\n";
    for (const file of fs.readdirSync(path.join(dir, "features"))) {
      const id = file.replace(/\.(js|css)$/, "");
      if (/\.(js|css)$/.test(file) && !features.includes(id)) {
        fs.writeFileSync(path.join(dir, "features", file), "");
      }
    }
  }
  fs.appendFileSync(path.join(dir, "core.js"), extra);
  return dir;
}

async function launchExtension(options = {}) {
  const extensionDir = buildTestCopy(options);
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "focus-buffer-profile-"));
  const context = await chromium.launchPersistentContext(profileDir, {
    executablePath: findChromium(),
    headless: false,
    // Pages may autoplay, as a real video site does after the user's first click.
    args: ["--headless=new", "--autoplay-policy=no-user-gesture-required", "--disable-extensions-except=" + extensionDir, "--load-extension=" + extensionDir],
    // Only the store-screenshot script sets these two.
    deviceScaleFactor: options.deviceScaleFactor,
    colorScheme: options.colorScheme
  });
  await context.route(/^https?:\/\//, (route) => route.fulfill({ contentType: "text/html", body: options.pageHtml || FAKE_PAGE }));

  const worker = async () => context.serviceWorkers()[0] || context.waitForEvent("serviceworker", { timeout: 15000 });
  const extensionId = new URL((await worker()).url()).host;

  // Runs `fn` inside the service worker, where `FB` and `chrome` are globals.
  const evaluate = async (fn, arg) => {
    try {
      return await (await worker()).evaluate(fn, arg);
    } catch (error) {
      return (await worker()).evaluate(fn, arg);
    }
  };

  const ext = {
    context,
    extensionId,
    evaluate,
    async getState() {
      return evaluate(() => FB.store.get());
    },
    // Merge `patch` into storage.local, then re-register the content script.
    async setState(patch) {
      await evaluate(async (items) => {
        await FB.store.update((state) => Object.assign(state, items));
        await FB.background.syncContentScripts();
      }, patch);
    },
    async newPage(url) {
      const page = await context.newPage();
      if (url) {
        await page.goto(url);
      }
      return page;
    },
    async openPopup() {
      const page = await context.newPage();
      await page.goto("chrome-extension://" + extensionId + "/popup.html");
      await page.waitForSelector("#target-list > *");
      return page;
    },
    async close() {
      await context.close();
      fs.rmSync(extensionDir, { recursive: true, force: true });
      fs.rmSync(profileDir, { recursive: true, force: true });
    }
  };

  // Wait for the install-time setup, then close the welcome tab it opens.
  await evaluate(async () => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if ((await chrome.scripting.getRegisteredContentScripts()).length > 0) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error("content script was never registered");
  });
  for (const page of context.pages()) {
    if (page.url().startsWith("chrome-extension://")) {
      await page.close();
    }
  }
  if (options.state) {
    await ext.setState(options.state);
  }
  return ext;
}

module.exports = { launchExtension, findChromium, EXTENSION_DIR, FAST_CONFIG };
