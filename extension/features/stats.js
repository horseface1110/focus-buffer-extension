// features/stats.js — 分心次數統計. Display only: the core already counts
// every overlay (state.stats) and every second of use (state.dailyUsage);
// this file turns them into one line in the overlay and the 紀錄 tab of the
// popup. See docs/FEATURES.md for the contract.
(function () {
  const FB = globalThis.FB;

  const CHART_DAYS = 7;
  const BAR_MAX_PX = 64;
  const BAR_MIN_PX = 3;
  // How long 「再按一次確認」 stays armed, and how soon after arming a press
  // counts, so a double-click cannot clear everything by accident.
  const CONFIRM_MS = 4000;
  const CONFIRM_DELAY_MS = 400;

  // Storage is only ever written by the core, but an old or hand-edited
  // value must not turn the whole tab into NaN.
  function amount(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : 0;
  }

  // Everything known about one day: totals across all targets, plus one
  // entry per target that has a count or some usage.
  function summarize(state, day) {
    const stats = (state.stats && state.stats[day]) || {};
    const usage = (state.dailyUsage && state.dailyUsage[day]) || {};
    const totals = { shown: 0, continued: 0, closed: 0, autoClosed: 0, seconds: 0 };
    const sites = {};

    const siteFor = (target) => (sites[target] = sites[target] || { target: target, shown: 0, seconds: 0 });

    for (const [target, entry] of Object.entries(stats)) {
      const counts = entry && typeof entry === "object" ? entry : {};
      totals.shown += amount(counts.shown);
      totals.continued += amount(counts.continued);
      totals.closed += amount(counts.closed);
      totals.autoClosed += amount(counts.autoClosed);
      siteFor(target).shown = amount(counts.shown);
    }
    for (const [target, seconds] of Object.entries(usage)) {
      totals.seconds += amount(seconds);
      siteFor(target).seconds = amount(seconds);
    }

    return { totals: totals, sites: sites };
  }

  // "2026-11-23" -> "11/23"
  function dayLabel(day) {
    const parts = String(day).split("-");
    return Number(parts[1]) + "/" + Number(parts[2]);
  }

  // The overlay can be redrawn in place (strict mode switching on while it
  // is showing, for one). That is still the same visit and its "shown" event
  // is already counted, so the gate's +1 would say one too many. Remember
  // what the first draw of a visit said and keep saying it.
  let visit = null;

  // ---------------------------------------------------------------------
  // Popup cards
  // ---------------------------------------------------------------------
  function renderToday(ctx, totals) {
    const el = ctx.el;
    const tile = (key, value, label, wide) =>
      el(
        "div",
        { class: "stats-tile" + (wide ? " wide" : ""), dataset: { stat: key } },
        el("span", { class: "stats-tile-value" }, String(value)),
        el("span", { class: "stats-tile-label" }, label)
      );

    ctx.section("stats", FB.t("today")).append(
      el(
        "div",
        { class: "stats-tiles" },
        tile("shown", totals.shown, FB.t("statShown"), true),
        tile("minutes", Math.floor(totals.seconds / 60), FB.t("statMinutes"), true),
        tile("continued", totals.continued, FB.t("statContinued")),
        tile("closed", totals.closed, FB.t("statClosed")),
        tile("autoClosed", totals.autoClosed, FB.t("statAutoClosed"))
      )
    );
  }

  function renderChart(ctx, state, now) {
    const el = ctx.el;
    const today = FB.dayKey(now);
    const days = FB.recentDays(CHART_DAYS, now).map((day) => ({
      day: day,
      label: dayLabel(day),
      shown: summarize(state, day).totals.shown
    }));
    const highest = Math.max(1, ...days.map((item) => item.shown));
    const sum = days.reduce((total, item) => total + item.shown, 0);

    const columns = days.map((item) => {
      const bar = el("span", { class: "stats-day-bar" });
      // A day with one visit still gets a bar you can see; a day with none
      // gets none, so "nothing" and "a little" do not look alike.
      const height = item.shown === 0 ? 0 : Math.max(BAR_MIN_PX, Math.round((item.shown / highest) * BAR_MAX_PX));
      bar.style.height = height + "px";

      return el(
        "div",
        {
          class: "stats-day" + (item.day === today ? " is-today" : ""),
          dataset: { day: item.day, count: String(item.shown) },
          title: FB.t("dayTitle", item.label, item.shown)
        },
        el("span", { class: "stats-day-plot" }, el("span", { class: "stats-day-count" }, String(item.shown)), bar),
        el("span", { class: "stats-day-label" }, item.label)
      );
    });

    // Screen readers get the same numbers as one sentence instead of
    // fourteen loose fragments.
    const spoken = FB.t(
      "chartSpoken",
      CHART_DAYS,
      days.map((item) => FB.t("chartSpokenDay", item.label + (item.day === today ? FB.t("todaySuffix") : ""), item.shown)).join(FB.t("listSeparator"))
    );

    ctx.section("stats", FB.t("lastDays", CHART_DAYS)).append(
      el("div", { class: "stats-chart", role: "img", "aria-label": spoken }, columns)
    );
  }

  function renderSites(ctx, sites) {
    const el = ctx.el;
    const rows = Object.values(sites)
      .filter((site) => site.shown > 0 || site.seconds > 0)
      .sort((a, b) => b.shown - a.shown || b.seconds - a.seconds || a.target.localeCompare(b.target))
      .map((site) =>
        el(
          "li",
          { class: "list-item stats-site", dataset: { target: site.target } },
          el("span", { class: "list-title" }, FB.siteName(site.target)),
          el(
            "span",
            { class: "stats-site-values" },
            el("span", { class: "stats-site-count" }, FB.t("times", site.shown)),
            el("span", { class: "stats-site-minutes" }, FB.formatMinutes(site.seconds))
          )
        )
      );

    ctx.section("stats", FB.t("sitesToday")).append(
      rows.length === 0 ? el("p", { class: "empty" }, FB.t("nothingToday")) : el("ul", { class: "list stats-sites" }, rows)
    );
  }

  function renderClear(ctx) {
    const el = ctx.el;
    const idleLabel = FB.t("clearStats");
    const button = el("button", { class: "btn destructive block stats-clear", type: "button" }, idleLabel);
    let armedAt = 0;
    let timer = null;

    const disarm = () => {
      window.clearTimeout(timer);
      armedAt = 0;
      delete button.dataset.armed;
      button.textContent = idleLabel;
    };

    button.addEventListener("click", async () => {
      if (!armedAt) {
        armedAt = Date.now();
        button.dataset.armed = "";
        button.textContent = FB.t("confirmClearStats");
        timer = window.setTimeout(disarm, CONFIRM_MS);
        return;
      }
      if (Date.now() - armedAt < CONFIRM_DELAY_MS) {
        return;
      }

      window.clearTimeout(timer);
      button.disabled = true;
      try {
        await ctx.send("stats/clear");
        // refresh() redraws this card, so there is nothing to reset here.
        await ctx.refresh();
        ctx.toast(FB.t("statsCleared"));
      } catch (error) {
        button.disabled = false;
        disarm();
        ctx.toast(error.message, "error");
      }
    });

    ctx.section("stats", "").append(
      el("div", { class: "row stats-clear-row" }, button)
    );
  }

  FB.registerFeature({
    id: "stats",

    // ---- service worker -------------------------------------------------
    handlers: {
      async "stats/clear"(message, ctx) {
        return ctx.store.update((state) => {
          // Today's usage is what strict mode's daily budget is measured
          // against, so strict mode gets a say.
          ctx.guard("stats/clear", {}, state, ctx.now);
          state.stats = {};
          state.dailyUsage = {};
          return { cleared: true };
        });
      }
    },

    // finalize, not gate: a later feature (strict mode) can still turn a
    // pass into an overlay, and the +1 below depends on the final action.
    finalize(gate, ctx) {
      const summary = summarize(ctx.state, ctx.day);
      const site = summary.sites[ctx.target];
      // The "shown" event for the overlay about to be drawn is recorded
      // after this runs. Count it now, so the overlay can say 第 N 次.
      const pending = gate.action === "overlay" ? 1 : 0;
      gate.extras.stats = {
        siteShown: (site ? site.shown : 0) + pending,
        totalShown: summary.totals.shown + pending
      };
    },

    // ---- content script -------------------------------------------------
    overlay: {
      // The counts go up as soon as the overlay is shown; that alone is no
      // reason to redraw it.
      volatile: true,
      render(ctx) {
        const extras = ctx.extras;
        if (!extras) {
          return;
        }
        if (!visit || visit.root !== ctx.root || visit.target !== ctx.gate.target) {
          visit = { root: ctx.root, target: ctx.gate.target, siteShown: amount(extras.siteShown), totalShown: amount(extras.totalShown) };
        }

        // One more figure in the row of today's numbers, in front of the
        // minutes the core puts there.
        const el = ctx.el;
        const figure = el(
          "div",
          { class: "fb-stats-line" },
          el("span", { class: "fb-usage-number" }, FB.t("visitNumber", visit.siteShown)),
          el("span", { class: "fb-usage-label" }, FB.t("openedToday"))
        );
        const usage = ctx.panel.querySelector(".fb-usage");
        if (usage) {
          usage.prepend(figure);
        } else {
          ctx.slots.stats.append(figure);
        }
      }
    },

    // ---- popup ------------------------------------------------------------
    popup: {
      render(ctx) {
        const state = ctx.state;
        const now = state.now === undefined ? Date.now() : state.now;
        const today = summarize(state, FB.dayKey(now));

        renderToday(ctx, today.totals);
        renderChart(ctx, state, now);
        renderSites(ctx, today.sites);
        renderClear(ctx);
      }
    }
  });
})();
