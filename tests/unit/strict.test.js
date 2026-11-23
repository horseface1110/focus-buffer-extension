"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { loadBackground } = require("../helpers/background.js");

const YT = "https://www.youtube.com/watch?v=1";
const IG = "https://www.instagram.com/";
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
// Results come out of another realm (node:vm); compare them as plain data.
const plain = (value) => JSON.parse(JSON.stringify(value));

// Local time in the week of Monday 2026-11-23: at(23, 9) is Monday 09:00,
// at(28, 6) is Saturday 06:00, at(29, 12) is Sunday noon.
const at = (date, hours, minutes = 0, seconds = 0) => new Date(2026, 10, date, hours, minutes, seconds).getTime();

const DEFAULTS = { enabled: false, mode: "always", days: [1, 2, 3, 4, 5], start: "09:00", end: "18:00", budgetMinutes: 30, escalate: true, offAt: 0 };
const strictState = (overrides) => Object.assign({}, DEFAULTS, { enabled: true }, overrides);

const load = (options) => loadBackground(Object.assign({ features: ["strict"] }, options));
const loadOn = (overrides, options) => {
  const extra = Object.assign({}, options);
  extra.local = Object.assign({ strict: strictState(overrides) }, extra.local);
  return load(extra);
};

async function gateAt(bg, time, url = YT, tabId = 1) {
  bg.clock.now = time;
  return bg.send("gate", { url: url }, tabId);
}

test("the calendar these tests assume", () => {
  assert.equal(new Date(at(23, 0)).getDay(), 1, "2026-11-23 is a Monday");
});

test("strict mode starts switched off and leaves the gate alone", async () => {
  const bg = load();
  assert.deepEqual(plain((await bg.send("state")).strict), DEFAULTS);
  const gate = await bg.send("gate", { url: YT }, 1);
  assert.equal(gate.action, "overlay");
  assert.equal(gate.canContinue, true);
  assert.equal(gate.message, "");
  assert.equal(gate.waitSeconds, 10);
  assert.deepEqual(plain(gate.extras.strict), { on: false, blocked: false });
});

// ---------------------------------------------------------------------------
// strict/enable
// ---------------------------------------------------------------------------
test("enable stores valid settings for each mode", async () => {
  let bg = load();
  await bg.send("strict/enable", { mode: "always" });
  assert.deepEqual(bg.data.local.strict, strictState());

  bg = load();
  const result = await bg.send("strict/enable", { mode: "schedule", days: [6, 0, 6], start: "22:00", end: "06:00", escalate: false });
  const expected = strictState({ mode: "schedule", days: [0, 6], start: "22:00", end: "06:00", escalate: false });
  assert.deepEqual(bg.data.local.strict, expected);
  assert.deepEqual(plain(result), expected);

  bg = load();
  await bg.send("strict/enable", { mode: "budget", budgetMinutes: 600 });
  assert.deepEqual(bg.data.local.strict, strictState({ mode: "budget", budgetMinutes: 600 }));
});

test("enable validates the fields its mode uses", async () => {
  const bg = load();
  const bad = [
    [{}, /請選擇全天、指定時段或每日額度/],
    [{ mode: "forever" }, /請選擇全天、指定時段或每日額度/],
    [{ mode: "schedule", days: [], start: "09:00", end: "18:00" }, /至少選一天/],
    [{ mode: "schedule", days: [1, 7], start: "09:00", end: "18:00" }, /至少選一天/],
    [{ mode: "schedule", days: [1.5], start: "09:00", end: "18:00" }, /至少選一天/],
    [{ mode: "schedule", days: "1,2", start: "09:00", end: "18:00" }, /至少選一天/],
    [{ mode: "schedule", days: [1], start: "9:00", end: "18:00" }, /開始和結束時間/],
    [{ mode: "schedule", days: [1], start: "09:00", end: "24:00" }, /開始和結束時間/],
    [{ mode: "schedule", days: [1], start: "09:60", end: "18:00" }, /開始和結束時間/],
    [{ mode: "schedule", days: [1], start: "", end: "18:00" }, /開始和結束時間/],
    [{ mode: "schedule", days: [1], start: "09:00", end: "09:00" }, /不能一樣/],
    [{ mode: "budget", budgetMinutes: 0 }, /1 到 600 分鐘/],
    [{ mode: "budget", budgetMinutes: 601 }, /1 到 600 分鐘/],
    [{ mode: "budget", budgetMinutes: 1.5 }, /1 到 600 分鐘/],
    [{ mode: "budget", budgetMinutes: "abc" }, /1 到 600 分鐘/]
  ];
  for (const [payload, pattern] of bad) {
    await assert.rejects(bg.send("strict/enable", payload), pattern, JSON.stringify(payload));
  }
  assert.equal(bg.data.local.strict === undefined || bg.data.local.strict.enabled === false, true);
});

