const test = require('node:test'),
  assert = require('node:assert/strict');
const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');
const { font, brandFont, FONT_FAMILY, BRAND_FAMILY } = require('../src/fonts.cjs');
test('bundled Chinese font draws title and subtitle characters as distinct glyphs', () => {
  const c = createCanvas(64, 64),
    ctx = c.getContext('2d');
  ctx.font = font(36);
  ctx.textBaseline = 'top';
  assert(GlobalFonts.has(FONT_FAMILY));
  const pixels = (character) => {
    ctx.clearRect(0, 0, 64, 64);
    ctx.fillText(character, 4, 4);
    return Buffer.from(ctx.getImageData(0, 0, 64, 64).data);
  };
  const missing = pixels(String.fromCodePoint(0x10ffff));
  for (const character of new Set('免配置启动浏览器劫持请求响应代理网络教程截图操作观察')) {
    const actual = pixels(character);
    assert(!actual.equals(missing), 'missing Chinese glyph: ' + character);
    assert(
      actual.some((value) => value !== 0),
      'empty Chinese glyph: ' + character,
    );
  }
});
test('bundled wordmark font uses the bundled Chinese fallback for configurable brand names', () => {
  const ctx = createCanvas(64, 64).getContext('2d');
  ctx.font = brandFont(36);
  assert(GlobalFonts.has(BRAND_FAMILY));
  const pixels = (text) => {
    ctx.clearRect(0, 0, 64, 64);
    ctx.fillText(text, 4, 42);
    return Buffer.from(ctx.getImageData(0, 0, 64, 64).data);
  };
  const missing = pixels(String.fromCodePoint(0x10ffff));
  for (const text of ['Y', 'A', 'K', '安', '全', '研', '究', '室'])
    assert(!pixels(text).equals(missing));
});
