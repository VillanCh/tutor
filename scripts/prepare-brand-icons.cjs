// Creates reviewable assets only. Existing app icons and installed applications are untouched.
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { createCanvas, Path2D, PathOp, SvgExportFlag } = require('@napi-rs/canvas');
const { brandFont, ensureFonts } = require('../src/fonts.cjs');
const ROOT = path.resolve(__dirname, '..');
const PALETTE = { tile: '#101114', border: '#44464D', light: '#F4F2ED', dark: '#101114' };

function markPath() {
  const angle = (-17 * Math.PI) / 180,
    cos = Math.cos(angle),
    sin = Math.sin(angle);
  const rotate = {
    a: cos,
    b: sin,
    c: -sin,
    d: cos,
    e: 28 - cos * 28 + sin * 126,
    f: 126 - sin * 28 - cos * 126,
  };
  const plate = new Path2D();
  plate.roundRect(28, 72, 268, 54, 11);
  const slanted = new Path2D();
  slanted.addPath(plate, rotate);
  const body = new Path2D(
    'M28 123H280Q288 123 288 131V180H198V330Q198 338 190 338H116Q108 338 108 330V180H28Z',
  );
  const stripes = new Path2D('M111 80H151L175 118H135ZM212 80H252L276 118H236Z');
  const holes = new Path2D();
  holes.addPath(stripes, rotate);
  holes.arc(51, 108, 10, 0, Math.PI * 2);
  holes.closePath();
  return slanted.op(body, PathOp.Union).op(holes, PathOp.Difference).simplify();
}

function drawMark(ctx, mark, box, color) {
  const [left, top, right, bottom] = mark.computeTightBounds();
  const scale = Math.min(box.width / (right - left), box.height / (bottom - top));
  ctx.save();
  ctx.translate(
    box.x + (box.width - (right - left) * scale) / 2 - left * scale,
    box.y + (box.height - (bottom - top) * scale) / 2 - top * scale,
  );
  ctx.scale(scale, scale);
  ctx.fillStyle = color;
  ctx.fill(mark);
  ctx.restore();
}

function paintIcon(ctx, size, mark) {
  ctx.save();
  ctx.scale(size / 1024, size / 1024);
  ctx.fillStyle = PALETTE.tile;
  ctx.strokeStyle = PALETTE.border;
  ctx.lineWidth = Math.max(10, (0.7 * 1024) / size);
  ctx.beginPath();
  // Account for the border width so the visible tile retains 12% clear space per side.
  const inset = 1024 * 0.12 + ctx.lineWidth / 2;
  ctx.roundRect(inset, inset, 1024 - inset * 2, 1024 - inset * 2, 172);
  ctx.fill();
  ctx.stroke();
  drawMark(ctx, mark, { x: 232, y: 226, width: 560, height: 572 }, PALETTE.light);
  ctx.restore();
}

function ico(images) {
  const header = Buffer.alloc(6 + images.length * 16);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, bytes }, i) => {
    const at = 6 + i * 16;
    header[at] = size === 256 ? 0 : size;
    header[at + 1] = header[at];
    header.writeUInt16LE(1, at + 4);
    header.writeUInt16LE(32, at + 6);
    header.writeUInt32LE(bytes.length, at + 8);
    header.writeUInt32LE(offset, at + 12);
    offset += bytes.length;
  });
  return Buffer.concat([header, ...images.map((i) => i.bytes)]);
}

function icns(images) {
  const types = [
    [16, 'icp4'],
    [32, 'icp5'],
    [128, 'ic07'],
    [256, 'ic08'],
    [512, 'ic09'],
    [1024, 'ic10'],
    [32, 'ic11'],
    [64, 'ic12'],
    [256, 'ic13'],
    [512, 'ic14'],
  ];
  const chunks = types.map(([size, type]) => {
    const png = images.get(size);
    const head = Buffer.alloc(8);
    head.write(type, 0, 4, 'ascii');
    head.writeUInt32BE(png.length + 8, 4);
    return Buffer.concat([head, png]);
  });
  const header = Buffer.alloc(8);
  header.write('icns', 0, 4, 'ascii');
  header.writeUInt32BE(8 + chunks.reduce((sum, c) => sum + c.length, 0), 4);
  return Buffer.concat([header, ...chunks]);
}

