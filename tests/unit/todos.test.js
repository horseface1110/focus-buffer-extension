"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { loadBackground } = require("../helpers/background.js");

const YT = "https://www.youtube.com/watch?v=1";

// Values that come back from the service worker belong to its own realm;
// copy them before comparing with deepEqual.
const plain = (value) => JSON.parse(JSON.stringify(value));

async function addAll(bg, texts) {
  const items = [];
  for (const text of texts) {
    items.push(await bg.send("todos/add", { text: text }));
    bg.advance(1000);
  }
  return items;
}

test("add stores a trimmed, open item", async () => {
  const bg = loadBackground({ features: ["todos"] });
  assert.deepEqual(plain((await bg.send("state")).todos), []);

  const item = plain(await bg.send("todos/add", { text: "  寫週報\n 第一段 " }));
  assert.equal(typeof item.id, "string");
  assert.ok(item.id.length > 0);
  assert.deepEqual(item, { id: item.id, text: "寫週報 第一段", done: false, createdAt: bg.clock.now, doneAt: null });
  assert.deepEqual(bg.data.local.todos, [item]);

  const second = await bg.send("todos/add", { text: "寫週報 第一段" });
  assert.notEqual(second.id, item.id);
  assert.equal(bg.data.local.todos.length, 2);
});

test("add rejects empty and overlong text", async () => {
  const bg = loadBackground({ features: ["todos"] });
  for (const bad of ["", "   ", undefined, null]) {
    await assert.rejects(bg.send("todos/add", { text: bad }), /請先輸入待辦事項/);
  }
  await assert.rejects(bg.send("todos/add", { text: "字".repeat(81) }), /最多 80 個字/);
  assert.equal((bg.data.local.todos || []).length, 0);

  await bg.send("todos/add", { text: "字".repeat(80) });
  assert.equal(bg.data.local.todos[0].text.length, 80);
});

test("at most 50 items can be open at once", async () => {
  const bg = loadBackground({ features: ["todos"] });
  const items = await addAll(
    bg,
    Array.from({ length: 50 }, (unused, index) => "待辦 " + (index + 1))
  );
  await assert.rejects(bg.send("todos/add", { text: "第 51 件" }), /未完成的待辦最多 50 件/);
  assert.equal(bg.data.local.todos.length, 50);

  // Finishing one makes room again.
  await bg.send("todos/toggle", { id: items[0].id, done: true });
  await bg.send("todos/add", { text: "第 51 件" });
  assert.equal(bg.data.local.todos.length, 51);
  assert.equal(bg.data.local.todos.filter((item) => !item.done).length, 50);
});

test("toggle marks an item done and open again", async () => {
  const bg = loadBackground({ features: ["todos"] });
  const [item] = await addAll(bg, ["寫週報"]);

  const done = await bg.send("todos/toggle", { id: item.id, done: true });
  assert.equal(done.done, true);
  assert.equal(done.doneAt, bg.clock.now);
  assert.equal(bg.data.local.todos[0].done, true);
  assert.equal(bg.data.local.todos[0].doneAt, bg.clock.now);

  // Saying "done" again changes nothing, not even the time it was finished.
  const finishedAt = bg.clock.now;
  bg.advance(5000);
  await bg.send("todos/toggle", { id: item.id, done: true });
  assert.equal(bg.data.local.todos[0].doneAt, finishedAt);

  await bg.send("todos/toggle", { id: item.id, done: false });
  assert.equal(bg.data.local.todos[0].done, false);
  assert.equal(bg.data.local.todos[0].doneAt, null);

  // Without `done` it flips.
  await bg.send("todos/toggle", { id: item.id });
  assert.equal(bg.data.local.todos[0].done, true);

  await assert.rejects(bg.send("todos/toggle", { id: "nope", done: true }), /找不到這件待辦/);
});

test("remove deletes one item and ignores unknown ids", async () => {
  const bg = loadBackground({ features: ["todos"] });
  const [first, second] = await addAll(bg, ["寫週報", "回覆客戶"]);

  assert.equal((await bg.send("todos/remove", { id: first.id })).removed, 1);
  assert.deepEqual(
    bg.data.local.todos.map((item) => item.id),
    [second.id]
  );
  assert.equal((await bg.send("todos/remove", { id: first.id })).removed, 0);
  assert.equal(bg.data.local.todos.length, 1);
});

test("clearDone removes finished items only", async () => {
  const bg = loadBackground({ features: ["todos"] });
  const [first, second, third] = await addAll(bg, ["寫週報", "回覆客戶", "訂車票"]);
  await bg.send("todos/toggle", { id: first.id, done: true });
  await bg.send("todos/toggle", { id: third.id, done: true });

  assert.equal((await bg.send("todos/clearDone")).removed, 2);
  assert.deepEqual(
    bg.data.local.todos.map((item) => item.id),
    [second.id]
  );
  assert.equal((await bg.send("todos/clearDone")).removed, 0);
});

test("finished items are capped at the newest 100", async () => {
  const done = Array.from({ length: 100 }, (unused, index) => ({ id: "d" + index, text: "做完 " + index, done: true, createdAt: index, doneAt: 1000 + index }));
  const open = { id: "open", text: "還沒做", done: false, createdAt: 5000, doneAt: null };
  const bg = loadBackground({ features: ["todos"], local: { todos: done.concat(open) } });

  await bg.send("todos/toggle", { id: "open", done: true });
  const ids = bg.data.local.todos.map((item) => item.id);
  assert.equal(ids.length, 100);
  assert.ok(ids.includes("open"));
  assert.ok(!ids.includes("d0"), "the one finished longest ago was dropped");
  assert.ok(ids.includes("d1"));
});

test("the gate hands the overlay the first three open items, oldest first", async () => {
  const bg = loadBackground({ features: ["todos"] });
  assert.deepEqual(plain((await bg.send("gate", { url: YT }, 1)).extras.todos), { open: [], openCount: 0 });

  const items = await addAll(bg, ["一", "二", "三", "四", "五"]);
  let extras = plain((await bg.send("gate", { url: YT }, 1)).extras.todos);
  assert.deepEqual(extras, {
    open: [
      { id: items[0].id, text: "一" },
      { id: items[1].id, text: "二" },
      { id: items[2].id, text: "三" }
    ],
    openCount: 5
  });

  // Finished items make room for the next ones.
  await bg.send("todos/toggle", { id: items[1].id, done: true });
  extras = plain((await bg.send("gate", { url: YT }, 1)).extras.todos);
  assert.deepEqual(
    extras.open.map((item) => item.text),
    ["一", "三", "四"]
  );
  assert.equal(extras.openCount, 4);

  await bg.send("todos/remove", { id: items[0].id });
  await bg.send("todos/toggle", { id: items[1].id, done: false });
  extras = plain((await bg.send("gate", { url: YT }, 1)).extras.todos);
  assert.deepEqual(
    extras.open.map((item) => item.text),
    ["二", "三", "四"]
  );
  assert.equal(extras.openCount, 4);

  // Pages that are not on the list get no gate extras at all.
  assert.equal((await bg.send("gate", { url: "https://example.org/" }, 1)).action, "none");
});

test("a broken stored list does not break the gate or the handlers", async () => {
  const bg = loadBackground({ features: ["todos"], local: { todos: "oops" } });
  assert.deepEqual(plain((await bg.send("gate", { url: YT }, 1)).extras.todos), { open: [], openCount: 0 });
  await bg.send("todos/add", { text: "重新開始" });
  assert.equal(bg.data.local.todos.length, 1);
});
