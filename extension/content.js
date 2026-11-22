// content.js — runs in the top frame of pages on listed sites. It asks the
// service worker what to do (the "gate"), then either shows the pause
// overlay or counts foreground time against the tab's pass.
(function () {
  const FB = globalThis.FB;
  if (!FB || window.top !== window || globalThis.__focusBufferContent) {
    return;
  }
  globalThis.__focusBufferContent = true;

  const api = FB.api;
  const config = FB.config;
  const el = FB.el;

  const ROOT_ID = "focus-buffer-root";
  const PAGE_UI_ID = "focus-buffer-page";
  const HINT_KEY = "focus-buffer-pass";
  const LOCK_CLASS = "focus-buffer-locked";

  let root = null;
  let gate = { action: "none" };
  let refreshing = false;
  let refreshAgain = false;
  let lastUrl = location.href;

  let trackTimer = null;
  let finalTickTimer = null;
  let lastTickAt = 0;

  let countdownTimer = null;
  // Set by a feature that just changed its own data from the overlay and
  // already shows the result (ticking a to-do): the next gate's feature data
  // is taken as seen instead of redrawing.
  let adoptExtras = false;
  let mediaTimer = null;
  const pausedMedia = new Set();
  let pageCleanups = [];

  start();

  async function start() {
    // Cover the page before the service worker answers, so a listed site
    // does not flash on screen first. Skipped while this tab holds a pass.
    try {
      const stored = await api.storage.local.get("blockedTargets");
      const targets = Array.isArray(stored.blockedTargets) ? stored.blockedTargets : config.DEFAULT_TARGETS;
      if (FB.matchTarget(targets, location.href) && !hasHint()) {
        mountRoot(true);
      }
    } catch (error) {
      // Fall through: the gate below decides.
    }

    await refresh();

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", flushUsage);
    window.addEventListener("pageshow", (event) => {
      if (event.persisted) {
        refresh();
      }
    });
    // Settings changed in the popup (a break started, strict mode switched
    // on...) should reach open pages without a reload. Usage counters change
    // on every tick, so they are not a reason to ask again.
    let settingsTimer = null;
    api.storage.onChanged.addListener((changes, area) => {
      if (area !== "local" || Object.keys(changes).every((key) => key === "dailyUsage" || key === "stats")) {
        return;
      }
      window.clearTimeout(settingsTimer);
      settingsTimer = window.setTimeout(refresh, 200);
    });
    // Single-page apps change the URL without loading a new document.
    window.setInterval(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        refresh();
      }
    }, 1000);
  }

  // -----------------------------------------------------------------------
  // Gate
  // -----------------------------------------------------------------------
  async function refresh() {
    if (refreshing) {
      refreshAgain = true;
      return;
    }
    refreshing = true;
    try {
      let next;
      try {
        next = await FB.send("gate", { url: location.href });
      } catch (error) {
        // The extension was reloaded or is unreachable: do not trap the page.
        next = { action: "none" };
      }
      apply(next);
    } finally {
      refreshing = false;
      if (refreshAgain) {
        refreshAgain = false;
        refresh();
      }
    }
  }

  function apply(next) {
    const previous = gate;
    gate = next;

    if (next.action === "overlay") {
      stopTracking();
      setHint(false);
      clearPageUi();
      // Redraw only when something the user can see changed, so a refresh
      // does not wipe a countdown or a half-typed reason.
      // Feature data counts too (a to-do added, 繼續前要寫理由 switched on),
      // except what a feature marks as changing on its own (stats' counts).
      const extras = {};
      for (const feature of FB.features) {
        if (next.extras && feature.id in next.extras && !(feature.overlay && feature.overlay.volatile)) {
          extras[feature.id] = next.extras[feature.id];
        }
      }
      const core = JSON.stringify([next.target, next.canContinue, next.message, next.waitSeconds]);
      const signature = JSON.stringify([core, extras]);
      const showing = root && !root.classList.contains("fb-cover");
      // Once the countdown runs the user has already passed every check;
      // redrawing now would only restart it.
      const counting = showing && countdownTimer !== null && root.dataset.target === next.target;
      const adopted = showing && adoptExtras && root.dataset.core === core;
      if (adopted && root.dataset.signature !== signature) {
        adoptExtras = false;
        root.dataset.signature = signature;
      }
      if (!showing || (root.dataset.signature !== signature && !counting)) {
        const sameVisit = Boolean(showing && root.dataset.target === next.target);
        showOverlay(next, sameVisit);
        root.dataset.core = core;
        root.dataset.signature = signature;
      }
      return;
    }

    removeOverlay();

    if (next.action === "pass" || next.action === "free") {
      setHint(true);
      startTracking();
      const changed =
        previous.action !== next.action ||
        previous.target !== next.target ||
        JSON.stringify(previous.extras) !== JSON.stringify(next.extras);
      if (changed) {
        renderPageUi(next);
      }
      scheduleFinalTick(next.remainingSeconds);
      return;
    }

    setHint(false);
    stopTracking();
    clearPageUi();
  }

  // -----------------------------------------------------------------------
  // Overlay
  // -----------------------------------------------------------------------
  function mountRoot(asCover) {
    if (!root) {
      root = el("div", { id: ROOT_ID });
    }
    root.classList.toggle("fb-cover", asCover);
    const attach = () => {
      if (root && !document.documentElement.contains(root)) {
        document.documentElement.appendChild(root);
      }
      document.documentElement.classList.add(LOCK_CLASS);
    };
    if (document.documentElement) {
      attach();
    } else {
      document.addEventListener("DOMContentLoaded", attach, { once: true });
    }
    return root;
  }

  function removeOverlay() {
    window.clearInterval(countdownTimer);
    countdownTimer = null;
    // However the overlay goes away (Continue, a break, the site taken off
    // the list), what it paused plays again.
    resumeMedia();
    if (root) {
      root.remove();
      root = null;
    }
    if (document.documentElement) {
      document.documentElement.classList.remove(LOCK_CLASS);
    }
  }

  // `redraw` is true when the overlay for this visit is already on screen
  // and only its content changed; that is not a new "shown" event.
  function showOverlay(current, redraw) {
    window.clearInterval(countdownTimer);
    countdownTimer = null;

    const container = mountRoot(false);
    // A redraw keeps what the user typed and where the focus was.
    const typed = {};
    let focusedId = "";
    if (redraw) {
      for (const field of container.querySelectorAll("input[id], textarea[id]")) {
        typed[field.id] = field.value;
      }
      focusedId = document.activeElement && container.contains(document.activeElement) ? document.activeElement.id : "";
    }
    container.replaceChildren();
    container.dataset.target = current.target;
    container.setAttribute("role", "dialog");
    container.setAttribute("aria-modal", "true");
    container.setAttribute("aria-label", "分心緩衝提醒");

    const slot = (name) => el("div", { class: "fb-slot", dataset: { slot: name } });
    const slots = { top: slot("top"), stats: slot("stats"), tasks: slot("tasks"), form: slot("form"), bottom: slot("bottom") };

    const task = (key, mark, label) =>
      el("div", { class: "fb-task", dataset: { task: key } }, el("span", { class: "fb-task-mark" }, mark), el("span", { class: "fb-task-label" }, label));
    const tasks = {
      water: task("water", "1", "喝一口水"),
      todo: task("todo", "2", "看一下今天最重要的待辦"),
      stretch: task("stretch", "3", "站起來伸展 30 秒")
    };

    const usageCard = (value, label) =>
      el("div", {}, el("span", { class: "fb-usage-number" }, value), el("span", { class: "fb-usage-label" }, label));

    const closeButton = el("button", { class: "fb-button fb-button-primary", type: "button", dataset: { action: "close" } }, "關掉這頁");
    const continueButton = el(
      "button",
      { class: "fb-button fb-button-secondary", type: "button", dataset: { action: "continue" } },
      "我真的要繼續"
    );
    const status = el("p", { class: "fb-status", "aria-live": "polite" });

    const panel = el(
      "section",
      { class: "fb-panel", "aria-labelledby": "fb-title" },
      el("h1", { id: "fb-title" }, "你剛剛打開了 " + current.siteName),
      slots.top,
      el(
        "div",
        { class: "fb-usage", "aria-label": "今天的使用時間" },
        usageCard(FB.formatMinutes(current.usage.siteSeconds), "這個網站"),
        usageCard(FB.formatMinutes(current.usage.totalSeconds), "全部網站")
      ),
      slots.stats,
      el("div", { class: "fb-actions-list", "aria-label": "回到專注的小任務" }, tasks.water, tasks.todo, tasks.stretch),
      slots.tasks,
      slots.form,
      el("div", { class: "fb-controls" }, closeButton, current.canContinue === false ? null : continueButton),
      status,
      slots.bottom
    );
    container.append(el("main", { class: "fb-shell" }, panel));

    if (current.canContinue === false) {
      status.textContent = current.message || "現在不能繼續。";
    }

    const contextFor = (feature) => ({
      gate: current,
      extras: current.extras ? current.extras[feature.id] : undefined,
      root: container,
      panel: panel,
      slots: slots,
      tasks: tasks,
      continueButton: continueButton,
      setStatus: (text) => {
        status.textContent = text;
      },
      redraw: Boolean(redraw),
      // Call right before sending a change the overlay already shows.
      keepOverlay: (keep) => {
        adoptExtras = keep !== false;
      },
      send: FB.send,
      el: el,
      refresh: refresh
    });

    for (const feature of FB.features) {
      if (feature.overlay && typeof feature.overlay.render === "function") {
        try {
          feature.overlay.render(contextFor(feature));
        } catch (error) {
          console.error("Focus Buffer: " + feature.id + " overlay failed", error);
        }
      }
    }

    for (const [id, value] of Object.entries(typed)) {
      const field = container.querySelector("#" + CSS.escape(id));
      if (field && field.type !== "checkbox" && field.type !== "radio") {
        field.value = value;
        field.dispatchEvent(new Event("input"));
      }
    }

    closeButton.addEventListener("click", async () => {
      closeButton.disabled = true;
      let closed = false;
      try {
        closed = (await FB.send("event", { name: "close", url: location.href })).closed;
      } catch (error) {
        closed = false;
      }
      if (!closed) {
        closeButton.disabled = false;
        status.textContent = "沒辦法自動關閉，請自己關掉這個分頁。";
      }
    });

    let continuing = false;
    continueButton.addEventListener("click", async () => {
      if (continuing) {
        return;
      }
      continuing = true;

      const data = {};
      for (const feature of FB.features) {
        const hook = feature.overlay && feature.overlay.beforeContinue;
        if (typeof hook !== "function") {
          continue;
        }
        const answer = await hook(contextFor(feature));
        if (answer === false) {
          continuing = false;
          return;
        }
        if (answer && typeof answer === "object") {
          Object.assign(data, answer);
        }
      }

      startCountdown(current, continueButton, closeButton, status, data);
    });

    pauseMediaWhileShown();
    if (!redraw) {
      FB.send("event", { name: "shown", url: location.href }).catch(() => {});
    }
    const refocus = focusedId ? container.querySelector("#" + CSS.escape(focusedId)) : null;
    if (refocus) {
      refocus.focus({ preventScroll: true });
    } else if (document.readyState !== "loading" && !redraw) {
      closeButton.focus({ preventScroll: true });
    }
  }

  function startCountdown(current, continueButton, closeButton, status, data) {
    let remaining = Math.max(0, Math.round(Number(current.waitSeconds) || 0));
    const limitMinutes = Math.ceil(current.limitSeconds / 60);

    const finish = async () => {
      window.clearInterval(countdownTimer);
      countdownTimer = null;
      try {
        await FB.send("event", { name: "continue", url: location.href, data: data });
      } catch (error) {
        // refresh() below shows whatever the service worker decided.
      }
      resumeMedia();
      await refresh();
    };

    continueButton.disabled = true;
    closeButton.focus({ preventScroll: true });

    if (remaining === 0) {
      finish();
      return;
    }

    const render = () => {
      status.textContent = "繼續後 " + limitMinutes + " 分鐘自動關閉。";
      continueButton.textContent = remaining + " 秒後繼續";
    };
    render();

    countdownTimer = window.setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        finish();
        return;
      }
      render();
    }, 1000);
  }

  // The page keeps loading underneath the overlay. Keep its audio and video
  // quiet until the user decides.
  function pauseMediaWhileShown() {
    window.clearInterval(mediaTimer);
    const pause = () => {
      for (const media of document.querySelectorAll("video, audio")) {
        if (!media.paused) {
          media.pause();
          pausedMedia.add(media);
        }
      }
    };
    pause();
    mediaTimer = window.setInterval(pause, 500);
  }

  function resumeMedia() {
    window.clearInterval(mediaTimer);
    mediaTimer = null;
    for (const media of pausedMedia) {
      if (media.isConnected) {
        const playing = media.play();
        if (playing && typeof playing.catch === "function") {
          playing.catch(() => {});
        }
      }
    }
    pausedMedia.clear();
  }

  // -----------------------------------------------------------------------
  // Small on-page UI for features while the page is usable ("pass"/"free")
  // -----------------------------------------------------------------------
  function clearPageUi() {
    for (const cleanup of pageCleanups) {
      try {
        cleanup();
      } catch (error) {
        // Ignore: the page is going away or the feature already cleaned up.
      }
    }
    pageCleanups = [];
    const existing = document.getElementById(PAGE_UI_ID);
    if (existing) {
      existing.remove();
    }
  }

  function renderPageUi(current) {
    clearPageUi();
    let container = null;
    const mount = (node) => {
      if (!container) {
        container = el("div", { id: PAGE_UI_ID });
        document.documentElement.appendChild(container);
      }
      container.append(node);
      return node;
    };

    for (const feature of FB.features) {
      if (!feature.page || typeof feature.page.render !== "function") {
        continue;
      }
      try {
        feature.page.render({
          gate: current,
          extras: current.extras ? current.extras[feature.id] : undefined,
          mount: mount,
          onCleanup: (cleanup) => pageCleanups.push(cleanup),
          send: FB.send,
          el: el,
          refresh: refresh
        });
      } catch (error) {
        console.error("Focus Buffer: " + feature.id + " page UI failed", error);
      }
    }
  }

  // -----------------------------------------------------------------------
  // Usage tracking
  // -----------------------------------------------------------------------
  function startTracking() {
    if (trackTimer) {
      return;
    }
    lastTickAt = Date.now();
    trackTimer = window.setInterval(() => tick(false), config.TICK_MS);
  }

  function stopTracking() {
    window.clearInterval(trackTimer);
    window.clearTimeout(finalTickTimer);
    trackTimer = null;
    finalTickTimer = null;
    lastTickAt = 0;
  }

  // Ticks are TICK_MS apart; when the pass ends sooner than that, check
  // again right when it runs out.
  function scheduleFinalTick(remainingSeconds) {
    window.clearTimeout(finalTickTimer);
    finalTickTimer = null;
    const remainingMs = Number(remainingSeconds) * 1000;
    if (trackTimer && Number.isFinite(remainingMs) && remainingMs > 0 && remainingMs < config.TICK_MS) {
      finalTickTimer = window.setTimeout(() => tick(false), remainingMs);
    }
  }

  async function tick(evenIfHidden) {
    if (!trackTimer || !lastTickAt) {
      return;
    }
    if (document.visibilityState !== "visible" && !evenIfHidden) {
      lastTickAt = Date.now();
      return;
    }

    const now = Date.now();
    const seconds = Math.min(config.MAX_TICK_SECONDS, Math.round((now - lastTickAt) / 1000));
    if (seconds <= 0) {
      return;
    }
    lastTickAt = now;

    let reply;
    try {
      reply = await FB.send("tick", { url: location.href, seconds: seconds });
    } catch (error) {
      return;
    }

    if (reply.action === "pass" || reply.action === "free") {
      if (reply.action === gate.action) {
        gate.remainingSeconds = reply.remainingSeconds;
        scheduleFinalTick(reply.remainingSeconds);
      } else {
        refresh();
      }
      return;
    }

    stopTracking();
    if (reply.action === "expired") {
      // The service worker is closing this tab. If it could not, show the
      // overlay again.
      window.setTimeout(refresh, 700);
    } else {
      refresh();
    }
  }

  function flushUsage() {
    tick(true);
  }

  function onVisibilityChange() {
    if (!trackTimer) {
      return;
    }
    if (document.visibilityState === "visible") {
      lastTickAt = Date.now();
    } else {
      flushUsage();
    }
  }

  // -----------------------------------------------------------------------
  // "This tab holds a pass" hint, so reloads skip the cover.
  // -----------------------------------------------------------------------
  function hasHint() {
    try {
      return sessionStorage.getItem(HINT_KEY) === "1";
    } catch (error) {
      return false;
    }
  }

  function setHint(on) {
    try {
      if (on) {
        sessionStorage.setItem(HINT_KEY, "1");
      } else {
        sessionStorage.removeItem(HINT_KEY);
      }
    } catch (error) {
      // Storage is blocked on this page; the cover just shows a little longer.
    }
  }
})();
