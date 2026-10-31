const path = require('node:path');

// Old projects keep their original script hash and approval until the next edit.
function projectSources(project) {
  return (
    project.sources || [
      {
        id: 'v01',
        name: path.basename(project.originalSource || project.source || ''),
        path: project.source,
        originalPath: project.originalSource,
        hash: project.sourceHash || null,
        info: project.info,
      },
    ]
  );
}

function findSource(project, id) {
  const sources = projectSources(project);
  if (id == null || id === '') {
    if (sources.length === 1) return sources[0];
    throw Error('请选择视频素材');
  }
  const source = sources.find((s) => s.id === id);
  if (!source) throw Error('视频素材不存在：' + id);
  return source;
}

function sourceManifest(project) {
  return projectSources(project).map((s) => ({
    source_id: s.id,
    name: s.name,
    duration: s.info.duration,
    width: s.info.width,
    height: s.info.height,
  }));
}

function sourceIdentities(project) {
  return projectSources(project).map((s) => ({ id: s.id, hash: s.hash || null }));
}

module.exports = { projectSources, findSource, sourceManifest, sourceIdentities };
