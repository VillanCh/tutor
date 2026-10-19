const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const version = require('../package.json').version;
const report = JSON.parse(
  fs.readFileSync(
    path.join('release', 'verification-' + process.platform + '-' + process.arch + '.json'),
    'utf8',
  ),
);
if (!report.passed || report.version !== version || report.signing?.verified !== true)
  throw Error('Passing native runtime and signature verification reports are required');
const files = fs
  .readdirSync('release')
  .filter(
    (name) =>
      (name.startsWith('Tutor-' + version + '-') && /\.(exe|zip|dmg)$/.test(name)) ||
      name === 'verification-' + process.platform + '-' + process.arch + '.json' ||
      name ===
        'SHA256SUMS-' +
          (process.platform === 'darwin' ? 'macOS' : 'windows') +
          '-' +
          process.arch +
          '.txt',
  )
  .map((name) => path.join('release', name));
const result = spawnSync('gh', ['release', 'upload', 'v' + version, ...files, '--clobber'], {
  stdio: 'inherit',
  env: process.env,
});
if (result.error) throw result.error;
process.exitCode = result.status;
