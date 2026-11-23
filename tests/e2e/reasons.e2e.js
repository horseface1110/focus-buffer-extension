"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { launchExtension } = require("../helpers/extension.js");

const YT = "https://www.youtube.com/watch";
const CONTINUE = '[data-action="continue"]';
const INPUT = "#focus-buffer-root .fb-reason-input";
const ERROR = "#focus-buffer-root .fb-error";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(check, message) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (await check()) {
      return;
    }
    await sleep(50);
  }
  assert.fail(message);
}

test("reasons in Chromium", async (t) => {
  // The wait before continuing is 2 seconds in the test copy.
  const ext = await launchExtension({ features: ["reasons"] });
  t.after(() => ext.close());

  const openOverlay = async () => {
    const page = await ext.newPage(YT);
    await page.waitForSelector("#fb-title");
    return page;
  };
  const loggedReasons = async () => (await ext.getState()).unlockLog.map((entry) => entry.reason);
  const toastIs = (page, text, kind) =>
    page.waitForFunction(
      ([wanted, wantedKind]) => {
        const toast = document.getElementById("toast");
        return toast.textContent.includes(wanted) && toast.dataset.kind === wantedKind;
      },
      [text, kind]
    );

  await t.test("continuing is blocked until a reason is written", async () => {
    const page = await openOverlay();
    assert.equal(await page.textContent('[data-slot="form"] .fb-field-label'), "為什麼現在要打開？");
    assert.deepEqual(await page.locator("#focus-buffer-root .fb-chip").allTextContents(), ["查資料", "回訊息", "工作需要", "休息一下"]);
    assert.equal(await page.getAttribute(INPUT, "maxlength"), "80");
    assert.equal(await page.textContent(ERROR), "");

    // Nothing written.
    await page.click(CONTINUE);
    await page.waitForFunction((selector) => document.querySelector(selector).textContent.includes("至少 2 個字"), ERROR);
    assert.ok(await page.evaluate((selector) => document.activeElement === document.querySelector(selector), INPUT), "the field has the focus");
    assert.ok(await page.locator(CONTINUE).isEnabled(), "no countdown started");

    // One character, padded with spaces, is not a reason either.
    await page.fill(INPUT, "  嗯  ");
    assert.equal(await page.textContent(ERROR), "", "typing clears the error");
    await page.click(CONTINUE);
    await page.waitForFunction((selector) => document.querySelector(selector).textContent.includes("至少 2 個字"), ERROR);
    await sleep(2600);
    assert.equal(await page.locator("#fb-title").count(), 1, "the overlay is still there after the wait would have passed");
    assert.deepEqual(await loggedReasons(), []);

    await page.fill(INPUT, "查一下報告要用的資料");
    await page.click(CONTINUE);
    assert.ok(await page.locator(CONTINUE).isDisabled());
    await page.waitForSelector("#focus-buffer-root", { state: "detached", timeout: 6000 });

    const log = (await ext.getState()).unlockLog;
    assert.equal(log.length, 1);
    assert.equal(log[0].reason, "查一下報告要用的資料");
    assert.equal(log[0].target, "youtube.com");
    assert.ok(Math.abs(Date.now() - log[0].at) < 10000);
    await page.close();
  });

  await t.test("a chip fills the field, and Enter continues", async () => {
    const page = await openOverlay();
    const pressed = (text) => page.getAttribute('#focus-buffer-root .fb-chip:text-is("' + text + '")', "aria-pressed");

    await page.click('#focus-buffer-root .fb-chip:text-is("回訊息")');
    assert.equal(await page.inputValue(INPUT), "回訊息");
    assert.equal(await pressed("回訊息"), "true");

    await page.click('#focus-buffer-root .fb-chip:text-is("工作需要")');
    assert.equal(await page.inputValue(INPUT), "工作需要");
    assert.equal(await pressed("回訊息"), "false");
    assert.equal(await pressed("工作需要"), "true");

    // Editing the text un-presses the chip.
    await page.fill(INPUT, "工作需要：看教學影片");
    assert.equal(await pressed("工作需要"), "false");

    await page.press(INPUT, "Enter");
    assert.ok(await page.locator(CONTINUE).isDisabled(), "Enter started the countdown");
    await page.waitForSelector("#focus-buffer-root", { state: "detached", timeout: 6000 });
    assert.deepEqual(await loggedReasons(), ["查一下報告要用的資料", "工作需要：看教學影片"]);
    await page.close();
  });

  await t.test("the popup lists the newest reasons, copies them as CSV and clears them", async () => {
    const fillers = Array.from({ length: 20 }, (unused, index) => ({
      at: new Date(2026, 10, 1 + index, 8, 0).getTime(),
      target: "facebook.com",
      reason: "理由 " + (index + 1)
    }));
    // A reason a spreadsheet would run as a formula.
    fillers[0].reason = "=HYPERLINK(\"https://example.com\")";
    const unlockLog = fillers.concat([
      { at: new Date(2026, 10, 22, 9, 3).getTime(), target: "https://example.com/news", reason: '他說 "快看", 就看了' },
      { at: new Date(2026, 10, 23, 10, 5).getTime(), target: "youtube.com", reason: "查資料" }
    ]);
    await ext.setState({ unlockLog: unlockLog });

    const popup = await ext.openPopup();
    await popup.click('.tab[data-tab="stats"]');
    const items = popup.locator(".reasons-log .reasons-item");
    assert.equal(await items.count(), 20, "only the newest 20 are listed");
    assert.equal(await items.nth(0).locator(".reasons-reason").textContent(), "查資料");
    assert.equal(await items.nth(0).locator(".reasons-time").textContent(), "11/23 10:05");
    assert.equal(await items.nth(0).locator(".reasons-site").textContent(), "YouTube");
    assert.equal(await items.nth(1).locator(".reasons-reason").textContent(), '他說 "快看", 就看了');
    assert.equal(await items.nth(1).locator(".reasons-site").textContent(), "example.com/news");
    assert.equal(await items.nth(19).locator(".reasons-reason").textContent(), "理由 3");
    assert.match(await popup.textContent(".reasons-count"), /共 22 筆/);

    // The clipboard API.
    await popup.evaluate(() => {
      window.copied = [];
      navigator.clipboard.writeText = async (text) => {
        window.copied.push(text);
      };
    });
    await popup.click(".reasons-copy");
    await toastIs(popup, "已複製 22 筆理由", "ok");
    const csv = (await popup.evaluate(() => window.copied))[0];
    const lines = csv.split("\n");
    assert.equal(lines.length, 23);
    assert.equal(lines[0], "時間,網站,理由");
    assert.equal(lines[1], '2026-11-01 08:00,Facebook,"\'=HYPERLINK(""https://example.com"")"');
    assert.equal(lines[21], '2026-11-22 09:03,example.com/news,"他說 ""快看"", 就看了"');
    assert.equal(lines[22], "2026-11-23 10:05,YouTube,查資料");

    // No clipboard API: the same text goes through a selected textarea.
    await popup.evaluate(() => {
      navigator.clipboard.writeText = async () => {
        throw new Error("denied");
      };
      window.selected = [];
      document.execCommand = (command) => {
        const area = document.querySelector(".reasons-copy-area");
        window.selected.push([command, area.value.slice(area.selectionStart, area.selectionEnd)]);
        return window.copyWorks;
      };
      window.copyWorks = true;
    });
    await popup.click(".reasons-copy");
    await toastIs(popup, "已複製 22 筆理由", "ok");
    assert.deepEqual(await popup.evaluate(() => window.selected), [["copy", csv]]);
    assert.equal(await popup.locator(".reasons-copy-area").count(), 0, "the helper textarea is removed again");

    await popup.evaluate(() => {
      window.copyWorks = false;
    });
    await popup.click(".reasons-copy");
    await toastIs(popup, "複製失敗", "error");

    // Clearing needs a second press.
    await popup.click(".reasons-clear");
    assert.equal(await popup.textContent(".reasons-clear"), "再按一次清除");
    await sleep(300);
    assert.equal((await ext.getState()).unlockLog.length, 22);
    await popup.click(".reasons-clear");
    await popup.waitForSelector(".reasons-log .empty");
    await toastIs(popup, "已清除理由紀錄", "ok");
    assert.equal(await items.count(), 0);
    assert.equal(await popup.locator(".reasons-copy, .reasons-clear").count(), 0);
    assert.deepEqual(await loggedReasons(), []);
    await popup.close();
  });

  await t.test("with the switch off no reason is asked", async () => {
    const popup = await ext.openPopup();
    await popup.click('.tab[data-tab="modes"]');
    assert.equal(await popup.textContent(".reasons-switch span"), "繼續前要寫理由");
    assert.ok(await popup.isChecked(".reasons-switch input"));
    await popup.click(".reasons-switch input");
    await waitFor(async () => (await ext.getState()).reasonRequired === false, "the switch was not saved");
    await popup.waitForFunction(() => {
      const input = document.querySelector(".reasons-switch input");
      return input && !input.checked && !input.disabled && document.activeElement === input;
    });
    await popup.close();

    const page = await openOverlay();
    assert.equal(await page.locator(INPUT).count(), 0);
    assert.equal(await page.locator("#focus-buffer-root .fb-chip").count(), 0);
    await page.click(CONTINUE);
    assert.ok(await page.locator(CONTINUE).isDisabled());
    await page.waitForSelector("#focus-buffer-root", { state: "detached", timeout: 6000 });
    assert.deepEqual(await loggedReasons(), []);
    await page.close();
  });

  await t.test("switching the reason on or off while the overlay is up takes effect at once", async () => {
    // The switch is off after the last test.
    const page = await openOverlay();
    assert.equal(await page.locator(INPUT).count(), 0);

    await ext.setState({ reasonRequired: true });
    await page.waitForSelector(INPUT, { timeout: 5000 });
    await page.click(CONTINUE);
    assert.match(await page.textContent(ERROR), /請先寫下理由/);
    assert.ok(!(await page.locator(CONTINUE).isDisabled()), "continuing without a reason must not start the countdown");

    await ext.setState({ reasonRequired: false });
    await page.waitForSelector(INPUT, { state: "detached", timeout: 5000 });
    assert.equal(await page.locator("#fb-title").count(), 1);
    await page.close();
  });

  await t.test("a refused change shows the error and puts the switch back", async () => {
    // Stands in for strict mode: turning the question off is not allowed.
    await ext.evaluate(() => {
      FB.registerFeature({
        id: "test-guard",
        guard(action, payload) {
          return action === "reasons/setRequired" && payload.required === false ? { ok: false, message: "嚴格模式開啟中，不能關掉。" } : undefined;
        }
      });
    });

    const popup = await ext.openPopup();
    await popup.click('.tab[data-tab="modes"]');
    assert.ok(!(await popup.isChecked(".reasons-switch input")));
    await popup.click(".reasons-switch input");
    await waitFor(async () => (await ext.getState()).reasonRequired === true, "turning it on was not saved");
    await popup.waitForFunction(() => {
      const input = document.querySelector(".reasons-switch input");
      return input && input.checked && !input.disabled;
    });

    await popup.click(".reasons-switch input");
    await toastIs(popup, "嚴格模式開啟中，不能關掉。", "error");
    await popup.waitForFunction(() => {
      const input = document.querySelector(".reasons-switch input");
      return input && input.checked && !input.disabled;
    });
    assert.equal((await ext.getState()).reasonRequired, true);
    await popup.close();

    const page = await openOverlay();
    assert.equal(await page.locator(INPUT).count(), 1, "the question is asked again");
    await page.close();
  });
});