test("enable ignores bad values in fields the chosen mode does not use", async () => {
  const bg = load({ local: { strict: Object.assign({}, DEFAULTS, { budgetMinutes: 45 }) } });
  await bg.send("strict/enable", { mode: "always", days: [], start: "x", end: "x", budgetMinutes: NaN });
  assert.deepEqual(bg.data.local.strict, strictState({ budgetMinutes: 45 }));
});

test("settings cannot be edited while strict mode is on", async () => {
  const bg = loadOn({ mode: "schedule" }, { now: at(28, 12) });
  // Saturday: on, though not blocking. Still no edits.
  await assert.rejects(bg.send("strict/enable", { mode: "budget", budgetMinutes: 600 }), /嚴格模式開啟中，要先關閉才能改設定。/);
  assert.equal(bg.data.local.strict.mode, "schedule");
});

// ---------------------------------------------------------------------------
// Blocking: always
// ---------------------------------------------------------------------------
test("always: no continuing, with a message, on every listed site", async () => {
  const bg = loadOn({ mode: "always" });
  for (const url of [YT, IG]) {
    const gate = await bg.send("gate", { url: url }, 1);
    assert.equal(gate.action, "overlay");
    assert.equal(gate.canContinue, false);
    assert.equal(gate.message, "嚴格模式開啟中，現在不能繼續。");
    assert.deepEqual(plain(gate.extras.strict), { on: true, blocked: true });
  }
  assert.equal((await bg.send("gate", { url: "https://example.org/" }, 1)).action, "none");

  // The service worker refuses a continue even if a page sends one.
  const result = await bg.send("event", { name: "continue", url: YT }, 1);
  assert.equal(result.refused, true);
  assert.equal((await bg.send("gate", { url: YT }, 1)).action, "overlay");
  assert.equal((await bg.send("tick", { url: YT, seconds: 30 }, 1)).action, "overlay");
  assert.deepEqual(bg.data.local.dailyUsage || {}, {});
});

// ---------------------------------------------------------------------------
// Blocking: schedule
// ---------------------------------------------------------------------------
test("schedule: blocks from start to end on the chosen days only", async () => {
  const bg = loadOn({ mode: "schedule", days: [1, 2, 3, 4, 5], start: "09:00", end: "18:00" });
  const blocked = async (time) => {
    const gate = await gateAt(bg, time);
    assert.equal(gate.action, "overlay");
    assert.equal(gate.extras.strict.on, true);
    assert.equal(gate.extras.strict.blocked, !gate.canContinue);
    return !gate.canContinue;
  };

  assert.equal(await blocked(at(23, 8, 59, 59)), false, "Monday just before the start");
  assert.equal(await blocked(at(23, 9)), true, "Monday at the start");
  assert.equal(await blocked(at(23, 17, 59, 59)), true, "Monday just before the end");
  assert.equal(await blocked(at(23, 18)), false, "Monday at the end");
  assert.equal(await blocked(at(23, 23, 59)), false, "Monday night");
  assert.equal(await blocked(at(27, 12)), true, "Friday");
  assert.equal(await blocked(at(28, 12)), false, "Saturday");
  assert.equal(await blocked(at(29, 12)), false, "Sunday");
  assert.equal(await blocked(at(30, 9)), true, "next Monday");

  const during = await gateAt(bg, at(23, 12));
  assert.equal(during.message, "嚴格模式開啟中，18:00 前不能繼續。");
  assert.equal(during.extras.strict.until, at(23, 18));
  const outside = await gateAt(bg, at(23, 18));
  assert.equal(outside.message, "");
  assert.equal(outside.extras.strict.until, undefined);
});

