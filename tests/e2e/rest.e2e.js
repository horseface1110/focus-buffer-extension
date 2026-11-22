"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { launchExtension } = require("../helpers/extension.js");

const YT = "https://www.youtube.com/watch";
const PILL = "#focus-buffer-page .fb-pill";

async function openModes(ext) {
  const popup = await ext.openPopup();
  await popup.click('.tab[data-tab="modes"]');
  await popup.waitForSelector(".fb-rest");
  return popup;
}

const toastSays = (popup, text) => popup.waitForFunction((wanted) => document.getElementById("toast").textContent.includes(wanted), text);

test("休息模式 in Chromium", async (t) => {
  const ext = await launchExtension({ features: ["rest"] });
  t.after(() => ext.close());

  await t.test("a break from the popup clears an open overlay, shows the pill, and ending it brings the overlay back", async () => {
    const page = await ext.newPage(YT);
    await page.waitForSelector("#fb-title");
    // The overlay offers no way to start a break: that would be a bypass.
    assert.deepEqual(await page.locator("#focus-buffer-root button").allTextContents(), ["關掉這頁", "我真的要繼續"]);

    const popup = await openModes(ext);
    const card = popup.locator(".fb-rest");
    assert.match(await card.locator("h2").textContent(), /休息模式/);
    assert.deepEqual(await card.locator(".chip").allTextContents(), ["5 分鐘", "10 分鐘", "15 分鐘"]);
    assert.equal(await card.locator(".fb-rest-left").textContent(), "今天還剩 3 次");

    await card.locator('.chip[data-minutes="10"]').click();
    assert.equal(await card.locator('.chip[data-minutes="10"]').getAttribute("aria-pressed"), "true");
    assert.equal(await card.locator('.chip[data-minutes="5"]').getAttribute("aria-pressed"), "false");
    await popup.click('[data-action="rest-start"]');

    await popup.waitForSelector('[data-action="rest-stop"]');
    assert.match(await popup.locator(".fb-rest-status").textContent(), /^休息到 \d\d:\d\d$/);
    assert.equal(await popup.locator('[data-action="rest-start"]').count(), 0);

    await page.waitForSelector("#focus-buffer-root", { state: "detached", timeout: 5000 });
    await page.waitForSelector(PILL);
    const first = await page.textContent(PILL);
    assert.match(first, /^休息中，還剩 (10:00|9:\d\d)$/);
    // The pill counts down.
    await page.waitForFunction(([selector, text]) => document.querySelector(selector).textContent !== text, [PILL, first], { timeout: 4000 });
    assert.match(await page.textContent(PILL), /^休息中，還剩 9:\d\d$/);

    // A reload during the break shows the page, not the overlay.
    await page.reload();
    await page.waitForSelector(PILL);
    assert.equal(await page.locator("#fb-title").count(), 0);

    const state = await ext.getState();
    assert.equal(state.rest.minutes, 10);
    assert.deepEqual(Object.values(state.restLog), [1]);

    await popup.click('[data-action="rest-stop"]');
    await popup.waitForSelector('[data-action="rest-start"]');
    assert.equal(await popup.locator(".fb-rest .fb-rest-left").textContent(), "今天還剩 2 次");
    await page.waitForSelector("#fb-title", { timeout: 5000 });
    assert.equal(await page.locator(PILL).count(), 0);

    await popup.close();
    await page.close();
  });

  await t.test("the overlay comes back by itself when the break runs out", async () => {
    const until = Date.now() + 4000;
    await ext.setState({ rest: { until: until, startedAt: Date.now(), minutes: 1 } });

    const page = await ext.newPage(YT);
    await page.waitForSelector(PILL, { timeout: 3000 });
    assert.match(await page.textContent(PILL), /^休息中，還剩 0:0[1-4]$/);
    assert.equal(await page.locator("#fb-title").count(), 0);

    await page.waitForSelector("#fb-title", { timeout: 8000 });
    assert.ok(Date.now() >= until, "the overlay did not come back early");
    assert.ok(Date.now() < until + 3000, "the overlay came back right when the break ended");
    assert.equal(await page.locator(PILL).count(), 0);
    await page.close();
  });

  await t.test("the popup goes back to idle when the break runs out", async () => {
    await ext.setState({ rest: { until: Date.now() + 2500, startedAt: Date.now(), minutes: 1 } });
    const popup = await openModes(ext);
    await popup.waitForSelector('[data-action="rest-stop"]');
    await popup.waitForSelector('[data-action="rest-start"]', { timeout: 6000 });
    await popup.close();
  });

  await t.test("the daily limit is set in the popup and enforced", async () => {
    const popup = await openModes(ext);
    const select = popup.locator('[data-action="rest-limit"]');
    assert.deepEqual(await select.locator("option").allTextContents(), ["0 次", "1 次", "2 次", "3 次", "4 次", "5 次"]);
    assert.equal(await select.inputValue(), "3");

    // One break was used above, so a limit of one leaves none.
    await select.selectOption("1");
    await toastSays(popup, "每天最多休息 1 次");
    assert.equal((await ext.getState()).restDailyLimit, 1);
    await popup.waitForFunction(() => document.querySelector(".fb-rest").textContent.includes("今天的次數用完了"));
    assert.ok(await popup.locator('[data-action="rest-start"]').isDisabled());

    // The service worker refuses too, whatever the popup shows.
    const error = await popup.evaluate(() => FB.send("rest/start", { minutes: 5 }).then(() => "", (problem) => problem.message));
    assert.equal(error, "今天的休息次數用完了。");
    await popup.close();
  });
});
