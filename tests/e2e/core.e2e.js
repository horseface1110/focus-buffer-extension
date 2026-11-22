"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { launchExtension } = require("../helpers/extension.js");

const YT = "https://www.youtube.com/watch";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("core flow in Chromium", async (t) => {
  // 0.05 minutes = a 3-second pass; the wait before continuing is 2 seconds.
  const ext = await launchExtension({ features: [], state: { limitMinutes: 0.05 } });
  t.after(() => ext.close());

  await t.test("the overlay covers a listed site", async () => {
    const page = await ext.newPage(YT);
    await page.waitForSelector("#fb-title");
    assert.match(await page.textContent("#fb-title"), /YouTube/);
    const covers = await page.evaluate(() => {
      const box = document.getElementById("focus-buffer-root").getBoundingClientRect();
      return box.width >= innerWidth && box.height >= innerHeight;
    });
    assert.ok(covers);
    await page.close();
  });

  await t.test("other sites are left alone", async () => {
    const page = await ext.newPage("https://example.org/");
    await sleep(500);
    assert.equal(await page.locator("#focus-buffer-root").count(), 0);
    await page.close();
  });

  await t.test("the popup adds, rejects and removes targets", async () => {
    const popup = await ext.openPopup();
    const titles = () => popup.locator("#target-list .list-title").allTextContents();
    assert.deepEqual(await titles(), ["instagram.com", "facebook.com", "youtube.com"]);

    await popup.fill("#target-input", "https://www.Reddit.com/");
    await popup.click("#add-form button[type=submit]");
    await popup.waitForSelector('.list-item[data-target="reddit.com"]');

    await popup.fill("#target-input", "not a domain!!");
    await popup.click("#add-form button[type=submit]");
    await popup.waitForFunction(() => document.getElementById("toast").textContent.includes("有效"));
    assert.ok(!(await titles()).includes("not a domain!!"));

    await popup.fill("#target-input", "reddit.com");
    await popup.click("#add-form button[type=submit]");
    await popup.waitForFunction(() => document.getElementById("toast").textContent.includes("已經在清單裡"));

    await popup.click('.list-item[data-target="facebook.com"] .btn.danger');
    await popup.waitForFunction(() => !document.querySelector('.list-item[data-target="facebook.com"]'));
    await popup.close();

    const reddit = await ext.newPage("https://old.reddit.com/r/all");
    await reddit.waitForSelector("#fb-title");
    await reddit.close();
    const facebook = await ext.newPage("https://facebook.com/");
    await sleep(500);
    assert.equal(await facebook.locator("#focus-buffer-root").count(), 0);
    await facebook.close();
  });

  await t.test("「關掉這頁」 closes the tab", async () => {
    const page = await ext.newPage(YT);
    await page.waitForSelector("#fb-title");
    const closed = page.waitForEvent("close", { timeout: 5000 });
    await page.click('[data-action="close"]');
    await closed;
  });

  await t.test("continuing waits, then the pass survives reloads and closes the tab when used up", async () => {
    const page = await ext.newPage(YT);
    await page.waitForSelector("#fb-title");
    const startedAt = Date.now();
    await page.click('[data-action="continue"]');
    assert.ok(await page.locator('[data-action="continue"]').isDisabled());
    await page.waitForSelector("#focus-buffer-root", { state: "detached", timeout: 6000 });
    assert.ok(Date.now() - startedAt >= 1800, "the 2-second wait was honoured");

    const passStartedAt = Date.now();
    let closedAt = 0;
    page.on("close", () => {
      closedAt = Date.now();
    });
    // Reloading used to reset the timer. Keep reloading: the tab must still
    // close about 3 seconds after the pass started.
    while (!closedAt && Date.now() - passStartedAt < 9000) {
      await sleep(800);
      if (!closedAt) {
        await page.reload().catch(() => {});
        assert.equal(await page.locator("#fb-title").count().catch(() => 0), 0, "a reload must not bring the overlay back");
      }
    }
    assert.ok(closedAt, "the tab was closed");
    assert.ok(closedAt - passStartedAt < 8000, "closed after " + (closedAt - passStartedAt) + " ms");

    const state = await ext.getState();
    const day = Object.keys(state.dailyUsage)[0];
    assert.ok(state.dailyUsage[day]["youtube.com"] >= 3);
    assert.equal(state.stats[day]["youtube.com"].autoClosed, 1);
  });
});