test("schedule: Sunday is day 0 and a single day can be chosen", async () => {
  const bg = loadOn({ mode: "schedule", days: [0], start: "00:00", end: "23:59" });
  assert.equal((await gateAt(bg, at(28, 23, 59))).canContinue, true, "Saturday night");
  assert.equal((await gateAt(bg, at(29, 0))).canContinue, false, "Sunday midnight");
  assert.equal((await gateAt(bg, at(29, 23, 58, 59))).canContinue, false, "Sunday late");
  assert.equal((await gateAt(bg, at(29, 23, 59))).canContinue, true, "Sunday at the end");
  assert.equal((await gateAt(bg, at(30, 0))).canContinue, true, "Monday");
});

test("schedule: a window across midnight belongs to the day it starts on", async () => {
  // Friday 22:00 to Saturday 06:00, and nothing else.
  const bg = loadOn({ mode: "schedule", days: [5], start: "22:00", end: "06:00" });
  const blocked = async (time) => !(await gateAt(bg, time)).canContinue;

  assert.equal(await blocked(at(27, 3)), false, "early Friday: Thursday is not chosen");
  assert.equal(await blocked(at(27, 21, 59, 59)), false, "Friday before the start");
  assert.equal(await blocked(at(27, 22)), true, "Friday at the start");
  assert.equal(await blocked(at(27, 23, 59, 59)), true, "Friday before midnight");
  assert.equal(await blocked(at(28, 0)), true, "Saturday at midnight");
  assert.equal(await blocked(at(28, 5, 59, 59)), true, "Saturday before the end");
  assert.equal(await blocked(at(28, 6)), false, "Saturday at the end");
  assert.equal(await blocked(at(28, 22, 30)), false, "Saturday night: Saturday is not chosen");

  const before = await gateAt(bg, at(27, 23));
  assert.equal(before.message, "嚴格模式開啟中，06:00 前不能繼續。");
  assert.equal(before.extras.strict.until, at(28, 6));
  assert.equal((await gateAt(bg, at(28, 1))).extras.strict.until, at(28, 6));
});

test("schedule: overnight windows on consecutive days", async () => {
  const bg = loadOn({ mode: "schedule", days: [0, 1, 2, 3, 4, 5, 6], start: "23:00", end: "07:00" });
  assert.equal((await gateAt(bg, at(23, 6, 59))).canContinue, false);
  assert.equal((await gateAt(bg, at(23, 7))).canContinue, true);
  assert.equal((await gateAt(bg, at(23, 22, 59))).canContinue, true);
  assert.equal((await gateAt(bg, at(23, 23))).canContinue, false);
  assert.equal((await gateAt(bg, at(24, 0, 30))).extras.strict.until, at(24, 7));
});

