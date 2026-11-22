"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { loadBackground } = require("../helpers/background.js");

const YT = "https://www.youtube.com/watch?v=1";

// Each tab can continue once (afterwards it holds a pass), so every unlock
// in these tests comes from its own tab.
function unlock(bg, tabId, data) {
  return bg.send("event", { name: "continue", url: YT, data: data }, tabId);
}

test("a new install asks for a reason and starts with an empty log", async () => {
  const bg = loadBackground({ features: ["reasons"] });
  const state = await bg.send("state");
  assert.equal(state.reasonRequired, true);
  assert.equal(state.unlockLog.length, 0);
  const gate = await bg.send("gate", { url: YT }, 1);
  assert.equal(gate.extras.reasons.required, true);
});

test("the reason given when continuing is logged", async () => {
  const bg = loadBackground({ features: ["reasons"] });
  const result = await unlock(bg, 1, { reason: "  查資料  " });
  assert.equal(result.action, "pass");
  assert.deepEqual(bg.data.local.unlockLog, [{ at: bg.clock.now, target: "youtube.com", reason: "查資料" }]);

  bg.advance(60000);
  await unlock(bg, 2, { reason: "回訊息" });
  assert.deepEqual(
    bg.data.local.unlockLog.map((entry) => entry.reason),
    ["查資料", "回訊息"]
  );
  assert.equal(bg.data.local.unlockLog[1].at, bg.clock.now);
});

test("only a continue with a real reason is logged", async () => {
  const bg = loadBackground({ features: ["reasons"] });
  await bg.send("event", { name: "shown", url: YT, data: { reason: "不算" } }, 1);
  await bg.send("event", { name: "close", url: YT, data: { reason: "不算" } }, 1);
  await unlock(bg, 2, {});
  await unlock(bg, 3, { reason: "   " });
  await unlock(bg, 4, { reason: 42 });
  await unlock(bg, 5, undefined);
  assert.deepEqual(bg.data.local.unlockLog, []);

  // A continue the core refuses (this tab already holds a pass) logs nothing.
  await unlock(bg, 6, { reason: "第一次" });
  await unlock(bg, 6, { reason: "第二次" });
  assert.deepEqual(
    bg.data.local.unlockLog.map((entry) => entry.reason),
    ["第一次"]
  );
});

test("a reason is cut to 80 characters", async () => {
  const bg = loadBackground({ features: ["reasons"] });
  await unlock(bg, 1, { reason: "字".repeat(120) });
  assert.equal(bg.data.local.unlockLog[0].reason, "字".repeat(80));
});

test("the log keeps only the newest 200 entries", async () => {
  const old = Array.from({ length: 199 }, (unused, index) => ({ at: index, target: "youtube.com", reason: "舊的 " + index }));
  const bg = loadBackground({ features: ["reasons"], local: { unlockLog: old } });

  await unlock(bg, 1, { reason: "第 200 筆" });
  assert.equal(bg.data.local.unlockLog.length, 200);
  assert.equal(bg.data.local.unlockLog[0].reason, "舊的 0");

  await unlock(bg, 2, { reason: "第 201 筆" });
  await unlock(bg, 3, { reason: "第 202 筆" });
  const log = bg.data.local.unlockLog;
  assert.equal(log.length, 200);
  assert.equal(log[0].reason, "舊的 2");
  assert.equal(log[199].reason, "第 202 筆");
});

test("setRequired switches the question off and on", async () => {
  const bg = loadBackground({ features: ["reasons"] });

  assert.equal((await bg.send("reasons/setRequired", { required: false })).required, false);
  assert.equal(bg.data.local.reasonRequired, false);
  assert.equal((await bg.send("gate", { url: YT }, 1)).extras.reasons.required, false);

  await bg.send("reasons/setRequired", { required: true });
  assert.equal(bg.data.local.reasonRequired, true);
  assert.equal((await bg.send("gate", { url: YT }, 1)).extras.reasons.required, true);
});

test("a reason sent while the question is off is still logged", async () => {
  const bg = loadBackground({ features: ["reasons"], local: { reasonRequired: false } });
  await unlock(bg, 1, {});
  await unlock(bg, 2, { reason: "順手寫的" });
  assert.deepEqual(
    bg.data.local.unlockLog.map((entry) => entry.reason),
    ["順手寫的"]
  );
});

test("setRequired goes through the guard, which can refuse it", async () => {
  const bg = loadBackground({ features: ["reasons"] });
  const seen = [];
  // Stands in for strict mode.
  bg.FB.registerFeature({
    id: "test-guard",
    guard(action, payload) {
      seen.push([action, payload.required]);
      return action === "reasons/setRequired" && payload.required === false ? { ok: false, message: "嚴格模式開啟中，不能關掉。" } : undefined;
    }
  });

  await assert.rejects(bg.send("reasons/setRequired", { required: false }), /嚴格模式開啟中/);
  assert.notEqual(bg.data.local.reasonRequired, false);
  assert.equal((await bg.send("gate", { url: YT }, 1)).extras.reasons.required, true);

  await bg.send("reasons/setRequired", { required: true });
  assert.equal(bg.data.local.reasonRequired, true);
  assert.deepEqual(seen, [
    ["reasons/setRequired", false],
    ["reasons/setRequired", true]
  ]);
});

test("clear empties the log and nothing else", async () => {
  const bg = loadBackground({ features: ["reasons"], local: { reasonRequired: false } });
  await unlock(bg, 1, { reason: "查資料" });
  await unlock(bg, 2, { reason: "回訊息" });
  assert.equal(bg.data.local.unlockLog.length, 2);

  await bg.send("reasons/clear");
  assert.deepEqual(bg.data.local.unlockLog, []);
  assert.equal(bg.data.local.reasonRequired, false);
  const day = bg.FB.dayKey(bg.clock.now);
  assert.equal(bg.data.local.stats[day]["youtube.com"].continued, 2);

  await unlock(bg, 3, { reason: "又來了" });
  assert.equal(bg.data.local.unlockLog.length, 1);
});
