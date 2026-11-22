// background.js — the service worker. It is the only place that writes to
// storage, so two tabs can never overwrite each other's updates, and it
// decides what every page should show (the "gate").
importScripts("core.js");
for (const id of FB.FEATURE_IDS) {
  // One broken feature file must not take the whole extension down.
  try {
    importScripts("features/" + id + ".js");
  } catch (error) {
    console.error("Focus Buffer: could not load feature " + id, error);
  }
}

(function (root) {
  const FB = root.FB;
  const api = FB.api;
  const config = FB.config;

  const CONTENT_SCRIPT_ID = "focus-buffer-sites";
  const CONTENT_JS = ["core.js", ...FB.FEATURE_IDS.map((id) => "features/" + id + ".js"), "content.js"];
  const CONTENT_CSS = ["overlay.css", ...FB.FEATURE_IDS.map((id) => "features/" + id + ".css")];
  const STAT_FIELDS = { shown: "shown", continue: "continued", close: "closed", autoclose: "autoClosed" };

  // ---------------------------------------------------------------------
  // Store. Everything lives in storage.local under top-level keys; features
  // add their own keys through `defaults`.
  // ---------------------------------------------------------------------
  let queue = Promise.resolve();

  function serial(task) {
    const run = queue.then(task);
    queue = run.catch(() => {});
    return run;
  }

  function defaults() {
    const base = {
      blockedTargets: config.DEFAULT_TARGETS.slice(),
      limitMinutes: config.DEFAULT_LIMIT_MINUTES,
      dailyUsage: {},
      stats: {}
    };
    for (const feature of FB.features) {
      if (feature.defaults) {
        Object.assign(base, JSON.parse(JSON.stringify(feature.defaults)));
      }
    }
    return base;
  }

  async function readState() {
    const stored = await api.storage.local.get(null);
    const state = Object.assign(defaults(), stored);
    if (!Array.isArray(state.blockedTargets)) {
      state.blockedTargets = config.DEFAULT_TARGETS.slice();
    }
    for (const key of ["dailyUsage", "stats"]) {
      if (!state[key] || typeof state[key] !== "object") {
        state[key] = {};
      }
    }
    return state;
  }

  FB.store = {
    get: readState,
    // Read, let `mutator` change the state in place, write it back. Calls
    // are queued, so a mutator always sees the previous one's result.
    update(mutator) {
      return serial(async () => {
        const state = await readState();
        const result = await mutator(state);
        await api.storage.local.set(state);
        return result;
      });
    }
  };

  // ---------------------------------------------------------------------
  // Passes. After "我真的要繼續" a tab holds a pass for that target until
  // its minutes are used up. Passes live in storage.session, so they survive
  // a reload and a service-worker restart but not a browser restart.
  // ---------------------------------------------------------------------
  let memoryPasses = {};

  async function readPasses() {
    if (!api.storage.session) {
      return memoryPasses;
    }
    const stored = await api.storage.session.get("passes");
    return stored.passes || {};
  }

  async function writePasses(passes) {
    if (!api.storage.session) {
      memoryPasses = passes;
      return;
    }
    await api.storage.session.set({ passes: passes });
  }

  async function getPass(tabId, target) {
    const passes = await readPasses();
    return (passes[tabId] && passes[tabId][target]) || null;
  }

  async function setPass(tabId, target, pass) {
    const passes = await readPasses();
    if (pass) {
      passes[tabId] = Object.assign({}, passes[tabId], { [target]: pass });
    } else if (passes[tabId]) {
      delete passes[tabId][target];
      if (Object.keys(passes[tabId]).length === 0) {
        delete passes[tabId];
      }
    }
    await writePasses(passes);
  }

  // ---------------------------------------------------------------------
  // Gate. What should the page at `url` in tab `tabId` do right now?
  // ---------------------------------------------------------------------
  async function computeGate(state, url, tabId, now) {
    const target = FB.matchTarget(state.blockedTargets, url);
    if (!target) {
      return { action: "none" };
    }

    const day = FB.dayKey(now);
    const today = state.dailyUsage[day] || {};
    const pass = typeof tabId === "number" ? await getPass(tabId, target) : null;
    const gate = {
      action: pass ? "pass" : "overlay",
      target: target,
      siteName: FB.siteName(target),
      canContinue: true,
      message: "",
      waitSeconds: config.WAIT_SECONDS,
      limitSeconds: FB.limitSeconds(state.limitMinutes),
      remainingSeconds: pass ? Math.max(0, pass.limitSeconds - pass.usedSeconds) : null,
      usage: {
        siteSeconds: Number(today[target] || 0),
        totalSeconds: Object.values(today).reduce((sum, value) => sum + Number(value || 0), 0)
      },
      extras: {}
    };

    const context = { state: state, target: target, url: url, tabId: tabId, now: now, day: day, pass: pass };
    for (const feature of FB.features) {
      if (typeof feature.gate === "function") {
        await feature.gate(gate, context);
      }
    }

    // A feature that forbids continuing also ends a pass already in use.
    if (gate.action === "pass" && gate.canContinue === false) {
      gate.action = "overlay";
    }
    if (gate.action !== "pass") {
      gate.remainingSeconds = null;
    }

    // For features that only describe the outcome: the action is final here.
    for (const feature of FB.features) {
      if (typeof feature.finalize === "function") {
        await feature.finalize(gate, context);
      }
    }
    return gate;
  }

  function bumpStat(state, day, target, name) {
    const field = STAT_FIELDS[name];
    if (!field) {
      return;
    }
    const dayStats = (state.stats[day] = state.stats[day] || {});
    const entry = (dayStats[target] = Object.assign({ shown: 0, continued: 0, closed: 0, autoClosed: 0 }, dayStats[target]));
    entry[field] += 1;
  }

  function addUsage(state, day, target, seconds) {
    const dayUsage = (state.dailyUsage[day] = state.dailyUsage[day] || {});
    dayUsage[target] = Number(dayUsage[target] || 0) + seconds;
  }

  function prune(state, now) {
    const cutoff = FB.recentDays(config.KEEP_DAYS, now)[0];
    for (const key of ["dailyUsage", "stats"]) {
      for (const day of Object.keys(state[key])) {
        if (day < cutoff) {
          delete state[key][day];
        }
      }
    }
  }

  function runEventHooks(event, state, gate) {
    for (const feature of FB.features) {
      if (typeof feature.onEvent === "function") {
        feature.onEvent(event, state, { gate: gate });
      }
    }
  }

  async function closeTab(tabId) {
    if (typeof tabId !== "number") {
      return false;
    }
    try {
      await api.tabs.remove(tabId);
      return true;
    } catch (error) {
      return false;
    }
  }

  // Throws when a feature vetoes a settings change (strict mode does).
  FB.guard = function (action, payload, state, now) {
    for (const feature of FB.features) {
      if (typeof feature.guard !== "function") {
        continue;
      }
      const verdict = feature.guard(action, payload || {}, state, now === undefined ? Date.now() : now);
      if (verdict && verdict.ok === false) {
        throw new Error(verdict.message || "目前不能變更這個設定。");
      }
    }
  };

  // ---------------------------------------------------------------------
  // Content-script registration. Safari (and now Chrome too) only runs the
  // content script on hosts the user granted, so the registration follows
  // the target list and the granted permissions.
  // ---------------------------------------------------------------------
  let syncQueue = Promise.resolve();

  function syncContentScripts() {
    const run = syncQueue.then(doSyncContentScripts);
    syncQueue = run.catch(() => {});
    return run;
  }

  async function doSyncContentScripts() {
    const state = await readState();
    const matches = new Set();

    for (const target of state.blockedTargets) {
      const origins = FB.originsFor(target);
      if (origins.length === 0) {
        continue;
      }
      if (await api.permissions.contains({ origins: origins })) {
        origins.forEach((pattern) => matches.add(pattern));
      }
    }

    try {
      await api.scripting.unregisterContentScripts({ ids: [CONTENT_SCRIPT_ID] });
    } catch (error) {
      // Nothing was registered yet.
    }

    if (matches.size === 0) {
      return [];
    }

    await api.scripting.registerContentScripts([
      {
        id: CONTENT_SCRIPT_ID,
        matches: Array.from(matches),
        js: CONTENT_JS,
        css: CONTENT_CSS,
        runAt: "document_start",
        persistAcrossSessions: true
      }
    ]);
    await injectIntoOpenTabs(Array.from(matches));
    return Array.from(matches);
  }

  // A registration only reaches pages loaded after it. A tab that was
  // already open on the site (「加入目前的網站」 adds the very tab the user is
  // looking at) gets the content script now; content.js ignores a second copy,
  // and the probe skips tabs that already have it.
  async function injectIntoOpenTabs(matches) {
    if (!api.tabs.query || !api.scripting.executeScript) {
      return;
    }
    let tabs = [];
    try {
      tabs = await api.tabs.query({ url: matches });
    } catch (error) {
      return;
    }
    await Promise.all(
      tabs.map(async (tab) => {
        const target = { tabId: tab.id };
        try {
          const [probe] = await api.scripting.executeScript({ target: target, func: () => Boolean(globalThis.__focusBufferContent) });
          if (probe && probe.result) {
            return;
          }
          await api.scripting.insertCSS({ target: target, files: CONTENT_CSS });
          await api.scripting.executeScript({ target: target, files: CONTENT_JS });
        } catch (error) {
          // The tab is an error page, still loading, or closed meanwhile.
        }
      })
    );
  }

  // ---------------------------------------------------------------------
  // Message handlers
  // ---------------------------------------------------------------------
  const handlers = {
    // Content script: what do I do on this page?
    async gate(message, sender) {
      const tabId = sender && sender.tab ? sender.tab.id : undefined;
      return serial(async () => {
        const state = await readState();
        const gate = await computeGate(state, message.url, tabId, Date.now());
        if (gate.action === "overlay" && typeof tabId === "number") {
          await setPass(tabId, gate.target, null);
        }
        return gate;
      });
    },

    // Content script: the overlay was shown / the user chose to continue /
    // the user chose to close the tab.
    async event(message, sender) {
      const tabId = sender && sender.tab ? sender.tab.id : undefined;
      const name = String(message.name || "");
      const now = Date.now();

      const result = await FB.store.update(async (state) => {
        const gate = await computeGate(state, message.url, tabId, now);
        if (gate.action === "none" || !STAT_FIELDS[name] || name === "autoclose") {
          return { action: gate.action };
        }

        if (name === "continue") {
          if (gate.action !== "overlay" || gate.canContinue === false) {
            return { action: gate.action, refused: gate.action === "overlay" };
          }
          await setPass(tabId, gate.target, { limitSeconds: gate.limitSeconds, usedSeconds: 0, grantedAt: now });
        }

        const event = { name: name, target: gate.target, data: message.data || {}, day: FB.dayKey(now), now: now, tabId: tabId };
        bumpStat(state, event.day, event.target, name);
        runEventHooks(event, state, gate);
        prune(state, now);
        return { action: name === "continue" ? "pass" : gate.action };
      });

      if (name === "close") {
        result.closed = await closeTab(tabId);
      }
      return result;
    },

    // Content script: `seconds` of foreground time passed on this page.
    async tick(message, sender) {
      const tabId = sender && sender.tab ? sender.tab.id : undefined;
      const seconds = Math.min(config.MAX_TICK_SECONDS, Math.max(0, Math.floor(Number(message.seconds) || 0)));
      const now = Date.now();

      const result = await FB.store.update(async (state) => {
        const gate = await computeGate(state, message.url, tabId, now);
        if (gate.action === "none") {
          return { action: "none" };
        }
        if (gate.action === "overlay") {
          await setPass(tabId, gate.target, null);
          return { action: "overlay" };
        }

        const day = FB.dayKey(now);
        if (seconds > 0) {
          addUsage(state, day, gate.target, seconds);
        }
        if (gate.action !== "pass") {
          return { action: gate.action };
        }

        const pass = await getPass(tabId, gate.target);
        pass.usedSeconds += seconds;
        const remainingSeconds = pass.limitSeconds - pass.usedSeconds;
        if (remainingSeconds > 0) {
          await setPass(tabId, gate.target, pass);
          return { action: "pass", remainingSeconds: remainingSeconds };
        }

        await setPass(tabId, gate.target, null);
        const event = { name: "autoclose", target: gate.target, data: {}, day: day, now: now, tabId: tabId };
        bumpStat(state, day, gate.target, "autoclose");
        runEventHooks(event, state, gate);
        return { action: "expired" };
      });

      if (result.action === "expired") {
        result.closed = await closeTab(tabId);
      }
      return result;
    },

    // Popup: the whole state.
    async state() {
      const state = await readState();
      state.now = Date.now();
      return state;
    },

    async "targets/add"(message) {
      const target = FB.normalizeTarget(message.target);
      if (!target) {
        throw new Error("請輸入有效的網域或網址，例如 reddit.com。");
      }
      await FB.store.update((state) => {
        const current = state.blockedTargets.map(FB.normalizeTarget).filter(Boolean);
        if (current.includes(target)) {
          throw new Error(target + " 已經在清單裡。");
        }
        state.blockedTargets = current.concat(target).sort();
      });
      await syncContentScripts();
      return { target: target };
    },

    async "targets/remove"(message) {
      const target = String(message.target || "");
      const remaining = await FB.store.update((state) => {
        FB.guard("targets/remove", { target: target }, state);
        state.blockedTargets = state.blockedTargets.filter((item) => item !== target);
        return state.blockedTargets.slice();
      });

      const host = FB.hostOf(target);
      if (host && !remaining.some((item) => FB.hostOf(item) === host)) {
        try {
          await api.permissions.remove({ origins: FB.originsFor(target) });
        } catch (error) {
          // The permission was never granted, or the browser keeps it.
        }
      }
      await syncContentScripts();
      return { target: target };
    },

    async "limit/set"(message) {
      const minutes = Number(message.minutes);
      if (!Number.isInteger(minutes) || minutes < config.MIN_LIMIT_MINUTES || minutes > config.MAX_LIMIT_MINUTES) {
        throw new Error("請輸入 " + config.MIN_LIMIT_MINUTES + " 到 " + config.MAX_LIMIT_MINUTES + " 分鐘。");
      }
      await FB.store.update((state) => {
        FB.guard("limit/set", { minutes: minutes, previous: Number(state.limitMinutes) }, state);
        state.limitMinutes = minutes;
      });
      return { minutes: minutes };
    },

    async sync() {
      return syncContentScripts();
    }
  };

  for (const feature of FB.features) {
    for (const [type, handler] of Object.entries(feature.handlers || {})) {
      handlers[type] = (message, sender) =>
        handler(message, { store: FB.store, sender: sender, now: Date.now(), guard: FB.guard, sync: syncContentScripts });
    }
  }

  api.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const handler = message && typeof message.type === "string" ? handlers[message.type] : null;
    if (!handler) {
      return undefined;
    }
    Promise.resolve()
      .then(() => handler(message, sender))
      .then(
        (result) => sendResponse({ ok: true, result: result === undefined ? null : result }),
        (error) => sendResponse({ ok: false, error: String((error && error.message) || error) })
      );
    return true;
  });

  // ---------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------

  // 0.1 kept the list and the limit in storage.sync. Copy them over once.
  async function migrate() {
    const stored = await api.storage.local.get(["blockedTargets", "limitMinutes"]);
    if (Array.isArray(stored.blockedTargets) || !api.storage.sync) {
      return;
    }
    let synced = {};
    try {
      synced = await api.storage.sync.get(["blockedTargets", "limitMinutes"]);
    } catch (error) {
      synced = {};
    }
    const updates = {
      blockedTargets: Array.isArray(synced.blockedTargets)
        ? synced.blockedTargets.map(FB.normalizeTarget).filter(Boolean)
        : config.DEFAULT_TARGETS.slice()
    };
    const limit = Number(synced.limitMinutes === undefined ? stored.limitMinutes : synced.limitMinutes);
    if (Number.isFinite(limit)) {
      updates.limitMinutes = limit;
    }
    await api.storage.local.set(updates);
  }

  api.runtime.onInstalled.addListener((details) => {
    serial(migrate)
      .then(syncContentScripts)
      .then(() => {
        // Chrome has no "enable this extension" settings page that leads the
        // user to the permission button, so open ours once after install.
        const isChrome = api.runtime.getURL("").startsWith("chrome-extension://");
        if (details && details.reason === "install" && isChrome) {
          return api.tabs.create({ url: api.runtime.getURL("popup.html") });
        }
        return undefined;
      })
      .catch((error) => console.error("Focus Buffer install setup failed:", error));
  });

  api.runtime.onStartup.addListener(() => {
    syncContentScripts().catch((error) => console.error("Focus Buffer startup sync failed:", error));
  });

  api.permissions.onAdded.addListener(() => {
    syncContentScripts().catch((error) => console.error("Focus Buffer permission sync failed:", error));
  });

  api.permissions.onRemoved.addListener(() => {
    syncContentScripts().catch((error) => console.error("Focus Buffer permission sync failed:", error));
  });

  api.tabs.onRemoved.addListener((tabId) => {
    serial(async () => {
      const passes = await readPasses();
      if (passes[tabId]) {
        delete passes[tabId];
        await writePasses(passes);
      }
    });
  });

  // Exposed for the unit tests.
  FB.background = { handlers: handlers, computeGate: computeGate, syncContentScripts: syncContentScripts, migrate: migrate };
})(globalThis);
