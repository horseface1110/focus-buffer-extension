"use strict";

// Every feature loaded together, the way the shipped extension runs.

const test = require("node:test");
const assert = require("node:assert/strict");
const { loadBackground } = require("../helpers/background.js");

const YT = "https://www.youtube.com/watch?v=1";
const plain = (value) => JSON.parse(JSON.stringify(value));

test("all five features load and each adds its part to the gate", async () => {
  const bg = loadBackground();
  assert.deepEqual(plain(bg.FB.features.map((feature) => feature.id)), ["stats", "reasons", "todos", "rest", "strict"]);

  await bg.send("todos/add", { text: "寫報告" });
  const gate = plain(await bg.send("gate", { url: YT }, 1));
  assert.equal(gate.action, "overlay");
  assert.deepEqual(gate.extras.stats, { siteShown: 1, totalShown: 1 });
  assert.equal(gate.extras.reasons.required, true);
  assert.equal(gate.extras.todos.open[0].text, "寫報告");
  assert.equal(gate.extras.strict.on, false);
});

test("a continue with a reason is logged and counted", async () => {
  const bg = loadBackground();
  await bg.send("event", { name: "shown", url: YT }, 1);
  await bg.send("event", { name: "continue", url: YT, data: { reason: "查資料" } }, 1);
  const state = plain(await bg.send("state"));
  assert.equal(state.unlockLog[0].reason, "查資料");
  assert.equal(state.stats[bg.FB.dayKey(bg.clock.now)]["youtube.com"].continued, 1);
  assert.equal((await bg.send("gate", { url: YT }, 1)).action, "pass");
});

test("a break opens the site, and strict mode overrides the break and counts the view", async () => {
  const bg = loadBackground();
  await bg.send("rest/start", { minutes: 10 });
  assert.equal((await bg.send("gate", { url: YT }, 1)).action, "free");

  await bg.send("strict/enable", { mode: "always" });
  const gate = plain(await bg.send("gate", { url: YT }, 1));
  assert.equal(gate.action, "overlay");
  assert.equal(gate.canContinue, false);
  assert.match(gate.message, /嚴格模式/);
  // The overlay is about to be shown, so this view is counted.
  assert.equal(gate.extras.stats.siteShown, 1);
});

test("strict mode ends a pass in use, and the view it causes is counted", async () => {
  const bg = loadBackground();
  await bg.send("event", { name: "shown", url: YT }, 1);
  await bg.send("event", { name: "continue", url: YT, data: { reason: "查資料" } }, 1);
  await bg.send("strict/enable", { mode: "always" });

  assert.equal((await bg.send("tick", { url: YT, seconds: 5 }, 1)).action, "overlay");
  const gate = plain(await bg.send("gate", { url: YT }, 1));
  assert.equal(gate.action, "overlay");
  assert.equal(gate.extras.stats.siteShown, 2);
});

test("while strict mode is on, nothing can be loosened", async () => {
  const bg = loadBackground();
  await bg.send("strict/enable", { mode: "always" });
  await assert.rejects(bg.send("targets/remove", { target: "youtube.com" }), /嚴格模式/);
  await assert.rejects(bg.send("limit/set", { minutes: 30 }), /嚴格模式/);
  await assert.rejects(bg.send("reasons/setRequired", { required: false }), /嚴格模式/);
  await assert.rejects(bg.send("rest/start", { minutes: 5 }), /嚴格模式/);
  await assert.rejects(bg.send("stats/clear"), /嚴格模式/);
  // Tightening is still allowed.
  await bg.send("limit/set", { minutes: 2 });
  await bg.send("targets/add", { target: "reddit.com" });
});
