// Loads the real service worker (extension/background.js and everything it
// imports) into a node:vm context with an in-memory fake of the extension
// API, so handlers can be exercised without a browser.
//
//   const bg = loadBackground({ features: ["todos"], now: Date.parse("2026-11-23T10:00:00") });
//   await bg.send("targets/add", { target: "reddit.com" });
//   const gate = await bg.send("gate", { url: "https://reddit.com/" }, 1);   // 1 = tab id
//   bg.advance(60_000);            // move the clock
//   bg.data.local                  // what storage.local holds
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const EXTENSION_DIR = path.join(__dirname, "..", "..", "extension");

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function storageArea(data) {
  return {
    async get(keys) {
      if (keys === null || keys === undefined) {
        return clone(data);
      }
      if (typeof keys === "string") {
        return keys in data ? { [keys]: clone(data[keys]) } : {};
      }
      if (Array.isArray(keys)) {
        const out = {};
        for (const key of keys) {
          if (key in data) {
            out[key] = clone(data[key]);
          }
        }
        return out;
      }
      const out = {};
      for (const [key, fallback] of Object.entries(keys)) {
        out[key] = key in data ? clone(data[key]) : fallback;
      }
      return out;
    },
    async set(items) {
      Object.assign(data, clone(items));
    },
    async remove(keys) {
      for (const key of [].concat(keys)) {
        delete data[key];
      }
    }
  };
}

function loadBackground(options = {}) {
  const clock = { now: options.now === undefined ? Date.parse("2026-11-23T10:00:00") : options.now };
  const data = { local: clone(options.local) || {}, session: {}, sync: clone(options.sync) || {} };
  const listeners = { message: [], installed: [], startup: [], permissionAdded: [], permissionRemoved: [], tabRemoved: [] };
  const event = (list) => ({ addListener: (fn) => list.push(fn) });

  // "all" grants every host; otherwise a Set of match patterns.
  let granted = options.granted === undefined ? "all" : new Set(options.granted);
  const calls = { registered: [], removedTabs: [], createdTabs: [], removedOrigins: [] };

  const api = {
    storage: { local: storageArea(data.local), session: storageArea(data.session), sync: storageArea(data.sync) },
    runtime: {
      onMessage: event(listeners.message),
      onInstalled: event(listeners.installed),
      onStartup: event(listeners.startup),
      getURL: (file) => "chrome-extension://test/" + (file || "")
    },
    permissions: {
      onAdded: event(listeners.permissionAdded),
      onRemoved: event(listeners.permissionRemoved),
      async contains({ origins }) {
        return granted === "all" || origins.every((origin) => granted.has(origin));
      },
      async remove({ origins }) {
        calls.removedOrigins.push(...origins);
        if (granted !== "all") {
          origins.forEach((origin) => granted.delete(origin));
        }
        return true;
      }
    },
    scripting: {
      async registerContentScripts(scripts) {
        calls.registered = clone(scripts);
      },
      async unregisterContentScripts() {
        if (calls.registered.length === 0) {
          throw new Error("Nonexistent script ID");
        }
        calls.registered = [];
      }
    },
    tabs: {
      onRemoved: event(listeners.tabRemoved),
      async remove(tabId) {
        if (options.tabsCannotClose) {
          throw new Error("cannot close");
        }
        calls.removedTabs.push(tabId);
      },
      async create(details) {
        calls.createdTabs.push(details);
        return { id: 999 };
      }
    }
  };

  class FakeDate extends Date {
    constructor(...args) {
      if (args.length === 0) {
        super(clock.now);
      } else {
        super(...args);
      }
    }
    static now() {
      return clock.now;
    }
  }

  const sandbox = { chrome: api, console: console, Date: FakeDate, setTimeout, clearTimeout, URL, structuredClone };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  vm.createContext(sandbox);

  const run = (file) => {
    const source = fs.readFileSync(path.join(EXTENSION_DIR, file), "utf8");
    vm.runInContext(source, sandbox, { filename: file });
  };
  sandbox.importScripts = (...files) => {
    for (const file of files) {
      run(file);
      // Lets a test load only the features it is about.
      if (file === "core.js" && options.features) {
        sandbox.FB.FEATURE_IDS = options.features.slice();
      }
    }
  };
  run("background.js");

  function send(type, payload, tabId) {
    const sender = typeof tabId === "number" ? { tab: { id: tabId } } : {};
    return new Promise((resolve, reject) => {
      let handled = false;
      const respond = (response) => {
        if (response && response.ok) {
          resolve(response.result);
        } else {
          reject(new Error((response && response.error) || "no response"));
        }
      };
      for (const listener of listeners.message) {
        if (listener(Object.assign({}, payload, { type: type }), sender, respond) === true) {
          handled = true;
        }
      }
      if (!handled) {
        reject(new Error("no handler for " + type));
      }
    });
  }

  return {
    FB: sandbox.FB,
    api: api,
    data: data,
    calls: calls,
    clock: clock,
    listeners: listeners,
    send: send,
    advance(ms) {
      clock.now += ms;
    },
    setGranted(next) {
      granted = next === "all" ? "all" : new Set(next);
    },
    // Fire runtime.onInstalled and wait for the setup it kicks off.
    async install(reason = "install") {
      listeners.installed.forEach((listener) => listener({ reason: reason }));
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  };
}

module.exports = { loadBackground, EXTENSION_DIR };
