const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const commit = '31e19f92f00c7003fa115047ce50978bc98c3a0d';
const sources = [
  {
    name: 'ffmpeg-6.1.1-source.tar.xz',
    url: 'https://ffmpeg.org/releases/ffmpeg-6.1.1.tar.xz',
    expectedSha256: '8684f4b00f94b85461884c3719382f1261f0d9eb3d59640a1f4ac0873616f968',
  },
  {
    name: 'x264-' + commit + '-source.tar.gz',
    url: 'https://codeload.github.com/mirror/x264/tar.gz/' + commit,
    expectedSha256: 'd053c9d86988d6bc78237ca5205865c5ddf99c98ef4cd9927eec8f6d388f6dd9',
  },
];
async function build() {
  if (process.platform !== 'darwin') throw Error('macOS media build requires macOS');
  const output = path.join(root, 'build/generated/mac-media', process.arch);
  try {
    const info = JSON.parse(await fs.readFile(path.join(output, 'build-info.json'), 'utf8'));
    if (
      info.recipe === 2 &&
      info.x264Commit === commit &&
      info.ffmpegVersion === '6.1.1' &&
      info.arch === process.arch
    ) {
      await fs.access(path.join(output, 'ffmpeg'));
      await fs.access(path.join(output, 'ffprobe'));
      return console.log('Using verified macOS media build: ' + process.arch);
    }
  } catch {}
  await fs.mkdir(output, { recursive: true });
  const archives = path.join(root, 'build/generated/media-sources');
  const work = path.join(root, 'build/generated/media-build', process.arch);
  const prefix = path.join(work, 'prefix');
  await fs.mkdir(archives, { recursive: true });
  await fs.mkdir(prefix, { recursive: true });
  const environment = {
    ...process.env,
    PATH: '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:' + process.env.PATH,
    PKG_CONFIG_PATH: path.join(prefix, 'lib/pkgconfig'),
    MACOSX_DEPLOYMENT_TARGET: '11.0',
  };
  const run = (command, args, cwd = work) =>
    new Promise((resolve, reject) => {
      const child = spawn(command, args, { cwd, env: environment, stdio: 'inherit' });
      child.on('error', reject);
      child.on('exit', (code) =>
        code === 0 ? resolve() : reject(Error(command + ' failed: ' + code)),
      );
    });
  for (const source of sources) {
    const archive = path.join(archives, source.name);
    let bytes;
    try {
      bytes = await fs.readFile(archive);
    } catch {
      const response = await fetch(source.url);
      if (!response.ok) throw Error('Source download failed: ' + response.status);
      bytes = Buffer.from(await response.arrayBuffer());
      await fs.writeFile(archive, bytes);
    }
    source.sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
    if (source.sha256 !== source.expectedSha256)
      throw Error('Unexpected source archive: ' + source.name);
    const dir = path.join(work, source.name.startsWith('ffmpeg') ? 'ffmpeg' : 'x264');
    await fs.mkdir(dir, { recursive: true });
    await run('tar', ['xf', archive, '-C', dir, '--strip-components=1']);
  }
  const jobs = String(Math.min(8, os.availableParallelism()));
  const x264 = path.join(work, 'x264');
  const x264Flags = [
    '--prefix=' + prefix,
    '--enable-static',
    '--disable-cli',
    '--disable-opencl',
    '--extra-cflags=-mmacosx-version-min=11.0',
  ];
  if (process.arch === 'x64') x264Flags.push('--disable-asm');
  await run('./configure', x264Flags, x264);
  await run('make', ['-j' + jobs], x264);
  await run('make', ['install'], x264);
  const ffmpeg = path.join(work, 'ffmpeg');
  const ffmpegFlags = [
    '--prefix=' + prefix,
    '--cc=/usr/bin/clang',
    '--disable-autodetect',
    '--enable-gpl',
    '--enable-version3',
    '--enable-libx264',
    '--enable-zlib',
    '--disable-shared',
    '--enable-static',
    '--disable-doc',
    '--disable-debug',
    '--disable-ffplay',
    '--disable-x86asm',
    '--extra-cflags=-mmacosx-version-min=11.0',
    '--extra-ldflags=-mmacosx-version-min=11.0',
  ];
  await run('./configure', ffmpegFlags, ffmpeg);
  await run('make', ['-j' + jobs, 'ffmpeg', 'ffprobe'], ffmpeg);
  for (const name of ['ffmpeg', 'ffprobe']) {
    await fs.copyFile(path.join(ffmpeg, name), path.join(output, name));
    await fs.chmod(path.join(output, name), 0o755);
  }
  await fs.copyFile(path.join(ffmpeg, 'COPYING.GPLv3'), path.join(output, 'FFmpeg-LICENSE.txt'));
  await fs.copyFile(path.join(x264, 'COPYING'), path.join(output, 'x264-LICENSE.txt'));
  await fs.writeFile(
    path.join(output, 'build-info.json'),
    JSON.stringify(
      {
        recipe: 2,
        ffmpegVersion: '6.1.1',
        x264Commit: commit,
        arch: process.arch,
        deploymentTarget: '11.0',
        x264Flags,
        ffmpegFlags,
        sources,
      },
      null,
      2,
    ),
  );
  console.log('Built portable GPL macOS media tools: ' + output);
}
build().catch((error) => {
  console.error(error.stack);
  process.exitCode = 1;
});
