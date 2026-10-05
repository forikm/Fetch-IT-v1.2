import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import sharp from "sharp";
const manifest = JSON.parse(fs.readFileSync(new URL("../public/manifest.webmanifest", import.meta.url), "utf8"));
const publicFile = path => new URL(`../public${path}`, import.meta.url);

test("transparent and maskable app icons have separate manifest entries and valid sizes", async () => {
  for (const purpose of ["any", "maskable"]) {
    const icons = manifest.icons.filter(icon => icon.purpose === purpose);
    assert.equal(icons.length, 2);
    assert(icons.some(icon => icon.sizes === "512x512"));
    for (const icon of icons) {
      const metadata = await sharp(fs.readFileSync(publicFile(icon.src))).metadata();
      assert.equal(`${metadata.width}x${metadata.height}`, icon.sizes);
      assert.equal(metadata.format, "png");
    }
  }
  assert(manifest.icons.every(icon => !icon.purpose.includes(" ")));
});

test("standard icons preserve the existing transparent brand artwork exactly", async () => {
  for (const icon of manifest.icons.filter(icon => icon.purpose === "any")) {
    const buffer = fs.readFileSync(publicFile(icon.src));
    const size = Number(icon.sizes.split("x")[0]);
    assert.deepEqual(buffer, fs.readFileSync(publicFile(`/fetch-icon-final-${size}.png`)));
    const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    assert.equal(info.channels, 4);
    assert.equal(data[3], 0);
  }
});

test("Android icons are opaque with a light surround and artwork inside the safe circle", async () => {
  for (const icon of manifest.icons.filter(icon => icon.purpose === "maskable")) {
    const buffer = fs.readFileSync(publicFile(icon.src));
    assert.equal((await sharp(buffer).metadata()).hasAlpha, false);
    const { data, info } = await sharp(buffer).raw().toBuffer({ resolveWithObject: true });
    assert([...data.subarray(0, 3)].every(channel => channel > 230), "No black corner fill");
    let orange = 0;
    for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
      const index = (y * info.width + x) * info.channels;
      if (data[index] > 180 && data[index + 1] < 180 && data[index + 2] < 120) {
        orange++;
        assert(Math.hypot(x - info.width / 2, y - info.height / 2) <= info.width * 0.4, "Artwork outside Android's safe area");
      }
    }
    assert(orange > info.width * info.height * 0.1, "Brand artwork is present");
  }
});
