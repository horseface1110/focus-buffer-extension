// features/reasons.js — 解鎖理由紀錄. Before continuing, the user writes down
// why they are opening the site now. The answers are kept as a log, so the
// excuses can be read back later. See docs/FEATURES.md for the contract.
(function () {
  const FB = globalThis.FB;

  const MIN_LENGTH = 2;
  const MAX_LENGTH = 80;
  const KEEP_ENTRIES = 200;
  const SHOWN_ENTRIES = 20;
  const CONFIRM_MS = 4000;
  const QUICK_PICKS = ["查資料", "回訊息", "工作需要", "休息一下"];

  const INPUT_ID = "fb-reason-input";
  const ERROR_ID = "fb-reason-error";

  function readLog(state) {
    return Array.isArray(state.unlockLog) ? state.unlockLog : [];
  }

  // "11/23 10:05"
  function formatStamp(at) {
    const date = new Date(at);
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return month + "/" + day + " " + FB.formatClock(at);
  }

  function csvField(value) {
    const text = String(value === undefined || value === null ? "" : value);
    return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
  }

  // The whole log, oldest first, with the year in the time column: a
  // spreadsheet has no other way to tell one November from the next.
  function toCsv(log) {
    const rows = [["時間", "網站", "理由"]];
    for (const entry of log) {
      rows.push([FB.dayKey(entry.at) + " " + FB.formatClock(entry.at), FB.siteName(entry.target), entry.reason]);
    }
    return rows.map((row) => row.map(csvField).join(",")).join("\n");
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (error) {
      // No clipboard API in this context, or the browser refused: fall back
      // to copying a selection.
    }

    const focused = document.activeElement;
    // Read-only keeps the iPhone keyboard from popping up for a moment.
    const area = FB.el("textarea", { class: "reasons-copy-area", readOnly: true, tabIndex: -1, "aria-hidden": "true" });
    area.value = text;
    document.body.append(area);
    area.select();
    area.setSelectionRange(0, text.length);
    try {
      return document.execCommand("copy") === true;
    } catch (error) {
      return false;
    } finally {
      area.remove();
      if (focused && typeof focused.focus === "function") {
        focused.focus();
      }
    }
  }

  // ---- popup --------------------------------------------------------------
  function renderLog(ctx) {
    const el = ctx.el;
    const log = readLog(ctx.state);
    const card = ctx.section("stats", "解鎖理由");
    card.classList.add("reasons-log");

    if (log.length === 0) {
      card.append(el("p", { class: "empty" }, "還沒有紀錄。"));
      return;
    }

    const newest = log.slice(-SHOWN_ENTRIES).reverse();
    card.append(
      el(
        "ul",
        { class: "list" },
        newest.map((entry) =>
          el(
            "li",
            { class: "list-item reasons-item" },
            el(
              "div",
              { class: "list-main" },
              el("span", { class: "list-title reasons-reason" }, entry.reason),
              el(
                "span",
                { class: "list-sub reasons-meta" },
                el("span", { class: "reasons-time" }, formatStamp(entry.at)),
                el("span", { class: "reasons-site" }, FB.siteName(entry.target))
              )
            )
          )
        )
      )
    );
    if (log.length > SHOWN_ENTRIES) {
      card.append(el("p", { class: "muted reasons-count" }, "共 " + log.length + " 筆，這裡只列最新 " + SHOWN_ENTRIES + " 筆。"));
    }

    const copyButton = el(
      "button",
      {
        class: "btn small secondary reasons-copy",
        type: "button",
        onclick: async () => {
          const copied = await copyText(toCsv(log));
          ctx.toast(copied ? "已複製 " + log.length + " 筆理由。" : "複製失敗，請再試一次。", copied ? "ok" : "error");
        }
      },
      "複製全部"
    );

    // Clearing cannot be undone, so it takes a second press.
    let armed = false;
    let disarmTimer = null;
    const clearButton = el(
      "button",
      {
        class: "btn small danger reasons-clear",
        type: "button",
        onclick: async () => {
          if (!armed) {
            armed = true;
            clearButton.textContent = "再按一次清除";
            disarmTimer = window.setTimeout(() => {
              armed = false;
              clearButton.textContent = "清除";
            }, CONFIRM_MS);
            return;
          }
          window.clearTimeout(disarmTimer);
          clearButton.disabled = true;
          let failure = "";
          try {
            await ctx.send("reasons/clear");
          } catch (error) {
            failure = error.message;
          }
          await ctx.refresh();
          ctx.toast(failure || "已清除理由紀錄。", failure ? "error" : "ok");
        }
      },
      "清除"
    );

    card.append(el("div", { class: "row reasons-actions" }, copyButton, clearButton));
  }

  function renderSetting(ctx) {
    const el = ctx.el;
    // The switch is the section's heading: one setting needs no title above it.
    const card = ctx.section("modes", null);
    const input = el("input", { type: "checkbox", checked: ctx.state.reasonRequired !== false });

    input.addEventListener("change", async () => {
      input.disabled = true;
      try {
        await ctx.send("reasons/setRequired", { required: input.checked });
      } catch (error) {
        // Strict mode can refuse; the redraw below puts the switch back.
        ctx.toast(error.message, "error");
      }
      await ctx.refresh();
      // The redraw replaced this card. Put the focus back on the new switch
      // so a keyboard user stays where they were.
      const next = document.querySelector(".reasons-switch input");
      if (next) {
        next.focus();
      }
    });

    card.append(
      el("label", { class: "switch switch-heading reasons-switch" }, input, el("span", {}, "繼續前要寫理由"))
    );
  }

  FB.registerFeature({
    id: "reasons",

    // ---- service worker ---------------------------------------------------
    defaults: { reasonRequired: true, unlockLog: [] },

    handlers: {
      async "reasons/setRequired"(message, ctx) {
        const required = Boolean(message.required);
        return ctx.store.update((state) => {
          ctx.guard("reasons/setRequired", { required: required }, state);
          state.reasonRequired = required;
          return { required: required };
        });
      },

      async "reasons/clear"(message, ctx) {
        return ctx.store.update((state) => {
          state.unlockLog = [];
          return { cleared: true };
        });
      }
    },

    gate(gate, ctx) {
      gate.extras.reasons = { required: ctx.state.reasonRequired !== false };
    },

    onEvent(event, state) {
      if (event.name !== "continue" || typeof event.data.reason !== "string") {
        return;
      }
      const reason = event.data.reason.trim().slice(0, MAX_LENGTH);
      if (!reason) {
        return;
      }
      const log = readLog(state);
      log.push({ at: event.now, target: event.target, reason: reason });
      state.unlockLog = log.slice(-KEEP_ENTRIES);
    },

    // ---- content script ---------------------------------------------------
    overlay: {
      render(ctx) {
        if (!ctx.extras || !ctx.extras.required || ctx.gate.canContinue === false) {
          return;
        }
        const el = ctx.el;

        const error = el("p", { class: "fb-error", id: ERROR_ID, role: "alert" });
        const input = el("input", {
          class: "fb-input fb-reason-input",
          id: INPUT_ID,
          type: "text",
          maxLength: MAX_LENGTH,
          autocomplete: "off",
          placeholder: "例如：查明天的天氣…",
          "aria-describedby": ERROR_ID
        });

        const clearError = () => {
          error.textContent = "";
          input.removeAttribute("aria-invalid");
        };
        const syncChips = () => {
          for (const chip of chips) {
            chip.setAttribute("aria-pressed", String(chip.textContent === input.value.trim()));
          }
        };
        const chips = QUICK_PICKS.map((text) =>
          el(
            "button",
            {
              class: "fb-chip",
              type: "button",
              "aria-pressed": "false",
              onclick: () => {
                input.value = text;
                syncChips();
                clearError();
              }
            },
            text
          )
        );

        input.addEventListener("input", () => {
          syncChips();
          clearError();
        });
        // The page underneath may have keyboard shortcuts of its own; typing
        // a reason must not trigger them.
        for (const type of ["keydown", "keypress", "keyup"]) {
          input.addEventListener(type, (event) => event.stopPropagation());
        }
        input.addEventListener("keydown", (event) => {
          // Enter also confirms a candidate in an input method (注音, 倉頡…);
          // Safari reports that one as keyCode 229 with isComposing false.
          if (event.key !== "Enter" || event.isComposing || event.keyCode === 229) {
            return;
          }
          event.preventDefault();
          ctx.continueButton.click();
        });

        ctx.slots.form.append(
          el(
            "div",
            { class: "fb-reason" },
            el("label", { class: "fb-field-label", for: INPUT_ID }, "為什麼現在要打開？"),
            el("div", { class: "fb-chips" }, chips),
            input,
            error
          )
        );
      },

      beforeContinue(ctx) {
        if (!ctx.extras || !ctx.extras.required) {
          return undefined;
        }
        // Each call gets a fresh ctx, so the field is looked up, by id: other
        // features put their own fields and error lines in the same slot.
        const input = ctx.slots.form.querySelector("#" + INPUT_ID);
        const error = ctx.slots.form.querySelector("#" + ERROR_ID);
        if (!input) {
          // The form was never drawn. Do not trap the user behind a field
          // that is not there.
          return undefined;
        }

        const reason = input.value.trim().slice(0, MAX_LENGTH);
        if (reason.length < MIN_LENGTH) {
          if (error) {
            error.textContent = "請先寫下理由，至少 " + MIN_LENGTH + " 個字。";
          }
          input.setAttribute("aria-invalid", "true");
          input.focus();
          return false;
        }
        return { reason: reason };
      }
    },

    // ---- popup --------------------------------------------------------------
    popup: {
      render(ctx) {
        renderLog(ctx);
        renderSetting(ctx);
      }
    }
  });
})();
