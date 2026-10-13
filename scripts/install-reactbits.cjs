const fs = require('node:fs/promises');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const items = [
  'ai-chat-2',
  'prompt-input-1',
  'agent-activity-1',
  'agent-approval-1',
  'agent-plan-1',
  'ai-usage-1',
  'app-shell-9',
  'wizard-1',
  'file-manager-1',
  'settings-form-1',
];

async function main() {
  try {
    process.loadEnvFile(path.join(root, '.env.local'));
  } catch {}
  if (!process.env.REACTBITS_LICENSE_KEY) {
    throw new Error('请在 .env.local 中配置 REACTBITS_LICENSE_KEY（需要 ReactBits Pro 授权）。');
  }
  const cssFile = path.join(root, 'src/ui/style.css');
  const css = await fs.readFile(cssFile);
  const result = spawnSync(
    process.execPath,
    [
      path.join(root, 'node_modules/shadcn/dist/index.js'),
      'add',
      ...items.map((name) => '@reactbits-pro/' + name),
      '-y',
    ],
    { cwd: root, env: process.env, stdio: 'inherit' },
  );
  await fs.writeFile(cssFile, css);
  if (result.status !== 0) throw new Error('ReactBits Pro 组件安装失败');
  // The JS shadcn transformer tries to parse Markdown as JSX. Download Agent Kit
  // Markdown from the same documented authenticated registry instead.
  for (const [tier, name] of [
    ['starter', 'skill'],
    ['pro', 'skill-terminal-dark'],
  ]) {
    const response = await fetch(
      'https://pro.reactbits.dev/api/r/' + tier + '/' + name + '.json?agent=codex',
      {
        headers: { Authorization: 'Bearer ' + process.env.REACTBITS_LICENSE_KEY },
      },
    );
    if (!response.ok) throw new Error('Agent Kit 下载失败：HTTP ' + response.status);
    const entry = await response.json();
    for (const file of entry.files || []) {
      if (!file.path.endsWith('.md')) continue;
      const relative = file.target || file.path;
      const target = path.resolve(root, relative);
      if (!target.startsWith(root + path.sep)) throw new Error('Agent Kit 路径无效');
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, file.content, 'utf8');
      console.log('已安装 Agent Kit：' + path.relative(root, target));
    }
  }
  await require('./adapt-reactbits.cjs').main();
  console.log('本地组件安装完成。付费源码和授权密钥不进入 Git。');
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
