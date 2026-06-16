(function () {
  const ROOT_ID = "focus-buffer-root";
  const BYPASS_KEY = "focus-buffer-bypass-url";
  const BLOCKED_TARGETS_KEY = "blockedTargets";
  const LIMIT_MINUTES_KEY = "limitMinutes";
  const USAGE_KEY = "dailyUsage";
  const WAIT_SECONDS = 10;
  const DEFAULT_LIMIT_MINUTES = 5;
  const DEFAULT_TARGETS = ["instagram.com", "facebook.com", "youtube.com"];
  const TRACK_INTERVAL_MS = 5000;

  if (window.top !== window || document.getElementById(ROOT_ID)) {
    return;
  }

  const currentUrl = `${location.origin}${location.pathname}`;
  let activeTarget = "";
  let activeSiteName = "";
  let usageSeconds = 0;
  let usageLimitSeconds = DEFAULT_LIMIT_MINUTES * 60;
  let trackingTimer = null;
  let lastTrackedAt = 0;

  chrome.storage.sync.get(
    {
      [BLOCKED_TARGETS_KEY]: DEFAULT_TARGETS,
      [LIMIT_MINUTES_KEY]: DEFAULT_LIMIT_MINUTES
    },
    (settings) => {
      const targets = Array.isArray(settings[BLOCKED_TARGETS_KEY])
        ? settings[BLOCKED_TARGETS_KEY]
        : DEFAULT_TARGETS;
      const matchedTarget = targets.find((target) => isBlockedTarget(target, location));

      if (!matchedTarget) {
        return;
      }

      activeTarget = normalizeTarget(matchedTarget);
      activeSiteName = getSiteName(location.hostname, activeTarget);
      usageLimitSeconds = getLimitSeconds(settings[LIMIT_MINUTES_KEY]);

      if (sessionStorage.getItem(BYPASS_KEY) === currentUrl) {
        startUsageTracking();
        return;
      }

      loadTodayUsage(activeTarget, (stats) => {
        showOverlay(activeSiteName, stats);
      });
    }
  );

  function showOverlay(siteName, stats) {
    const root = document.createElement("div");
    root.id = ROOT_ID;
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-label", "分心緩衝提醒");

    root.innerHTML = `
      <main class="fb-shell">
        <section class="fb-panel" aria-labelledby="fb-title">
          <p class="fb-kicker">先暫停一下</p>
          <h1 id="fb-title">你剛剛打開了 ${escapeHtml(siteName)}</h1>
          <p class="fb-copy">不然你先去喝一口水，看看待辦清單，伸展 30 秒。等一下再決定要不要繼續。</p>

          <div class="fb-usage" aria-label="今天的使用時間">
            <div>
              <span class="fb-usage-number">${formatMinutes(stats.siteSeconds)}</span>
              <span class="fb-usage-label">今天在這個頁面</span>
            </div>
            <div>
              <span class="fb-usage-number">${formatMinutes(stats.totalSeconds)}</span>
              <span class="fb-usage-label">今天所有限制頁面</span>
            </div>
          </div>

          <div class="fb-actions-list" aria-label="回到專注的小任務">
            <div class="fb-task">
              <span class="fb-task-mark">1</span>
              <span>喝一口水</span>
            </div>
            <div class="fb-task">
              <span class="fb-task-mark">2</span>
              <span>看一下今天最重要的待辦</span>
            </div>
            <div class="fb-task">
              <span class="fb-task-mark">3</span>
              <span>站起來伸展 30 秒</span>
            </div>
          </div>

          <div class="fb-controls">
            <button class="fb-button fb-button-primary" type="button" data-action="close">關掉這頁</button>
            <button class="fb-button fb-button-secondary" type="button" data-action="continue">我真的要繼續</button>
          </div>

          <p class="fb-status" aria-live="polite"></p>
        </section>
      </main>
    `;

    const mount = () => {
      if (!document.documentElement.contains(root)) {
        document.documentElement.appendChild(root);
      }
    };

    if (document.documentElement) {
      mount();
    } else {
      document.addEventListener("DOMContentLoaded", mount, { once: true });
    }

    root.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-action]");
      if (!button) {
        return;
      }

      if (button.dataset.action === "close") {
        chrome.runtime.sendMessage({ type: "CLOSE_DISTRACTION_TAB" });
        return;
      }

      startCountdown(root, currentUrl);
    });
  }

  function startCountdown(container, url) {
    const continueButton = container.querySelector('[data-action="continue"]');
    const closeButton = container.querySelector('[data-action="close"]');
    const status = container.querySelector(".fb-status");
    let remaining = WAIT_SECONDS;

    continueButton.disabled = true;
    closeButton.focus();

    const render = () => {
      const limitMinutes = Math.ceil(usageLimitSeconds / 60);
      status.textContent = `先等 ${remaining} 秒。繼續後使用 ${limitMinutes} 分鐘就會自動關閉。`;
      continueButton.textContent = `${remaining} 秒後繼續`;
    };

    render();
    const timer = window.setInterval(() => {
      remaining -= 1;

      if (remaining <= 0) {
        window.clearInterval(timer);
        sessionStorage.setItem(BYPASS_KEY, url);
        container.remove();
        startUsageTracking();
        return;
      }

      render();
    }, 1000);
  }

  function startUsageTracking() {
    if (trackingTimer || !activeTarget) {
      return;
    }

    lastTrackedAt = Date.now();
    trackingTimer = window.setInterval(trackUsageTick, TRACK_INTERVAL_MS);
    window.addEventListener("pagehide", flushUsage);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        lastTrackedAt = Date.now();
      } else {
        flushUsage();
      }
    });
  }

  function trackUsageTick() {
    if (document.visibilityState !== "visible") {
      lastTrackedAt = Date.now();
      return;
    }

    const now = Date.now();
    const elapsedSeconds = Math.max(0, Math.round((now - lastTrackedAt) / 1000));
    lastTrackedAt = now;

    if (elapsedSeconds > 0) {
      addUsageSeconds(elapsedSeconds);
    }

    if (usageSeconds >= usageLimitSeconds) {
      flushUsage();
      chrome.runtime.sendMessage({ type: "CLOSE_DISTRACTION_TAB" });
    }
  }

  function flushUsage() {
    if (!lastTrackedAt) {
      return;
    }

    const now = Date.now();
    const elapsedSeconds = Math.max(0, Math.round((now - lastTrackedAt) / 1000));
    lastTrackedAt = now;

    if (elapsedSeconds > 0) {
      addUsageSeconds(elapsedSeconds);
    }
  }

  function addUsageSeconds(seconds) {
    usageSeconds += seconds;
    updateTodayUsage(activeTarget, seconds);
  }

  function loadTodayUsage(target, callback) {
    chrome.storage.local.get({ [USAGE_KEY]: {} }, (settings) => {
      const today = getTodayKey();
      const usage = settings[USAGE_KEY] || {};
      const todayUsage = usage[today] || {};
      const siteSeconds = Number(todayUsage[target] || 0);
      const totalSeconds = Object.values(todayUsage).reduce((total, value) => total + Number(value || 0), 0);
      callback({ siteSeconds, totalSeconds });
    });
  }

  function updateTodayUsage(target, seconds) {
    chrome.storage.local.get({ [USAGE_KEY]: {} }, (settings) => {
      const today = getTodayKey();
      const usage = settings[USAGE_KEY] || {};
      const todayUsage = usage[today] || {};

      usage[today] = {
        ...todayUsage,
        [target]: Number(todayUsage[target] || 0) + seconds
      };

      chrome.storage.local.set({ [USAGE_KEY]: usage });
    });
  }

  function isBlockedTarget(target, pageLocation) {
    const normalizedTarget = normalizeTarget(target);
    if (!normalizedTarget) {
      return false;
    }

    if (normalizedTarget.startsWith("http://") || normalizedTarget.startsWith("https://")) {
      return pageLocation.href.toLowerCase().startsWith(normalizedTarget);
    }

    const hostname = pageLocation.hostname.toLowerCase();
    return hostname === normalizedTarget || hostname.endsWith(`.${normalizedTarget}`);
  }

  function normalizeTarget(value) {
    const trimmed = String(value || "").trim().toLowerCase();
    if (!trimmed) {
      return "";
    }

    if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
      try {
        const url = new URL(trimmed);
        return `${url.origin}${url.pathname === "/" ? "" : url.pathname}`;
      } catch {
        return "";
      }
    }

    return trimmed
      .replace(/^www\./, "")
      .replace(/\/+$/, "");
  }

  function getSiteName(hostname, matchedTarget) {
    if (hostname.includes("instagram.com")) {
      return "Instagram";
    }

    if (hostname.includes("facebook.com")) {
      return "Facebook";
    }

    if (hostname.includes("youtube.com")) {
      return "YouTube";
    }

    return matchedTarget || hostname;
  }

  function getLimitSeconds(value) {
    const minutes = Number(value);
    if (!Number.isFinite(minutes) || minutes < 1) {
      return DEFAULT_LIMIT_MINUTES * 60;
    }

    return Math.round(minutes * 60);
  }

  function getTodayKey() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function formatMinutes(seconds) {
    return `${Math.floor(Number(seconds || 0) / 60)} 分鐘`;
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }
})();
