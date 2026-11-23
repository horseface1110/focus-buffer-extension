"use strict";

// The overlay pauses the page's audio and video. Whatever takes the overlay
// away has to let them play again, not only the Continue button.

const test = require("node:test");
const assert = require("node:assert/strict");
const { launchExtension } = require("../helpers/extension.js");

// One second of silence as an 8 kHz, 8-bit mono WAV.
function silentWav() {
  const samples = 8000;
  const buffer = Buffer.alloc(44 + samples, 0x80);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + samples, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(8000, 24);
  buffer.writeUInt32LE(8000, 28);
  buffer.writeUInt16LE(1, 32);
  buffer.writeUInt16LE(8, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(samples, 40);
  return "data:audio/wav;base64," + buffer.toString("base64");
}

const PAGE =
  '<!doctype html><html><head><meta charset="utf-8"><title>video site</title></head><body>' +
  '<audio id="clip" src="' + silentWav() + '" loop muted autoplay></audio></body></html>';

test("paused media in Chromium", async (t) => {
  const ext = await launchExtension({ features: ["rest"], pageHtml: PAGE });
  t.after(() => ext.close());

  await t.test("a break started while the overlay is up lets the page's media play again", async () => {
    const page = await ext.newPage("https://www.youtube.com/watch");
    await page.waitForSelector("#fb-title");
    // The page tried to play; the overlay keeps it paused.
    await page.waitForTimeout(800);
    assert.equal(await page.evaluate(() => document.getElementById("clip").paused), true);

    await ext.evaluate(() => FB.background.handlers["rest/start"]({ minutes: 5 }, {}));
    await page.waitForSelector("#focus-buffer-root", { state: "detached", timeout: 5000 });
    await page.waitForFunction(() => !document.getElementById("clip").paused, null, { timeout: 3000 });
    await page.close();
  });
});
