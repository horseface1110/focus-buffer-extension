// core.js — shared by the service worker, the content script, the popup and
// the node unit tests. Everything hangs off one global, FB, because the
// extension ships without a build step: each context just loads this file
// first and the feature files after it.
(function (root) {
  const api = root.browser || root.chrome;
  const FB = (root.FB = root.FB || {});

  FB.api = api;

  FB.config = {
    WAIT_SECONDS: 10,
    TICK_MS: 5000,
    MAX_TICK_SECONDS: 60,
    DEFAULT_LIMIT_MINUTES: 5,
    MIN_LIMIT_MINUTES: 1,
    MAX_LIMIT_MINUTES: 180,
    DEFAULT_TARGETS: ["instagram.com", "facebook.com", "youtube.com"],
    KEEP_DAYS: 30
  };

  // ---------------------------------------------------------------------
  // Features. See docs/FEATURES.md for the contract.
  //
  // FEATURE_IDS is the load order. Each id has features/<id>.js and
  // features/<id>.css; the service worker and the content-script
  // registration read this list, popup.html lists the same files by hand.
  // ---------------------------------------------------------------------
  FB.FEATURE_IDS = ["stats", "reasons", "todos", "rest", "strict"];
  FB.features = FB.features || [];
  FB.registerFeature = function (feature) {
    if (!feature || !feature.id) {
      throw new Error("A feature needs an id.");
    }
    if (!FB.features.some((item) => item.id === feature.id)) {
      FB.features.push(feature);
    }
    return feature;
  };

  // ---------------------------------------------------------------------
  // Targets. A target is either a bare domain ("reddit.com", which also
  // covers its subdomains) or a URL prefix ("https://example.com/path").
  // ---------------------------------------------------------------------
  const HOST_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

  function stripWww(hostname) {
    return String(hostname || "").replace(/^www\./, "");
  }

  function cleanPath(pathname) {
    const path = String(pathname || "").replace(/\/+$/, "");
    return path === "" ? "" : path;
  }

  // Returns the normalized target, or "" when the input is not a usable
  // domain or http(s) URL.
  FB.normalizeTarget = function (value) {
    const trimmed = String(value || "").trim().toLowerCase();
    if (!trimmed || /\s/.test(trimmed)) {
      return "";
    }

    const hasScheme = /^https?:\/\//.test(trimmed);
    if (!hasScheme && /^[a-z][a-z0-9+.-]*:\/\//.test(trimmed)) {
      return "";
    }

    let url;
    try {
      url = new URL(hasScheme ? trimmed : "https://" + trimmed);
    } catch (error) {
      return "";
    }

    const host = stripWww(url.hostname);
    if (!HOST_PATTERN.test(host)) {
      return "";
    }

    const path = cleanPath(url.pathname);
    if (!path) {
      return host;
    }

    return (hasScheme ? url.protocol : "https:") + "//" + host + path;
  };

  FB.isUrlTarget = function (target) {
    return /^https?:\/\//.test(String(target || ""));
  };

  // The registrable host a target lives on, without "www.".
  FB.hostOf = function (target) {
    const value = String(target || "");
    if (!value) {
      return "";
    }
    try {
      return stripWww(new URL(FB.isUrlTarget(value) ? value : "https://" + value).hostname);
    } catch (error) {
      return "";
    }
  };

  // Match patterns to request host access for a target.
  FB.originsFor = function (target) {
    const host = FB.hostOf(target);
    return host ? ["*://" + host + "/*", "*://*." + host + "/*"] : [];
  };

  FB.targetMatches = function (target, pageUrl) {
    let page;
    try {
      page = pageUrl instanceof URL ? pageUrl : new URL(String(pageUrl));
    } catch (error) {
      return false;
    }
    if (page.protocol !== "http:" && page.protocol !== "https:") {
      return false;
    }

    const pageHost = page.hostname.toLowerCase();
    if (FB.isUrlTarget(target)) {
      let wanted;
      try {
        wanted = new URL(target);
      } catch (error) {
        return false;
      }
      if (stripWww(pageHost) !== stripWww(wanted.hostname)) {
        return false;
      }
      const wantedPath = cleanPath(wanted.pathname).toLowerCase();
      const pagePath = page.pathname.toLowerCase();
      return pagePath.startsWith(wantedPath);
    }

    return pageHost === target || pageHost.endsWith("." + target);
  };

  // The most specific target that covers pageUrl, or "".
  FB.matchTarget = function (targets, pageUrl) {
    const matches = (Array.isArray(targets) ? targets : [])
      .map(FB.normalizeTarget)
      .filter((target) => target && FB.targetMatches(target, pageUrl))
      .sort((a, b) => b.length - a.length);
    return matches[0] || "";
  };

  FB.siteName = function (target) {
    const host = FB.hostOf(target);
    const known = { "instagram.com": "Instagram", "facebook.com": "Facebook", "youtube.com": "YouTube" };
    if (known[host]) {
      return known[host];
    }
    return FB.isUrlTarget(target) ? String(target).replace(/^https?:\/\//, "") : host;
  };

  // ---------------------------------------------------------------------
  // Small helpers
  // ---------------------------------------------------------------------
  FB.dayKey = function (date) {
    const now = date instanceof Date ? date : new Date(date === undefined ? Date.now() : date);
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return now.getFullYear() + "-" + month + "-" + day;
  };

  // The last `count` day keys ending today, oldest first.
  FB.recentDays = function (count, date) {
    const end = date instanceof Date ? date : new Date(date === undefined ? Date.now() : date);
    const days = [];
    for (let offset = count - 1; offset >= 0; offset -= 1) {
      const day = new Date(end.getFullYear(), end.getMonth(), end.getDate() - offset);
      days.push(FB.dayKey(day));
    }
    return days;
  };

  FB.formatMinutes = function (seconds) {
    return Math.floor(Number(seconds || 0) / 60) + " 分鐘";
  };

  FB.formatClock = function (timestamp) {
    const date = new Date(timestamp);
    return String(date.getHours()).padStart(2, "0") + ":" + String(date.getMinutes()).padStart(2, "0");
  };

  FB.limitSeconds = function (minutes) {
    const value = Number(minutes);
    const config = FB.config;
    if (!Number.isFinite(value) || value < config.MIN_LIMIT_MINUTES || value > config.MAX_LIMIT_MINUTES) {
      return Math.round(config.DEFAULT_LIMIT_MINUTES * 60);
    }
    return Math.round(value * 60);
  };

  // Tiny DOM builder used by the overlay and the popup, so nothing has to
  // go through innerHTML.
  //   FB.el("button", { class: "x", type: "button", onclick: fn }, "label")
  FB.el = function (tag, attrs, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs || {})) {
      if (value === undefined || value === null || value === false) {
        continue;
      }
      if (key === "class") {
        node.className = value;
      } else if (key === "dataset") {
        Object.assign(node.dataset, value);
      } else if (key.startsWith("on") && typeof value === "function") {
        node.addEventListener(key.slice(2), value);
      } else if (key in node && key !== "list" && key !== "form") {
        node[key] = value;
      } else {
        node.setAttribute(key, value === true ? "" : String(value));
      }
    }
    for (const child of children.flat()) {
      if (child === undefined || child === null || child === false) {
        continue;
      }
      node.append(child instanceof Node ? child : String(child));
    }
    return node;
  };

  // Ask the service worker to do something. Resolves with the handler's
  // return value and rejects with its error message.
  FB.send = async function (type, payload) {
    const response = await api.runtime.sendMessage(Object.assign({}, payload, { type: type }));
    if (!response || response.ok !== true) {
      throw new Error((response && response.error) || "擴充功能沒有回應，請再試一次。");
    }
    return response.result;
  };
})(globalThis);
