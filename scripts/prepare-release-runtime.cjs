const fs = require('node:fs/promises');
const nativeFs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { pipeline } = require('node:stream/promises');
const { createGunzip } = require('node:zlib');
const manifest = require('./release-runtime.json');
const root = path.resolve(__dirname, '..');
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function checksum(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of nativeFs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

function validateManifest(platform, electronVersion, ffmpegVersion, checksums) {
  if (
    electronVersion !== manifest.electronVersion ||
    ffmpegVersion !== manifest.ffmpegStaticVersion
  )
    throw Error('Native dependency versions changed; update the verified release runtime manifest');
  const selected = manifest.platforms[platform];
  if (!selected) throw Error('Unsupported release runtime platform: ' + platform);
  if (checksums[selected.electron.name] !== selected.electron.sha256)
    throw Error('Electron checksum differs from the pinned npm package');
  for (const asset of Object.values(selected)) {
    if (
      !Number.isSafeInteger(asset.id) ||
      asset.id <= 0 ||
      !/^[a-zA-Z0-9_.-]+$/.test(asset.name) ||
      !/^[a-f0-9]{64}$/.test(asset.sha256)
    )
      throw Error('Invalid native asset manifest');
  }
  return selected;
}

async function download(repo, asset, cache, command = 'gh') {
  const file = path.join(cache, asset.name);
  try {
    if ((await checksum(file)) === asset.sha256) return file;
  } catch {}
  let failure;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const temporary = file + '.partial';
    try {
      await new Promise((resolve, reject) => {
        const output = nativeFs.openSync(temporary, 'w');
        const child = spawn(
          command,
          [
            'api',
            'repos/' + repo + '/releases/assets/' + asset.id,
            '-H',
            'Accept: application/octet-stream',
          ],
          {
            stdio: ['ignore', output, 'pipe'],
            windowsHide: true,
          },
        );
        nativeFs.closeSync(output);
        let stderr = '';
        const timer = setTimeout(() => child.kill(), 180000);
        child.stderr.on('data', (chunk) => {
          stderr = (stderr + chunk).slice(-2000);
        });
        child.on('error', (error) => {
          clearTimeout(timer);
          reject(error);
        });
        child.on('close', (code) => {
          clearTimeout(timer);
          code === 0
            ? resolve()
            : reject(Error('Official asset download failed: ' + asset.name + ': ' + stderr));
        });
      });
      if ((await checksum(temporary)) !== asset.sha256)
        throw Error('Native asset checksum mismatch: ' + asset.name);
      await fs.rename(temporary, file);
      console.log('Verified official asset: ' + asset.name);
      return file;
    } catch (error) {
      failure = error;
      await fs.rm(temporary, { force: true });
      if (attempt < 3) await pause(3000);
    }
  }
  throw failure;
}

async function prepare({ downloadOnly = false } = {}) {
  const electron = require('../node_modules/electron/package.json');
  const ffmpeg = require('../node_modules/ffmpeg-static/package.json');
  const selected = validateManifest(
    process.platform + '-' + process.arch,
    electron.version,
    ffmpeg.version,
    require('../node_modules/electron/checksums.json'),
  );
  const cache = path.join(root, 'build/generated/native-runtime');
  await fs.mkdir(cache, { recursive: true });
  const files = {};
  for (const [key, asset] of Object.entries(selected))
    files[key] = await download(
      key === 'electron' ? 'electron/electron' : 'eugeneware/ffmpeg-static',
      asset,
      cache,
      process.env.TUTOR_GH_PATH || 'gh',
    );
  if (downloadOnly) return files;
  const dist = path.join(root, 'node_modules/electron/dist');
  await require('@electron-internal/extract-zip').extract(files.electron, { dir: dist });
  const runtimeVersion = (await fs.readFile(path.join(dist, 'version'), 'utf8'))
    .trim()
    .replace(/^v/, '');
  if (runtimeVersion !== electron.version) throw Error('Extracted Electron version mismatch');
  const runtimePath =
    process.platform === 'win32' ? 'electron.exe' : 'Electron.app/Contents/MacOS/Electron';
  await fs.access(path.join(dist, runtimePath));
  await fs.writeFile(path.join(root, 'node_modules/electron/path.txt'), runtimePath);
  const binary = path.join(
    root,
    'node_modules/ffmpeg-static/ffmpeg' + (process.platform === 'win32' ? '.exe' : ''),
  );
  await pipeline(
    nativeFs.createReadStream(files.ffmpeg),
    createGunzip(),
    nativeFs.createWriteStream(binary),
  );
  if (process.platform !== 'win32') await fs.chmod(binary, 0o755);
  await fs.copyFile(files.license, binary + '.LICENSE');
  await fs.copyFile(files.readme, binary + '.README');
  console.log('Prepared verified release runtime: ' + process.platform + '-' + process.arch);
  return files;
}

if (require.main === module)
  prepare({ downloadOnly: process.argv.includes('--download-only') }).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
module.exports = { validateManifest, checksum, download, prepare };