// ---------------------------------------------------------------------------
// Blocking: budget
// ---------------------------------------------------------------------------
test("budget: blocks once today's time on all listed sites reaches the budget", async () => {
  const now = at(23, 10);
  const today = "2026-11-23";
  const usage = (youtube, instagram) => ({ "2026-11-22": { "youtube.com": 9999 }, [today]: { "youtube.com": youtube, "instagram.com": instagram } });

  let bg = loadOn({ mode: "budget", budgetMinutes: 30 }, { now: now, local: { dailyUsage: usage(1000, 799) } });
  let gate = await bg.send("gate", { url: YT }, 1);
  assert.equal(gate.canContinue, true, "29:59 used");
  assert.deepEqual(plain(gate.extras.strict), { on: true, blocked: false });

  bg = loadOn({ mode: "budget", budgetMinutes: 30 }, { now: now, local: { dailyUsage: usage(1000, 800) } });
  for (const url of [YT, IG, "https://facebook.com/"]) {
    gate = await bg.send("gate", { url: url }, 1);
    assert.equal(gate.canContinue, false, "30:00 used, " + url);
    assert.equal(gate.message, "嚴格模式：今天的 30 分鐘額度用完了。");
  }
  // Blocked until midnight, then a fresh budget.
  assert.equal(gate.extras.strict.until, at(24, 0));
  assert.equal((await gateAt(bg, at(23, 23, 59, 59))).canContinue, false);
  assert.equal((await gateAt(bg, at(24, 0))).canContinue, true);
});

test("budget: no usage yet means not blocked", async () => {
  const bg = loadOn({ mode: "budget", budgetMinutes: 1 });
  assert.equal((await bg.send("gate", { url: YT }, 1)).canContinue, true);
});

// ---------------------------------------------------------------------------
// Passes
// ---------------------------------------------------------------------------
test("a pass in use is revoked when the budget runs out", async () => {
  const bg = loadOn({ mode: "budget", budgetMinutes: 1, escalate: false });
  assert.equal((await bg.send("event", { name: "continue", url: YT }, 1)).action, "pass");
  assert.equal((await bg.send("tick", { url: YT, seconds: 40 }, 1)).action, "pass");
  assert.equal((await bg.send("tick", { url: YT, seconds: 20 }, 1)).remainingSeconds, 240);

  // 60 seconds are used up: the next tick finds the overlay and is not counted.
  assert.equal((await bg.send("tick", { url: YT, seconds: 5 }, 1)).action, "overlay");
  assert.equal(bg.data.local.dailyUsage[bg.FB.dayKey(bg.clock.now)]["youtube.com"], 60);
  const gate = await bg.send("gate", { url: YT }, 1);
  assert.equal(gate.action, "overlay");
  assert.equal(gate.canContinue, false);
  assert.equal(gate.remainingSeconds, null);
  assert.deepEqual(bg.calls.removedTabs, [], "the tab is covered, not closed");
});

test("a pass in use is revoked when the schedule starts, and does not come back after it", async () => {
  const bg = loadOn({ mode: "schedule", start: "09:00", end: "18:00", escalate: false }, { now: at(23, 8, 58) });
  await bg.send("event", { name: "continue", url: YT }, 1);
  assert.equal((await bg.send("tick", { url: YT, seconds: 30 }, 1)).remainingSeconds, 270);

  bg.clock.now = at(23, 9);
  // Even a reload cannot keep the pass.
  const reloaded = await bg.send("gate", { url: YT }, 1);
  assert.equal(reloaded.action, "overlay");
  assert.equal(reloaded.canContinue, false);
  assert.equal((await bg.send("tick", { url: YT, seconds: 30 }, 1)).action, "overlay");
  assert.equal(bg.data.local.dailyUsage["2026-11-23"]["youtube.com"], 30);

  const evening = await gateAt(bg, at(23, 18));
  assert.equal(evening.action, "overlay", "the old pass is gone");
  assert.equal(evening.canContinue, true);
});

// ---------------------------------------------------------------------------
// Escalation
// ---------------------------------------------------------------------------
test("escalate: the wait doubles with every continue today, up to two minutes", async () => {
  const day = "2026-11-28";
  const waitAfter = async (continued, overrides) => {
    const stats = continued === null ? {} : { [day]: { "youtube.com": { shown: 9, continued: continued, closed: 0, autoClosed: 0 } } };
    const bg = loadOn(Object.assign({ mode: "schedule" }, overrides), { now: at(28, 12), local: { stats: stats } });
    return bg.send("gate", { url: YT }, 1);
  };

  assert.equal((await waitAfter(null)).waitSeconds, 10);
  assert.equal((await waitAfter(0)).waitSeconds, 10);
  assert.equal((await waitAfter(1)).waitSeconds, 20);
  assert.equal((await waitAfter(2)).waitSeconds, 40);
  assert.equal((await waitAfter(3)).waitSeconds, 80);
  assert.equal((await waitAfter(4)).waitSeconds, 120);
  assert.equal((await waitAfter(5000)).waitSeconds, 120);
  assert.equal((await waitAfter(3, { escalate: false })).waitSeconds, 10);
  assert.equal((await waitAfter(3, { enabled: false })).waitSeconds, 10);
});

