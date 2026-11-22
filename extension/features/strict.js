// features/strict.js — 嚴格模式. While it blocks, the overlay has no
// 「我真的要繼續」 button, and settings cannot be loosened on impulse: turning
// it off only takes effect after a cooldown.
//
// It adds friction, it is not a lock: the browser can still switch the
// extension off. The README and the store listing say so.
(function () {
  const FB = globalThis.FB;

  const MODES = ["always", "schedule", "budget"];
  const DEFAULTS = {
    enabled: false,
    mode: "always",
    days: [1, 2, 3, 4, 5],
    start: "09:00",
    end: "18:00",
    budgetMinutes: 30,
    escalate: true,
    offAt: 0
  };
  const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
  const MIN_BUDGET_MINUTES = 1;
  const MAX_BUDGET_MINUTES = 600;
  const MAX_WAIT_SECONDS = 120;
  const DEFAULT_COOLDOWN_MINUTES = 10;
  // Date#getDay numbering, shown Monday first.
  const WEEK = [
    [1, "一"],
    [2, "二"],
    [3, "三"],
    [4, "四"],
    [5, "五"],
    [6, "六"],
    [0, "日"]
  ];
  const MODE_LABELS = { always: "全天", schedule: "指定時段", budget: "每日額度" };
  // setTimeout cannot wait longer than this.
  const MAX_TIMEOUT_MS = 0x7fffffff;

  // ---- shared, pure: everything here depends only on (state, now) --------
  function read(state) {
    const stored = state && state.strict && typeof state.strict === "object" ? state.strict : null;
    const strict = Object.assign({}, DEFAULTS, stored);
    if (!Array.isArray(strict.days)) {
      strict.days = DEFAULTS.days.slice();
    }
    return strict;
  }

  // A requested switch-off counts from the moment offAt passes, whether or
  // not anything has written `enabled: false` yet.
  function isOn(strict, now) {
    return Boolean(strict.enabled) && !(strict.offAt && now >= strict.offAt);
  }

  function minutesOf(text) {
    const match = TIME_PATTERN.exec(String(text));
    return match ? Number(match[1]) * 60 + Number(match[2]) : null;
  }

  // Local time `minutes` after midnight of `date`'s day; past 24 hours it
  // rolls into the next day.
  function timeOn(date, minutes) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, minutes).getTime();
  }

  // When the schedule window that covers `now` ends, or 0 outside a window.
  function scheduleEnd(strict, now) {
    const start = minutesOf(strict.start);
    const end = minutesOf(strict.end);
    if (start === null || end === null || start === end) {
      return 0;
    }
    const today = new Date(now);
    // A window that crosses midnight belongs to the day it starts on, so the
    // one that started yesterday may still be running.
    for (const offset of [0, -1]) {
      const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset);
      if (!strict.days.includes(day.getDay())) {
        continue;
      }
      const opens = timeOn(day, start);
      const closes = timeOn(day, end > start ? end : end + 24 * 60);
      if (now >= opens && now < closes) {
        return closes;
      }
    }
    return 0;
  }

  function usedSecondsToday(state, now) {
    const today = (state.dailyUsage && state.dailyUsage[FB.dayKey(now)]) || {};
    return Object.values(today).reduce((sum, value) => sum + (Number(value) || 0), 0);
  }

  // { on, blocked, until, strict }. `until` is when the block ends, where
  // that is known (0 otherwise).
  function verdict(state, now) {
    const strict = read(state);
    if (!isOn(strict, now)) {
      return { on: false, blocked: false, until: 0, strict: strict };
    }

    let blocked = false;
    let until = 0;
    if (strict.mode === "schedule") {
      until = scheduleEnd(strict, now);
      blocked = until > 0;
    } else if (strict.mode === "budget") {
      blocked = usedSecondsToday(state, now) >= Number(strict.budgetMinutes) * 60;
      until = blocked ? timeOn(new Date(now), 24 * 60) : 0;
    } else {
      blocked = true;
    }

    // A switch-off that is already counting down ends the block too.
    if (blocked && strict.offAt && (!until || strict.offAt < until)) {
      until = strict.offAt;
    }
    return { on: true, blocked: blocked, until: until, strict: strict };
  }

  function blockMessage(result) {
    const strict = result.strict;
    if (strict.mode === "budget") {
      return "嚴格模式：今天的 " + strict.budgetMinutes + " 分鐘額度用完了。";
    }
    if (result.until) {
      return "嚴格模式開啟中，" + FB.formatClock(result.until) + " 前不能繼續。";
    }
    return "嚴格模式開啟中，現在不能繼續。";
  }

  function refuse(message) {
    return { ok: false, message: message };
  }

  function cooldownMinutes() {
    const value = FB.config.STRICT_COOLDOWN_MINUTES;
    const minutes = Number(value);
    return value !== undefined && value !== null && Number.isFinite(minutes) && minutes >= 0 ? minutes : DEFAULT_COOLDOWN_MINUTES;
  }

  // ---- service worker ------------------------------------------------------
  // Bring state.strict up to date before a handler changes it: fill in
  // missing fields, and turn a switch-off whose time has come into
  // `enabled: false`.
  function settle(state, now) {
    const strict = read(state);
    if (strict.enabled && strict.offAt && now >= strict.offAt) {
      strict.enabled = false;
    }
    if (!strict.enabled) {
      strict.offAt = 0;
    }
    state.strict = strict;
    return strict;
  }

  function cleanDays(value) {
    if (!Array.isArray(value) || !value.every((day) => Number.isInteger(day) && day >= 0 && day <= 6)) {
      return null;
    }
    return Array.from(new Set(value)).sort((a, b) => a - b);
  }

  // The settings in an enable message. Fields the chosen mode uses must be
  // valid; the others are taken when valid and otherwise left as they were,
  // so an empty minutes box cannot stop someone from choosing 全天.
  function settingsFrom(message, current) {
    const mode = String(message.mode || "");
    if (!MODES.includes(mode)) {
      throw new Error("請選擇全天、指定時段或每日額度。");
    }

    const days = cleanDays(message.days);
    const hasDays = Boolean(days && days.length > 0);
    const start = minutesOf(message.start);
    const end = minutesOf(message.end);
    const hasTimes = start !== null && end !== null && start !== end;
    const budget = Number(message.budgetMinutes);
    const hasBudget = Number.isInteger(budget) && budget >= MIN_BUDGET_MINUTES && budget <= MAX_BUDGET_MINUTES;

    if (mode === "schedule") {
      if (!hasDays) {
        throw new Error("請至少選一天。");
      }
      if (start === null || end === null) {
        throw new Error("請填開始和結束時間，例如 09:00。");
      }
      if (start === end) {
        throw new Error("開始和結束時間不能一樣。");
      }
    }
    if (mode === "budget" && !hasBudget) {
      throw new Error("每日額度請輸入 " + MIN_BUDGET_MINUTES + " 到 " + MAX_BUDGET_MINUTES + " 分鐘。");
    }

    return {
      mode: mode,
      days: hasDays ? days : current.days,
      start: hasTimes ? String(message.start) : current.start,
      end: hasTimes ? String(message.end) : current.end,
      budgetMinutes: hasBudget ? budget : current.budgetMinutes,
      escalate: message.escalate === undefined ? Boolean(current.escalate) : Boolean(message.escalate)
    };
  }

  // ---- content script and popup --------------------------------------------
  // Both redraw from scratch, so timers and the half-filled form live here.
  let overlayTimer = null;
  let popupTimer = null;
  let draft = null;

  // 「每天」, 「週一到週五」 for a run of days, otherwise 「週一、三、五」.
  function daysLabel(days) {
    const chosen = WEEK.filter(([day]) => days.includes(day)).map(([, label]) => label);
    if (chosen.length === WEEK.length) {
      return "每天";
    }
    const labels = WEEK.map(([, label]) => label).join("");
    if (chosen.length >= 3 && labels.includes(chosen.join(""))) {
      return "週" + chosen[0] + "到週" + chosen[chosen.length - 1];
    }
    return "週" + chosen.join("、");
  }

  // The settings in words, for the modes that have any.
  function describe(strict) {
    if (strict.mode === "schedule") {
      const overnight = minutesOf(strict.end) < minutesOf(strict.start);
      return daysLabel(strict.days) + " " + strict.start + " 到" + (overnight ? "隔天 " : " ") + strict.end + "。";
    }
    if (strict.mode === "budget") {
      return "每天 " + strict.budgetMinutes + " 分鐘。";
    }
    return "";
  }

  function describeNow(result, state, now) {
    const strict = result.strict;
    if (strict.mode === "schedule") {
      return result.blocked ? "現在是限制時段，" + FB.formatClock(result.until) + " 前不能繼續。" : "現在不在限制時段。";
    }
    if (strict.mode === "budget") {
      const used = FB.formatMinutes(usedSecondsToday(state, now));
      return result.blocked ? "今天用了 " + used + "，額度用完了，不能繼續。" : "今天用了 " + used + "，還可以繼續。";
    }
    return result.until ? FB.formatClock(result.until) + " 前不能繼續。" : "現在不能繼續。";
  }

  function renderOn(ctx, card, result, now, run) {
    const el = ctx.el;
    const strict = result.strict;

    const detail = describe(strict);
    card.append(el("p", { class: "fb-strict-status" }, MODE_LABELS[strict.mode] + "開啟中"));
    if (detail) {
      card.append(el("p", { class: "muted fb-strict-detail" }, detail));
    }
    card.append(el("p", { class: "muted fb-strict-now" }, describeNow(result, ctx.state, now)));
    if (strict.offAt) {
      card.append(
        el(
          "div",
          { class: "row fb-strict-off" },
          el("p", { class: "fb-strict-off-time" }, FB.formatClock(strict.offAt) + " 關閉"),
          el(
            "button",
            { class: "btn secondary", type: "button", dataset: { action: "strict-cancel-off" }, onclick: () => run("strict/cancelOff", {}, "嚴格模式會繼續開著。") },
            "取消"
          )
        )
      );
      // Redraw as "off" once the cooldown is over.
      popupTimer = window.setTimeout(ctx.refresh, Math.min(MAX_TIMEOUT_MS, Math.max(0, strict.offAt - now) + 200));
      return;
    }

    card.append(
      el("p", { class: "muted" }, "關閉要等 " + cooldownMinutes() + " 分鐘才生效。"),
      el(
        "button",
        { class: "btn secondary block", type: "button", dataset: { action: "strict-request-off" }, onclick: () => run("strict/requestOff", {}, "已申請關閉。") },
        "申請關閉"
      )
    );
  }

  function renderOff(ctx, card, strict, run) {
    const el = ctx.el;
    if (!draft) {
      draft = {
        mode: strict.mode,
        days: strict.days.slice(),
        start: strict.start,
        end: strict.end,
        budgetMinutes: strict.budgetMinutes,
        escalate: Boolean(strict.escalate)
      };
    }

    const body = el("div", { class: "fb-strict-body" });
    card.append(body);

    const chip = (label, pressed, dataset, onclick) =>
      el("button", { class: "chip", type: "button", "aria-pressed": String(pressed), dataset: dataset, onclick: onclick }, label);

    // Only the mode changes which fields exist, so only a mode change
    // redraws; the other inputs just write into the draft.
    const draw = () => {
      const parts = [
        el("p", { class: "muted" }, "擋下時不能繼續，也不能放寬設定。"),
        el(
          "div",
          { class: "chips", role: "group", "aria-label": "什麼時候擋" },
          MODES.map((mode) =>
            chip(MODE_LABELS[mode], draft.mode === mode, { mode: mode }, () => {
              draft.mode = mode;
              draw();
            })
          )
        )
      ];

      if (draft.mode === "schedule") {
        parts.push(
          el(
            "div",
            { class: "chips fb-strict-days", role: "group", "aria-label": "星期幾" },
            WEEK.map(([day, label]) => {
              const button = chip(label, draft.days.includes(day), { day: String(day) }, () => {
                draft.days = draft.days.includes(day) ? draft.days.filter((item) => item !== day) : draft.days.concat(day);
                button.setAttribute("aria-pressed", String(draft.days.includes(day)));
              });
              button.setAttribute("aria-label", "週" + label);
              return button;
            })
          ),
          el(
            "div",
            { class: "row fb-strict-times" },
            el("input", {
              class: "input",
              type: "time",
              value: draft.start,
              "aria-label": "開始時間",
              dataset: { field: "start" },
              oninput: (event) => {
                draft.start = event.target.value;
              }
            }),
            el("span", { class: "muted" }, "到"),
            el("input", {
              class: "input",
              type: "time",
              value: draft.end,
              "aria-label": "結束時間",
              dataset: { field: "end" },
              oninput: (event) => {
                draft.end = event.target.value;
              }
            })
          )
        );
      }

      if (draft.mode === "budget") {
        parts.push(
          el(
            "label",
            { class: "row fb-strict-budget" },
            el("span", { class: "fb-strict-budget-label" }, "每天最多"),
            el("input", {
              class: "input narrow",
              type: "number",
              inputMode: "numeric",
              min: String(MIN_BUDGET_MINUTES),
              max: String(MAX_BUDGET_MINUTES),
              step: "1",
              value: String(draft.budgetMinutes),
              dataset: { field: "budget" },
              oninput: (event) => {
                draft.budgetMinutes = event.target.value;
              }
            }),
            el("span", { class: "muted" }, "分鐘")
          ),
          el("p", { class: "muted" }, "所有網站合計，用滿就擋到明天。")
        );
      }

      // 全天 never lets anyone continue, so the switch would do nothing there.
      if (draft.mode !== "always") {
        parts.push(
          el(
            "label",
            { class: "switch" },
            el("input", {
              type: "checkbox",
              checked: draft.escalate,
              dataset: { field: "escalate" },
              onchange: (event) => {
                draft.escalate = event.target.checked;
              }
            }),
            el("span", {}, "每次繼續，等待時間加倍")
          )
        );
      }

      parts.push(
        el(
          "p",
          { class: "muted fb-strict-honest" },
          "關閉要等 " + cooldownMinutes() + " 分鐘才生效。"
        ),
        el(
          "button",
          {
            class: "btn secondary block",
            type: "button",
            dataset: { action: "strict-enable" },
            onclick: async () => {
              const sent = Object.assign({}, draft, { budgetMinutes: Number(draft.budgetMinutes) });
              if (await run("strict/enable", sent, "嚴格模式開啟了。")) {
                draft = null;
              }
            }
          },
          "開啟嚴格模式"
        )
      );

      body.replaceChildren(...parts);
    };
    draw();
  }

  FB.registerFeature({
    id: "strict",

    defaults: { strict: DEFAULTS },

    handlers: {
      async "strict/enable"(message, ctx) {
        const now = ctx.now;
        return ctx.store.update((state) => {
          const strict = settle(state, now);
          if (strict.enabled) {
            throw new Error("嚴格模式開啟中，要先關閉才能改設定。");
          }
          state.strict = Object.assign(strict, settingsFrom(message, strict), { enabled: true, offAt: 0 });
          return Object.assign({}, state.strict);
        });
      },

      // Asking twice does not push the time back, and does not bring it
      // forward either.
      async "strict/requestOff"(message, ctx) {
        const now = ctx.now;
        return ctx.store.update((state) => {
          const strict = settle(state, now);
          if (strict.enabled && !strict.offAt) {
            strict.offAt = now + Math.round(cooldownMinutes() * 60 * 1000);
          }
          return Object.assign({}, strict);
        });
      },

      async "strict/cancelOff"(message, ctx) {
        const now = ctx.now;
        const strict = await ctx.store.update((state) => {
          const current = settle(state, now);
          current.offAt = 0;
          return Object.assign({}, current);
        });
        // Throw after the update, so the settled state is still saved.
        if (!strict.enabled) {
          throw new Error("嚴格模式已經關閉了。");
        }
        return strict;
      }
    },

    // Runs after rest's gate, so it can take a break back.
    gate(gate, ctx) {
      const result = verdict(ctx.state, ctx.now);
      gate.extras.strict = { on: result.on, blocked: result.blocked };
      if (!result.on) {
        return;
      }

      if (result.blocked) {
        gate.canContinue = false;
        gate.message = blockMessage(result);
        if (gate.action === "free") {
          gate.action = "overlay";
        }
        if (result.until) {
          gate.extras.strict.until = result.until;
        }
        return;
      }

      if (result.strict.escalate) {
        const dayStats = (ctx.state.stats && ctx.state.stats[ctx.day || FB.dayKey(ctx.now)]) || {};
        const continued = Number((dayStats[ctx.target] || {}).continued) || 0;
        const base = Number(gate.waitSeconds) || 0;
        // Never shorter than what came in, even if that was above the cap.
        gate.waitSeconds = Math.max(base, Math.min(MAX_WAIT_SECONDS, base * 2 ** continued));
      }
    },

    guard(action, payload, state, now) {
      const result = verdict(state, now);
      if (!result.on) {
        return undefined;
      }
      if (action === "targets/remove") {
        return refuse("嚴格模式開啟中，不能移除網站。");
      }
      if (action === "limit/set" && Number(payload.minutes) > Number(payload.previous)) {
        return refuse("嚴格模式開啟中，不能把使用時間調長。");
      }
      if (action === "reasons/setRequired" && payload.required === false) {
        return refuse("嚴格模式開啟中，不能取消必填理由。");
      }
      if (action === "rest/setDailyLimit" && Number(payload.limit) > Number(payload.previous)) {
        return refuse("嚴格模式開啟中，不能增加休息次數。");
      }
      // Clearing the statistics would also reset the daily budget and the
      // escalating wait.
      if (action === "stats/clear") {
        return refuse("嚴格模式開啟中，不能清除統計。");
      }
      // A break is fine while strict mode lets the site through anyway.
      if (action === "rest/start" && result.blocked) {
        return refuse("嚴格模式開啟中，現在不能休息。");
      }
      return undefined;
    },

    overlay: {
      // The overlay is only asked again when something happens. When the
      // block has a known end, ask again by ourselves then, so the continue
      // button comes back without a reload.
      render(ctx) {
        window.clearTimeout(overlayTimer);
        overlayTimer = null;
        const until = ctx.extras && ctx.extras.blocked ? Number(ctx.extras.until) : 0;
        if (!until) {
          return;
        }
        // A little late on purpose: asking early would get the same answer
        // and nothing would ask again.
        overlayTimer = window.setTimeout(ctx.refresh, Math.min(MAX_TIMEOUT_MS, Math.max(0, until - Date.now()) + 300));
      }
    },

    popup: {
      render(ctx) {
        const now = Number(ctx.state.now) || Date.now();
        const result = verdict(ctx.state, now);

        // Resolves true when the change went through.
        const run = async (type, payload, done) => {
          try {
            await ctx.send(type, payload);
          } catch (error) {
            ctx.toast(error.message, "error");
            // A refusal often means the popup was showing an old state.
            await ctx.refresh();
            return false;
          }
          await ctx.refresh();
          ctx.toast(done);
          return true;
        };

        const card = ctx.section("modes", "嚴格模式");
        card.classList.add("fb-strict");
        window.clearTimeout(popupTimer);
        popupTimer = null;

        if (result.on) {
          renderOn(ctx, card, result, now, run);
        } else {
          renderOff(ctx, card, result.strict, run);
        }
      }
    }
  });
})();
