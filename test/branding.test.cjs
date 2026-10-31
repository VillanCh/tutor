const test = require('node:test'),
  assert = require('node:assert/strict');
const { createCanvas } = require('@napi-rs/canvas');
const { brandLayout, chapterSegments, ellipsis } = require('../src/branding.cjs');
const { font, brandFont, ensureFonts, BRAND_FAMILY } = require('../src/fonts.cjs');
const { DEFAULTS, validateConfig } = require('../src/config.cjs');

test('old settings get portable brand defaults; brand text and gap settings validate before rendering', () => {
  const old = structuredClone(DEFAULTS);
  delete old.style.brand;
  delete old.style.chapterGap;
  const migrated = validateConfig(old);
  assert.equal(migrated.style.brand.name, 'YAK');
  assert.equal(migrated.style.chapterGap, 12);
  for (const brand of [
    { name: 'a\nb' },
    { name: 'x'.repeat(25) },
    { tagline: 'x'.repeat(49) },
    { enabled: 'yes' },
  ])
    assert.throws(() => validateConfig({ ...old, style: { ...old.style, brand } }), /品牌/);
  for (const chapterGap of [0, 100, NaN])
    assert.throws(() => validateConfig({ ...old, style: { ...old.style, chapterGap } }), /间距/);
  assert.equal(
    validateConfig({ ...old, style: { ...old.style, brand: { name: '安全研究室', tagline: '' } } })
      .style.brand.name,
    '安全研究室',
  );
});

test('wordmark layouts leave chapter and timer room at narrow and wide widths, including long Chinese names', () => {
  const ctx = createCanvas(1440, 72).getContext('2d');
  for (const width of [640, 1440, 3840])
    for (const name of ['YAK', 'Yakit Studio', '安全研究教程制作工作室品牌名称测试']) {
      const layout = brandLayout(
        ctx,
        { ...DEFAULTS.style, brand: { enabled: true, name, tagline: '安全技术教程工作室' } },
        width,
        16,
      );
      assert(layout.headingWidth > 0);
      assert(layout.headingX + layout.headingWidth < layout.timeX);
      ctx.font = font(22);
      const text = ellipsis(
        ctx,
        '一个很长很长的章节标题用于验证商标区和时间不会发生重叠',
        layout.headingWidth,
      );
      assert(ctx.measureText(text).width <= layout.headingWidth);
    }
  ensureFonts();
  assert(brandFont(32).includes(BRAND_FAMILY));
  const hidden = brandLayout(
    ctx,
    { ...DEFAULTS.style, brand: { enabled: false, name: 'YAK', tagline: '' } },
    640,
    16,
  );
  assert.equal(hidden.headingX, 16);
});

test('chapter rail geometry reserves actual gaps and follows chapter duration proportions', () => {
  const segments = chapterSegments(
    [
      { start: 0, end: 20, title: 'a' },
      { start: 20, end: 30, title: 'b' },
      { start: 30, end: 60, title: 'c' },
    ],
    60,
    1408,
    12,
  );
  for (let i = 1; i < segments.length; i++)
    assert(Math.abs(segments[i].x - segments[i - 1].x - segments[i - 1].width - 12) < 1e-6);
  assert(Math.abs(segments.at(-1).x + segments.at(-1).width - 1408) < 1e-6);
  assert(Math.abs(segments[0].width / segments[1].width - 2) < 1e-6);
});
