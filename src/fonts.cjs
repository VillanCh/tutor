const fs = require('node:fs'),
  path = require('node:path');
const { GlobalFonts } = require('@napi-rs/canvas');
const FONT_FAMILY = 'Tutor CJK';
const FONT_FILE = path.join(__dirname, '../build/fonts/NotoSansCJKsc-Regular.otf');
const BRAND_FAMILY = 'Tutor Brand';
const BRAND_FILE = path.join(__dirname, '../build/fonts/SpaceGrotesk-Variable.ttf');
let ready = false;
function ensureFonts() {
  if (ready) return;
  // Read through Node so the same font also loads from Electron's app.asar.
  const key = GlobalFonts.register(fs.readFileSync(FONT_FILE), FONT_FAMILY);
  if (!key || !GlobalFonts.has(FONT_FAMILY))
    throw Error('内置中文字体加载失败，请检查应用字体资源');
  if (
    !GlobalFonts.register(fs.readFileSync(BRAND_FILE), BRAND_FAMILY) ||
    !GlobalFonts.has(BRAND_FAMILY)
  )
    throw Error('内置商标字体加载失败，请检查应用字体资源');
  ready = true;
}
function font(size) {
  ensureFonts();
  return size + 'px "' + FONT_FAMILY + '"';
}
function brandFont(size) {
  ensureFonts();
  return '700 ' + size + 'px "' + BRAND_FAMILY + '", "' + FONT_FAMILY + '"';
}
module.exports = { ensureFonts, font, brandFont, FONT_FAMILY, FONT_FILE, BRAND_FAMILY, BRAND_FILE };
