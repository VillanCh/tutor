const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const version = require('../package.json').version;
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
async function mediaTools() {
  const dir = path.join(root, 'build/generated/tools');
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
  const sources =
    process.platform === 'darwin'
      ? [
          path.join(root, 'build/generated/mac-media/' + process.arch + '/ffmpeg'),
          path.join(root, 'build/generated/mac-media/' + process.arch + '/ffprobe'),
        ]
      : [require('ffmpeg-static'), require('ffprobe-static').path];
  const records = [];
  for (const source of sources) {
    const destination = path.join(dir, path.basename(source));
    await fs.copyFile(source, destination);
    if (process.platform !== 'win32') await fs.chmod(destination, 0o755);
    const { stdout, stderr } = await promisify(execFile)(destination, ['-version']);
    const output = stdout + stderr;
    if (output.includes('--enable-nonfree'))
      throw Error('Media binary is not redistributable: ' + source);
    records.push({ file: path.basename(destination), version: output });
  }
  const noticeSource =
    process.platform === 'darwin' ? path.dirname(sources[0]) : path.dirname(sources[0]);
  for (const file of await fs.readdir(noticeSource))
    if (/LICENSE|README|COPYING|build-info/.test(file))
      await fs.copyFile(path.join(noticeSource, file), path.join(dir, file));
  await fs.writeFile(path.join(dir, 'versions.json'), JSON.stringify(records, null, 2));
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
      'Tutor launches FFmpeg and FFprobe as separate processes. Their licenses are separate from the Tutor MIT business-code license.',
      'Exact binary versions and configuration: resources/tools/versions.json.',
      'macOS: FFmpeg 6.1.1 and static x264 (31e19f92f00c7003fa115047ce50978bc98c3a0d), GPL-3.0-or-later, built without nonfree components.',
      'macOS build recipe and flags: resources/tools/build-info.json and scripts/build-mac-media.cjs in the tagged Tutor source.',
      'Windows: FFmpeg 6.1.1 essentials from gyan.dev and FFprobe 4.0.2 supplied by ffprobe-static; binaries unmodified.',
      'Windows build configuration/external libraries: resources/tools/ffmpeg.exe.README; sources: https://www.gyan.dev/ffmpeg/builds/ and https://github.com/joshwnj/ffprobe-static.',
      'FFmpeg and x264 source archives are supplied with this Tutor GitHub Release.',
      'FFmpeg source: https://ffmpeg.org/releases/ffmpeg-6.1.1.tar.xz and https://github.com/FFmpeg/FFmpeg/archive/refs/tags/n4.0.2.tar.gz',
      'x264 source: https://github.com/mirror/x264/tree/31e19f92f00c7003fa115047ce50978bc98c3a0d',
    ].join('\n') + '\n',
  );
}

