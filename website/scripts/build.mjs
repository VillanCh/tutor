import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const out = path.join(root, 'dist');
let release = JSON.parse(await readFile(path.join(root, 'release.json'), 'utf8'));

if (process.argv.includes('--refresh-release')) {
  const response = await fetch('https://api.github.com/repos/VillanCh/tutor/releases/latest', {
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
    },
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`Cannot read latest release: HTTP ${response.status}`);
  const latest = await response.json();
  if (latest.draft || latest.prerelease) throw new Error('A public stable release is required');
  release = {
    version: latest.tag_name.replace(/^v/, ''),
    url: latest.html_url,
    publishedAt: latest.published_at,
    assets: latest.assets.map(({ name, browser_download_url }) => ({
      name,
      url: browser_download_url,
    })),
  };
}

if (!/^\d+\.\d+\.\d+(?:[-.][\w.-]+)?$/.test(release.version))
  throw new Error('Invalid release version');
if (!/^https:\/\/github\.com\/VillanCh\/tutor\/releases\/tag\//.test(release.url))
  throw new Error('Invalid release URL');
const asset = (suffix) => {
  const name = `Tutor-${release.version}-${suffix}`;
  const found = release.assets.find((item) => item.name === name);
  if (!found || !found.url.startsWith('https://github.com/VillanCh/tutor/releases/download/')) {
    throw new Error(`Missing published download: ${name}`);
  }
  return found.url;
};
const checksum = release.assets.find((item) => item.name === 'SHA256SUMS.txt');
if (!checksum?.url.startsWith('https://github.com/VillanCh/tutor/releases/download/'))
  throw new Error('Missing checksums');
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const published = new Date(release.publishedAt);
if (!Number.isFinite(published.getTime())) throw new Error('Invalid release date');
const replacements = {
  COMMIT: commit,
  VERSION: release.version,
  RELEASE_URL: release.url,
  RELEASE_DATE: new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(published),
  YEAR: new Intl.DateTimeFormat('en', { timeZone: 'Asia/Shanghai', year: 'numeric' }).format(
    new Date(),
  ),
  MAC_ARM_URL: asset('macOS-arm64.dmg'),
  MAC_ARM_ZIP_URL: asset('macOS-arm64.zip'),
  MAC_INTEL_URL: asset('macOS-x64.dmg'),
  MAC_INTEL_ZIP_URL: asset('macOS-x64.zip'),
  WINDOWS_URL: asset('windows-x64-setup.exe'),
  WINDOWS_ZIP_URL: asset('windows-x64-portable.zip'),
  CHECKSUM_URL: checksum.url,
};
const escapeHtml = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
  );
const template = await readFile(path.join(root, 'index.html'), 'utf8');
const html = template.replace(/\{\{([A-Z_]+)\}\}/g, (_, key) => {
  if (!(key in replacements)) throw new Error(`Unknown template value: ${key}`);
  return escapeHtml(replacements[key]);
});
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await Promise.all([
  writeFile(path.join(out, 'index.html'), html),
  cp(path.join(root, 'styles.css'), path.join(out, 'styles.css')),
  cp(path.join(root, 'app.js'), path.join(out, 'app.js')),
  cp(path.join(root, 'assets'), path.join(out, 'assets'), { recursive: true }),
  writeFile(
    path.join(out, 'build.json'),
    JSON.stringify({ commit, version: release.version, release: release.url }, null, 2) + '\n',
  ),
  writeFile(path.join(out, '.nojekyll'), ''),
  writeFile(
    path.join(out, 'robots.txt'),
    'User-agent: *\nAllow: /\nSitemap: https://villanch.github.io/tutor/sitemap.xml\n',
  ),
  writeFile(
    path.join(out, 'sitemap.xml'),
    '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://villanch.github.io/tutor/</loc></url></urlset>\n',
  ),
]);
console.log(`Built Tutor website for v${release.version} (${commit.slice(0, 7)})`);
