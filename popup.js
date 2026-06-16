const BLOCKED_TARGETS_KEY = "blockedTargets";
const LIMIT_MINUTES_KEY = "limitMinutes";
const DEFAULT_TARGETS = ["instagram.com", "facebook.com", "youtube.com"];
const DEFAULT_LIMIT_MINUTES = 5;

const form = document.getElementById("add-form");
const input = document.getElementById("target-input");
const message = document.getElementById("form-message");
const list = document.getElementById("target-list");
const template = document.getElementById("target-template");
const addCurrentButton = document.getElementById("add-current");
const limitForm = document.getElementById("limit-form");
const limitInput = document.getElementById("limit-input");
const limitMessage = document.getElementById("limit-message");

renderTargets();
renderLimit();

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  await addTarget(input.value);
  input.value = "";
});

addCurrentButton.addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const target = getTargetFromUrl(tab?.url);

  if (!target) {
    setMessage("這個頁面不能加入清單。");
    return;
  }

  await addTarget(target);
});

limitForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const minutes = Number(limitInput.value);

  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 180) {
    setLimitMessage("請輸入 1 到 180 分鐘。");
    return;
  }

  await chrome.storage.sync.set({ [LIMIT_MINUTES_KEY]: minutes });
  setLimitMessage(`已設定為 ${minutes} 分鐘後自動關閉。`);
});

async function renderTargets() {
  const targets = await getTargets();
  list.replaceChildren();

  if (targets.length === 0) {
    const empty = document.createElement("li");
    empty.className = "empty";
    empty.textContent = "目前沒有封鎖項目。";
    list.appendChild(empty);
    return;
  }

  for (const target of targets) {
    const item = template.content.firstElementChild.cloneNode(true);
    item.querySelector("span").textContent = target;
    item.querySelector("button").addEventListener("click", async () => {
      await saveTargets(targets.filter((itemTarget) => itemTarget !== target));
      setMessage(`已移除 ${target}`);
      await renderTargets();
    });
    list.appendChild(item);
  }
}

async function addTarget(value) {
  const target = normalizeTarget(value);

  if (!target) {
    setMessage("請輸入有效的網站，例如 reddit.com。");
    return;
  }

  const targets = await getTargets();
  if (targets.includes(target)) {
    setMessage(`${target} 已經在清單裡。`);
    return;
  }

  await saveTargets([...targets, target].sort());
  setMessage(`已新增 ${target}`);
  await renderTargets();
}

async function getTargets() {
  const settings = await chrome.storage.sync.get({ [BLOCKED_TARGETS_KEY]: DEFAULT_TARGETS });
  const targets = Array.isArray(settings[BLOCKED_TARGETS_KEY])
    ? settings[BLOCKED_TARGETS_KEY]
    : DEFAULT_TARGETS;

  return targets.map(normalizeTarget).filter(Boolean);
}

async function saveTargets(targets) {
  await chrome.storage.sync.set({ [BLOCKED_TARGETS_KEY]: targets });
}

async function renderLimit() {
  const settings = await chrome.storage.sync.get({ [LIMIT_MINUTES_KEY]: DEFAULT_LIMIT_MINUTES });
  const minutes = Number(settings[LIMIT_MINUTES_KEY]);
  limitInput.value = Number.isFinite(minutes) ? minutes : DEFAULT_LIMIT_MINUTES;
  setLimitMessage(`目前設定：${limitInput.value} 分鐘。`);
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

function getTargetFromUrl(value) {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) {
      return "";
    }

    return url.hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function setMessage(value) {
  message.textContent = value;
}

function setLimitMessage(value) {
  limitMessage.textContent = value;
}
