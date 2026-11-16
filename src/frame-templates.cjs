const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { normalizeBranding, importBranding } = require('./branding.cjs');

const templateDir = (root) => path.join(root, 'frame-templates');
async function listTemplates(root) {
  const dir = templateDir(root);
  await fs.mkdir(dir, { recursive: true });
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const templates = [];
  for (const entry of entries.filter((e) => e.isDirectory())) {
    try {
      const item = JSON.parse(
        await fs.readFile(path.join(dir, entry.name, 'template.json'), 'utf8'),
      );
      if (item.id === entry.name) templates.push(item);
    } catch {
      /* Ignore incomplete template writes. */
    }
  }
  return templates.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
async function saveTemplate(root, name, frame) {
  if (typeof name !== 'string' || !name.trim() || [...name.trim()].length > 40)
    throw Error('请输入 1–40 字的模板名称');
  normalizeBranding({ frame });
  const id = crypto.randomUUID(),
    dir = path.join(templateDir(root), id);
  await fs.mkdir(dir, { recursive: true });
  try {
    const imported = await importBranding({ frame }, dir);
    if (imported.frame.preset === 'custom') imported.frame.name = name.trim();
    const template = {
      id,
      name: name.trim(),
      frame: imported.frame,
      createdAt: new Date().toISOString(),
    };
    await fs.writeFile(path.join(dir, 'template.json'), JSON.stringify(template, null, 2), {
      flag: 'wx',
    });
    return template;
  } catch (error) {
    await fs.rm(dir, { recursive: true, force: true });
    throw error;
  }
}
async function deleteTemplate(root, id) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw Error('模板不存在');
  await fs.rm(path.join(templateDir(root), id), { recursive: true, force: true });
}
module.exports = { listTemplates, saveTemplate, deleteTemplate };