test("escalate: counts real continues, per site and per day", async () => {
  // Saturday: on, but outside the Monday-to-Friday schedule.
  const bg = loadOn({ mode: "schedule" }, { now: at(28, 12) });
  assert.equal((await bg.send("gate", { url: YT }, 1)).waitSeconds, 10);
  await bg.send("event", { name: "continue", url: YT }, 1);
  assert.equal((await bg.send("gate", { url: YT }, 2)).waitSeconds, 20);
  await bg.send("event", { name: "continue", url: YT }, 2);
  assert.equal((await bg.send("gate", { url: YT }, 3)).waitSeconds, 40);
  assert.equal((await bg.send("gate", { url: IG }, 3)).waitSeconds, 10, "another site starts from the base");

  bg.advance(DAY);
  assert.equal((await bg.send("gate", { url: YT }, 3)).waitSeconds, 10, "a new day starts from the base");
});

test("escalate: builds on the wait it is handed and never shortens it", () => {
  const bg = load();
  const strict = bg.FB.features.find((feature) => feature.id === "strict");
  const wait = (base, continued) => {
    const gate = { action: "overlay", canContinue: true, message: "", waitSeconds: base, extras: {} };
    const state = { strict: strictState({ mode: "budget" }), dailyUsage: {}, stats: { "2026-11-23": { "youtube.com": { continued: continued } } } };
    strict.gate(gate, { state: state, target: "youtube.com", now: at(23, 10), day: "2026-11-23" });
    return gate.waitSeconds;
  };
  assert.equal(wait(2, 3), 16);
  assert.equal(wait(30, 1), 60);
  assert.equal(wait(30, 2), 120);
  assert.equal(wait(200, 2), 200);
});

// ---------------------------------------------------------------------------
// Guard
// ---------------------------------------------------------------------------
test("guard: sites cannot be removed while strict mode is on", async () => {
  const bg = loadOn({ mode: "schedule" }, { now: at(28, 12) });
  // On but not blocking right now: still refused.
  await assert.rejects(bg.send("targets/remove", { target: "youtube.com" }), /嚴格模式開啟中，不能移除網站。/);
  assert.equal(bg.data.local.blockedTargets === undefined || bg.data.local.blockedTargets.includes("youtube.com"), true);
  assert.deepEqual(bg.calls.removedOrigins, []);
  // Adding is tightening, so it is fine.
  await bg.send("targets/add", { target: "reddit.com" });
  assert.ok(bg.data.local.blockedTargets.includes("reddit.com"));
});

test("guard: the pass length can go down but not up", async () => {
  const bg = loadOn({ mode: "always" }, { local: { limitMinutes: 10 } });
  await assert.rejects(bg.send("limit/set", { minutes: 11 }), /嚴格模式開啟中，不能把使用時間調長。/);
  assert.equal(bg.data.local.limitMinutes, 10);
  await bg.send("limit/set", { minutes: 10 });
  await bg.send("limit/set", { minutes: 3 });
  assert.equal(bg.data.local.limitMinutes, 3);
  await assert.rejects(bg.send("limit/set", { minutes: 4 }), /不能把使用時間調長/);
});

