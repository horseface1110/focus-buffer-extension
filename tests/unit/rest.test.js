"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { loadBackground } = require("../helpers/background.js");

const YT = "https://www.youtube.com/watch?v=1";
const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;
// Results come out of another realm (node:vm); compare them as plain data.
const plain = (value) => JSON.parse(JSON.stringify(value));

const load = (options) => loadBackground(Object.assign({ features: ["rest"] }, options));

test("rest starts with no break, three breaks a day and an empty log", async () => {
  const bg = load();
  const state = plain(await bg.send("state"));
  assert.deepEqual(state.rest, { until: 0, startedAt: 0, minutes: 0 });
  assert.equal(state.restDailyLimit, 3);
  assert.deepEqual(state.restLog, {});
  assert.equal((await bg.send("gate", { url: YT }, 1)).action, "overlay");
});

test("starting a break frees listed sites until it runs out", async () => {
  const bg = load();
  const started = plain(await bg.send("rest/start", { minutes: 10 }));
  assert.deepEqual(started, { until: bg.clock.now + 10 * MINUTE, startedAt: bg.clock.now, minutes: 10 });
  assert.deepEqual(bg.data.local.rest, started);
  assert.deepEqual(bg.data.local.restLog, { [bg.FB.dayKey(bg.clock.now)]: 1 });

  const gate = await bg.send("gate", { url: YT }, 1);
  assert.equal(gate.action, "free");
  assert.equal(gate.canContinue, true);
  assert.equal(gate.remainingSeconds, null);
  assert.deepEqual(plain(gate.extras.rest), { until: started.until });
  // Sites that are not listed are still none of our business.
  assert.equal((await bg.send("gate", { url: "https://example.org/" }, 1)).action, "none");

  bg.advance(10 * MINUTE - 1);
  assert.equal((await bg.send("gate", { url: YT }, 1)).action, "free");
  bg.advance(1);
  const after = await bg.send("gate", { url: YT }, 1);
  assert.equal(after.action, "overlay");
  assert.equal(after.extras.rest, undefined);
});

test("minutes must be a whole number from 1 to 30", async () => {
  const bg = load();
  for (const bad of [0, 31, 2.5, -5, "x", undefined, null]) {
    await assert.rejects(bg.send("rest/start", { minutes: bad }), /1 到 30 分鐘/, String(bad));
  }
  assert.deepEqual(bg.data.local.restLog || {}, {});
  await bg.send("rest/start", { minutes: 1 });
  await bg.send("rest/stop");
  await bg.send("rest/start", { minutes: 30 });
  assert.equal(bg.data.local.rest.minutes, 30);
});

test("a second break cannot start while one is running", async () => {
  const bg = load();
  await bg.send("rest/start", { minutes: 5 });
  const until = bg.data.local.rest.until;
  bg.advance(MINUTE);
  await assert.rejects(bg.send("rest/start", { minutes: 15 }), /已經在休息了/);
  assert.equal(bg.data.local.rest.until, until);
  assert.equal(bg.data.local.restLog[bg.FB.dayKey(bg.clock.now)], 1);
});

test("stopping ends the break now and does not give it back", async () => {
  const bg = load();
  await bg.send("rest/start", { minutes: 15 });
  bg.advance(MINUTE);
  await bg.send("rest/stop");
  assert.deepEqual(bg.data.local.rest, { until: 0, startedAt: 0, minutes: 0 });
  assert.equal((await bg.send("gate", { url: YT }, 1)).action, "overlay");
  assert.equal(bg.data.local.restLog[bg.FB.dayKey(bg.clock.now)], 1);
  // Stopping when nothing runs is harmless.
  await bg.send("rest/stop");
});

test("breaks are limited per day and the count starts over the next day", async () => {
  const bg = load();
  for (let count = 0; count < 3; count += 1) {
    await bg.send("rest/start", { minutes: 5 });
    bg.advance(5 * MINUTE);
  }
  await assert.rejects(bg.send("rest/start", { minutes: 5 }), /今天的休息次數用完了。/);
  assert.equal((await bg.send("gate", { url: YT }, 1)).action, "overlay");

  bg.advance(DAY);
  await bg.send("rest/start", { minutes: 5 });
  assert.equal(bg.data.local.restLog[bg.FB.dayKey(bg.clock.now)], 1);
  assert.equal(bg.data.local.restLog[bg.FB.dayKey(bg.clock.now - DAY)], 3);
});

test("the daily limit can be changed, within 0 to 10", async () => {
  const bg = load();
  for (const bad of [-1, 11, 1.5, "x", undefined]) {
    await assert.rejects(bg.send("rest/setDailyLimit", { limit: bad }), /0 到 10 次/, String(bad));
  }
  assert.equal((await bg.send("rest/setDailyLimit", { limit: 10 })).limit, 10);
  assert.equal(bg.data.local.restDailyLimit, 10);

  await bg.send("rest/setDailyLimit", { limit: 1 });
  await bg.send("rest/start", { minutes: 5 });
  await bg.send("rest/stop");
  await assert.rejects(bg.send("rest/start", { minutes: 5 }), /今天的休息次數用完了。/);

  bg.advance(DAY);
  await bg.send("rest/setDailyLimit", { limit: 0 });
  await assert.rejects(bg.send("rest/start", { minutes: 5 }), /今天的休息次數用完了。/);
});

