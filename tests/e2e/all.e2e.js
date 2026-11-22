"use strict";

// The shipped configuration: every feature on, driven through the real UI.

const test = require("node:test");
const assert = require("node:assert/strict");
const { launchExtension } = require("../helpers/extension.js");

const YT = "https://www.youtube.com/watch";
const NOW = Date.now();

test("all features together in Chromium", async (t) => {
  const ext = await launchExtension({
    state: { todos: [{ id: "a", text: "寫報告", done: false, createdAt: NOW, doneAt: 0 }] }
  });
  t.after(() => ext.close());

  const errors = [];
  const watch = (page) => {
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") {
        errors.push(message.text());
      }
    });
    return page;
  };

  await t.test("the popup shows all four tabs and every feature's card", async () => {
    const popup = watch(await ext.openPopup());
    for (const tab of ["sites", "todos", "stats", "modes"]) {
      assert.ok(await popup.locator('.tab[data-tab="' + tab + '"]').isVisible(), tab);
    }
    const features = await popup.evaluate(() => Array.from(new Set(Array.from(document.querySelectorAll(".section[data-feature]")).map((card) => card.dataset.feature))));
    assert.deepEqual(features.sort(), ["reasons", "rest", "stats", "strict", "todos"]);
    await popup.close();
  });

  await t.test("the overlay carries the count, the to-do and the reason form, and a reason is required", async () => {
    const page = watch(await ext.newPage(YT));
    await page.waitForSelector("#fb-title");
    const text = await page.locator("#focus-buffer-root").innerText();
    assert.match(text, /你剛剛打開了 YouTube/);
    // The count is the first figure in the row of today's numbers.
    assert.equal(await page.textContent("#focus-buffer-root .fb-usage .fb-stats-line .fb-usage-number"), "第 1 次");
    assert.equal(await page.textContent("#focus-buffer-root .fb-usage .fb-stats-line .fb-usage-label"), "今天打開");
    assert.match(text, /寫報告/);
    assert.match(text, /為什麼現在要打開？/);

    await page.click('[data-action="continue"]');
    await page.waitForTimeout(300);
    assert.ok(await page.locator('[data-action="continue"]').isEnabled(), "no countdown without a reason");

    await page.fill("#focus-buffer-root input.fb-input", "查資料");
    await page.click('[data-action="continue"]');
    await page.waitForSelector("#focus-buffer-root", { state: "detached", timeout: 6000 });

    const state = await ext.getState();
    assert.equal(state.unlockLog[0].reason, "查資料");
    await page.close();
  });

  await t.test("a break started in the popup opens listed sites, with a countdown pill", async () => {
    const page = watch(await ext.newPage("https://www.instagram.com/"));
    await page.waitForSelector("#fb-title");

    await ext.evaluate(() => FB.background.handlers["rest/start"]({ minutes: 5 }, {}));
    await page.waitForSelector("#focus-buffer-root", { state: "detached", timeout: 5000 });
    await page.waitForSelector("#focus-buffer-page .fb-pill");
    assert.match(await page.locator("#focus-buffer-page .fb-pill").innerText(), /休息中/);
    await page.close();
  });

  await t.test("strict mode ends the break, removes the continue button and locks the settings", async () => {
    const page = watch(await ext.newPage("https://www.instagram.com/"));
    await page.waitForSelector("#focus-buffer-page .fb-pill");

    await ext.evaluate(() => FB.background.handlers["strict/enable"]({ mode: "always" }, {}));
    await page.waitForSelector("#fb-title", { timeout: 5000 });
    assert.equal(await page.locator('[data-action="continue"]').count(), 0);
    assert.match(await page.locator(".fb-status").innerText(), /嚴格模式/);
    await page.close();

    const popup = watch(await ext.openPopup());
    await popup.click('#target-list .list-item[data-target="youtube.com"] .btn.danger');
    await popup.waitForFunction(() => document.getElementById("toast").textContent.includes("嚴格模式"));
    assert.equal(await popup.locator('#target-list .list-item[data-target="youtube.com"]').count(), 1);
    await popup.close();
  });

  await t.test("a tall popup scrolls down but never sideways", async () => {
    // Chrome caps the popup at 600px; the stats tab is taller than that.
    const popup = await ext.context.newPage();
    await popup.setViewportSize({ width: 380, height: 600 });
    await popup.goto("chrome-extension://" + ext.extensionId + "/popup.html#stats");
    await popup.waitForSelector("#target-list > *", { state: "attached" });
    const box = await popup.evaluate(() => {
      const body = document.body;
      const tall = body.scrollHeight > body.clientHeight;
      body.scrollTop = body.scrollHeight;
      const last = document.querySelector(".stats-clear").getBoundingClientRect();
      return {
        tall: tall,
        scrolled: body.scrollTop > 0,
        lastVisible: last.bottom <= innerHeight,
        sideways: body.scrollWidth - body.clientWidth,
        pageSideways: document.documentElement.scrollWidth - innerWidth
      };
    });
    assert.ok(box.tall, "the stats tab should be taller than the popup for this test to mean anything");
    assert.ok(box.scrolled, "the body should scroll");
    assert.ok(box.lastVisible, "the last button should come into view");
    assert.equal(box.sideways, 0);
    assert.equal(box.pageSideways, 0);
    await popup.close();
  });

  await t.test("the popup page never grows past the cap, so Safari's popover can't cut it off", async () => {
    // Safari on the Mac sizes its web view to the whole page instead of
    // scrolling it, so the page itself must stay within the cap.
    const popup = await ext.context.newPage();
    await popup.setViewportSize({ width: 380, height: 1200 });
    await popup.goto("chrome-extension://" + ext.extensionId + "/popup.html#modes");
    await popup.waitForSelector("#target-list > *", { state: "attached" });
    for (const tab of ["sites", "todos", "stats", "modes"]) {
      await popup.click('.tab[data-tab="' + tab + '"]');
      const height = await popup.evaluate(() => Math.ceil(document.documentElement.getBoundingClientRect().height));
      assert.ok(height <= 600, tab + " is " + height + "px tall");
    }
    await popup.close();
  });

  await t.test("no script errors along the way", () => {
    assert.deepEqual(errors, []);
  });
});
