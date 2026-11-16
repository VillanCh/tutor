const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { normalizeLayout } = require('./layout-options.mjs');
const queues = new Map();
const file = (root) => path.join(root, 'layout-presets.json');
async function listLayoutPresets(root) {
  try {
    return JSON.parse(await fs.readFile(file(root), 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
}
async function updateLayoutPresets(root, value) {
  const previous = queues.get(root) || Promise.resolve();
  const task = previous
    .catch(() => {})
    .then(async () => {
      let items = await listLayoutPresets(root);
      if (value.action === 'delete') {
        if (typeof value.id !== 'string') throw Error('排版预设不存在');
        items = items.filter((item) => item.id !== value.id);
      } else {
        if (
          typeof value.name !== 'string' ||
          !value.name.trim() ||
          [...value.name.trim()].length > 40
        )
          throw Error('请输入 1–40 字的排版预设名称');
        if (items.length >= 100) throw Error('最多保存 100 个排版预设，请先移除不再使用的预设');
        items.unshift({
          id: crypto.randomUUID(),
          name: value.name.trim(),
          layout: normalizeLayout(value.layout),
          createdAt: new Date().toISOString(),
        });
      }
      await fs.mkdir(root, { recursive: true });
      const temporary = file(root) + '.' + crypto.randomUUID() + '.tmp';
      try {
        await fs.writeFile(temporary, JSON.stringify(items, null, 2));
        await fs.rename(temporary, file(root));
      } finally {
        await fs.rm(temporary, { force: true });
      }
      return items;
    });
  queues.set(root, task);
  try {
    return await task;
  } finally {
    if (queues.get(root) === task) queues.delete(root);
  }
}
module.exports = { listLayoutPresets, updateLayoutPresets };
