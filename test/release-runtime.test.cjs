const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { validateManifest, download } = require('../scripts/prepare-release-runtime.cjs');
const manifest = require('../scripts/release-runtime.json');
const electron = require('electron/package.json');
const ffmpeg = require('ffmpeg-static/package.json');
const checksums = require('electron/checksums.json');

test('native release manifests match the pinned Electron package and reject dependency or checksum drift', () => {
  for (const platform of ['win32-x64', 'darwin-x64', 'darwin-arm64']) {
    const selected = validateManifest(platform, electron.version, ffmpeg.version, checksums);
    assert.equal(selected.electron.sha256, checksums[selected.electron.name]);
    assert(selected.ffmpeg.name.includes(platform));
    assert(selected.license.name.startsWith(platform));
    assert(selected.readme.name.startsWith(platform));
    assert.throws(
      () => validateManifest(platform, 'unverified-version', ffmpeg.version, checksums),
      /versions changed/,
    );
    assert.throws(
      () => validateManifest(platform, electron.version, ffmpeg.version, {}),
      /checksum differs/,
    );
  }
  assert.equal(manifest.electronVersion, electron.version);
  assert.throws(
    () => validateManifest('unsupported', electron.version, ffmpeg.version, checksums),
    /Unsupported/,
  );
});

test('runtime download cache is reused only after hash verification and corrupt bytes cannot be accepted', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tutor-native-cache-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const bytes = Buffer.from('verified native release asset\0\r\n', 'utf8');
  const asset = {
    id: 1,
    name: 'runtime.zip',
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  };
  const target = path.join(dir, asset.name);
  await fs.writeFile(target, bytes);
  assert.equal(
    await download('electron/electron', asset, dir, 'tutor-nonexistent-download-command'),
    target,
  );
  await fs.writeFile(target, 'corrupt cache');
  await assert.rejects(
    download('electron/electron', asset, dir, 'tutor-nonexistent-download-command'),
    /ENOENT|not found/,
  );
  assert.deepEqual(await fs.readdir(dir), ['runtime.zip']);
  assert.equal(await fs.readFile(target, 'utf8'), 'corrupt cache');
});
