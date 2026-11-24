"use strict";

// The extension follows the system language. Both catalogs carry every
// key, and the English build shows no Chinese anywhere.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { launchExtension, EXTENSION_DIR } = require("../helpers/extension.js");

const HAN = /[一-鿿]/;
const NOW = Date.now();
const catalog = (locale) => JSON.parse(fs.readFileSync(path.join(EXTENSION_DIR, "_locales", locale, "messages.json"), "utf8"));

test("zh_TW and en define the same keys and the same placeholders", () => {
  const zh = catalog("zh_TW");
  const en = catalog("en");
  assert.deepEqual(Object.keys(en).sort(), Object.keys(zh).sort());
  for (const key of Object.keys(zh)) {
    assert.deepEqual(Object.keys(en[key].placeholders || {}).sort(), Object.keys(zh[key].placeholders || {}).sort(), key);
  }
});

test("in English, the overlay and every popup tab are in English", async (t) => {
  const ext = await launchExtension({
    locale: "en",
    state: { todos: [{ id: "a", text: "Write the report", done: false, createdAt: NOW, doneAt: 0 }] }
  });
  t.after(() => ext.close());

  const page = await ext.newPage("https://www.youtube.com/watch");
  await page.waitForSelector("#fb-title");
  assert.equal(await page.textContent("#fb-title"), "You just opened YouTube");
  assert.equal(await page.getAttribute("#focus-buffer-root", "lang"), "en");
  const overlayText = await page.locator("#focus-buffer-root").innerText();
  assert.ok(!HAN.test(overlayText), overlayText);
  await page.close();

  const popup = await ext.openPopup();
  assert.equal(await popup.evaluate(() => document.documentElement.lang), "en");
  for (const tab of ["sites", "todos", "stats", "modes"]) {
    await popup.click('.tab[data-tab="' + tab + '"]');
    const text = await popup.locator("body").innerText();
    assert.ok(!HAN.test(text), tab + ": " + text);
  }
  await popup.close();
});
