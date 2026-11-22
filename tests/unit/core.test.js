"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { loadBackground } = require("../helpers/background.js");

const YT = "https://www.youtube.com/watch?v=1";

test("normalizeTarget accepts domains and URLs and rejects everything else", () => {
  const { FB } = loadBackground({ features: [] });
  assert.equal(FB.normalizeTarget("  Reddit.com/ "), "reddit.com");
  assert.equal(FB.normalizeTarget("www.reddit.com"), "reddit.com");
  assert.equal(FB.normalizeTarget("https://www.Reddit.com/"), "reddit.com");
  assert.equal(FB.normalizeTarget("https://example.com/Path/"), "https://example.com/path");
  assert.equal(FB.normalizeTarget("example.com/path"), "https://example.com/path");
  for (const bad of ["", "not a domain!!", "localhost", "ftp://example.com", "chrome://extensions", "hello", "a..b"]) {
    assert.equal(FB.normalizeTarget(bad), "", bad);
  }
});

test("matchTarget covers subdomains and path prefixes and prefers the most specific target", () => {
  const { FB } = loadBackground({ features: [] });
  const targets = ["youtube.com", "https://example.com/news"];
  assert.equal(FB.matchTarget(targets, "https://m.youtube.com/"), "youtube.com");
  assert.equal(FB.matchTarget(targets, "https://notyoutube.com/"), "");
  assert.equal(FB.matchTarget(targets, "https://www.example.com/news/today"), "https://example.com/news");
  assert.equal(FB.matchTarget(targets, "https://example.com/about"), "");
  assert.equal(FB.matchTarget(["example.com", "https://example.com/news"], "https://example.com/news/1"), "https://example.com/news");
  assert.equal(FB.matchTarget(targets, "chrome://newtab"), "");
});

test("originsFor asks for the host and its subdomains", () => {
  const { FB } = loadBackground({ features: [] });
  assert.deepEqual(Array.from(FB.originsFor("https://www.example.com/news")), ["*://example.com/*", "*://*.example.com/*"]);
});

test("gate shows the overlay on a listed site and nothing elsewhere", async () => {
  const bg = loadBackground({ features: [] });
  const gate = await bg.send("gate", { url: YT }, 1);
  assert.equal(gate.action, "overlay");
  assert.equal(gate.target, "youtube.com");
  assert.equal(gate.siteName, "YouTube");
  assert.equal(gate.canContinue, true);
  assert.equal(gate.waitSeconds, 10);
  assert.equal(gate.limitSeconds, 300);
  assert.equal((await bg.send("gate", { url: "https://example.org/" }, 1)).action, "none");
});

test("continuing grants a pass that survives a reload and runs out on schedule", async () => {
  const bg = loadBackground({ features: [], local: { limitMinutes: 1 } });
  await bg.send("event", { name: "shown", url: YT }, 1);
  await bg.send("event", { name: "continue", url: YT }, 1);

  assert.equal((await bg.send("tick", { url: YT, seconds: 40 }, 1)).remainingSeconds, 20);
  // A reload asks the gate again: the pass keeps its used time.
  const reloaded = await bg.send("gate", { url: YT }, 1);
  assert.equal(reloaded.action, "pass");
  assert.equal(reloaded.remainingSeconds, 20);
  // Another tab has no pass.
  assert.equal((await bg.send("gate", { url: YT }, 2)).action, "overlay");

  const last = await bg.send("tick", { url: YT, seconds: 20 }, 1);
  assert.equal(last.action, "expired");
  assert.equal(last.closed, true);
  assert.deepEqual(bg.calls.removedTabs, [1]);
  assert.equal((await bg.send("gate", { url: YT }, 1)).action, "overlay");

  const day = bg.FB.dayKey(bg.clock.now);
  assert.equal(bg.data.local.dailyUsage[day]["youtube.com"], 60);
  assert.deepEqual(bg.data.local.stats[day]["youtube.com"], { shown: 1, continued: 1, closed: 0, autoClosed: 1 });
});

test("a tick without a pass is refused and not counted", async () => {
  const bg = loadBackground({ features: [] });
  assert.equal((await bg.send("tick", { url: YT, seconds: 30 }, 1)).action, "overlay");
  assert.deepEqual(bg.data.local.dailyUsage, {});
});

