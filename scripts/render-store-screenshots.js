// Builds the store screenshots: a short headline over a device showing the
// real extension UI.
//
//   node scripts/render-store-screenshots.js
//
// Output:
//   store-assets/screenshots/iphone-6.9/*.png   1320×2868 (App Store, 6.9")
//   store-assets/screenshots/chrome/*.png       1280×800  (Chrome Web Store)
//   store-assets/screenshots/mac/*.png          2560×1600 (Mac App Store, Safari look)
//
// It works in two passes, both in the headless Chromium the end-to-end
// tests use. First the extension is loaded with sample data and each screen
// is captured as it really renders. Then those captures are placed inside a
// drawn phone or browser window on a branded background with a headline.
// The UI in the frames is therefore the shipped UI, not a mock-up; edit the
// headlines in FRAMES below.
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { launchExtension } = require("../tests/helpers/extension.js");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "store-assets", "screenshots");
const ICON_SVG = fs.readFileSync(path.join(ROOT, "store-assets", "icon", "icon.svg"), "utf8");
const ICON_PATH = ICON_SVG.match(/<path[^>]*\/>/)[0];

const NOW = Date.now();
const DAY = 24 * 60 * 60 * 1000;
const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 900, height: 700 };
// Scrollbars are an artefact of capturing, not part of the UI.
const NO_SCROLLBARS = "*{scrollbar-width:none !important}*::-webkit-scrollbar{display:none !important}";

const FONT = "'PingFang TC', 'Noto Sans TC', system-ui, sans-serif";
const GREEN = "linear-gradient(180deg, #3b8273 0%, #22574c 100%)";
const CREAM = "#f4f6ef";

// One idea per frame: what it does for you, then the screen that does it.
const FRAMES = [
  { shot: "overlay", theme: "green", headline: ["想滑一下？", "先緩緩"], sub: "打開分心網站前，先停十秒" },
  { shot: "todos", theme: "cream", headline: ["先看到", "該做的事"], sub: "提醒畫面會列出你的待辦" },
  { shot: "stats", theme: "green", headline: ["今天打開了", "幾次"], sub: "次數和時間，一眼看完" },
  { shot: "modes", theme: "cream", headline: ["要認真時", "開嚴格模式"], sub: "指定時段或額度，到了就不能繼續" },
  { shot: "sites", theme: "green", headline: ["哪些網站", "你決定"], sub: "資料只存在你的裝置" }
];

const SITE_PAGE =
  '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>site</title></head>' +
  '<body style="margin:0;background:#fff"></body></html>';

function dayKey(timestamp) {
  const date = new Date(timestamp);
  return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");
}

function sampleState() {
  const stats = {};
  const dailyUsage = {};
  [9, 7, 8, 5, 6, 4, 3].forEach((count, index) => {
    const day = dayKey(NOW - (6 - index) * DAY);
    const continued = Math.max(1, Math.round(count / 3));
    const onVideo = Math.ceil(count * 0.6);
    stats[day] = {
      "youtube.com": { shown: onVideo, continued: continued, closed: onVideo - continued, autoClosed: Math.max(0, continued - 1) },
      "instagram.com": { shown: count - onVideo, continued: 0, closed: count - onVideo, autoClosed: 0 }
    };
    dailyUsage[day] = { "youtube.com": continued * 290, "instagram.com": 0 };
  });
  return {
    blockedTargets: ["facebook.com", "instagram.com", "reddit.com", "youtube.com"],
    limitMinutes: 5,
    stats: stats,
    dailyUsage: dailyUsage,
    todos: [
      { id: "a", text: "回覆指導教授的信", done: false, createdAt: NOW - 3 * 60 * 60 * 1000, doneAt: 0 },
      { id: "b", text: "把報告第三章寫完", done: false, createdAt: NOW - 2 * 60 * 60 * 1000, doneAt: 0 },
      { id: "c", text: "訂週五的高鐵票", done: false, createdAt: NOW - 60 * 60 * 1000, doneAt: 0 },
      { id: "d", text: "倒垃圾", done: true, createdAt: NOW - 5 * 60 * 60 * 1000, doneAt: NOW - 4 * 60 * 60 * 1000 }
    ],
    unlockLog: [
      { at: NOW - 26 * 60 * 60 * 1000, target: "youtube.com", reason: "查資料" },
      { at: NOW - 5 * 60 * 60 * 1000, target: "youtube.com", reason: "找上次那支教學影片" },
      { at: NOW - 2 * 60 * 60 * 1000, target: "instagram.com", reason: "回訊息" }
    ]
  };
}

