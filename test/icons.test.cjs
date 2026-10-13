const test = require('node:test'),
  assert = require('node:assert/strict');
const fs = require('node:fs/promises'),
  path = require('node:path'),
  os = require('node:os');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { prepare } = require('../scripts/prepare-brand-icons.cjs');

test('review icon kit retains transparent safety margins, outlined SVG text and valid multi-size containers', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tutor-icons-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await prepare(dir);
  for (const size of [16, 24, 32, 48, 64, 128, 256, 512, 1024]) {
    const image = await loadImage(path.join(dir, 'png', 'tutor-' + size + '.png'));
    assert.equal(image.width, size);
    assert.equal(image.height, size);
    const ctx = createCanvas(size, size).getContext('2d');
    ctx.drawImage(image, 0, 0);
    const pixels = ctx.getImageData(0, 0, size, size).data;
    const margin = Math.max(1, Math.floor(size * 0.12));
    let white = 0;
    let coverage = 0;
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const at = (y * size + x) * 4;
        // Weighted brightness retains antialiased strokes in the 16px export.
        if (x >= size * 0.19 && y >= size * 0.19 && x < size * 0.81 && y < size * 0.81)
          coverage += Math.max(0, (pixels[at] - 16) / 228) * (pixels[at + 3] / 255);
        if (x < margin || y < margin || x >= size - margin || y >= size - margin)
          assert.equal(pixels[at + 3], 0, 'clipped outer safety margin at ' + size);
        if (
          pixels[at + 3] > 220 &&
          pixels[at] > 225 &&
          pixels[at + 1] > 225 &&
          pixels[at + 2] > 220
        ) {
          white++;
          assert(
            x >= size * 0.19 && y >= size * 0.19 && x < size * 0.81 && y < size * 0.81,
            'glyph must stay inside its safety area at ' + size,
          );
        }
      }
    assert(white > 5 && coverage >= size * size * 0.09, 'mark must remain visible at ' + size);
  }
  for (const name of ['app-icon', 'mark-light', 'mark-dark', 'wordmark-light', 'wordmark-dark']) {
    const svg = await fs.readFile(path.join(dir, name + '.svg'), 'utf8');
    assert(
      !/<(?:text|image)\b|font-family|(?:href|src)=["']https?:/i.test(svg),
      'SVG must be self-contained outlined geometry',
    );
    assert(svg.includes('<path'));
  }
  const ico = await fs.readFile(path.join(dir, 'tutor.ico'));
  assert.equal(ico.readUInt16LE(2), 1);
  assert.equal(ico.readUInt16LE(4), 7);
  for (let i = 0; i < 7; i++) {
    const at = 6 + i * 16,
      offset = ico.readUInt32LE(at + 12),
      bytes = ico.readUInt32LE(at + 8);
    assert(offset + bytes <= ico.length);
    const image = await loadImage(ico.subarray(offset, offset + bytes));
    assert.equal(image.width, ico[at] || 256);
    assert.equal(image.height, ico[at + 1] || 256);
  }
  const icns = await fs.readFile(path.join(dir, 'tutor.icns'));
  assert.equal(icns.toString('ascii', 0, 4), 'icns');
  assert.equal(icns.readUInt32BE(4), icns.length);
  let cursor = 8;
  while (cursor < icns.length) {
    const length = icns.readUInt32BE(cursor + 4);
    assert(length > 8 && cursor + length <= icns.length);
    cursor += length;
  }
  assert.equal(cursor, icns.length);
});