test("old days are dropped from the log when a break starts", async () => {
  const now = Date.parse("2026-11-23T10:00:00");
  const bg = load({ now: now, local: { restLog: { "2020-01-01": 2, "2026-10-24": 3, "2026-10-25": 1, "2026-11-22": 3 } } });
  assert.equal(bg.FB.config.KEEP_DAYS, 30);
  await bg.send("rest/start", { minutes: 5 });
  // 30 days ending today: 2026-10-25 is the oldest one kept.
  assert.deepEqual(bg.data.local.restLog, { "2026-10-25": 1, "2026-11-22": 3, "2026-11-23": 1 });
});

test("time on a break is counted as usage but does not use up a pass", async () => {
  const bg = load();
  await bg.send("event", { name: "continue", url: YT }, 1);
  assert.equal((await bg.send("tick", { url: YT, seconds: 10 }, 1)).remainingSeconds, 290);

  await bg.send("rest/start", { minutes: 5 });
  const tick = await bg.send("tick", { url: YT, seconds: 30 }, 1);
  assert.equal(tick.action, "free");
  assert.equal(tick.remainingSeconds, undefined);
  // A tab without a pass is free too.
  assert.equal((await bg.send("tick", { url: YT, seconds: 20 }, 2)).action, "free");
  assert.equal(bg.data.local.dailyUsage[bg.FB.dayKey(bg.clock.now)]["youtube.com"], 60);
  assert.deepEqual(bg.calls.removedTabs, []);

  await bg.send("rest/stop");
  const back = await bg.send("gate", { url: YT }, 1);
  assert.equal(back.action, "pass");
  assert.equal(back.remainingSeconds, 290);
  assert.equal((await bg.send("tick", { url: YT, seconds: 5 }, 2)).action, "overlay");
});

test("continuing is not recorded during a break, because there is no overlay", async () => {
  const bg = load();
  await bg.send("rest/start", { minutes: 5 });
  const result = await bg.send("event", { name: "continue", url: YT }, 1);
  assert.equal(result.action, "free");
  assert.equal(result.refused, false);
  assert.deepEqual(bg.data.local.stats, {});
});

test("starting a break and raising the limit ask the guard first", async () => {
  const bg = load();
  const asked = [];
  let refuse = true;
  bg.FB.registerFeature({
    id: "veto",
    guard(action, payload, state, now) {
      asked.push({ action: action, payload: plain(payload), now: now, hasState: Array.isArray(state.blockedTargets) });
      return refuse ? { ok: false, message: "現在不行。" } : undefined;
    }
  });

  await assert.rejects(bg.send("rest/start", { minutes: 5 }), /現在不行。/);
  assert.equal(bg.data.local.rest === undefined || bg.data.local.rest.until === 0, true);
  assert.deepEqual(bg.data.local.restLog || {}, {});
  await assert.rejects(bg.send("rest/setDailyLimit", { limit: 5 }), /現在不行。/);
  assert.notEqual(bg.data.local.restDailyLimit, 5);

  assert.deepEqual(asked, [
    { action: "rest/start", payload: { minutes: 5 }, now: bg.clock.now, hasState: true },
    { action: "rest/setDailyLimit", payload: { limit: 5, previous: 3 }, now: bg.clock.now, hasState: true }
  ]);

  refuse = false;
  await bg.send("rest/start", { minutes: 5 });
  assert.equal((await bg.send("gate", { url: YT }, 1)).action, "free");
});

test("the guard is not asked when the break would be refused anyway", async () => {
  const bg = load({ local: { restDailyLimit: 0 } });
  let asked = 0;
  bg.FB.registerFeature({
    id: "veto",
    guard() {
      asked += 1;
    }
  });
  await assert.rejects(bg.send("rest/start", { minutes: 5 }), /今天的休息次數用完了。/);
  assert.equal(asked, 0);
});

test("gate() depends only on the state and the time it is given", () => {
  const bg = load();
  const rest = bg.FB.features.find((feature) => feature.id === "rest");
  const state = { rest: { until: 5000, startedAt: 1000, minutes: 1 } };
  const run = (now, from) => {
    const gate = { action: from, extras: {} };
    rest.gate(gate, { state: state, now: now });
    return plain(gate);
  };

  assert.deepEqual(run(4999, "overlay"), { action: "free", extras: { rest: { until: 5000 } } });
  assert.deepEqual(run(4999, "pass"), { action: "free", extras: { rest: { until: 5000 } } });
  assert.deepEqual(run(5000, "overlay"), { action: "overlay", extras: {} });
  assert.deepEqual(run(5000, "pass"), { action: "pass", extras: {} });

  // Damaged storage must not break every page.
  const gate = { action: "overlay", extras: {} };
  rest.gate(gate, { state: { rest: null }, now: 1 });
  assert.deepEqual(gate, { action: "overlay", extras: {} });
});