test("guard: reasons cannot be made optional, the break limit cannot go up", () => {
  const bg = load();
  const now = at(28, 12);
  const on = { strict: strictState({ mode: "schedule" }), dailyUsage: {} };
  const guard = (action, payload, state = on) => bg.FB.guard(action, payload, state, now);

  assert.throws(() => guard("reasons/setRequired", { required: false }), /嚴格模式開啟中，不能取消必填理由。/);
  guard("reasons/setRequired", { required: true });
  assert.throws(() => guard("rest/setDailyLimit", { limit: 4, previous: 3 }), /嚴格模式開啟中，不能增加休息次數。/);
  guard("rest/setDailyLimit", { limit: 3, previous: 3 });
  guard("rest/setDailyLimit", { limit: 0, previous: 3 });
  // Actions strict mode knows nothing about pass through.
  guard("todos/remove", { id: "x" });
  guard("targets/add", { target: "reddit.com" });

  // Off: nothing is refused.
  const off = { strict: Object.assign({}, DEFAULTS), dailyUsage: {} };
  guard("targets/remove", { target: "youtube.com" }, off);
  guard("limit/set", { minutes: 99, previous: 1 }, off);
  guard("reasons/setRequired", { required: false }, off);
  guard("rest/setDailyLimit", { limit: 9, previous: 1 }, off);
  guard("rest/start", { minutes: 30 }, off);
});

test("guard: a break is refused only while strict mode is blocking", () => {
  const bg = load();
  const state = { strict: strictState({ mode: "schedule" }), dailyUsage: {} };
  assert.throws(() => bg.FB.guard("rest/start", { minutes: 5 }, state, at(23, 12)), /嚴格模式開啟中，現在不能休息。/);
  bg.FB.guard("rest/start", { minutes: 5 }, state, at(23, 18));
  bg.FB.guard("rest/start", { minutes: 5 }, state, at(28, 12));

  const budget = { strict: strictState({ mode: "budget", budgetMinutes: 1 }), dailyUsage: { "2026-11-23": { "youtube.com": 59 } } };
  bg.FB.guard("rest/start", { minutes: 5 }, budget, at(23, 12));
  budget.dailyUsage["2026-11-23"]["instagram.com"] = 1;
  assert.throws(() => bg.FB.guard("rest/start", { minutes: 5 }, budget, at(23, 12)), /現在不能休息/);
});

test("guard() and gate() use the time they are given, not the clock", () => {
  // The service worker's clock says Saturday; the arguments say Monday noon.
  const bg = load({ now: at(28, 12) });
  const strict = bg.FB.features.find((feature) => feature.id === "strict");
  const state = { strict: strictState({ mode: "schedule" }), dailyUsage: {}, stats: {} };

  assert.equal(plain(strict.guard("rest/start", {}, state, at(23, 12))).ok, false);
  assert.equal(strict.guard("rest/start", {}, state, at(28, 12)), undefined);

  const gate = { action: "free", canContinue: true, message: "", waitSeconds: 10, extras: {} };
  strict.gate(gate, { state: state, target: "youtube.com", now: at(23, 12), day: "2026-11-23" });
  assert.equal(gate.action, "overlay");
  assert.equal(gate.canContinue, false);
  assert.deepEqual(plain(state.strict), strictState({ mode: "schedule" }), "the state is not touched");
});

