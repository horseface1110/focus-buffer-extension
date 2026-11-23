// popup.js — the settings UI. It doubles as the options page, and on iPhone
// it is the sheet Safari shows for the extension.
(function () {
  const FB = globalThis.FB;
  const api = FB.api;
  const el = FB.el;
  const $ = (id) => document.getElementById(id);

  let state = null;
  let currentHost = "";
  let toastTimer = null;

  // Safari's extension sheet on iPhone and iPad gets its own layout. iPad
  // Safari says it is a Mac, so it is told apart by its touch screen.
  const touchMac = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  if (/iPhone|iPad|iPod/.test(navigator.userAgent) || touchMac) {
    document.documentElement.classList.add("is-ios");
  }
  if (/iPad/.test(navigator.userAgent) || touchMac) {
    document.documentElement.classList.add("is-ipad");
  }

  // Static text in popup.html: data-i18n sets an element's text,
  // data-i18n-placeholder and data-i18n-aria-label set those attributes.
  document.documentElement.lang = FB.t("langTag");
  document.title = FB.t("extName");
  for (const node of document.querySelectorAll("[data-i18n]")) {
    node.textContent = FB.t(node.dataset.i18n);
  }
  for (const node of document.querySelectorAll("[data-i18n-placeholder]")) {
    node.placeholder = FB.t(node.dataset.i18nPlaceholder);
  }
  for (const node of document.querySelectorAll("[data-i18n-aria-label]")) {
    node.setAttribute("aria-label", FB.t(node.dataset.i18nAriaLabel));
  }

  init().catch((error) => toast(FB.t("initFailed", error.message), "error"));

  async function init() {
    for (const tab of document.querySelectorAll(".tab")) {
      tab.addEventListener("click", () => selectTab(tab.dataset.tab));
    }
    $("add-form").addEventListener("submit", onAddSubmit);
    $("add-current").addEventListener("click", () => addTarget(currentHost));
    $("grant-all").addEventListener("click", onGrantAll);
    $("limit-form").addEventListener("submit", onLimitSubmit);

    try {
      const tabs = await api.tabs.query({ active: true, currentWindow: true });
      const url = new URL((tabs && tabs[0] && tabs[0].url) || "");
      currentHost = ["http:", "https:"].includes(url.protocol) ? FB.normalizeTarget(url.hostname) : "";
    } catch (error) {
      currentHost = "";
    }
    $("add-current").disabled = !currentHost;

    await refresh();
    selectTab(readTab());
    FB.send("sync").catch(() => {});
  }

  // Reload the state and redraw everything, feature sections included.
  async function refresh() {
    state = await FB.send("state");
    await renderTargets();
    $("limit-input").value = Number(state.limitMinutes) || FB.config.DEFAULT_LIMIT_MINUTES;
    renderFeatures();
  }

  // ---------------------------------------------------------------------
  // Tabs
  // ---------------------------------------------------------------------
  // The open tab lives in the URL (popup.html#stats), so it survives a
  // reload and can be linked to.
  function readTab() {
    return location.hash.replace(/^#/, "") || "sites";
  }

  function selectTab(name) {
    const tabs = Array.from(document.querySelectorAll(".tab"));
    const wanted = tabs.some((tab) => tab.dataset.tab === name && !tab.hidden) ? name : "sites";
    for (const tab of tabs) {
      tab.setAttribute("aria-selected", String(tab.dataset.tab === wanted));
    }
    for (const panel of document.querySelectorAll(".panel")) {
      panel.hidden = panel.dataset.panel !== wanted;
    }
    if (readTab() !== wanted) {
      history.replaceState(null, "", wanted === "sites" ? location.pathname : "#" + wanted);
    }
  }

  // ---------------------------------------------------------------------
  // Feature sections
  // ---------------------------------------------------------------------
  function renderFeatures() {
    for (const section of document.querySelectorAll(".section[data-feature]")) {
      section.remove();
    }

    for (const feature of FB.features) {
      if (!feature.popup || typeof feature.popup.render !== "function") {
        continue;
      }
      const context = {
        state: state,
        send: FB.send,
        el: el,
        refresh: refresh,
        toast: toast,
        // Adds a section to one of the tabs ("sites", "todos", "stats",
        // "modes") and returns it.
        section(tab, title) {
          const panel = document.querySelector('.panel[data-panel="' + tab + '"]') || document.querySelector('.panel[data-panel="modes"]');
          const section = el("section", { class: "section", dataset: { feature: feature.id } }, title ? el("h2", {}, title) : null);
          panel.append(section);
          return section;
        }
      };
      try {
        feature.popup.render(context);
      } catch (error) {
        console.error("Focus Buffer: " + feature.id + " popup failed", error);
      }
    }

    // A tab with nothing in it is not worth showing, and neither is a tab
    // bar with a single tab.
    const tabs = Array.from(document.querySelectorAll(".tab"));
    for (const tab of tabs) {
      const panel = document.querySelector('.panel[data-panel="' + tab.dataset.tab + '"]');
      tab.hidden = panel.children.length === 0;
    }
    document.querySelector(".tabs").hidden = tabs.filter((tab) => !tab.hidden).length < 2;
  }

  // ---------------------------------------------------------------------
  // Targets
  // ---------------------------------------------------------------------
  async function renderTargets() {
    const list = $("target-list");
    const targets = state.blockedTargets;
    const rows = [];
    let missing = 0;

    for (const target of targets) {
      const granted = await hasAccess(target);
      if (!granted) {
        missing += 1;
      }
      rows.push(
        el(
          "li",
          { class: "list-item", dataset: { target: target } },
          el(
            "div",
            { class: "list-main" },
            el("span", { class: "list-title" }, target),
            // Only worth a line when something is wrong.
            granted ? null : el("span", { class: "list-sub warn" }, FB.t("notGranted"))
          ),
          el(
            "div",
            { class: "list-actions" },
            granted ? null : el("button", { class: "btn small primary", type: "button", onclick: () => grant([target]) }, FB.t("grant")),
            el("button", { class: "btn small danger", type: "button", onclick: () => removeTarget(target) }, FB.t("remove"))
          )
        )
      );
    }

    if (rows.length === 0) {
      rows.push(el("li", { class: "empty" }, FB.t("noTargets")));
    }
    list.replaceChildren(...rows);
    $("target-count").textContent = String(targets.length);
    $("permission-card").hidden = missing === 0;
  }

  async function hasAccess(target) {
    const origins = FB.originsFor(target);
    if (origins.length === 0) {
      return false;
    }
    try {
      return await api.permissions.contains({ origins: origins });
    } catch (error) {
      return false;
    }
  }

  // permissions.request has to run inside the click handler, before any
  // await, or the browser refuses it.
  function requestAccess(targets) {
    const origins = Array.from(new Set(targets.flatMap(FB.originsFor)));
    if (origins.length === 0) {
      return Promise.resolve(false);
    }
    try {
      return Promise.resolve(api.permissions.request({ origins: origins })).catch(() => false);
    } catch (error) {
      return Promise.resolve(false);
    }
  }

  function onAddSubmit(event) {
    event.preventDefault();
    addTarget($("target-input").value);
  }

  async function addTarget(value) {
    const target = FB.normalizeTarget(value);
    if (!target) {
      toast(FB.t("invalidTarget"), "error");
      return;
    }

    // Save first: in Chrome the permission prompt can close the popup, and
    // the service worker picks the new permission up on its own.
    const access = requestAccess([target]);
    try {
      await FB.send("targets/add", { target: target });
    } catch (error) {
      toast(error.message, "error");
      return;
    }
    $("target-input").value = "";

    const granted = await access;
    await FB.send("sync").catch(() => {});
    await refresh();
    toast(granted ? FB.t("added", target) : FB.t("addedNotGranted", target), granted ? "ok" : "warn");
  }

  async function removeTarget(target) {
    try {
      await FB.send("targets/remove", { target: target });
    } catch (error) {
      toast(error.message, "error");
      return;
    }
    await refresh();
    // Removing is immediate, so offer a way back.
    toast(FB.t("removed", target), "ok", { label: FB.t("undo"), run: () => addTarget(target) });
  }

  async function grant(targets) {
    const granted = await requestAccess(targets);
    await FB.send("sync").catch(() => {});
    await refresh();
    toast(granted ? FB.t("grantedToast") : FB.t("notGrantedToast"), granted ? "ok" : "warn");
  }

  function onGrantAll() {
    grant(state.blockedTargets);
  }

  // ---------------------------------------------------------------------
  // Limit
  // ---------------------------------------------------------------------
  async function onLimitSubmit(event) {
    event.preventDefault();
    try {
      const result = await FB.send("limit/set", { minutes: Number($("limit-input").value) });
      toast(FB.t("limitSaved", result.minutes));
    } catch (error) {
      toast(error.message, "error");
    }
    await refresh();
  }

  // `action` is an optional { label, run } shown as a button in the toast.
  function toast(text, kind, action) {
    const node = $("toast");
    node.replaceChildren(el("span", {}, text));
    if (action) {
      node.append(
        el("button", { class: "btn", type: "button", onclick: () => { node.replaceChildren(); action.run(); } }, action.label)
      );
    }
    node.dataset.kind = kind || "ok";
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => node.replaceChildren(), action ? 8000 : 5000);
  }
})();