// ---------------------------------------------------------------------------
// Pass 1: the real UI
// ---------------------------------------------------------------------------
async function captureScreens(viewport, scale) {
  const ext = await launchExtension({ state: sampleState(), pageHtml: SITE_PAGE, deviceScaleFactor: scale, colorScheme: "light" });
  const shots = {};
  const phone = viewport.width < 600;

  const overlay = await ext.context.newPage();
  await overlay.setViewportSize(viewport);
  await overlay.goto("https://www.youtube.com/");
  await overlay.waitForSelector("#fb-title");
  await overlay.addStyleTag({ content: NO_SCROLLBARS });
  await overlay.waitForTimeout(400);
  shots.overlay = await overlay.screenshot();
  await overlay.close();

  const SCROLL_TO = { modes: '[data-action="strict-enable"]' };
  for (const tab of ["sites", "todos", "stats", "modes"]) {
    const popup = await ext.context.newPage();
    // The popup is 380px wide on the desktop and Chrome caps it at 600px
    // tall; on the phone it fills the sheet.
    await popup.setViewportSize(phone ? viewport : { width: 380, height: 600 });
    await popup.goto("chrome-extension://" + ext.extensionId + "/popup.html#" + tab);
    await popup.waitForSelector("#target-list > *", { state: "attached" });
    if (phone) {
      await popup.addStyleTag({ content: "body{width:auto !important}.popup{padding-top:22px}" });
    }
    await popup.addStyleTag({ content: NO_SCROLLBARS });
    if (!phone && SCROLL_TO[tab]) {
      // The popup scrolls past 590px, which would cut the button the headline
      // talks about in half. Drop the logo row (the iPhone sheet has none
      // either) and scroll whatever is still missing, so the shot starts at
      // the tabs and ends on a whole button.
      await popup.evaluate((selector) => {
        const button = document.querySelector(selector);
        const overflow = () => button.getBoundingClientRect().bottom + 14 - document.body.clientHeight;
        if (overflow() > 0) {
          document.querySelector(".header").hidden = true;
        }
        if (overflow() > 0) {
          document.body.scrollTop += overflow();
        }
      }, SCROLL_TO[tab]);
    }
    await popup.waitForTimeout(400);
    shots[tab] = await popup.screenshot();
    await popup.close();
  }

  await ext.close();
  return shots;
}

// ---------------------------------------------------------------------------
// Pass 2: the frames
// ---------------------------------------------------------------------------
const dataUrl = (buffer) => "data:image/png;base64," + buffer.toString("base64");

function themeOf(frame) {
  return frame.theme === "green"
    ? { background: GREEN, text: "#f7f4e9", sub: "rgba(247,244,233,0.82)", mark: "#f7f4e9", shadow: "rgba(10,30,25,0.45)" }
    : { background: CREAM, text: "#17231f", sub: "#52615c", mark: "#2d7569", shadow: "rgba(23,35,31,0.22)" };
}

function wordmark(colors, size) {
  return (
    '<div style="display:flex;align-items:center;gap:' + size * 0.3 + "px;font-size:" + size + "px;font-weight:600;color:" + colors.text + '">' +
    '<svg width="' + size * 1.1 + '" height="' + size * 1.1 + '" viewBox="250 220 560 620" style="fill:' + colors.mark + '">' + ICON_PATH.replace(/fill="[^"]*"/, "") + "</svg>" +
    "先緩緩</div>"
  );
}

