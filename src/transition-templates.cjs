const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { importBranding, normalizeBranding } = require('./branding.cjs');
const directory = (root) => path.join(root, 'transition-templates');
async function listTemplates(root) {
  await fs.mkdir(directory(root), { recursive: true });
  const items = [];
  for (const e of await fs.readdir(directory(root), { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    try {
      const t = JSON.parse(
        await fs.readFile(path.join(directory(root), e.name, 'template.json'), 'utf8'),
      );
      if (t.id === e.name) items.push(t);
    } catch {
      /* Incomplete writes are not published to the library. */
    }
  }
  return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
async function saveTemplate(root, name, value) {
  if (typeof name !== 'string' || !name.trim() || [...name.trim()].length > 40)
    throw Error('请输入 1–40 字的过场预设名称');
  const transition = { ...value, enabled: true, cards: [] };
  normalizeBranding({ transition });
  const id = crypto.randomUUID(),
    dir = path.join(directory(root), id);
  await fs.mkdir(dir, { recursive: true });
  try {
    const b = await importBranding({ transition }, dir);
    const item = {
      id,
      name: name.trim(),
      transition: b.transition,
      createdAt: new Date().toISOString(),
    };
    await fs.writeFile(path.join(dir, 'template.json'), JSON.stringify(item, null, 2), {
      flag: 'wx',
    });
    return item;
  } catch (e) {
    await fs.rm(dir, { recursive: true, force: true });
    throw e;
  }
}
async function deleteTemplate(root, id) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw Error('过场预设不存在');
  await fs.rm(path.join(directory(root), id), { recursive: true, force: true });
}
module.exports = { listTemplates, saveTemplate, deleteTemplate };
