// features/todos.js — 待辦清單. A small to-do list the overlay points the
// user back to: instead of 「看一下今天最重要的待辦」 it shows the next few
// items, which can be ticked off right there. See docs/FEATURES.md.
(function () {
  const FB = globalThis.FB;

  const MAX_LENGTH = 80;
  const MAX_OPEN = 50;
  const KEEP_DONE = 100;
  const OVERLAY_ITEMS = 3;
  const POPUP_DONE_ITEMS = 5;

  // What is typed in the popup's add field. The popup redraws this feature's
  // cards on every refresh (ticking an item, another feature's change…), and
  // that must not wipe a half-typed to-do.
  let draft = "";

  function readTodos(state) {
    return Array.isArray(state.todos) ? state.todos.filter((item) => item && typeof item === "object") : [];
  }

  // Open items, oldest first.
  function openOf(todos) {
    return todos.filter((item) => !item.done).sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0));
  }

  // Finished items, most recently finished first.
  function doneOf(todos) {
    return todos.filter((item) => item.done).sort((a, b) => Number(b.doneAt || 0) - Number(a.doneAt || 0));
  }

  function newId(todos, now) {
    let id = "";
    do {
      id = "t" + Number(now).toString(36) + Math.random().toString(36).slice(2, 8);
    } while (todos.some((item) => item.id === id));
    return id;
  }

  // ---- popup --------------------------------------------------------------
  function findItem(id) {
    return Array.from(document.querySelectorAll(".todos-item")).find((node) => node.dataset.id === id) || null;
  }

  // Send a change and tell the user when it was refused.
  async function request(ctx, type, payload) {
    try {
      await ctx.send(type, payload);
      return true;
    } catch (error) {
      ctx.toast(error.message, "error");
      return false;
    }
  }

  // Redraw, then put the focus back: the redraw replaces every node in this
  // feature's cards, the focused one included. `focus` returns the node that
  // should have it afterwards.
  async function redraw(ctx, focus) {
    await ctx.refresh();
    const node = focus();
    if (node) {
      node.focus();
    }
  }

  const addInput = () => document.querySelector(".todos-input");

  function todoRow(ctx, item, index) {
    const el = ctx.el;
    const checkbox = el("input", { type: "checkbox", checked: Boolean(item.done) });
    // The wanted state is sent explicitly, so a quick tick and untick settle
    // on the last one.
    checkbox.addEventListener("change", async () => {
      await request(ctx, "todos/toggle", { id: item.id, done: checkbox.checked });
      await redraw(ctx, () => {
        const row = findItem(item.id);
        return row ? row.querySelector('input[type="checkbox"]') : addInput();
      });
    });

    const removeButton = item.done
      ? null
      : el(
          "button",
          {
            class: "btn small danger todos-remove",
            type: "button",
            "aria-label": FB.t("deleteItem", item.text),
            onclick: async () => {
              await request(ctx, "todos/remove", { id: item.id });
              // Land on the item that moved up into this place, so several
              // can be deleted in a row from the keyboard.
              await redraw(ctx, () => {
                const buttons = document.querySelectorAll(".todos-open .todos-remove");
                return buttons[Math.min(index, buttons.length - 1)] || addInput();
              });
            }
          },
          FB.t("delete")
        );

    return el(
      "li",
      { class: "list-item todos-item" + (item.done ? " is-done" : ""), dataset: { id: String(item.id) } },
      el("label", { class: "todos-check" }, checkbox, el("span", { class: "list-title todos-text" }, item.text)),
      removeButton ? el("div", { class: "list-actions" }, removeButton) : null
    );
  }

  function renderOpen(ctx, open) {
    const el = ctx.el;
    const card = ctx.section("todos", null);
    card.classList.add("todos-open");

    const input = el("input", {
      class: "input todos-input",
      type: "text",
      maxLength: MAX_LENGTH,
      placeholder: FB.t("todoPlaceholder"),
      autocomplete: "off",
      enterKeyHint: "done",
      "aria-label": FB.t("addTodo"),
      oninput: () => {
        draft = input.value;
      }
    });
    input.value = draft;

    // Adding is the one change that is not safe to send twice.
    let sending = false;
    const form = el(
      "form",
      {
        class: "row todos-form",
        onsubmit: async (event) => {
          event.preventDefault();
          if (sending) {
            return;
          }
          sending = true;
          try {
            if (await request(ctx, "todos/add", { text: input.value })) {
              draft = "";
            }
            // Back to the (new) field, ready for the next one.
            await redraw(ctx, addInput);
          } finally {
            sending = false;
          }
        }
      },
      input,
      el("button", { class: "btn primary", type: "submit" }, FB.t("add"))
    );

    card.append(
      el("div", { class: "section-heading" }, el("h2", {}, FB.t("todoList")), el("span", { class: "count todos-count" }, String(open.length))),
      form,
      open.length === 0
        ? el("p", { class: "empty" }, FB.t("noTodos"))
        : el("ul", { class: "list todos-list" }, open.map((item, index) => todoRow(ctx, item, index)))
    );
  }

  function renderDone(ctx, done) {
    const el = ctx.el;
    const card = ctx.section("todos", null);
    card.classList.add("todos-done");

    const clearButton =
      done.length === 0
        ? null
        : el(
            "button",
            {
              class: "btn small danger todos-clear-done",
              type: "button",
              onclick: async () => {
                await request(ctx, "todos/clearDone");
                await redraw(ctx, addInput);
              }
            },
            FB.t("clearDone")
          );

    card.append(el("div", { class: "section-heading" }, el("h2", {}, FB.t("doneHeading")), clearButton));
    if (done.length === 0) {
      card.append(el("p", { class: "empty" }, FB.t("noDone")));
      return;
    }
    card.append(el("ul", { class: "list todos-list" }, done.slice(0, POPUP_DONE_ITEMS).map((item, index) => todoRow(ctx, item, index))));
    if (done.length > POPUP_DONE_ITEMS) {
      card.append(el("p", { class: "muted todos-done-count" }, FB.t("doneCount", done.length, POPUP_DONE_ITEMS)));
    }
  }

  // ---- content script -----------------------------------------------------
  function overlayRow(ctx, todo) {
    const el = ctx.el;
    const checkbox = el("input", { type: "checkbox" });
    const row = el("li", { class: "fb-todo-item" }, el("label", { class: "fb-todo" }, checkbox, el("span", { class: "fb-todo-text" }, todo.text)));

    // Only this row changes. The overlay is not rebuilt, so a countdown or a
    // half-typed reason next to it is left alone. The state is sent
    // explicitly, so quick ticks and unticks settle on the last one.
    checkbox.addEventListener("change", async () => {
      const done = checkbox.checked;
      row.classList.toggle("is-done", done);
      if (ctx.keepOverlay) {
        ctx.keepOverlay();
      }
      try {
        await ctx.send("todos/toggle", { id: todo.id, done: done });
      } catch (error) {
        if (ctx.keepOverlay) {
          ctx.keepOverlay(false);
        }
        checkbox.checked = !done;
        row.classList.toggle("is-done", !done);
        ctx.setStatus(error.message);
      }
    });
    return row;
  }

  FB.registerFeature({
    id: "todos",

    // ---- service worker ---------------------------------------------------
    // item = { id, text, done, createdAt, doneAt }
    defaults: { todos: [] },

    handlers: {
      async "todos/add"(message, ctx) {
        const text = String(message.text === undefined || message.text === null ? "" : message.text)
          .replace(/\s+/g, " ")
          .trim();
        if (!text) {
          throw new Error(FB.t("todoEmpty"));
        }
        if (text.length > MAX_LENGTH) {
          throw new Error(FB.t("todoTooLong", MAX_LENGTH));
        }
        return ctx.store.update((state) => {
          const todos = readTodos(state);
          if (openOf(todos).length >= MAX_OPEN) {
            throw new Error(FB.t("todoTooManyAdd", MAX_OPEN));
          }
          const item = { id: newId(todos, ctx.now), text: text, done: false, createdAt: ctx.now, doneAt: null };
          state.todos = todos.concat(item);
          return item;
        });
      },

      async "todos/toggle"(message, ctx) {
        return ctx.store.update((state) => {
          const todos = readTodos(state);
          const item = todos.find((entry) => entry.id === message.id);
          if (!item) {
            throw new Error(FB.t("todoNotFound"));
          }
          const done = message.done === undefined ? !item.done : Boolean(message.done);
          if (!done && item.done && openOf(todos).length >= MAX_OPEN) {
            throw new Error(FB.t("todoTooManyRestore", MAX_OPEN));
          }
          if (done !== Boolean(item.done)) {
            item.done = done;
            item.doneAt = done ? ctx.now : null;
          }
          // Finished items are only kept for the 「已完成」 list. Without a cap
          // they would pile up in a state that is rewritten on every tick.
          const dropped = new Set(doneOf(todos).slice(KEEP_DONE));
          state.todos = todos.filter((entry) => !dropped.has(entry));
          return item;
        });
      },

      async "todos/remove"(message, ctx) {
        return ctx.store.update((state) => {
          const todos = readTodos(state);
          state.todos = todos.filter((entry) => entry.id !== message.id);
          return { removed: todos.length - state.todos.length };
        });
      },

      async "todos/clearDone"(message, ctx) {
        return ctx.store.update((state) => {
          const todos = readTodos(state);
          state.todos = todos.filter((entry) => !entry.done);
          return { removed: todos.length - state.todos.length };
        });
      }
    },

    gate(gate, ctx) {
      const open = openOf(readTodos(ctx.state));
      gate.extras.todos = {
        open: open.slice(0, OVERLAY_ITEMS).map((item) => ({ id: item.id, text: item.text })),
        openCount: open.length
      };
    },

    // ---- content script ---------------------------------------------------
    overlay: {
      render(ctx) {
        const extras = ctx.extras;
        const taskRow = ctx.tasks && ctx.tasks.todo;
        if (!taskRow || !extras || !Array.isArray(extras.open)) {
          return;
        }
        // Nothing to do: drop the to-do step instead of pointing at an empty
        // list, and number the steps that are left 1, 2.
        if (extras.open.length === 0) {
          taskRow.remove();
          ctx.panel.querySelectorAll(".fb-task .fb-task-mark").forEach((mark, index) => {
            mark.textContent = String(index + 1);
          });
          return;
        }
        const el = ctx.el;
        const shown = extras.open.slice(0, OVERLAY_ITEMS);

        const label = taskRow.querySelector(".fb-task-label");
        if (label) {
          label.textContent = FB.t("taskDoTodo");
        }

        const list = el("ul", { class: "fb-todos", "aria-label": FB.t("todoList") }, shown.map((todo) => overlayRow(ctx, todo)));
        const more = Number(extras.openCount || 0) - shown.length;
        if (more > 0) {
          list.append(el("li", { class: "fb-todos-more" }, FB.t("moreTodos", more)));
        }
        taskRow.after(list);
      }
    },

    // ---- popup --------------------------------------------------------------
    popup: {
      render(ctx) {
        const todos = readTodos(ctx.state);
        renderOpen(ctx, openOf(todos));
        renderDone(ctx, doneOf(todos));
      }
    }
  });
})();
