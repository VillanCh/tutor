const path = require('node:path');
const fs = require('node:fs/promises');
const { notarizeApplication } = require('./signing.cjs');

module.exports = async (context) => {
  if (context.electronPlatformName !== 'darwin') return;
  const app = path.join(context.appOutDir, context.packager.appInfo.productFilename + '.app');
  await fs.access(app);
  await notarizeApplication(app);
};