test("closing from the overlay closes the tab and is counted", async () => {
  const bg = loadBackground({ features: [] });
  const result = await bg.send("event", { name: "close", url: YT }, 7);
  assert.equal(result.closed, true);
  assert.deepEqual(bg.calls.removedTabs, [7]);
  const day = bg.FB.dayKey(bg.clock.now);
  assert.equal(bg.data.local.stats[day]["youtube.com"].closed, 1);
});

test("targets can be added and removed, and the registration follows", async () => {
  const bg = loadBackground({ features: [] });
  await bg.send("targets/add", { target: "https://www.Reddit.com/" });
  assert.deepEqual(bg.data.local.blockedTargets, ["facebook.com", "instagram.com", "reddit.com", "youtube.com"]);
  assert.ok(bg.calls.registered[0].matches.includes("*://*.reddit.com/*"));
  assert.deepEqual(bg.calls.registered[0].js.slice(0, 1).concat(bg.calls.registered[0].js.slice(-1)), ["core.js", "content.js"]);

  await assert.rejects(bg.send("targets/add", { target: "reddit.com" }), /已經在清單裡/);
  await assert.rejects(bg.send("targets/add", { target: "not a domain!!" }), /有效/);

  await bg.send("targets/remove", { target: "reddit.com" });
  assert.ok(!bg.data.local.blockedTargets.includes("reddit.com"));
  assert.ok(bg.calls.removedOrigins.includes("*://reddit.com/*"));
  assert.ok(!bg.calls.registered[0].matches.includes("*://reddit.com/*"));
});

test("adding a site reaches tabs already open on it, once", async () => {
  const bg = loadBackground({
    features: [],
    openTabs: [
      { id: 5, url: "https://www.reddit.com/r/all" },
      { id: 6, url: "https://www.youtube.com/watch?v=1", guarded: true },
      { id: 7, url: "https://example.org/" }
    ]
  });
  await bg.send("targets/add", { target: "reddit.com" });
  assert.deepEqual(bg.calls.injected.map((call) => call.tabId), [5]);
  assert.equal(bg.calls.injected[0].files.slice(-1)[0], "content.js");
});

test("only granted hosts are registered", async () => {
  const bg = loadBackground({ features: [], granted: ["*://youtube.com/*", "*://*.youtube.com/*"] });
  const matches = await bg.send("sync");
  assert.deepEqual(Array.from(matches).sort(), ["*://*.youtube.com/*", "*://youtube.com/*"]);
});

test("a host whose permission was revoked is left alone, and open tabs are told", async () => {
  const bg = loadBackground({ features: [], granted: ["*://youtube.com/*", "*://*.youtube.com/*"] });
  assert.equal((await bg.send("gate", { url: YT }, 1)).action, "overlay");
  await bg.send("event", { name: "continue", url: YT }, 1);

  bg.setGranted([]);
  bg.listeners.permissionRemoved.forEach((listener) => listener({ origins: ["*://youtube.com/*"] }));
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal((await bg.send("gate", { url: YT }, 1)).action, "none");
  assert.equal((await bg.send("tick", { url: YT, seconds: 30 }, 1)).action, "none");
  // Content scripts refresh on any storage change; this one says why.
  assert.equal(typeof bg.data.local.permissionsChangedAt, "number");
});

test("the limit must be a whole number of minutes in range", async () => {
  const bg = loadBackground({ features: [] });
  await bg.send("limit/set", { minutes: 20 });
  assert.equal(bg.data.local.limitMinutes, 20);
  for (const bad of [0, 181, 2.5, "x"]) {
    await assert.rejects(bg.send("limit/set", { minutes: bad }), /1 到 180/);
  }
});

test("old days are pruned", async () => {
  const bg = loadBackground({ features: [], local: { dailyUsage: { "2020-01-01": { "youtube.com": 5 } }, stats: { "2020-01-01": {} } } });
  await bg.send("event", { name: "shown", url: YT }, 1);
  assert.equal(bg.data.local.dailyUsage["2020-01-01"], undefined);
  assert.equal(bg.data.local.stats["2020-01-01"], undefined);
});

test("install migrates the 0.1 settings from storage.sync", async () => {
  const bg = loadBackground({ features: [], sync: { blockedTargets: ["www.reddit.com", "bad target"], limitMinutes: 12 } });
  await bg.install("update");
  assert.deepEqual(bg.data.local.blockedTargets, ["reddit.com"]);
  assert.equal(bg.data.local.limitMinutes, 12);
  assert.equal(bg.calls.createdTabs.length, 0);
});