// 440×956 CSS px at 3x = 1320×2868. The phone runs off the bottom edge.
function iphoneFrame(frame, shot) {
  const colors = themeOf(frame);
  return (
    '<body style="margin:0;width:440px;height:956px;overflow:hidden;background:' + colors.background + ";font-family:" + FONT + '">' +
    '<div style="padding:64px 40px 0">' +
    wordmark(colors, 17) +
    '<h1 style="margin:22px 0 0;font-size:54px;line-height:1.16;font-weight:700;letter-spacing:0;color:' + colors.text + '">' + frame.headline.join("<br>") + "</h1>" +
    '<p style="margin:14px 0 0;font-size:19px;line-height:1.4;color:' + colors.sub + '">' + frame.sub + "</p>" +
    "</div>" +
    // The phone: bezel, island, screen.
    '<div style="position:absolute;left:50%;top:318px;width:336px;margin-left:-168px;padding:9px;border-radius:52px;background:#0d1211;box-shadow:0 30px 60px ' + colors.shadow + '">' +
    '<div style="position:relative;overflow:hidden;border-radius:43px;background:' + CREAM + ';height:690px">' +
    '<div style="height:40px;background:' + CREAM + '"></div>' +
    '<div style="position:absolute;top:10px;left:50%;width:86px;height:25px;margin-left:-43px;border-radius:14px;background:#0d1211"></div>' +
    '<img src="' + dataUrl(shot) + '" style="display:block;width:100%">' +
    "</div></div></body>"
  );
}

// 1280×800. Headline on the left, a browser window on the right that fits
// inside the frame. Settings frames show the toolbar popup hanging from the
// extension's toolbar button over an ordinary page, the way it really looks;
// the pause-screen frame shows the page itself. `safari` draws Safari's
// toolbar (centred address field, no extensions puzzle) and the popup as a
// popover with an arrow, for the Mac App Store set.
function chromeFrame(frame, pageShot, popupShot, safari) {
  const colors = themeOf(frame);
  const left = 452;
  const width = 776;
  const toolbar = 48;
  const contentHeight = popupShot ? 600 : Math.round((width / DESKTOP.width) * DESKTOP.height);
  const top = Math.round((800 - toolbar - contentHeight) / 2);

  const dots = ["#ec6a5e", "#f4bf4f", "#61c554"].map((color) => '<span style="width:12px;height:12px;border-radius:50%;background:' + color + '"></span>').join("");
  const puzzle =
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#5f6b66" stroke-width="2" stroke-linejoin="round">' +
    '<path d="M10 3h4v3a2 2 0 1 0 0 0h0v2h4v4h-2a2 2 0 1 0 0 4h2v4h-4v-2a2 2 0 1 0-4 0v2H6v-4h2a2 2 0 1 0 0-4H6V8h4z"/></svg>';
  const button =
    '<span style="display:grid;place-items:center;width:30px;height:30px;border-radius:8px;' +
    (popupShot ? "background:rgba(45,117,105,.16)" : "") + '">' +
    '<span style="width:20px;height:20px;border-radius:5px;overflow:hidden;display:block">' +
    ICON_SVG.replace("<svg ", '<svg width="20" height="20" style="display:block" ') +
    "</span></span>";
  const bar = safari
    ? '<div style="display:flex;align-items:center;gap:10px;height:' + toolbar + 'px;padding:0 14px;background:#ecedeb">' +
      dots +
      '<span style="width:22px;height:22px;margin-left:12px;border-radius:5px;border:1.5px solid #9aa29e"></span>' +
      '<span style="flex:1"></span>' +
      '<span style="display:flex;align-items:center;justify-content:center;width:46%;height:30px;border-radius:8px;background:#e1e3e0;color:#3c4642;font-size:13px">youtube.com</span>' +
      '<span style="flex:1"></span>' + button + "</div>"
    : '<div style="display:flex;align-items:center;gap:8px;height:' + toolbar + 'px;padding:0 14px;background:#e9ece6">' +
      dots +
      '<span style="flex:1;display:flex;align-items:center;height:30px;margin:0 10px 0 14px;padding:0 14px;border-radius:15px;background:#fff;color:#5f6b66;font-size:13px">www.youtube.com</span>' +
      puzzle + button + "</div>";

  // An ordinary page, drawn as grey blocks, so the popup is the only content.
  const blank =
    '<div style="height:' + contentHeight + 'px;padding:28px 36px;background:#fff">' +
    ['<div style="height:22px;width:42%;border-radius:6px;background:#eceeea"></div>',
     '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-top:24px">' +
       Array.from({ length: 6 }, () => '<div><div style="aspect-ratio:16/9;border-radius:8px;background:#eceeea"></div><div style="height:10px;width:80%;margin-top:10px;border-radius:5px;background:#eceeea"></div></div>').join("") +
       "</div>"].join("") +
    "</div>";

  const content = popupShot ? blank : '<img src="' + dataUrl(pageShot) + '" style="display:block;width:100%">';
  const popupLeft = left + width - 14 - 330;
  // Safari's popover points at its button with a small arrow.
  const arrow = safari
    ? '<div style="position:absolute;top:' + (top + toolbar + 2) + "px;left:" + (left + width - 14 - 15 - 9) + 'px;width:18px;height:18px;transform:rotate(45deg);background:#f7f8f3;box-shadow:-1px -1px 0 rgba(23,35,31,.08)"></div>'
    : "";
  const popup = popupShot
    ? '<div style="position:absolute;top:' + (top + toolbar + (safari ? 10 : 4)) + "px;left:" + popupLeft + 'px;width:330px;border-radius:' + (safari ? 12 : 10) + 'px;overflow:hidden;box-shadow:0 18px 50px rgba(23,35,31,.30),0 0 0 1px rgba(23,35,31,.08)">' +
      '<img src="' + dataUrl(popupShot) + '" style="display:block;width:100%"></div>' + arrow
    : "";

  return (
    '<body style="margin:0;width:1280px;height:800px;overflow:hidden;position:relative;background:' + colors.background + ";font-family:" + FONT + '">' +
    '<div style="position:absolute;left:72px;top:0;bottom:0;width:340px;display:flex;flex-direction:column;justify-content:center">' +
    wordmark(colors, 22) +
    '<h1 style="margin:28px 0 0;font-size:60px;line-height:1.16;font-weight:700;letter-spacing:0;color:' + colors.text + '">' + frame.headline.join("<br>") + "</h1>" +
    '<p style="margin:18px 0 0;font-size:22px;line-height:1.45;color:' + colors.sub + '">' + frame.sub + "</p>" +
    "</div>" +
    '<div style="position:absolute;left:' + left + "px;top:" + top + "px;width:" + width + 'px;border-radius:12px;overflow:hidden;box-shadow:0 30px 70px ' + colors.shadow + '">' +
    bar + content + "</div>" +
    popup +
    "</body>"
  );
}

