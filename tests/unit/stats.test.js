"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { loadBackground } = require("../helpers/background.js");

const YT = "https://www.youtube.com/watch?v=1";
const IG = "https://www.instagram.com/";
const TODAY = "2026-11-23";
const YESTERDAY = "2026-11-22";

// Values that come back from the service worker belong to its vm context, so
// deepEqual would reject them for their prototype alone.
const plain = (value) => JSON.parse(JSON.stringify(value));

const load = (local) => loadBackground({ features: ["stats"], now: Date.parse(TODAY + "T10:00:00"), local: local });

test("the first overlay of the day is already counted as number 1", async () => {
  const bg = load();
  const gate = await bg.send("gate", { url: YT }, 1);
  assert.equal(gate.action, "overlay");
  assert.deepEqual(plain(gate.extras.stats), { siteShown: 1, totalShown: 1 });
  // Asking is not showing: nothing is recorded until the "shown" event.
  assert.deepEqual(bg.data.local.stats || {}, {});
});

test("the gate counts earlier overlays for this site and for all sites, plus the one being drawn", async () => {
  const bg = load();
  await bg.send("event", { name: "shown", url: YT }, 1);
  await bg.send("event", { name: "shown", url: YT }, 1);
  await bg.send("event", { name: "shown", url: IG }, 2);

  assert.deepEqual(plain((await bg.send("gate", { url: YT }, 3)).extras.stats), { siteShown: 3, totalShown: 4 });
  assert.deepEqual(plain((await bg.send("gate", { url: IG }, 3)).extras.stats), { siteShown: 2, totalShown: 4 });
  // A listed site nobody opened yet today.
  assert.deepEqual(plain((await bg.send("gate", { url: "https://facebook.com/" }, 3)).extras.stats), { siteShown: 1, totalShown: 4 });
});

test("the number the gate promises is the number the shown event records", async () => {
  const bg = load();
  for (let view = 1; view <= 3; view += 1) {
    const gate = await bg.send("gate", { url: YT }, view);
    await bg.send("event", { name: "shown", url: YT }, view);
    assert.equal(gate.extras.stats.siteShown, view);
    assert.equal(bg.data.local.stats[TODAY]["youtube.com"].shown, view);
  }
});

test("a tab that holds a pass gets the plain counts, without the +1", async () => {
  const bg = load();
  await bg.send("event", { name: "shown", url: YT }, 1);
  await bg.send("event", { name: "continue", url: YT }, 1);

  const gate = await bg.send("gate", { url: YT }, 1);
  assert.equal(gate.action, "pass");
  assert.deepEqual(plain(gate.extras.stats), { siteShown: 1, totalShown: 1 });
});

test("only today counts, and odd values in storage count as zero", async () => {
  const bg = load({
    stats: {
      [YESTERDAY]: { "youtube.com": { shown: 9, continued: 9, closed: 0, autoClosed: 0 } },
      [TODAY]: { "youtube.com": { shown: 2 }, "instagram.com": { shown: "oops" }, "facebook.com": null }
    }
  });
  assert.deepEqual(plain((await bg.send("gate", { url: YT }, 1)).extras.stats), { siteShown: 3, totalShown: 3 });
});

test("a site that is not on the list has no gate extras", async () => {
  const bg = load();
  const gate = await bg.send("gate", { url: "https://example.org/" }, 1);
  assert.equal(gate.action, "none");
  assert.equal(gate.extras, undefined);
});

test("stats/clear empties the counts and the usage and leaves the settings alone", async () => {
  const bg = load({ limitMinutes: 1, blockedTargets: ["youtube.com", "reddit.com"] });
  await bg.send("event", { name: "shown", url: YT }, 1);
  await bg.send("event", { name: "continue", url: YT }, 1);
  await bg.send("tick", { url: YT, seconds: 30 }, 1);
  assert.equal(bg.data.local.stats[TODAY]["youtube.com"].shown, 1);
  assert.equal(bg.data.local.dailyUsage[TODAY]["youtube.com"], 30);

  assert.deepEqual(plain(await bg.send("stats/clear")), { cleared: true });
  assert.deepEqual(bg.data.local.stats, {});
  assert.deepEqual(bg.data.local.dailyUsage, {});
  assert.deepEqual(bg.data.local.blockedTargets, ["youtube.com", "reddit.com"]);
  assert.equal(bg.data.local.limitMinutes, 1);

  // Counting starts over, and the pass in use keeps running.
  assert.deepEqual(plain((await bg.send("gate", { url: YT }, 2)).extras.stats), { siteShown: 1, totalShown: 1 });
  assert.equal((await bg.send("tick", { url: YT, seconds: 10 }, 1)).remainingSeconds, 20);
  assert.equal(bg.data.local.dailyUsage[TODAY]["youtube.com"], 10);

  const state = await bg.send("state");
  assert.deepEqual(plain(state.stats), {});
});
