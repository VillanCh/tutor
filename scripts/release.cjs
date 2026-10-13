const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { createCanvas } = require('@napi-rs/canvas');
const root = path.resolve(__dirname, '..');
async function run(script, args = [], env = {}) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, script), ...args], {
      cwd: root,
      windowsHide: true,
      stdio: 'inherit',
      env: { ...process.env, ...env },
    });
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(Error(script + ' failed: ' + code)),
    );
  });
}
async function icon() {
  const canvas = createCanvas(256, 256),
    ctx = canvas.getContext('2d');
  ctx.fillStyle = '#14161c';
  ctx.beginPath();
  ctx.roundRect(0, 0, 256, 256, 46);
  ctx.fill();
  ctx.strokeStyle = '#e8ebf0';
  ctx.lineWidth = 12;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.roundRect(57, 112, 142, 91, 14);
  ctx.stroke();
  ctx.save();
  ctx.translate(57, 100);
  ctx.rotate(-0.14);
  ctx.fillStyle = '#e8ebf0';
  ctx.fillRect(0, -31, 142, 31);
  ctx.strokeStyle = '#14161c';
  ctx.lineWidth = 13;
  for (const x of [25, 65, 105]) {
    ctx.beginPath();
    ctx.moveTo(x, -31);
    ctx.lineTo(x - 17, 0);
    ctx.stroke();
  }
  ctx.restore();
  ctx.fillStyle = '#c792ea';
  ctx.beginPath();
  ctx.moveTo(112, 139);
  ctx.lineTo(143, 157);
  ctx.lineTo(112, 175);
  ctx.closePath();
  ctx.fill();
  const png = canvas.toBuffer('image/png');
  await fs.mkdir(path.join(root, 'build'), { recursive: true });
  await fs.writeFile(path.join(root, 'build/tutor.png'), png);
  const header = Buffer.alloc(22);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  header.writeUInt16LE(1, 10);
  header.writeUInt16LE(32, 12);
  header.writeUInt32LE(png.length, 14);
  header.writeUInt32LE(22, 18);
  await fs.writeFile(path.join(root, 'build/tutor.ico'), Buffer.concat([header, png]));
}
async function licenses() {
  const dir = path.join(root, 'build/generated/licenses');
  await fs.mkdir(dir, { recursive: true });
  const lock = JSON.parse(await fs.readFile(path.join(root, 'package-lock.json'), 'utf8'));
  const records = [];
  for (const [folder, info] of Object.entries(lock.packages)) {
    if (!folder || info.dev || ['ffmpeg-static', 'ffprobe-static'].includes(path.basename(folder)))
      continue;
    const packageDir = path.join(root, folder);
    let entries;
    try {
      entries = await fs.readdir(packageDir);
    } catch {
      continue;
    }
    const files = entries.filter((name) =>
      /^(license|licence|copying|copyright|notice|ofl)(\.|$|-)/i.test(name),
    );
    const name = info.name || folder.split('node_modules/').at(-1);
    const target = path.join(dir, name.replaceAll('/', '_') + '-' + info.version);
    await fs.mkdir(target, { recursive: true });
    for (const file of files)
      if ((await fs.stat(path.join(packageDir, file))).isFile())
        await fs.copyFile(path.join(packageDir, file), path.join(target, file));
    records.push({ name, version: info.version, license: info.license || null, files });
  }
  await fs.writeFile(path.join(dir, 'packages.json'), JSON.stringify(records, null, 2));
  await fs.copyFile(path.join(root, 'THIRD_PARTY.md'), path.join(dir, 'THIRD_PARTY.md'));
  await fs.writeFile(
    path.join(dir, 'MEDIA-NOTICE.txt'),
    [
      'Tutor launches unmodified FFmpeg and FFprobe as separate processes.',
      'The media executables are GPL-3.0-or-later; this is separate from the Tutor business-code license.',
      'FFmpeg: 6.1.1 essentials, gyan.dev; source commit e38092ef93.',
      'Source: https://github.com/FFmpeg/FFmpeg/archive/refs/tags/n6.1.1.tar.gz',
      'Build configuration and external-library versions: resources/tools/ffmpeg.exe.README',
      'Build provider and external-library source links: https://www.gyan.dev/ffmpeg/builds/',
      'FFprobe: 4.0.2, supplied by ffprobe-static 3.1.0 (Zeranoe build).',
      'Source: https://github.com/FFmpeg/FFmpeg/archive/refs/tags/n4.0.2.tar.gz',
      'Original package: https://github.com/joshwnj/ffprobe-static',
      'License text: resources/tools/ffmpeg.exe.LICENSE',
      'No modifications to either executable were made by Tutor.',
      'The FFmpeg source archives are offered with the binary downloads on the Tutor release page.',
    ].join('\n') + '\n',
  );
}
async function verify() {
  const { listPackage } = require('@electron/asar');
  const entries = listPackage(path.join(root, 'release/win-unpacked/resources/app.asar'));
  const forbidden = entries.filter((entry) =>
    /[/\\](\.env[^/\\]*|credentials[^/\\]*|\.agents|\.claude)([/\\]|$)|[/\\]src[/\\]ui[/\\]vendor([/\\]|$)|\.map$|[/\\]ffmpeg-static([/\\]|$)|[/\\]ffprobe-static([/\\]|$)/i.test(
      entry,
    ),
  );
  if (forbidden.length) throw Error('Unexpected packaged files: ' + forbidden.join(', '));
  for (const file of ['src/main.cjs', 'src/smoke.cjs', 'dist/ui/index.html'])
    if (!entries.some((entry) => entry.replaceAll('\\', '/').endsWith('/' + file)))
      throw Error('Missing packaged file: ' + file);
  for (const file of ['tools/ffmpeg.exe', 'tools/ffprobe.exe', 'licenses/MEDIA-NOTICE.txt'])
    await fs.access(path.join(root, 'release/win-unpacked/resources', file));
  const files = (await fs.readdir(path.join(root, 'release'))).filter((file) =>
    /^Tutor-.*\.(exe|zip)$/.test(file),
  );
  if (files.length !== 2) throw Error('Expected installer and portable ZIP');
  const sums = [];
  for (const file of files) {
    const hash = crypto.createHash('sha256');
    for await (const chunk of require('node:fs').createReadStream(path.join(root, 'release', file)))
      hash.update(chunk);
    sums.push(hash.digest('hex') + '  ' + file);
  }
  await fs.writeFile(path.join(root, 'release/SHA256SUMS.txt'), sums.join('\n') + '\n');
  console.log(
    'Verified packaged contents: compiled UI, native modules, media tools; no keys or licensed source.',
  );
}
(async () => {
  if (process.argv.includes('--verify-only')) return verify();
  if (process.platform !== 'win32' || process.arch !== 'x64')
    throw Error('Build Windows x64 on a Windows x64 host');
  await fs.access(path.join(root, 'src/ui/vendor/tutor/ai-chat-2.jsx'));
  await icon();
  await licenses();
  await run('node_modules/vite/bin/vite.js', ['build']);
  await run(
    'node_modules/electron-builder/cli.js',
    ['--config', 'electron-builder.config.cjs', '--win', '--x64', '--publish', 'never'],
    { CSC_IDENTITY_AUTO_DISCOVERY: 'false' },
  );
  await verify();
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
