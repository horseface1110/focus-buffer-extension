// features/rest.js — 休息模式. The user starts a timed break from the popup;
// until it ends, listed sites open with no overlay and no pass timer, and a
// small pill on the page counts down. Breaks are limited per day.
//
// There is deliberately no "start a break" button on the overlay: that would
// be a one-click way around it.
(function () {
  const FB = globalThis.FB;

  const MIN_MINUTES = 1;
  const MAX_MINUTES = 30;
  const DEFAULT_DAILY_LIMIT = 3;
  const MAX_DAILY_LIMIT = 10;
  const CHOICES = [5, 10, 15];
  const LIMIT_OPTIONS = Array.from({ length: MAX_DAILY_LIMIT + 1 }, (unused, index) => index);

  // ---- shared, pure -------------------------------------------------------
  function restUntil(state) {
    const rest = state && state.rest;
    return rest && typeof rest === "object" ? Number(rest.until) || 0 : 0;
  }

  function isResting(state, now) {
    return now < restUntil(state);
  }

  function dailyLimit(state) {
    const limit = Number(state.restDailyLimit);
    return Number.isInteger(limit) && limit >= 0 ? limit : DEFAULT_DAILY_LIMIT;
  }

  function usedToday(state, now) {
    const log = state.restLog && typeof state.restLog === "object" ? state.restLog : {};
    return Number(log[FB.dayKey(now)]) || 0;
  }

  function formatCountdown(seconds) {
    return Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0");
  }

  // ---- popup --------------------------------------------------------------
  // The popup redraws every card on each refresh, so what the user picked
  // and the "break is over" timer live out here.
  let chosenMinutes = CHOICES[0];
  let popupTimer = null;

  FB.registerFeature({
    id: "rest",

    defaults: {
      rest: { until: 0, startedAt: 0, minutes: 0 },
      restDailyLimit: DEFAULT_DAILY_LIMIT,
      restLog: {}
    },

    handlers: {
      async "rest/start"(message, ctx) {
        const minutes = Number(message.minutes);
        if (!Number.isInteger(minutes) || minutes < MIN_MINUTES || minutes > MAX_MINUTES) {
          throw new Error(FB.t("restRange", MIN_MINUTES, MAX_MINUTES));
        }
        const now = ctx.now;

        return ctx.store.update((state) => {
          if (isResting(state, now)) {
            throw new Error(FB.t("alreadyResting"));
          }
          if (usedToday(state, now) >= dailyLimit(state)) {
            throw new Error(FB.t("noBreaksLeft"));
          }
          ctx.guard("rest/start", { minutes: minutes }, state, now);

          state.rest = { until: now + minutes * 60 * 1000, startedAt: now, minutes: minutes };

          const log = state.restLog && typeof state.restLog === "object" ? state.restLog : {};
          const day = FB.dayKey(now);
          log[day] = (Number(log[day]) || 0) + 1;
          const cutoff = FB.recentDays(FB.config.KEEP_DAYS, now)[0];
          for (const key of Object.keys(log)) {
            if (key < cutoff) {
              delete log[key];
            }
          }
          state.restLog = log;

          return Object.assign({}, state.rest);
        });
      },

      // Ending early does not give the break back: it was still a break.
      async "rest/stop"(message, ctx) {
        return ctx.store.update((state) => {
          state.rest = { until: 0, startedAt: 0, minutes: 0 };
          return Object.assign({}, state.rest);
        });
      },

      async "rest/setDailyLimit"(message, ctx) {
        const limit = Number(message.limit);
        if (!Number.isInteger(limit) || limit < 0 || limit > MAX_DAILY_LIMIT) {
          throw new Error(FB.t("dailyBreaksRange", MAX_DAILY_LIMIT));
        }
        const now = ctx.now;

        return ctx.store.update((state) => {
          ctx.guard("rest/setDailyLimit", { limit: limit, previous: dailyLimit(state) }, state, now);
          state.restDailyLimit = limit;
          return { limit: limit };
        });
      }
    },

    // Pure: depends only on ctx.state and ctx.now.
    gate(gate, ctx) {
      if (!isResting(ctx.state, ctx.now)) {
        return;
      }
      gate.action = "free";
      gate.extras.rest = { until: restUntil(ctx.state) };
    },

    page: {
      render(ctx) {
        const until = ctx.extras ? Number(ctx.extras.until) : 0;
        if (ctx.gate.action !== "free" || !until) {
          return;
        }

        const time = ctx.el("span", { class: "fb-rest-time" });
        // role="timer" keeps screen readers from announcing every second.
        // The pill is a flex row, which would eat the space before the digits
        // if the words sat in it directly.
        ctx.mount(ctx.el("div", { class: "fb-pill fb-rest-pill", role: "timer" }, ctx.el("span", {}, FB.t("restPill"), time)));

        let timer = null;
        const update = () => {
          const remainingMs = until - Date.now();
          if (remainingMs <= 0) {
            timer = null;
            time.textContent = formatCountdown(0);
            ctx.refresh();
            return;
          }
          time.textContent = formatCountdown(Math.ceil(remainingMs / 1000));
          // Wake up when the shown second changes, so the last wake-up lands
          // on the end of the break and not up to a second after it.
          timer = window.setTimeout(update, ((remainingMs - 1) % 1000) + 1);
        };
        update();
        ctx.onCleanup(() => window.clearTimeout(timer));
      }
    },

    popup: {
      render(ctx) {
        const el = ctx.el;
        const state = ctx.state;
        const now = Number(state.now) || Date.now();
        const until = restUntil(state);
        const resting = now < until;
        const limit = dailyLimit(state);
        const left = Math.max(0, limit - usedToday(state, now));

        const run = async (type, payload, done) => {
          try {
            await ctx.send(type, payload);
          } catch (error) {
            ctx.toast(error.message, "error");
            await ctx.refresh();
            return;
          }
          await ctx.refresh();
          ctx.toast(done);
        };

        const card = ctx.section("modes", FB.t("restHeading"));
        card.classList.add("fb-rest");
        card.append(el("p", { class: "muted" }, FB.t("restNote")));

        window.clearTimeout(popupTimer);
        popupTimer = null;

        if (resting) {
          card.append(
            el("p", { class: "fb-rest-status" }, FB.t("restUntil", FB.formatClock(until))),
            el(
              "button",
              { class: "btn secondary block", type: "button", dataset: { action: "rest-stop" }, onclick: () => run("rest/stop", {}, FB.t("restEnded")) },
              FB.t("endEarly")
            )
          );
          // Show the idle card again once the break is over.
          popupTimer = window.setTimeout(ctx.refresh, until - now + 200);
        } else {
          const chips = CHOICES.map((minutes) =>
            el(
              "button",
              {
                class: "chip",
                type: "button",
                "aria-pressed": String(minutes === chosenMinutes),
                dataset: { minutes: String(minutes) },
                onclick: () => {
                  chosenMinutes = minutes;
                  for (const chip of chips) {
                    chip.setAttribute("aria-pressed", String(chip.dataset.minutes === String(minutes)));
                  }
                }
              },
              FB.t("minutes", minutes)
            )
          );
          card.append(
            el("div", { class: "chips", role: "group", "aria-label": FB.t("restLengthLabel") }, chips),
            el(
              "button",
              {
                class: "btn primary block",
                type: "button",
                disabled: left === 0,
                dataset: { action: "rest-start" },
                onclick: () => run("rest/start", { minutes: chosenMinutes }, FB.t("restStarted", chosenMinutes))
              },
              FB.t("startRest")
            ),
            el("p", { class: "muted fb-rest-left" }, left === 0 ? FB.t("noBreaksLeftShort") : FB.t("breaksLeft", left))
          );
        }

        // The handler accepts up to MAX_DAILY_LIMIT; keep such a value
        // selectable instead of silently showing another one.
        const options = LIMIT_OPTIONS.includes(limit) ? LIMIT_OPTIONS : LIMIT_OPTIONS.concat(limit);
        const select = el(
          "select",
          {
            class: "select",
            dataset: { action: "rest-limit" },
            onchange: () => run("rest/setDailyLimit", { limit: Number(select.value) }, FB.t("dailyLimitSet", select.value))
          },
          options.map((count) => el("option", { value: String(count), selected: count === limit }, FB.t("times", count)))
        );
        card.append(el("label", { class: "row fb-rest-limit" }, el("span", { class: "fb-rest-limit-label" }, FB.t("breaksPerDay")), select));
      }
    }
  });
})();
