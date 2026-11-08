export function readLocal(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null');
  } catch {
    return null;
  }
}

export function writeLocal(key, value) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* A full or disabled local store must not interrupt editing. */
  }
}

export function loadProjectDraft(project) {
  const saved = readLocal('tutor-draft:' + project.id);
  return saved?.baseHash === project.scriptHash ? saved : null;
}
