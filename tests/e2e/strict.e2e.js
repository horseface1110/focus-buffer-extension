"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { launchExtension } = require("../helpers/extension.js");

const YT = "https://www.youtube.com/watch";
const CONTINUE = '#focus-buffer-root [data-action="continue"]';
const STATUS = "#focus-buffer-root .fb-status";

async function openModes(ext) {
  const popup = await ext.openPopup();
  await popup.click('.tab[data-tab="modes"]');
  await popup.waitForSelector(".fb-strict");
  return popup;
}

const toastSays = (popup, text) => popup.waitForFunction((wanted) => document.getElementById("toast").textContent.includes(wanted), text);

test("嚴格模式 in Chromium", async (t) => {
  // 0.05 minutes: turning strict mode off takes 3 seconds.
  const ext = await launchExtension({ features: ["rest", "strict"], config: { STRICT_COOLDOWN_MINUTES: 0.05 } });
  t.after(() => ext.close());

  await t.test("the popup shows the inputs of the chosen mode and says how long switching off takes", async () => {
    const popup = await openModes(ext);
    const card = popup.locator(".fb-strict");
    assert.deepEqual(await card.locator(".chip[data-mode]").allTextContents(), ["全天", "指定時段", "每日額度"]);
    assert.equal(await card.locator('.chip[data-mode="always"]').getAttribute("aria-pressed"), "true");
    assert.equal(await card.locator(".chip[data-day], input").count(), 0);

    assert.equal(await card.locator(".fb-strict-honest").textContent(), "關閉要等 0.05 分鐘才生效。");

    await card.locator('.chip[data-mode="schedule"]').click();
    assert.deepEqual(await card.locator(".chip[data-day]").allTextContents(), ["一", "二", "三", "四", "五", "六", "日"]);
    assert.deepEqual(
      await card.locator(".chip[data-day]").evaluateAll((chips) => chips.map((chip) => chip.getAttribute("aria-pressed"))),
      ["true", "true", "true", "true", "true", "false", "false"]
    );
    assert.equal(await card.locator('input[type="time"]').count(), 2);
    assert.equal(await card.locator('[data-field="start"]').inputValue(), "09:00");
    assert.equal(await card.locator('[data-field="end"]').inputValue(), "18:00");
    assert.match(await card.locator(".switch").textContent(), /每次繼續，等待時間加倍/);
    assert.ok(await card.locator('[data-field="escalate"]').isChecked());
    assert.equal(await card.locator('[data-field="budget"]').count(), 0);

    await card.locator('.chip[data-mode="budget"]').click();
    assert.equal(await card.locator('[data-field="budget"]').inputValue(), "30");
    assert.equal(await card.locator(".chip[data-day], input[type=time]").count(), 0);

    // Nothing fits? The service worker's message is shown and nothing is saved.
    await card.locator('[data-field="budget"]').fill("0");
    await popup.click('[data-action="strict-enable"]');
    await toastSays(popup, "每日額度請輸入 1 到 600 分鐘。");
    assert.equal((await ext.getState()).strict.enabled, false);
    // The half-filled form survives the redraw.
    assert.equal(await popup.locator('.fb-strict .chip[data-mode="budget"]').getAttribute("aria-pressed"), "true");

    // The whole card fits the popup: nothing sticks out sideways.
    await popup.locator('.fb-strict .chip[data-mode="schedule"]').click();
    const overflow = await popup.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.equal(overflow, 0);
    await popup.close();
  });

  await t.test("全天: the overlay has no continue button and says why", async () => {
    const page = await ext.newPage(YT);
    await page.waitForSelector(CONTINUE);

    const popup = await openModes(ext);
    await popup.click('[data-action="strict-enable"]');
    await popup.waitForSelector('[data-action="strict-request-off"]');
    assert.equal(await popup.locator(".fb-strict-status").textContent(), "全天開啟中");
    assert.equal(await popup.locator(".fb-strict-now").textContent(), "現在不能繼續。");
    assert.equal(await popup.locator('[data-action="strict-enable"]').count(), 0);
    await popup.close();

    // The overlay that was already open loses its button without a reload.
    await page.waitForSelector(CONTINUE, { state: "detached", timeout: 5000 });
    assert.equal(await page.textContent(STATUS), "嚴格模式開啟中，現在不能繼續。");
    assert.deepEqual(await page.locator("#focus-buffer-root button").allTextContents(), ["關掉這頁"]);

    const fresh = await ext.newPage(YT);
    await fresh.waitForSelector("#fb-title");
    assert.equal(await fresh.locator(CONTINUE).count(), 0);
    assert.equal(await fresh.textContent(STATUS), "嚴格模式開啟中，現在不能繼續。");
    await fresh.close();
    await page.close();
  });

  await t.test("the popup refuses to remove a site, lengthen the pass or start a break", async () => {
    const popup = await ext.openPopup();
    await popup.click('.list-item[data-target="facebook.com"] .btn.danger');
    await toastSays(popup, "嚴格模式開啟中，不能移除網站。");
    assert.equal(await popup.locator('.list-item[data-target="facebook.com"]').count(), 1);
    assert.ok((await ext.getState()).blockedTargets.includes("facebook.com"));

    await popup.fill("#limit-input", "99");
    await popup.click("#limit-form button[type=submit]");
    await toastSays(popup, "嚴格模式開啟中，不能把使用時間調長。");
    assert.equal((await ext.getState()).limitMinutes, 5);

    await popup.click('.tab[data-tab="modes"]');
    await popup.click('[data-action="rest-start"]');
    await toastSays(popup, "嚴格模式開啟中，現在不能休息。");
    assert.equal((await ext.getState()).rest.until, 0);

    await popup.locator('[data-action="rest-limit"]').selectOption("5");
    await toastSays(popup, "嚴格模式開啟中，不能增加休息次數。");
    assert.equal((await ext.getState()).restDailyLimit, 3);
    await popup.close();
  });

  await t.test("a running break does not get past strict mode", async () => {
    await ext.setState({ rest: { until: Date.now() + 60000, startedAt: Date.now(), minutes: 1 } });
    const page = await ext.newPage(YT);
    await page.waitForSelector("#fb-title");
    assert.equal(await page.locator(CONTINUE).count(), 0);
    assert.equal(await page.locator("#focus-buffer-page").count(), 0);
    await page.close();
    await ext.setState({ rest: { until: 0, startedAt: 0, minutes: 0 } });
  });

  await t.test("switching off: request, cancel, request again, and the cooldown passing turns it off", async () => {
    const page = await ext.newPage(YT);
    await page.waitForSelector("#fb-title");
    assert.equal(await page.locator(CONTINUE).count(), 0);

    const popup = await openModes(ext);
    assert.match(await popup.locator(".fb-strict").textContent(), /要等 0\.05 分鐘才生效/);

    await popup.click('[data-action="strict-request-off"]');
    await popup.waitForSelector('[data-action="strict-cancel-off"]');
    assert.match(await popup.locator(".fb-strict-off-time").textContent(), /^\d\d:\d\d 關閉$/);
    assert.equal(await popup.locator('[data-action="strict-cancel-off"]').textContent(), "取消");
    await popup.click('[data-action="strict-cancel-off"]');
    await popup.waitForSelector('[data-action="strict-request-off"]');
    let strict = (await ext.getState()).strict;
    assert.equal(strict.enabled, true);
    assert.equal(strict.offAt, 0);

    const requestedAt = Date.now();
    await popup.click('[data-action="strict-request-off"]');
    await popup.waitForSelector('[data-action="strict-cancel-off"]');
    // Still on while the cooldown runs.
    assert.equal(await page.locator(CONTINUE).count(), 0);
    await popup.click('.tab[data-tab="sites"]');
    await popup.click('.list-item[data-target="facebook.com"] .btn.danger');
    await toastSays(popup, "嚴格模式開啟中，不能移除網站。");
    await popup.click('.tab[data-tab="modes"]');

    // Then both the popup and the open overlay notice by themselves.
    await popup.waitForSelector('[data-action="strict-enable"]', { timeout: 8000 });
    assert.ok(Date.now() - requestedAt >= 2900, "off only after the cooldown");
    await page.waitForSelector(CONTINUE, { timeout: 8000 });
    assert.doesNotMatch(await page.textContent(STATUS), /嚴格模式/);

    await popup.click('.tab[data-tab="sites"]');
    await popup.click('.list-item[data-target="facebook.com"] .btn.danger');
    await popup.waitForSelector('.list-item[data-target="facebook.com"]', { state: "detached" });
    await popup.close();
    await page.close();
  });

  await t.test("指定時段 outside its hours lets you continue, and the wait doubles", async () => {
    // A day that is neither today nor tomorrow, so the test passes at any hour.
    const day = (new Date().getDay() + 3) % 7;
    const popup = await openModes(ext);
    const card = popup.locator(".fb-strict");
    await card.locator('.chip[data-mode="schedule"]').click();
    for (const chip of await card.locator(".chip[data-day]").all()) {
      const wanted = (await chip.getAttribute("data-day")) === String(day);
      if (((await chip.getAttribute("aria-pressed")) === "true") !== wanted) {
        await chip.click();
      }
    }
    await card.locator('[data-field="start"]').fill("22:00");
    await card.locator('[data-field="end"]').fill("06:00");
    await popup.click('[data-action="strict-enable"]');
    await popup.waitForSelector('[data-action="strict-request-off"]');
    assert.equal(await popup.locator(".fb-strict-status").textContent(), "指定時段開啟中");
    assert.match(await popup.locator(".fb-strict-detail").textContent(), /^週[一二三四五六日] 22:00 到隔天 06:00。$/);
    assert.equal(await popup.locator(".fb-strict-now").textContent(), "現在不在限制時段。");
    await popup.close();

    const strict = (await ext.getState()).strict;
    assert.deepEqual(
      { enabled: strict.enabled, mode: strict.mode, days: strict.days, start: strict.start, end: strict.end, escalate: strict.escalate, offAt: strict.offAt },
      { enabled: true, mode: "schedule", days: [day], start: "22:00", end: "06:00", escalate: true, offAt: 0 }
    );

    // The test build waits 2 seconds; the second continue today waits 4.
    const first = await ext.newPage(YT);
    await first.waitForSelector(CONTINUE);
    await first.click(CONTINUE);
    assert.match(await first.textContent(CONTINUE), /^[12] 秒後繼續$/);
    assert.equal(await first.textContent(STATUS), "繼續後 5 分鐘自動關閉。");
    await first.waitForSelector("#focus-buffer-root", { state: "detached", timeout: 6000 });

    const second = await ext.newPage(YT);
    await second.waitForSelector(CONTINUE);
    await second.click(CONTINUE);
    assert.match(await second.textContent(CONTINUE), /^[34] 秒後繼續$/);
    await second.close();
    await first.close();
  });
});
