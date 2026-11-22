"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { launchExtension } = require("../helpers/extension.js");

const YT = "https://www.youtube.com/watch";
const IG = "https://www.instagram.com/";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// "2026-11-23" -> "11/23"
const label = (day) => Number(day.split("-")[1]) + "/" + Number(day.split("-")[2]);

test("stats in Chromium", async (t) => {
  const ext = await launchExtension({ features: ["stats"] });
  t.after(() => ext.close());

  // The browser's own idea of the last seven days, oldest first.
  const days = await ext.evaluate(() => FB.recentDays(7));
  const today = days[6];

  const seed = () =>
    ext.setState({
      stats: {
        [days[1]]: { "youtube.com": { shown: 2, continued: 1, closed: 1, autoClosed: 0 } },
        [days[3]]: {
          "youtube.com": { shown: 4, continued: 4, closed: 0, autoClosed: 2 },
          "instagram.com": { shown: 4, continued: 0, closed: 4, autoClosed: 0 }
        },
        [days[5]]: { "instagram.com": { shown: 1, continued: 0, closed: 1, autoClosed: 0 } },
        [today]: {
          "youtube.com": { shown: 2, continued: 1, closed: 1, autoClosed: 1 },
          "instagram.com": { shown: 3, continued: 2, closed: 1, autoClosed: 0 },
          "facebook.com": { shown: 0, continued: 0, closed: 0, autoClosed: 0 }
        }
      },
      dailyUsage: {
        [days[3]]: { "youtube.com": 3000 },
        [today]: { "youtube.com": 754, "instagram.com": 130 }
      }
    });

  const openStatsTab = async () => {
    const popup = await ext.openPopup();
    await popup.click('.tab[data-tab="stats"]');
    await popup.waitForSelector('.panel[data-panel="stats"] .stats-tiles');
    return popup;
  };

  // The overlay's visit count: a figure in the row of today's numbers.
  const LINE = "#focus-buffer-root .fb-usage .fb-stats-line";
  const visitFigure = async (page) => {
    await page.waitForSelector(LINE);
    return [await page.textContent(LINE + " .fb-usage-number"), await page.textContent(LINE + " .fb-usage-label")];
  };

  const waitForShown = async (target, expected) => {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const state = await ext.getState();
      const entry = (state.stats[today] || {})[target];
      if (entry && entry.shown === expected) {
        return;
      }
      await sleep(100);
    }
    assert.fail(target + " never reached " + expected + " overlays");
  };

  await t.test("the 今天 card adds up every site", async () => {
    await seed();
    const popup = await openStatsTab();

    const titles = await popup.locator('.panel[data-panel="stats"] .section h2').allTextContents();
    assert.deepEqual(titles, ["今天", "最近 7 天", "今天各網站"]);

    const tiles = await popup.locator(".stats-tile").evaluateAll((nodes) =>
      nodes.map((node) => [
        node.dataset.stat,
        node.querySelector(".stats-tile-value").textContent,
        node.querySelector(".stats-tile-label").textContent
      ])
    );
    assert.deepEqual(tiles, [
      ["shown", "5", "打開次數"],
      ["minutes", "14", "使用分鐘"],
      ["continued", "3", "繼續"],
      ["closed", "2", "關掉"],
      ["autoClosed", "1", "時間到自動關閉"]
    ]);
    await popup.close();
  });

  await t.test("the 最近 7 天 card draws one bar per day, oldest first, with the counts as text", async () => {
    await seed();
    const popup = await openStatsTab();

    const columns = await popup.locator(".stats-chart .stats-day").evaluateAll((nodes) =>
      nodes.map((node) => ({
        day: node.dataset.day,
        label: node.querySelector(".stats-day-label").textContent,
        count: node.querySelector(".stats-day-count").textContent,
        height: Math.round(node.querySelector(".stats-day-bar").getBoundingClientRect().height),
        today: node.classList.contains("is-today")
      }))
    );
    assert.deepEqual(columns.map((column) => column.day), days);
    assert.deepEqual(columns.map((column) => column.label), days.map(label));
    assert.deepEqual(columns.map((column) => column.count), ["0", "2", "0", "8", "0", "1", "5"]);
    assert.deepEqual(columns.map((column) => column.today), [false, false, false, false, false, false, true]);
    // The busiest day is the tallest bar, the others are in proportion, and
    // a day with nothing has no bar at all.
    assert.deepEqual(columns.map((column) => column.height), [0, 16, 0, 64, 0, 8, 40]);

    const chart = popup.locator(".stats-chart");
    assert.equal(await chart.getAttribute("role"), "img");
    const spoken = await chart.getAttribute("aria-label");
    assert.ok(spoken.startsWith("最近 7 天每天的打開次數："), spoken);
    assert.ok(spoken.includes(label(days[3]) + " 8 次、"), spoken);
    assert.ok(spoken.endsWith(label(today) + "（今天） 5 次。"), spoken);
    await popup.close();
  });

  await t.test("the 今天各網站 card lists the sites by count, and nothing spills out of a card", async () => {
    await seed();
    const popup = await openStatsTab();

    const rows = await popup.locator(".stats-sites .stats-site").evaluateAll((nodes) =>
      nodes.map((node) => [
        node.dataset.target,
        node.querySelector(".list-title").textContent,
        node.querySelector(".stats-site-count").textContent,
        node.querySelector(".stats-site-minutes").textContent
      ])
    );
    // facebook.com has an entry but no visits and no time, so it is left out.
    assert.deepEqual(rows, [
      ["instagram.com", "Instagram", "3 次", "2 分鐘"],
      ["youtube.com", "YouTube", "2 次", "12 分鐘"]
    ]);

    const spills = await popup.evaluate(() => {
      const found = [];
      for (const card of document.querySelectorAll('.section[data-feature="stats"]')) {
        const box = card.getBoundingClientRect();
        for (const node of card.querySelectorAll("*")) {
          const inner = node.getBoundingClientRect();
          if (inner.left < box.left - 0.5 || inner.right > box.right + 0.5 || node.scrollWidth > node.clientWidth + 1) {
            found.push(node.className + ": " + node.textContent.slice(0, 20));
          }
        }
      }
      return found;
    });
    assert.deepEqual(spills, []);
    await popup.close();
  });

  await t.test("the overlay says which visit this is, and the next one counts on", async () => {
    await seed();

    const first = await ext.newPage(YT);
    assert.deepEqual(await visitFigure(first), ["第 3 次", "今天打開"]);
    assert.equal(await first.locator(LINE).count(), 1);
    // It leads the row of today's numbers, in front of the minutes.
    assert.deepEqual(await first.locator("#focus-buffer-root .fb-usage .fb-usage-label").allTextContents(), ["今天打開", "這個網站", "全部網站"]);
    await waitForShown("youtube.com", 3);
    await first.close();

    const second = await ext.newPage(YT);
    assert.deepEqual(await visitFigure(second), ["第 4 次", "今天打開"]);
    await waitForShown("youtube.com", 4);
    await second.close();

    // The count is per site: Instagram had 3 of its own.
    const other = await ext.newPage(IG);
    assert.deepEqual(await visitFigure(other), ["第 4 次", "今天打開"]);
    await waitForShown("instagram.com", 4);
    await other.close();

    // The popup agrees with what the overlays said.
    const popup = await openStatsTab();
    assert.equal(await popup.textContent('.stats-tile[data-stat="shown"] .stats-tile-value'), "8");
    assert.equal(await popup.textContent(".stats-day.is-today .stats-day-count"), "8");
    await popup.close();
  });

  await t.test("「清除統計」 asks for a second press, then empties everything", async () => {
    await seed();
    const popup = await openStatsTab();
    const button = popup.locator(".stats-clear");
    assert.equal(await button.textContent(), "清除統計");

    // One press only arms the button, and it gives up after a few seconds.
    await button.click();
    assert.equal(await button.textContent(), "再按一次確認");
    await popup.waitForFunction(() => document.querySelector(".stats-clear").textContent === "清除統計", null, { timeout: 8000 });
    assert.equal((await ext.getState()).stats[today]["youtube.com"].shown, 2);

    // A double-click is one decision, not two.
    await button.dblclick();
    await sleep(300);
    assert.equal(await button.textContent(), "再按一次確認");
    assert.equal((await ext.getState()).stats[today]["youtube.com"].shown, 2);

    await sleep(300);
    await button.click();
    await popup.waitForFunction(() => document.getElementById("toast").textContent.includes("已清除統計"));

    const state = await ext.getState();
    assert.deepEqual(state.stats, {});
    assert.deepEqual(state.dailyUsage, {});
    assert.deepEqual(state.blockedTargets, ["instagram.com", "facebook.com", "youtube.com"]);

    // The tab is redrawn empty and stays selected.
    assert.equal(await popup.getAttribute('.tab[data-tab="stats"]', "aria-selected"), "true");
    assert.deepEqual(await popup.locator(".stats-tile-value").allTextContents(), ["0", "0", "0", "0", "0"]);
    assert.deepEqual(await popup.locator(".stats-day-count").allTextContents(), ["0", "0", "0", "0", "0", "0", "0"]);
    assert.equal(await popup.locator(".stats-site").count(), 0);
    assert.equal(await popup.textContent('.section[data-feature="stats"] .empty'), "今天還沒有紀錄。");
    assert.equal(await popup.textContent(".stats-clear"), "清除統計");
    await popup.close();

    const page = await ext.newPage(YT);
    assert.deepEqual(await visitFigure(page), ["第 1 次", "今天打開"]);
    await page.close();
  });
});
