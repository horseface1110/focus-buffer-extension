// Renders store-assets/icon/icon.svg into every PNG the project needs.
// Uses the Chromium that the end-to-end tests use, so there is nothing
// extra to install:  node scripts/render-icons.js
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright-core");
const { findChromium } = require("../tests/helpers/extension.js");

const ROOT = path.join(__dirname, "..");
const SVG = fs.readFileSync(path.join(ROOT, "store-assets", "icon", "icon.svg"), "utf8");

// rounded: transparent rounded corners (browser toolbars and stores).
// Square, opaque icons are for iOS, which applies its own mask.
const OUTPUTS = [
  ...[16, 32, 48, 96, 128, 256, 512].map((size) => ({ file: "extension/icons/icon-" + size + ".png", size, rounded: true })),
  { file: "store-assets/icon/icon-1024.png", size: 1024, rounded: false },
  { file: "store-assets/icon/chrome-store-128.png", size: 128, rounded: true, padding: 16 }
];

(async () => {
  const browser = await chromium.launch({ executablePath: findChromium(), args: ["--headless=new"], headless: false });
  for (const output of OUTPUTS) {
    const page = await browser.newPage({ viewport: { width: output.size, height: output.size }, deviceScaleFactor: 1 });
    const padding = output.padding || 0;
    const inner = output.size - padding * 2;
    const radius = output.rounded ? Math.round(inner * 0.225) : 0;
    await page.setContent(
      '<body style="margin:0;background:transparent">' +
        '<div style="width:' + inner + "px;height:" + inner + "px;margin:" + padding + "px;border-radius:" + radius + 'px;overflow:hidden">' +
        SVG.replace("<svg ", '<svg width="' + inner + '" height="' + inner + '" style="display:block" ') +
        "</div></body>"
    );
    const target = path.join(ROOT, output.file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    await page.screenshot({ path: target, omitBackground: output.rounded });
    await page.close();
    console.log(output.file);
  }

  // Chrome Web Store small promo tile, in the same look as the icon.
  const glyph = SVG.match(/<path[^>]*\/>/)[0];
  const promo = await browser.newPage({ viewport: { width: 440, height: 280 }, deviceScaleFactor: 1 });
  await promo.setContent(
    '<body style="margin:0;width:440px;height:280px;display:flex;align-items:center;justify-content:center;gap:22px;' +
      "background:linear-gradient(180deg,#3b8273,#22574c);color:#f7f4e9;" +
      "font-family:'PingFang TC','Noto Sans TC',system-ui,sans-serif\">" +
      '<svg width="110" height="110" viewBox="250 220 560 620">' + glyph + "</svg>" +
      '<div><div style="font-size:54px;font-weight:700;line-height:1.1">先緩緩</div>' +
      '<div style="margin-top:10px;font-size:19px;opacity:.86">打開分心網站前，先停一下</div></div></body>'
  );
  await promo.screenshot({ path: path.join(ROOT, "store-assets", "promo-small-440x280.png") });
  console.log("store-assets/promo-small-440x280.png");

  await browser.close();
})();