function packagePaths() {
  const base =
    process.platform === 'darwin'
      ? path.join(
          root,
          'release',
          process.arch === 'arm64' ? 'mac-arm64' : 'mac',
          'Tutor.app',
          'Contents',
        )
      : path.join(root, 'release', 'win-unpacked');
  return {
    resources: path.join(base, process.platform === 'darwin' ? 'Resources' : 'resources'),
    executable: path.join(base, process.platform === 'darwin' ? 'MacOS/Tutor' : 'Tutor.exe'),
  };
}
async function verify() {
  const { resources, executable } = packagePaths();
  const { listPackage } = require('@electron/asar');
  const entries = listPackage(path.join(resources, 'app.asar'));
  const forbidden = entries.filter((entry) =>
    /[/\\](\.env[^/\\]*|credentials[^/\\]*|\.agents|\.claude)([/\\]|$)|[/\\]src[/\\]ui[/\\]vendor([/\\]|$)|\.map$|[/\\]ffmpeg-static([/\\]|$)|[/\\]ffprobe-static([/\\]|$)/i.test(
      entry,
    ),
  );
  if (forbidden.length) throw Error('Unexpected packaged files: ' + forbidden.join(', '));
  for (const file of [
    'src/main.cjs',
    'src/smoke.cjs',
    'dist/ui/index.html',
    'build/tutor.png',
    'build/fonts/NotoSansCJKsc-Regular.otf',
    'build/fonts/SpaceGrotesk-Variable.ttf',
  ])
    if (!entries.some((entry) => entry.replaceAll('\\', '/').endsWith('/' + file)))
      throw Error('Missing packaged file: ' + file);
  for (const file of ['ffmpeg', 'ffprobe'])
    await fs.access(
      path.join(resources, 'tools', file + (process.platform === 'win32' ? '.exe' : '')),
    );
  await fs.access(path.join(resources, 'licenses/MEDIA-NOTICE.txt'));
  const report = path.join(
    root,
    'release',
    'verification-' + process.platform + '-' + process.arch + '.json',
  );
  await fs.rm(report, { force: true });
  await new Promise((resolve, reject) => {
    const child = spawn(executable, ['--smoke-test', report], {
      stdio: 'inherit',
      env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1' },
    });
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(Error('Packaged smoke test failed: ' + code)),
    );
  });
  const verification = JSON.parse(await fs.readFile(report, 'utf8'));
  if (!verification.passed || verification.version !== version)
    throw Error('Invalid smoke-test report');
  verification.sourceCommit = (
    await promisify(execFile)('git', ['rev-parse', 'HEAD'], { cwd: root })
  ).stdout.trim();
  verification.frontendAssets = {};
  const { extractFile } = require('@electron/asar');
  for (const entry of entries.filter((entry) =>
    /[/\\]dist[/\\]ui[/\\]assets[/\\].*\.(js|css|svg)$/.test(entry),
  )) {
    const relative = entry.replaceAll('\\', '/').replace(/^\//, '');
    verification.frontendAssets[path.basename(relative)] = crypto
      .createHash('sha256')
      .update(extractFile(path.join(resources, 'app.asar'), relative.split('/').join(path.sep)))
      .digest('hex');
  }
  await fs.writeFile(report, JSON.stringify(verification, null, 2));
  const platform = process.platform === 'darwin' ? 'macOS' : 'windows';
  const files = (await fs.readdir(path.join(root, 'release')))
    .filter(
      (file) =>
        file.startsWith('Tutor-' + version + '-' + platform + '-' + process.arch + '-') ||
        file.startsWith('Tutor-' + version + '-' + platform + '-' + process.arch + '.'),
    )
    .filter((file) => /\.(exe|zip|dmg)$/.test(file));
  if (files.length !== 2)
    throw Error('Expected two platform distribution artifacts; got ' + files.length);
  const sums = [];
  for (const file of files) {
    const hash = crypto.createHash('sha256');
    for await (const chunk of require('node:fs').createReadStream(path.join(root, 'release', file)))
      hash.update(chunk);
    sums.push(hash.digest('hex') + '  ' + file);
  }
  await fs.writeFile(
    path.join(root, 'release', 'SHA256SUMS-' + platform + '-' + process.arch + '.txt'),
    sums.join('\n') + '\n',
  );
  console.log(
    'Verified native package: UI, fonts, canvas, media render/decode, silence gaps, document import; no keys or licensed source.',
  );
}
(async () => {
  if (process.argv.includes('--verify-only')) return verify();
  if (
    !['win32', 'darwin'].includes(process.platform) ||
    (process.platform === 'win32' && process.arch !== 'x64')
  )
    throw Error('Build on the corresponding native macOS or Windows x64 host');
  for (const file of ['tutor.png', 'tutor.svg', 'tutor.ico', 'tutor.icns'])
    await fs.access(path.join(root, 'build', file));
  if (process.platform === 'darwin') await run('scripts/build-mac-media.cjs');
  await mediaTools();
  await licenses();
  if (process.argv.includes('--prebuilt-ui'))
    await fs.access(path.join(root, 'dist/ui/index.html'));
  else {
    await fs.access(path.join(root, 'src/ui/vendor/tutor/ai-chat-2.jsx'));
    await run('node_modules/vite/bin/vite.js', ['build']);
  }
  await run(
    'node_modules/electron-builder/cli.js',
    [
      '--config',
      'electron-builder.config.cjs',
      process.platform === 'darwin' ? '--mac' : '--win',
      '--' + process.arch,
      '--publish',
      'never',
    ],
    { CSC_IDENTITY_AUTO_DISCOVERY: 'false' },
  );
  await verify();
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