// ---------------------------------------------------------------------------
// Turning it off
// ---------------------------------------------------------------------------
test("requesting off only takes effect after the cooldown", async () => {
  const start = at(23, 10);
  const bg = loadOn({ mode: "always" }, { now: start });
  assert.equal(bg.FB.config.STRICT_COOLDOWN_MINUTES, undefined, "the default cooldown is 10 minutes");

  const result = await bg.send("strict/requestOff");
  assert.equal(result.offAt, start + 10 * MINUTE);
  assert.deepEqual(bg.data.local.strict, strictState({ offAt: start + 10 * MINUTE }));

  // Still on during the cooldown, and the overlay says until when.
  bg.advance(10 * MINUTE - 1);
  const waiting = await bg.send("gate", { url: YT }, 1);
  assert.equal(waiting.canContinue, false);
  assert.equal(waiting.message, "嚴格模式開啟中，10:10 前不能繼續。");
  assert.deepEqual(plain(waiting.extras.strict), { on: true, blocked: true, until: start + 10 * MINUTE });
  await assert.rejects(bg.send("targets/remove", { target: "youtube.com" }), /不能移除網站/);
  await assert.rejects(bg.send("strict/enable", { mode: "budget", budgetMinutes: 600 }), /要先關閉才能改設定/);

  // Asking again does not move the time.
  assert.equal((await bg.send("strict/requestOff")).offAt, start + 10 * MINUTE);

  bg.advance(1);
  const off = await bg.send("gate", { url: YT }, 1);
  assert.equal(off.canContinue, true);
  assert.equal(off.message, "");
  assert.deepEqual(plain(off.extras.strict), { on: false, blocked: false });
  await bg.send("targets/remove", { target: "youtube.com" });

  // Nothing wrote `enabled: false` yet; the next strict handler tidies up.
  assert.equal(bg.data.local.strict.enabled, true);
  await bg.send("strict/requestOff");
  assert.deepEqual(bg.data.local.strict, Object.assign({}, DEFAULTS));
});

test("after the cooldown the settings can be changed and strict mode switched on again", async () => {
  const bg = loadOn({ mode: "always" });
  await bg.send("strict/requestOff");
  bg.advance(10 * MINUTE);
  await bg.send("strict/enable", { mode: "budget", budgetMinutes: 45, escalate: false });
  assert.deepEqual(bg.data.local.strict, strictState({ mode: "budget", budgetMinutes: 45, escalate: false }));
});

test("the cooldown can be shortened through FB.config", async () => {
  const bg = loadOn({ mode: "always" });
  bg.FB.config.STRICT_COOLDOWN_MINUTES = 1;
  assert.equal((await bg.send("strict/requestOff")).offAt, bg.clock.now + MINUTE);
  bg.advance(MINUTE - 1);
  assert.equal((await bg.send("gate", { url: YT }, 1)).canContinue, false);
  bg.advance(1);
  assert.equal((await bg.send("gate", { url: YT }, 1)).canContinue, true);
});

test("cancelling keeps strict mode on", async () => {
  const bg = loadOn({ mode: "always" });
  await bg.send("strict/requestOff");
  bg.advance(5 * MINUTE);
  const result = await bg.send("strict/cancelOff");
  assert.equal(result.offAt, 0);
  assert.deepEqual(bg.data.local.strict, strictState());

  bg.advance(DAY);
  const gate = await bg.send("gate", { url: YT }, 1);
  assert.equal(gate.canContinue, false);
  assert.equal(gate.message, "嚴格模式開啟中，現在不能繼續。");

  // A new request starts a full cooldown again.
  assert.equal((await bg.send("strict/requestOff")).offAt, bg.clock.now + 10 * MINUTE);
});

test("cancelling too late says so and leaves strict mode off", async () => {
  const bg = loadOn({ mode: "always" });
  await bg.send("strict/requestOff");
  bg.advance(10 * MINUTE);
  await assert.rejects(bg.send("strict/cancelOff"), /嚴格模式已經關閉了。/);
  assert.deepEqual(bg.data.local.strict, Object.assign({}, DEFAULTS));
  assert.equal((await bg.send("gate", { url: YT }, 1)).canContinue, true);
});

test("requesting off while it is already off changes nothing", async () => {
  const bg = load();
  const result = await bg.send("strict/requestOff");
  assert.equal(result.enabled, false);
  assert.equal(result.offAt, 0);
  await assert.rejects(bg.send("strict/cancelOff"), /已經關閉了/);
});

