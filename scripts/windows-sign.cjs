const path = require('node:path');
const { spawn } = require('node:child_process');
const { validateSigningEnvironment } = require('./signing.cjs');
module.exports = async ({ path: file }) => {
  validateSigningEnvironment('win32');
  if (!file) throw Error('Signing target is missing');
  await new Promise((resolve, reject) => {
    const child = spawn(
      'pwsh',
      ['-NoProfile', '-NonInteractive', '-File', path.join(__dirname, 'windows-sign.ps1'), file],
      { windowsHide: true, stdio: 'inherit' },
    );
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0
        ? resolve()
        : reject(Error('Azure Key Vault signing failed (' + code + '): ' + path.basename(file))),
    );
  });
};
