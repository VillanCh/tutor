const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

function requiredSigningVariables(platform) {
  if (platform === 'darwin')
    return [
      'CSC_LINK',
      'CSC_KEY_PASSWORD',
      'APPLE_ID',
      'APPLE_APP_SPECIFIC_PASSWORD',
      'APPLE_TEAM_ID',
    ];
  if (platform === 'win32')
    return ['CERT_NAME', 'CLIENT_ID', 'CLIENT_SECRET', 'KEY_VAULT_URI', 'TENANT_ID'].map(
      (name) => 'WINDOWS_CODE_SIGN_' + name,
    );
  throw Error('Unsupported signing platform: ' + platform);
}

function validateSigningEnvironment(platform, env = process.env) {
  const missing = requiredSigningVariables(platform).filter((name) => !env[name]?.trim());
  if (missing.length) throw Error('Missing required signing configuration: ' + missing.join(', '));
}

function redact(value, env = process.env) {
  let result = String(value);
  for (const name of [...requiredSigningVariables('darwin'), ...requiredSigningVariables('win32')])
    if (env[name]) result = result.split(env[name]).join('[REDACTED]');
  return result;
}

async function command(binary, args, options = {}) {
  try {
    return await promisify(execFile)(binary, args, {
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
      timeout: 120000,
      ...options,
    });
  } catch (error) {
    // execFile's error.message includes the command and its password arguments.
    throw Error(
      redact(
        `${path.basename(binary)} failed (${error.code}): ${error.stderr || error.stdout || 'No diagnostic output'}`,
      ),
    );
  }
}

function parseMacSignature(output, expectedTeam, requireRuntime = true) {
  const authority = output.match(/^Authority=(Developer ID Application: .+)$/m)?.[1];
  const team = output.match(/^TeamIdentifier=(.+)$/m)?.[1];
  const timestamp = output.match(/^Timestamp=(.+)$/m)?.[1];
  if (
    !authority ||
    !team ||
    team === 'not set' ||
    !timestamp ||
    (expectedTeam && team !== expectedTeam)
  )
    throw Error(
      'A timestamped Developer ID Application signature from the configured Apple team is required',
    );
  if (requireRuntime && !/^CodeDirectory .*flags=.*\(.*runtime.*\)/m.test(output))
    throw Error('Hardened runtime is required');
  return { authority, team, timestamp, hardenedRuntime: requireRuntime };
}

function acceptedNotarization(result) {
  if (result.status !== 'Accepted' || !result.id)
    throw Error(
      'Apple notarization did not succeed: ' +
        (result.status || result.message || 'unknown response'),
    );
  return result.id;
}

async function stapleWithRetry(
  file,
  run = command,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
) {
  for (let attempt = 1; ; attempt++) {
    try {
      await run('xcrun', ['stapler', 'staple', file]);
      await run('xcrun', ['stapler', 'validate', file]);
      return;
    } catch (error) {
      if (attempt >= 5) throw error;
      console.log(
        `Apple ticket stapling attempt ${attempt} failed; retrying in ${attempt * 15}s: ${error.message}`,
      );
      await wait(attempt * 15000);
    }
  }
}

async function notarizeFile(file, suffix) {
  validateSigningEnvironment('darwin');
  const authentication = [
    '--apple-id',
    process.env.APPLE_ID,
    '--password',
    process.env.APPLE_APP_SPECIFIC_PASSWORD,
    '--team-id',
    process.env.APPLE_TEAM_ID,
  ];
  console.log('Submitting signed artifact to Apple notarization: ' + path.basename(file));
  const { stdout } = await command(
    'xcrun',
    [
      'notarytool',
      'submit',
      file,
      ...authentication,
      '--wait',
      '--timeout',
      '30m',
      '--output-format',
      'json',
    ],
    { timeout: 35 * 60000 },
  );
  const result = JSON.parse(stdout);
  await fs.writeFile(
    path.resolve('release', `notarization-darwin-${process.arch}-${suffix}.json`),
    JSON.stringify({ file: path.basename(file), id: result.id, status: result.status }, null, 2),
  );
  if (result.status !== 'Accepted' && result.id) {
    const log = await command('xcrun', ['notarytool', 'log', result.id, ...authentication]);
    console.error(redact(log.stdout));
  }
  acceptedNotarization(result);
}

async function notarizeApplication(app) {
  const archive = path.resolve('release', `notary-upload-${process.arch}.zip`);
  try {
    await command('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', app, archive], {
      timeout: 10 * 60000,
    });
    await notarizeFile(archive, 'app');
    await stapleWithRetry(app);
  } finally {
    await fs.rm(archive, { force: true });
  }
}

async function notarizeDmg(directory) {
  const version = require('../package.json').version;
  const file = path.join(directory, `Tutor-${version}-macOS-${process.arch}.dmg`);
  await notarizeFile(file, 'dmg');
  await stapleWithRetry(file);
}

async function verifySignatures({ resources, executable, artifacts }) {
  if (process.platform === 'darwin') {
    const app = path.resolve(resources, '../..');
    const targets = [
      app,
      path.join(resources, 'tools/ffmpeg'),
      path.join(resources, 'tools/ffprobe'),
    ];
    const unpacked = path.join(resources, 'app.asar.unpacked');
    for (const entry of await fs.readdir(unpacked, { recursive: true }))
      if (entry.endsWith('.node')) targets.push(path.join(unpacked, entry));
    const records = [];
    for (const target of [...targets, ...artifacts.filter((file) => file.endsWith('.dmg'))]) {
      await command('codesign', ['--verify', '--deep', '--strict', target]);
      const { stderr } = await command('codesign', ['--display', '--verbose=4', target]);
      records.push({
        file: path.relative(path.dirname(app), target),
        ...parseMacSignature(stderr, process.env.APPLE_TEAM_ID, !target.endsWith('.dmg')),
      });
    }
    await command('xcrun', ['stapler', 'validate', app]);
    await command('spctl', ['--assess', '--type', 'execute', '--verbose=4', app]);
    for (const file of artifacts.filter((item) => item.endsWith('.dmg')))
      await command('xcrun', ['stapler', 'validate', file]);
    return { verified: true, notarized: true, records };
  }
  if (process.platform === 'win32') {
    const manifest = path.resolve('release/signature-targets.json');
    await fs.writeFile(
      manifest,
      JSON.stringify([executable, ...artifacts.filter((file) => file.endsWith('.exe'))]),
    );
    try {
      const { stdout } = await command('pwsh', [
        '-NoProfile',
        '-NonInteractive',
        '-File',
        path.join(__dirname, 'verify-windows-signatures.ps1'),
        manifest,
      ]);
      const records = JSON.parse(stdout.replace(/^\uFEFF/, '').trim());
      if (
        !Array.isArray(records) ||
        records.length < 2 ||
        records.some((record) => record.status !== 'Valid' || !record.timestampSubject)
      )
        throw Error('Application and installer signatures were not verified');
      return { verified: true, records };
    } finally {
      await fs.rm(manifest, { force: true });
    }
  }
  throw Error('Unsupported signature verification platform');
}

module.exports = {
  requiredSigningVariables,
  validateSigningEnvironment,
  redact,
  parseMacSignature,
  acceptedNotarization,
  stapleWithRetry,
  notarizeApplication,
  notarizeDmg,
  verifySignatures,
};