async function prepare(destination = path.join(ROOT, '.tutor/logo-review/03-ready-12pct')) {
  ensureFonts();
  const mark = markPath();
  await fs.mkdir(path.join(destination, 'png'), { recursive: true });
  const vector = createCanvas(1024, 1024, SvgExportFlag.ConvertTextToPaths);
  paintIcon(vector.getContext('2d'), 1024, mark);
  await fs.writeFile(path.join(destination, 'app-icon.svg'), vector.getContent());
  const images = new Map();
  for (const size of [16, 24, 32, 48, 64, 128, 256, 512, 1024]) {
    const canvas = createCanvas(size, size);
    paintIcon(canvas.getContext('2d'), size, mark);
    const bytes = canvas.toBuffer('image/png');
    images.set(size, bytes);
    await fs.writeFile(path.join(destination, 'png', 'tutor-' + size + '.png'), bytes);
  }
  await fs.writeFile(path.join(destination, 'app-icon.png'), images.get(1024));
  await fs.writeFile(
    path.join(destination, 'tutor.ico'),
    ico([16, 24, 32, 48, 64, 128, 256].map((size) => ({ size, bytes: images.get(size) }))),
  );
  await fs.writeFile(path.join(destination, 'tutor.icns'), icns(images));
  const iconset = path.join(destination, 'tutor.iconset');
  await fs.mkdir(iconset, { recursive: true });
  for (const base of [16, 32, 128, 256, 512]) {
    await fs.writeFile(path.join(iconset, 'icon_' + base + 'x' + base + '.png'), images.get(base));
    await fs.writeFile(
      path.join(iconset, 'icon_' + base + 'x' + base + '@2x.png'),
      images.get(base * 2),
    );
  }
  if (process.platform === 'darwin')
    await promisify(execFile)('iconutil', [
      '-c',
      'icns',
      iconset,
      '-o',
      path.join(destination, 'tutor.icns'),
    ]);
  for (const [name, color] of [
    ['light', PALETTE.light],
    ['dark', PALETTE.dark],
  ]) {
    const svg = createCanvas(512, 512, SvgExportFlag.ConvertTextToPaths);
    drawMark(svg.getContext('2d'), mark, { x: 72, y: 62, width: 368, height: 388 }, color);
    await fs.writeFile(path.join(destination, 'mark-' + name + '.svg'), svg.getContent());
    const canvas = createCanvas(512, 512);
    drawMark(canvas.getContext('2d'), mark, { x: 72, y: 62, width: 368, height: 388 }, color);
    await fs.writeFile(
      path.join(destination, 'mark-' + name + '.png'),
      canvas.toBuffer('image/png'),
    );
    const paintWordmark = (ctx) => {
      drawMark(ctx, mark, { x: 48, y: 44, width: 172, height: 212 }, color);
      ctx.font = brandFont(108);
      ctx.fillStyle = color;
      ctx.textBaseline = 'alphabetic';
      ctx.fillText('Tutor', 258, 194);
    };
    const wordmark = createCanvas(640, 300, SvgExportFlag.ConvertTextToPaths);
    paintWordmark(wordmark.getContext('2d'));
    await fs.writeFile(path.join(destination, 'wordmark-' + name + '.svg'), wordmark.getContent());
    const raster = createCanvas(640, 300);
    paintWordmark(raster.getContext('2d'));
    await fs.writeFile(
      path.join(destination, 'wordmark-' + name + '.png'),
      raster.toBuffer('image/png'),
    );
  }
  await fs.writeFile(
    path.join(destination, 'manifest.json'),
    JSON.stringify(
      {
        concept: '03 / clapperboard T',
        palette: PALETTE,
        canvas: 1024,
        transparentMarginPerSide: 0.12,
        tile: { x: 127.88, y: 127.88, width: 768.24, height: 768.24, radius: 172 },
        markSafeBox: { x: 232, y: 226, width: 560, height: 572 },
        sizes: [...images.keys()],
        svgText: 'outlined paths; no font dependency',
        status: 'awaiting visual approval; not installed',
      },
      null,
      2,
    ),
  );
  return destination;
}
if (require.main === module)
  prepare(process.argv[2] ? path.resolve(process.argv[2]) : undefined)
    .then((dir) => console.log(dir))
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
module.exports = { prepare, markPath, paintIcon, drawMark, PALETTE, ico, icns };
