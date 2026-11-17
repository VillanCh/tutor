const fs = require('node:fs/promises'),
  path = require('node:path'),
  crypto = require('node:crypto');
const { importBranding } = require('./branding.cjs');
const { normalizeSurfaces, SURFACE_DEFAULTS } = require('./header-options.mjs');
const directory = (root) => path.join(root, 'header-presets');
async function listPresets(root) {
  await fs.mkdir(directory(root), { recursive: true });
  const items = [];
  for (const e of await fs.readdir(directory(root), { withFileTypes: true }))
    if (e.isDirectory()) {
      try {
        const p = JSON.parse(
          await fs.readFile(path.join(directory(root), e.name, 'preset.json'), 'utf8'),
        );
        if (p.id === e.name) items.push(p);
      } catch {}
    }
  return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
async function savePreset(root, name, header, surfaces) {
  header = header ?? {};
  require('./header-options.mjs').normalizeHeader(header);
  if (typeof name !== 'string' || !name.trim() || [...name.trim()].length > 40)
    throw Error('请输入 1–40 字的品牌预设名称');
  const bands = normalizeSurfaces(surfaces ?? SURFACE_DEFAULTS),
    id = crypto.randomUUID(),
    dir = path.join(directory(root), id);
  await fs.mkdir(dir, { recursive: true });
  try {
    const imported = await importBranding({ header }, dir);
    const p = {
      id,
      name: name.trim(),
      header: imported.header,
      surfaces: bands,
      createdAt: new Date().toISOString(),
    };
    await fs.writeFile(path.join(dir, 'preset.json'), JSON.stringify(p, null, 2), { flag: 'wx' });
    return p;
  } catch (e) {
    await fs.rm(dir, { recursive: true, force: true });
    throw e;
  }
}
async function deletePreset(root, id) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw Error('品牌预设不存在');
  await fs.rm(path.join(directory(root), id), { recursive: true, force: true });
}
module.exports = { listPresets, savePreset, deletePreset };