test("a pending switch-off ends a schedule block early, never late", async () => {
  const bg = loadOn({ mode: "schedule", start: "09:00", end: "18:00" }, { now: at(23, 17, 55) });
  await bg.send("strict/requestOff");
  // The window ends at 18:00, before the cooldown does.
  assert.equal((await bg.send("gate", { url: YT }, 1)).message, "嚴格模式開啟中，18:00 前不能繼續。");

  const early = loadOn({ mode: "schedule", start: "09:00", end: "18:00" }, { now: at(23, 12) });
  await early.send("strict/requestOff");
  const gate = await early.send("gate", { url: YT }, 1);
  assert.equal(gate.message, "嚴格模式開啟中，12:10 前不能繼續。");
  assert.equal(gate.extras.strict.until, at(23, 12, 10));
});

// ---------------------------------------------------------------------------
// With 休息模式
// ---------------------------------------------------------------------------
test("strict mode beats a running break", async () => {
  const bg = loadBackground({ features: ["rest", "strict"], now: at(23, 8, 50) });
  await bg.send("strict/enable", { mode: "schedule", days: [1, 2, 3, 4, 5], start: "09:00", end: "18:00" });
  // On, not blocking yet: a break is allowed and frees the site.
  await bg.send("rest/start", { minutes: 30 });
  const before = await bg.send("gate", { url: YT }, 1);
  assert.equal(before.action, "free");
  assert.deepEqual(plain(before.extras.strict), { on: true, blocked: false });
  assert.equal((await bg.send("tick", { url: YT, seconds: 30 }, 1)).action, "free");

  // 09:00: the break still has 20 minutes, the schedule wins.
  bg.clock.now = at(23, 9);
  const during = await bg.send("gate", { url: YT }, 1);
  assert.equal(during.action, "overlay");
  assert.equal(during.canContinue, false);
  assert.equal(during.message, "嚴格模式開啟中，18:00 前不能繼續。");
  assert.equal(during.extras.rest.until, at(23, 9, 20), "the break itself is still there");
  assert.equal((await bg.send("tick", { url: YT, seconds: 30 }, 1)).action, "overlay");
  assert.equal(bg.data.local.dailyUsage["2026-11-23"]["youtube.com"], 30, "blocked time is not counted");
});

test("with strict mode blocking, a break cannot start and its limit cannot go up", async () => {
  const bg = loadBackground({ features: ["rest", "strict"], now: at(23, 12) });
  await bg.send("strict/enable", { mode: "always" });

  await assert.rejects(bg.send("rest/start", { minutes: 5 }), /嚴格模式開啟中，現在不能休息。/);
  assert.equal(bg.data.local.rest === undefined || bg.data.local.rest.until === 0, true);
  assert.deepEqual(bg.data.local.restLog || {}, {}, "a refused break is not counted");
  assert.equal((await bg.send("gate", { url: YT }, 1)).action, "overlay");

  await assert.rejects(bg.send("rest/setDailyLimit", { limit: 4 }), /嚴格模式開啟中，不能增加休息次數。/);
  await bg.send("rest/setDailyLimit", { limit: 1 });
  assert.equal(bg.data.local.restDailyLimit, 1);
  await assert.rejects(bg.send("rest/setDailyLimit", { limit: 2 }), /不能增加休息次數/);
});

test("a break started before strict mode was switched on is overridden too", async () => {
  const bg = loadBackground({ features: ["rest", "strict"] });
  await bg.send("rest/start", { minutes: 30 });
  assert.equal((await bg.send("gate", { url: YT }, 1)).action, "free");
  await bg.send("strict/enable", { mode: "always" });
  const gate = await bg.send("gate", { url: YT }, 1);
  assert.equal(gate.action, "overlay");
  assert.equal(gate.canContinue, false);
});

test("break time counts towards the budget, and the budget ends the break", async () => {
  const bg = loadBackground({ features: ["rest", "strict"] });
  await bg.send("strict/enable", { mode: "budget", budgetMinutes: 1 });
  await bg.send("rest/start", { minutes: 30 });
  assert.equal((await bg.send("tick", { url: YT, seconds: 60 }, 1)).action, "free");
  const gate = await bg.send("gate", { url: YT }, 1);
  assert.equal(gate.action, "overlay");
  assert.equal(gate.message, "嚴格模式：今天的 1 分鐘額度用完了。");
});
