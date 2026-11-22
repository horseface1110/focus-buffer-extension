"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { launchExtension } = require("../helpers/extension.js");

const YT = "https://www.youtube.com/watch";
const TASK_LABEL = '#focus-buffer-root [data-task="todo"] .fb-task-label';
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

test("todos in Chromium", async (t) => {
  const ext = await launchExtension({ features: ["todos"] });
  t.after(() => ext.close());

  const openOverlay = async () => {
    const page = await ext.newPage(YT);
    await page.waitForSelector("#fb-title");
    return page;
  };
  const stored = async () => (await ext.getState()).todos;
  const byText = async (text) => (await stored()).find((item) => item.text === text);

  await t.test("with no to-dos the overlay drops the to-do step and renumbers the rest", async () => {
    const page = await openOverlay();
    assert.equal(await page.locator('#focus-buffer-root .fb-task[data-task="todo"]').count(), 0);
    assert.equal(await page.locator("#focus-buffer-root .fb-todos").count(), 0);
    assert.deepEqual(await page.locator("#focus-buffer-root .fb-task-mark").allTextContents(), ["1", "2"]);
    assert.deepEqual(await page.locator("#focus-buffer-root .fb-task-label").allTextContents(), ["喝一口水", "站起來伸展 30 秒"]);
    await page.close();
  });

  await t.test("the popup adds, ticks, unticks and deletes to-dos", async () => {
    const popup = await ext.openPopup();
    await popup.click('.tab[data-tab="todos"]');
    const openTexts = () => popup.locator(".todos-open .todos-item .todos-text").allTextContents();
    const doneTexts = () => popup.locator(".todos-done .todos-item .todos-text").allTextContents();
    const inputState = () =>
      popup.evaluate(() => {
        const input = document.querySelector(".todos-input");
        return { focused: document.activeElement === input, value: input.value };
      });
    const toastIs = (text) =>
      popup.waitForFunction((wanted) => {
        const toast = document.getElementById("toast");
        return toast.textContent.includes(wanted) && toast.dataset.kind === "error";
      }, text);

    assert.equal(await popup.locator(".todos-open .empty").count(), 1);
    assert.equal(await popup.locator(".todos-done .empty").count(), 1);
    assert.equal(await popup.locator(".todos-clear-done").count(), 0);
    assert.equal(await popup.getAttribute(".todos-input", "maxlength"), "80");

    // Enter adds, and the field keeps the focus for the next one.
    await popup.fill(".todos-input", "  寫週報 ");
    await popup.press(".todos-input", "Enter");
    await waitFor(async () => (await openTexts()).length === 1, "the first to-do was not added");
    assert.deepEqual(await inputState(), { focused: true, value: "" });
    await popup.keyboard.type("回覆客戶");
    await popup.keyboard.press("Enter");
    await waitFor(async () => (await openTexts()).length === 2, "the second to-do was not added");
    assert.deepEqual(await inputState(), { focused: true, value: "" });

    // So does the button.
    await popup.fill(".todos-input", "訂車票");
    await popup.click('.todos-form button[type="submit"]');
    await waitFor(async () => (await openTexts()).length === 3, "the third to-do was not added");
    assert.deepEqual(await openTexts(), ["寫週報", "回覆客戶", "訂車票"]);
    assert.equal(await popup.textContent(".todos-count"), "3");
    assert.equal(await popup.locator(".todos-open .empty").count(), 0);
    assert.deepEqual(
      (await stored()).map((item) => [item.text, item.done]),
      [
        ["寫週報", false],
        ["回覆客戶", false],
        ["訂車票", false]
      ]
    );

    // An empty to-do is refused.
    await popup.fill(".todos-input", "   ");
    await popup.press(".todos-input", "Enter");
    await toastIs("請先輸入待辦事項");
    assert.equal((await stored()).length, 3);

    // Ticking moves the item to 「已完成」; a half-typed to-do survives the redraw.
    await popup.fill(".todos-input", "打到一半");
    await popup.click('.todos-open .todos-item:has-text("寫週報") input[type="checkbox"]');
    await waitFor(async () => (await doneTexts()).length === 1, "the to-do was not moved to the finished list");
    assert.deepEqual(await doneTexts(), ["寫週報"]);
    assert.deepEqual(await openTexts(), ["回覆客戶", "訂車票"]);
    assert.ok(await popup.isChecked(".todos-done .todos-item input"));
    assert.equal((await inputState()).value, "打到一半");
    const finished = await byText("寫週報");
    assert.equal(finished.done, true);
    assert.ok(Math.abs(Date.now() - finished.doneAt) < 10000);

    // Unticking brings it back, in its old place.
    await popup.click(".todos-done .todos-item input");
    await waitFor(async () => (await openTexts()).length === 3, "the to-do was not reopened");
    assert.deepEqual(await openTexts(), ["寫週報", "回覆客戶", "訂車票"]);
    assert.equal((await byText("寫週報")).done, false);
    assert.equal((await byText("寫週報")).doneAt, null);

    await popup.click('.todos-open .todos-item:has-text("回覆客戶") .todos-remove');
    await waitFor(async () => (await openTexts()).length === 2, "the to-do was not deleted");
    assert.deepEqual(
      (await stored()).map((item) => item.text),
      ["寫週報", "訂車票"]
    );

    await popup.click('.todos-open .todos-item:has-text("寫週報") input[type="checkbox"]');
    await waitFor(async () => (await doneTexts()).length === 1, "the to-do was not finished");
    await popup.click(".todos-clear-done");
    await popup.waitForSelector(".todos-done .empty");
    assert.deepEqual(
      (await stored()).map((item) => item.text),
      ["訂車票"]
    );
    await popup.close();
  });

  await t.test("the overlay lists open to-dos, and ticking one marks it done without a redraw", async () => {
    // One open to-do is left from the popup test.
    const single = await openOverlay();
    assert.equal(await single.textContent(TASK_LABEL), "先做一件待辦");
    assert.deepEqual(await single.locator("#focus-buffer-root .fb-todo-text").allTextContents(), ["訂車票"]);
    assert.equal(await single.locator("#focus-buffer-root .fb-todos-more").count(), 0);
    await single.close();

    const todo = (id, text, createdAt, doneAt) => ({ id: id, text: text, done: Boolean(doneAt), createdAt: createdAt, doneAt: doneAt || null });
    await ext.setState({
      todos: [todo("a", "寫週報", 1), todo("z", "早就做完的", 2, 50), todo("b", "回覆客戶", 3), todo("c", "訂車票", 4), todo("d", "繳電費", 5), todo("e", "倒垃圾", 6)]
    });

    const page = await openOverlay();
    assert.equal(await page.textContent(TASK_LABEL), "先做一件待辦");
    assert.deepEqual(await page.locator("#focus-buffer-root .fb-todo-text").allTextContents(), ["寫週報", "回覆客戶", "訂車票"]);
    assert.equal(await page.textContent("#focus-buffer-root .fb-todos-more"), "還有 2 件");
    // The list sits right under the second task row.
    assert.ok(await page.evaluate(() => document.querySelector('#focus-buffer-root [data-task="todo"]').nextElementSibling.classList.contains("fb-todos")));

    // Mark the node: if the overlay were rebuilt, the mark would be gone.
    await page.evaluate(() => document.querySelector("#focus-buffer-root .fb-todos").setAttribute("data-test-mark", "1"));
    const first = "#focus-buffer-root .fb-todo-item:nth-child(1)";
    await page.click(first + " input");
    await waitFor(async () => (await byText("寫週報")).done === true, "ticking in the overlay was not saved");
    assert.ok(Math.abs(Date.now() - (await byText("寫週報")).doneAt) < 10000);
    assert.equal(await page.evaluate((selector) => getComputedStyle(document.querySelector(selector + " .fb-todo-text")).textDecorationLine, first), "line-through");

    // Give the page time to hear about the storage change.
    await sleep(800);
    assert.equal(await page.locator('#focus-buffer-root .fb-todos[data-test-mark="1"]').count(), 1, "the overlay was not rebuilt");
    assert.ok(await page.isChecked(first + " input"));
    assert.equal(await page.locator("#fb-title").count(), 1);

    // Unticking takes it back.
    await page.click(first + " input");
    await waitFor(async () => (await byText("寫週報")).done === false, "unticking in the overlay was not saved");
    assert.equal(await page.evaluate((selector) => getComputedStyle(document.querySelector(selector + " .fb-todo-text")).textDecorationLine, first), "none");

    // The other to-dos were not touched.
    assert.deepEqual(
      (await stored()).map((item) => [item.id, item.done]),
      [
        ["a", false],
        ["z", true],
        ["b", false],
        ["c", false],
        ["d", false],
        ["e", false]
      ]
    );

    // The next visit shows what is still open.
    await page.click(first + " input");
    await waitFor(async () => (await byText("寫週報")).done === true, "ticking again was not saved");
    await page.reload();
    await page.waitForSelector("#fb-title");
    assert.deepEqual(await page.locator("#focus-buffer-root .fb-todo-text").allTextContents(), ["回覆客戶", "訂車票", "繳電費"]);
    assert.equal(await page.textContent("#focus-buffer-root .fb-todos-more"), "還有 1 件");
    await page.close();
  });
});
