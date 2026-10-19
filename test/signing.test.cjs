const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  validateSigningEnvironment,
  parseMacSignature,
  acceptedNotarization,
  redact,
} = require('../scripts/signing.cjs');

test('signed release fails closed on incomplete credentials without printing secret values', () => {
  assert.throws(
    () => validateSigningEnvironment('darwin', { CSC_LINK: 'private-certificate' }),
    (error) =>
      error.message.includes('APPLE_TEAM_ID') && !error.message.includes('private-certificate'),
  );
  assert.throws(() => validateSigningEnvironment('win32', {}), /WINDOWS_CODE_SIGN_CLIENT_SECRET/);
});

const signed = `CodeDirectory v=20500 size=100 flags=0x10000(runtime) hashes=1+1 location=embedded
Authority=Developer ID Application: Example (TEAM123456)
Authority=Developer ID Certification Authority
Timestamp=Oct 19, 2026 at 12:00:00
TeamIdentifier=TEAM123456`;

test('Mac verification rejects ad hoc signatures, wrong teams and absent timestamps', () => {
  assert.equal(parseMacSignature(signed, 'TEAM123456').team, 'TEAM123456');
  assert.throws(() => parseMacSignature('Signature=adhoc\nTeamIdentifier=not set'), /Developer ID/);
  assert.throws(() => parseMacSignature(signed, 'OTHERTEAM'), /Developer ID/);
  assert.throws(() => parseMacSignature(signed.replace(/^Timestamp=.*\n/m, '')), /Developer ID/);
  assert.throws(
    () => parseMacSignature(signed.replace('0x10000(runtime)', '0x0(none)')),
    /Hardened runtime/,
  );
  assert.equal(
    parseMacSignature(signed.replace('0x10000(runtime)', '0x0(none)'), 'TEAM123456', false)
      .hardenedRuntime,
    false,
  );
});

test('Apple notarization must be accepted, not merely submitted', () => {
  assert.equal(acceptedNotarization({ id: 'submission', status: 'Accepted' }), 'submission');
  for (const status of ['In Progress', 'Invalid', 'Rejected', undefined])
    assert.throws(() => acceptedNotarization({ id: 'submission', status }), /did not succeed/);
  assert.throws(() => acceptedNotarization({ status: 'Accepted' }), /did not succeed/);
});

test('signing diagnostics redact repeated passwords and certificate material', () => {
  assert.equal(
    redact('pw=pw certificate', { APPLE_APP_SPECIFIC_PASSWORD: 'pw', CSC_LINK: 'certificate' }),
    '[REDACTED]=[REDACTED] [REDACTED]',
  );
});
