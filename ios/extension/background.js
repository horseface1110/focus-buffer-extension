const BLOCKED_TARGETS_KEY = "blockedTargets";
const DAILY_USAGE_KEY = "dailyUsage";
const DEFAULT_TARGETS = ["instagram.com", "facebook.com", "youtube.com"];
const DEFAULT_LIMIT_MINUTES = 5;
const CONTENT_SCRIPT_ID = "focus-buffer-dynamic-sites";

let syncQueue = Promise.resolve();
let usageQueue = Promise.resolve();

browser.runtime.onInstalled.addListener(() => {
  ensureDefaults()
    .then(syncContentScripts)
    .catch((error) => console.error("Focus Buffer install setup failed:", error));
});

browser.runtime.onStartup.addListener(() => {
  syncContentScripts().catch((error) => {
    console.error("Focus Buffer startup registration failed:", error);
  });
});

browser.permissions.onAdded.addListener(() => {
  syncContentScripts().catch((error) => {
    console.error("Focus Buffer permission registration failed:", error);
  });
});

browser.permissions.onRemoved.addListener(() => {
  syncContentScripts().catch((error) => {
    console.error("Focus Buffer permission cleanup failed:", error);
  });
});

browser.runtime.onMessage.addListener((message, sender) => {
  if (!message || typeof message.type !== "string") {
    return undefined;
  }

  if (message.type === "CLOSE_DISTRACTION_TAB") {
    const tabId = sender && sender.tab ? sender.tab.id : undefined;
    if (typeof tabId !== "number") {
      return Promise.resolve(false);
    }

    return browser.tabs.remove(tabId).then(
      () => true,
      (error) => {
        console.error("Could not close the current Safari tab:", error);
        return false;
      }
    );
  }

  if (message.type === "SYNC_CONTENT_SCRIPTS") {
    return syncContentScripts();
  }

  if (message.type === "ADD_USAGE_SECONDS") {
    usageQueue = usageQueue.then(() => addUsageSeconds(message));
    return usageQueue;
  }

  return undefined;
});

async function ensureDefaults() {
  const settings = await browser.storage.local.get([
    BLOCKED_TARGETS_KEY,
    "limitMinutes"
  ]);

  const updates = {};

  if (!Array.isArray(settings[BLOCKED_TARGETS_KEY])) {
    updates[BLOCKED_TARGETS_KEY] = DEFAULT_TARGETS;
  }

  if (!Number.isFinite(Number(settings.limitMinutes))) {
    updates.limitMinutes = DEFAULT_LIMIT_MINUTES;
  }

  if (Object.keys(updates).length > 0) {
    await browser.storage.local.set(updates);
  }
}

function syncContentScripts() {
  syncQueue = syncQueue.then(doSyncContentScripts);
  return syncQueue;
}

async function doSyncContentScripts() {
  await ensureDefaults();

  const settings = await browser.storage.local.get(BLOCKED_TARGETS_KEY);
  const targets = Array.isArray(settings[BLOCKED_TARGETS_KEY])
    ? settings[BLOCKED_TARGETS_KEY]
    : [];

  const matches = new Set();

  for (const target of targets) {
    const host = getHost(target);
    if (!host) {
      continue;
    }

    const origins = originsForHost(host);
    const hasAccess = await browser.permissions.contains({ origins: origins });

    if (hasAccess) {
      for (const pattern of origins) {
        matches.add(pattern);
      }
    }
  }

  try {
    await browser.scripting.unregisterContentScripts({
      ids: [CONTENT_SCRIPT_ID]
    });
  } catch (error) {
    // It is expected that no registration exists on first install.
  }

  if (matches.size === 0) {
    return;
  }

  await browser.scripting.registerContentScripts([
    {
      id: CONTENT_SCRIPT_ID,
      matches: Array.from(matches),
      js: ["content.js"],
      css: ["styles.css"],
      runAt: "document_start",
      persistAcrossSessions: true
    }
  ]);
}

async function addUsageSeconds(message) {
  const target = typeof message.target === "string" ? message.target : "";
  const seconds = Math.floor(Number(message.seconds));
  const dayKey = typeof message.dayKey === "string" ? message.dayKey : localDayKey();

  if (!target || !Number.isFinite(seconds) || seconds <= 0 || seconds > 60) {
    return false;
  }

  const settings = await browser.storage.local.get(DAILY_USAGE_KEY);
  const allUsage = settings[DAILY_USAGE_KEY] || {};
  const todayUsage = allUsage[dayKey] || {};

  allUsage[dayKey] = Object.assign({}, todayUsage, {
    [target]: Number(todayUsage[target] || 0) + seconds
  });

  await browser.storage.local.set({
    [DAILY_USAGE_KEY]: allUsage
  });

  return true;
}

function originsForHost(host) {
  return [
    "*://" + host + "/*",
    "*://*." + host + "/*"
  ];
}

function getHost(target) {
  const value = String(target || "").trim().toLowerCase();

  if (!value) {
    return "";
  }

  try {
    if (value.startsWith("http://") || value.startsWith("https://")) {
      return new URL(value).hostname.replace(/^www\./, "");
    }

    return new URL("https://" + value).hostname.replace(/^www\./, "");
  } catch (error) {
    return "";
  }
}

function localDayKey() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return year + "-" + month + "-" + day;
}