async function renderFrames(name, viewport, scale, htmlFor) {
  const { chromium } = require("playwright-core");
  const { findChromium } = require("../tests/helpers/extension.js");
  const browser = await chromium.launch({ executablePath: findChromium(), args: ["--headless=new"], headless: false });
  const dir = path.join(OUT, name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });

  for (const [index, frame] of FRAMES.entries()) {
    const page = await browser.newPage({ viewport: viewport, deviceScaleFactor: scale });
    await page.setContent("<!doctype html><html><head><meta charset='utf-8'></head>" + htmlFor(frame) + "</html>");
    await page.waitForLoadState("load");
    const file = path.join(dir, String(index + 1).padStart(2, "0") + "-" + frame.shot + ".png");
    await page.screenshot({ path: file });
    await page.close();
    console.log(path.relative(ROOT, file));
  }
  await browser.close();
}

(async () => {
  const phoneShots = await captureScreens(PHONE, 3);
  await renderFrames("iphone-6.9", { width: 440, height: 956 }, 3, (frame) => iphoneFrame(frame, phoneShots[frame.shot]));

  const desktopShots = await captureScreens(DESKTOP, 2);
  // On the desktop the settings live in the toolbar popup.
  await renderFrames("chrome", { width: 1280, height: 800 }, 1, (frame) =>
    chromeFrame(frame, desktopShots.overlay, frame.shot === "overlay" ? null : desktopShots[frame.shot])
  );
  // Mac App Store: the same frames in Safari, at 2560×1600.
  await renderFrames("mac", { width: 1280, height: 800 }, 2, (frame) =>
    chromeFrame(frame, desktopShots.overlay, frame.shot === "overlay" ? null : desktopShots[frame.shot], true)
  );
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
