import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../dist/', import.meta.url));
const urlIndex = process.argv.indexOf('--url');
const baseUrl = urlIndex >= 0 ? process.argv[urlIndex + 1] : null;
if (urlIndex >= 0 && !baseUrl) throw new Error('--url requires a deployed site URL');

async function get(relative) {
  if (!baseUrl) return readFile(path.join(root, relative), 'utf8');
  const url = new URL(relative, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
  url.searchParams.set('verify', process.env.EXPECTED_SHA || Date.now().toString());
  const response = await fetch(url, { signal: AbortSignal.timeout(20000), cache: 'no-store' });
  assert.equal(response.status, 200, `${url.pathname}: HTTP ${response.status}`);
  return response.text();
}

const html = await get('index.html');
const build = JSON.parse(await get('build.json'));
assert.match(build.commit, /^[a-f0-9]{40}$/);
if (process.env.EXPECTED_SHA)
  assert.equal(build.commit, process.env.EXPECTED_SHA, 'Live site is not the deployed commit');
assert.ok(html.includes(`content="${build.commit}"`), 'HTML and build metadata must match');
assert.ok(!/\{\{[A-Z_]+\}\}/.test(html), 'Unresolved template values');
for (const [pattern, label] of [
  [/<html lang="zh-CN">/, 'Chinese document language'],
  [/软件免费/, 'Free software notice'],
  [/yakcool\.com 充值并配置自己的 KEY/, 'Recharge and personal KEY requirement'],
  [/软件免费不代表 AI 调用免费/, 'AI usage billing disclosure'],
  [/相关视频、知识资料和剧本文本会发送/, 'Model data transmission disclosure'],
  [/data-download="mac-arm"/, 'Apple Silicon download'],
  [/data-download="mac-intel"/, 'Intel download'],
  [/data-download="windows"/, 'Windows download'],
  [/<track\b[^>]*kind="captions"/, 'Video captions'],
])
  assert.ok(pattern.test(html), `Missing website requirement: ${label}`);
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
assert.equal(new Set(ids).size, ids.length, 'Duplicate anchors');
for (const [, anchor] of html.matchAll(/href="#([^"\s]+)"/g))
  assert.ok(ids.includes(anchor), `Missing anchor #${anchor}`);
const resources = new Set(
  [...html.matchAll(/(?:src|href)="(\.\/[^"?#]+)"/g)].map((match) => match[1]),
);
resources.add('./assets/social-card.jpg');
const css = await get('styles.css');
for (const [, resource] of css.matchAll(/url\(['"]?(\.\/[^)'"?#]+)['"]?\)/g))
  resources.add(resource);
for (const resource of resources) {
  if (baseUrl) {
    const response = await fetch(new URL(resource, baseUrl), {
      headers: { Range: 'bytes=0-1023' },
      signal: AbortSignal.timeout(20000),
    });
    assert.ok(
      [200, 206].includes(response.status),
      `Missing live asset ${resource}: ${response.status}`,
    );
    const type = response.headers.get('content-type') || '';
    assert.ok(!type.includes('text/html'), `Asset returned HTML: ${resource}`);
    await response.body?.cancel();
  } else await access(path.join(root, resource));
}
assert.ok([...resources].includes('./assets/tutorial-demo.mp4'));
assert.ok([...resources].includes('./assets/workbench.webp'));
if (!baseUrl) execFileSync(process.execPath, ['--check', path.join(root, 'app.js')]);
console.log(
  `${baseUrl ? 'Live' : 'Local'} website verified: ${build.commit.slice(0, 7)}, v${build.version}, ${resources.size} assets, downloads, anchors, KEY notice and captions`,
);
