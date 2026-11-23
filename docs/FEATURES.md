# Features

Each feature is one file, `extension/features/<id>.js`, plus `<id>.css`. The
same file is loaded in all three places the extension runs:

- the **service worker** (`background.js`), which owns storage and decides
  what a page should do,
- the **content script** (`content.js`) on listed sites, which draws the
  pause overlay,
- the **popup** (`popup.html`), which is also the options page.

A feature registers one object. Every part is optional, and each part only
runs in the context it belongs to, so DOM code and storage code can sit in
the same file.

```js
(function () {
  const FB = globalThis.FB;

  FB.registerFeature({
    id: "todos",

    // ---- service worker -------------------------------------------------
    // Keys this feature owns in storage.local, with their initial values.
    defaults: { todos: [] },

    // Messages from the popup or the overlay: FB.send("todos/add", { text }).
    // Return a value to resolve FB.send, throw an Error to reject it (the
    // message is shown to the user, so write it in Chinese).
    handlers: {
      async "todos/add"(message, ctx) {
        // ctx = { store, sender, now, guard, sync }
        return ctx.store.update((state) => { /* change state in place */ });
      }
    },

    // Called while deciding what a page does. Change `gate` in place.
    // ctx = { state, target, url, tabId, now, day, pass }
    gate(gate, ctx) {
      gate.extras.todos = { open: [] };   // handed to this feature's overlay
    },

    // Called after every feature's gate() has run and the action is final.
    // For features that only describe the result; do not change the action.
    finalize(gate, ctx) {},

    // Called inside a storage update when the overlay is shown, the user
    // continues, closes the tab, or the tab is closed because time ran out.
    // event = { name: "shown"|"continue"|"close"|"autoclose", target, data, day, now, tabId }
    // Change `state` in place; it is saved for you. Must be synchronous.
    onEvent(event, state, ctx) {},

    // Veto a settings change. Return { ok: false, message } to refuse.
    guard(action, payload, state, now) {},

    // ---- content script -------------------------------------------------
    overlay: {
      // ctx = { gate, extras, root, panel, slots, tasks, continueButton,
      //         setStatus(text), redraw, keepOverlay(keep), send, el, refresh }
      // The overlay is drawn again in place (redraw is true) when the gate
      // or any feature's extras change, keeping typed text and focus; never
      // while the countdown runs. Call keepOverlay() right before sending a
      // change the overlay already shows (ticking a to-do), so that change
      // does not redraw it; keepOverlay(false) if sending failed.
      render(ctx) {},
      // true when this feature's extras change on their own (stats' counts),
      // so they never cause a redraw.
      volatile: false,
      // Runs when the user presses 「我真的要繼續」, before the countdown.
      // Return false to stop (after telling the user why), or an object to
      // merge into event.data of the "continue" event. May be async.
      beforeContinue(ctx) {}
    },
    // Small UI while the page is usable (gate.action "pass" or "free").
    // ctx = { gate, extras, mount(node), onCleanup(fn), send, el, refresh }
    page: { render(ctx) {} },

    // ---- popup ------------------------------------------------------------
    // ctx = { state, send, el, refresh, toast(text, kind, action), section(tab, title) }
    // toast's optional action is { label, run }, e.g. an undo button.
    popup: { render(ctx) {} }
  });
})();
```

## The gate

`background.js` builds this object for every page load and every usage tick,
then passes it through each feature's `gate()` in `FB.FEATURE_IDS` order
(`stats`, `reasons`, `todos`, `rest`, `strict`):

| field | meaning |
|---|---|
| `action` | `"overlay"` show the pause overlay · `"pass"` this tab may use the site until its minutes run out · `"free"` usable with no overlay and no time limit (a break) · `"none"` not a listed site |
| `target`, `siteName` | the matched list entry and its display name |
| `canContinue` | `false` hides 「我真的要繼續」 and ends a pass that is in use |
| `message` | shown in the overlay when `canContinue` is `false` |
| `waitSeconds` | the countdown before continuing (default 10) |
| `limitSeconds`, `remainingSeconds` | length of a pass, and what is left of this tab's pass |
| `usage` | `{ siteSeconds, totalSeconds }` for today |
| `extras` | `extras[featureId]` is passed to that feature's overlay and page UI as `ctx.extras`; keep it small and JSON-serializable |

## State

`ctx.store.get()` returns the whole state; `ctx.store.update(fn)` reads it,
lets `fn` change it in place, and writes it back. Updates are queued, so two
tabs cannot overwrite each other. Core keys:

| key | shape |
|---|---|
| `blockedTargets` | `["youtube.com", "https://example.com/path"]` |
| `limitMinutes` | minutes a pass lasts |
| `dailyUsage` | `{ "2026-11-23": { "youtube.com": seconds } }` |
| `stats` | `{ "2026-11-23": { "youtube.com": { shown, continued, closed, autoClosed } } }` |

Both day maps keep the last `FB.config.KEEP_DAYS` days. Day keys come from
`FB.dayKey(timestamp)`; `FB.recentDays(n, timestamp)` lists the last n.

## Guard actions

A handler that loosens a restriction calls
`ctx.guard(action, payload, state)` inside its update, so strict mode can
refuse it. It throws when refused.

| action | payload | raised by |
|---|---|---|
| `targets/remove` | `{ target }` | core |
| `limit/set` | `{ minutes, previous }` | core |
| `reasons/setRequired` | `{ required }` | reasons |
| `stats/clear` | `{}` | stats |
| `rest/start` | `{ minutes }` | rest |
| `rest/setDailyLimit` | `{ limit, previous }` | rest |

## Overlay slots

`ctx.slots` are empty containers inside the overlay panel, top to bottom:
`top` (under the intro text), `stats` (under the two usage cards), `tasks`
(under the three small tasks), `form` (just above the buttons), `bottom`
(under the status line). `ctx.tasks.water`, `.todo` and `.stretch` are the
three task rows.

The overlay sits inside other people's pages, so every rule in
`features/<id>.css` that styles it must start with `#focus-buffer-root`
(or `#focus-buffer-page` for the on-page UI). `overlay.css` has shared
pieces: `.fb-note`, `.fb-field-label`, `.fb-input`, `.fb-chips`, `.fb-chip`,
`.fb-error`, `.fb-pill`. The popup has its own in `popup.css`: `.section`,
`.row`, `.input`, `.select`, `.btn` (`.primary` `.secondary` `.danger`
`.small` `.block`), `.chips`/`.chip`, `.switch`, `.list`/`.list-item`,
`.muted`, `.empty`, and the colour variables at the top of that file.

## Tests

- `tests/unit/<id>.test.js` runs the real service worker in node with a fake
  extension API (`tests/helpers/background.js`).
- `tests/e2e/<id>.e2e.js` drives the extension in headless Chromium
  (`tests/helpers/extension.js`).

```bash
npm run test:unit
```

```bash
npm run test:e2e
```
