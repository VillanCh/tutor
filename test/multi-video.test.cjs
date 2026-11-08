const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { Store, hashFile } = require('../src/store.cjs');
const { Engine } = require('../src/engine.cjs');
const { normalizeScript, approve, requireApproval, scriptHash } = require('../src/script.cjs');
const { FFMPEG, run } = require('../src/media.cjs');
const { render } = require('../src/render.cjs');
const { DEFAULTS } = require('../src/config.cjs');
const { startServer } = require('../src/server.cjs');
const { TestAccount, confirmModels } = require('./helpers/account.cjs');

const sources = [
  { id: 'v01', hash: 'first', info: { duration: 8 } },
  { id: 'v02', hash: 'second', info: { duration: 2 } },
];
function scene(source_id = 'v01', id = 'a') {
  return {
    id,
    kind: 'action',
    chapter: 0,
    source_id,
    source_start: 0,
    source_end: 0.5,
    hold_at: 0.3,
    narration: '',
    min_view_seconds: 0.5,
    silent_tail_seconds: 0.2,
  };
}
function script(scenes = [scene()]) {
  return { title: '多素材教程', chapters: ['操作'], scenes };
}

test('scene times are local to their selected source, with explicit identity for multi-video scripts', () => {
  const valid = normalizeScript(script([scene('v02'), scene('v01', 'b')]), sources);
  assert.deepEqual(
    valid.scenes.map((s) => s.source_id),
    ['v02', 'v01'],
  );
  for (const id of [undefined, 'missing']) {
    const s = scene();
    if (id === undefined) delete s.source_id;
    else s.source_id = id;
    assert.throws(() => normalizeScript(script([s]), sources), /source_id/);
  }
  const tooLong = scene('v02');
  tooLong.source_end = 3;
  assert.throws(() => normalizeScript(script([tooLong]), sources), /超出/);
  const freeze = { ...scene('v02'), kind: 'observe', motion_mode: 'freeze', freeze_at: 2 };
  assert.throws(() => normalizeScript(script([freeze]), sources), /超出/);
  const legacy = scene();
  delete legacy.source_id;
  assert.equal(normalizeScript(script([legacy]), [sources[0]]).scenes[0].source_id, 'v01');
  assert(!('source_id' in normalizeScript(script([legacy]), 8).scenes[0]));
});

test('approval binds every source, its ID and its order, while old single-video approvals remain usable', () => {
  const p = {
    script: normalizeScript(script(), sources),
    revision: 1,
    sources: structuredClone(sources),
  };
  approve(p, scriptHash(p.script));
  requireApproval(p);
  for (const mutation of [
    (items) => {
      items[1].hash = 'changed';
    },
    (items) => {
      items[1].id = 'changed';
    },
    (items) => items.pop(),
    (items) => items.reverse(),
  ]) {
    const changed = structuredClone(p);
    mutation(changed.sources);
    assert.throws(() => requireApproval(changed), /视频素材已变更/);
  }
  const legacy = { script: normalizeScript(script(), 8), revision: 1, sourceHash: 'legacy' };
  approve(legacy, scriptHash(legacy.script));
  delete legacy.approval.sourceHashes;
  requireApproval(legacy);
});

test('packaged media tools resolve on Windows, macOS and Linux without development dependencies', async () => {
  const vm = require('node:vm');
  const code = await fs.readFile(path.join(__dirname, '../src/media.cjs'), 'utf8');
  for (const platform of ['win32', 'darwin', 'linux']) {
    const module = { exports: {} };
    const resourcesPath = path.resolve('packaged/resources');
    vm.runInNewContext(code, {
      module,
      __dirname: path.join(resourcesPath, 'app.asar', 'src'),
      process: { platform, resourcesPath },
      require: (name) => {
        assert(
          name.startsWith('node:'),
          'packaged mode must not load a development media dependency',
        );
        return require(name);
      },
    });
    for (const tool of ['FFMPEG', 'FFPROBE'])
      assert.equal(
        module.exports[tool],
        path.join(
          resourcesPath,
          'tools',
          tool.toLowerCase() + (platform === 'win32' ? '.exe' : ''),
        ),
      );
  }
});

test(
  'multi-video import, model workflow, HTTP previews and real mixed-aspect rendering',
  { timeout: 120000 },
  async (t) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tutor-multi-video-'));
    t.after(async () => {
      assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
      await fs.rm(dir, { recursive: true, force: true });
    });
    const inputs = [];
    for (const [folder, color, size, duration] of [
      ['素材 一', 'red', '320x180', 2],
      ["素材 二's", 'blue', '180x320', 1],
    ]) {
      const inputDir = path.join(dir, folder);
      await fs.mkdir(inputDir);
      const file = path.join(inputDir, '录屏.mp4');
      await run(FFMPEG, [
        '-v',
        'error',
        '-y',
        '-f',
        'lavfi',
        '-i',
        `color=c=${color}:s=${size}:r=30:d=${duration}`,
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        file,
      ]);
      inputs.push(file);
    }
    const store = new Store(path.join(dir, 'projects'), new TestAccount());
    await store.init();
    await confirmModels(store);
    const p = await store.create([inputs[0], inputs[0], inputs[1]], '教学目标', '联合剪辑');

    await t.test(
      'copies all sources independently, deduplicates paths and restores persisted sources',
      async () => {
        assert.equal(p.sources.length, 2);
        assert.equal(p.info.duration, 3);
        assert.deepEqual(
          p.sources.map((s) => s.name),
          ['录屏.mp4', '录屏.mp4'],
        );
        assert.notEqual(p.sources[0].path, p.sources[1].path);
        for (const [i, s] of p.sources.entries()) {
          assert.notEqual(s.path, inputs[i]);
          assert.equal(await hashFile(s.path), await hashFile(inputs[i]));
          assert.equal(s.hash, await hashFile(inputs[i]));
        }
        const reloaded = new Store(store.root);
        await reloaded.init();
        assert.deepEqual(reloaded.get(p.id).sources, p.sources);
        store.config.limits.maxDuration = 2;
        await assert.rejects(store.create(inputs, '', ''), /总时长/);
        store.config.limits.maxDuration = 600;
        await assert.rejects(store.create([], '', ''), /至少/);
        await assert.rejects(store.create([inputs[0], dir], '', ''), /视频文件/);
        assert.equal(store.projects.size, 1);
        assert.deepEqual(
          (await fs.readdir(store.root, { withFileTypes: true }))
            .filter((entry) => entry.isDirectory())
            .map((entry) => entry.name),
          [p.id],
        );
      },
    );

    await t.test('CLI cannot bypass YAKCOOL login with local video arguments', async () => {
      const cliDir = path.join(dir, 'cli-projects');
      await fs.mkdir(cliDir);
      const config = structuredClone(DEFAULTS);
      config.limits.maxDuration = 2;
      await fs.writeFile(path.join(cliDir, 'settings.json'), JSON.stringify(config));
      await assert.rejects(
        run(process.execPath, [
          path.join(__dirname, '../src/cli.cjs'),
          'prepare',
          '--video',
          inputs[0],
          '--video',
          inputs[1],
          '--data',
          cliDir,
        ]),
        /登录 YAKCOOL/,
      );
    });

    const engine = new Engine(store);
    await t.test(
      'preflight reports each invalid file without hiding the valid videos',
      async () => {
        const broken = path.join(dir, '损坏.mp4');
        await fs.writeFile(broken, 'not a video');
        const inspection = await store.inspectSources([
          inputs[0],
          broken,
          path.join(dir, '不存在.mp4'),
          inputs[1],
        ]);
        assert.equal(inspection.files.length, 4);
        assert.equal(inspection.totalDuration, 3);
        assert.equal(inspection.files.filter((item) => item.info).length, 2);
        assert.match(inspection.files[1].error, /损坏或格式不支持/);
        assert.match(inspection.files[2].error, /找不到/);
        assert.equal(store.projects.size, 1);
      },
    );
    await t.test(
      'analyzes one video per request, jointly edits drafts and audits each source without changing other scenes',
      async () => {
        const calls = [];
        const combined = script([scene('v02', 'second'), scene('v01', 'first')]);
        const responses = [
          script([scene('v01')]),
          script([scene('v02')]),
          combined,
          {
            script: script([{ ...scene('v01', 'first'), evidence: '第一份素材画面' }]),
            issues: [],
            summary: '通过',
          },
          {
            script: script([{ ...scene('v02', 'second'), evidence: '第二份素材画面' }]),
            issues: [],
            summary: '通过',
          },
        ];
        engine.provider = () => ({
          json: async (role, label, messages) => {
            const content = messages.at(-1).content;
            if (role === 'vision')
              assert.equal(content.filter((item) => item.type === 'video_url').length, 1);
            if (role === 'editor') {
              assert.match(content, /"drafts"/);
              assert.match(content, /"source_id":"v01"/);
              assert.match(content, /"source_id":"v02"/);
            }
            calls.push({ role, label });
            return { value: structuredClone(responses[calls.length - 1]) };
          },
        });
        await engine.prepare(p.id);
        assert.deepEqual(
          calls.map((c) => c.role),
          ['vision', 'vision', 'editor', 'vision', 'vision'],
        );
        assert.deepEqual(
          p.script.scenes.map((s) => s.source_id),
          ['v02', 'v01'],
        );
        assert.deepEqual(
          p.script.scenes.map((s) => s.evidence),
          ['第二份素材画面', '第一份素材画面'],
        );
        assert.equal(p.status, 'review');
        assert.equal(p.approval, null);
        assert.equal(p.revision, 1);
        assert.deepEqual(
          p.history.map((h) => h.stage),
          ['initial', 'max', 'audit'],
        );
        assert.equal(
          (await fs.readdir(store.dir(p.id))).filter((name) => name.startsWith('analysis-')).length,
          2,
        );
        await assert.rejects(
          engine.audit(
            p,
            { json: async () => ({ value: { script: script([scene('v02', 'first')]) } }) },
            p.script,
          ),
          /source_id/,
        );
      },
    );

    await t.test(
      'conversation edits preserve source references and revoke the previous approval',
      async () => {
        approve(p, scriptHash(p.script));
        const updated = structuredClone(p.script);
        updated.scenes[0].narration = '先展示第二段素材的结果。';
        const calls = [];
        engine.provider = () => ({
          json: async (role, label, messages) => {
            calls.push(role);
            if (role === 'editor') {
              assert.match(messages[0].content, /"source_id":"v01"/);
              assert.match(messages[0].content, /"source_id":"v02"/);
              return { value: updated };
            }
            const sourceId = label.split(' · ').at(-1);
            return {
              value: {
                script: {
                  ...updated,
                  scenes: updated.scenes.filter((s) => s.source_id === sourceId),
                },
                issues: [],
                summary: '通过',
              },
            };
          },
        });
        await engine.edit(p.id, '先展示第二段素材的结果，保持素材引用不变');
        assert.deepEqual(calls, ['editor', 'vision', 'vision']);
        assert.equal(p.revision, 2);
        assert.equal(p.approval, null);
        assert.equal(p.status, 'review');
        assert.deepEqual(
          p.script.scenes.map((s) => s.source_id),
          ['v02', 'v01'],
        );
        assert.equal(p.script.scenes[0].narration, updated.scenes[0].narration);
        assert.throws(() => requireApproval(p), /人工确认/);
      },
    );

    await t.test(
      'HTTP chooses the requested source for streaming and thumbnails and checks that source duration',
      async () => {
        const server = await startServer({ dataDir: store.root, account: new TestAccount() });
        try {
          const base = server.url + '/api/projects/' + p.id;
          const response = await fetch(base + '/source?source=v02', {
            headers: { Range: 'bytes=0-63' },
          });
          assert.equal(response.status, 206);
          assert.equal(response.headers.get('content-type'), 'video/mp4');
          assert.deepEqual(
            Buffer.from(await response.arrayBuffer()),
            (await fs.readFile(p.sources[1].path)).subarray(0, 64),
          );
          const red = await fetch(base + '/frame?source=v01&t=0');
          const blue = await fetch(base + '/frame?source=v02&t=0');
          assert.equal(red.status, 200);
          assert.equal(blue.status, 200);
          assert.notDeepEqual(
            Buffer.from(await red.arrayBuffer()),
            Buffer.from(await blue.arrayBuffer()),
          );
          assert.equal((await fetch(base + '/frame?source=v02&t=1.5')).status, 400);
          assert.equal((await fetch(base + '/source?source=unknown')).status, 400);
          assert.equal((await fetch(base + '/source')).status, 400);
          const headers = { 'Content-Type': 'application/json', 'X-Tutor-Token': server.token };
          const created = await fetch(server.url + '/api/projects', {
            method: 'POST',
            headers,
            body: JSON.stringify({ sources: inputs, title: 'API 多选' }),
          });
          assert.equal(created.status, 200);
          assert.equal((await created.json()).sources.length, 2);
          const legacy = await fetch(server.url + '/api/projects', {
            method: 'POST',
            headers,
            body: JSON.stringify({ source: inputs[0] }),
          });
          assert.equal(legacy.status, 200);
          assert.equal((await legacy.json()).sources.length, 1);
        } finally {
          server.close();
        }
      },
    );

    await t.test(
      'renders clips and freezes from the correct source with a shared aspect-preserving canvas',
      async () => {
        const outputDir = path.join(dir, 'render');
        const edit = normalizeScript(
          script([
            { ...scene('v02', 'blue'), narration: '蓝色素材。' },
            {
              ...scene('v01', 'red'),
              narration: '红色素材。',
              source_end: 1,
              motion_mode: 'compress',
            },
            { ...scene('v02', 'freeze'), kind: 'observe', motion_mode: 'freeze', freeze_at: 0.5 },
          ]),
          p.sources,
        );
        const config = structuredClone(DEFAULTS);
        config.style.width = 640;
        const { wav } = require('../src/media.cjs');
        const voice = Buffer.alloc(48000 * 2);
        for (let n = 0; n < 48000; n++)
          voice.writeInt16LE(Math.round(Math.sin((n * 2 * Math.PI * 220) / 48000) * 3000), n * 2);
        await fs.mkdir(outputDir);
        const voiceFile = path.join(outputDir, 'voice.wav');
        await fs.writeFile(voiceFile, wav(voice));
        const result = await render({
          source: p.source,
          sources: p.sources,
          info: p.info,
          script: edit,
          audio: [
            { file: voiceFile, pcm: voice, duration: 1 },
            { file: voiceFile, pcm: voice, duration: 1 },
            null,
          ],
          config,
          dir: outputDir,
        });
        assert.equal(result.verification.passed, true);
        assert.deepEqual(
          result.plan.scenes.map((s) => s.source_id),
          ['v02', 'v01', 'v02'],
        );
        assert.equal(result.plan.sources.length, 2);
        assert.equal(result.verification.decodedSpeechGaps.length, 1);
        assert.equal(result.plan.canvas.video_width / result.plan.canvas.video_height, 16 / 9);
        for (const [index, channel] of [
          [0, 2],
          [1, 0],
          [2, 2],
        ]) {
          const s = result.plan.scenes[index];
          const { stdout } = await run(FFMPEG, [
            '-v',
            'error',
            '-ss',
            String(s.offset + s.duration / 2),
            '-i',
            result.output,
            '-frames:v',
            '1',
            '-vf',
            `crop=2:2:${config.style.width / 2}:${52 + result.plan.canvas.video_height / 2},scale=1:1`,
            '-pix_fmt',
            'rgb24',
            '-f',
            'rawvideo',
            '-',
          ]);
          assert.equal(stdout.length, 3);
          assert(stdout[channel] > 180, 'wrong source color at scene ' + s.id);
          assert(stdout.filter((_, i) => i !== channel).every((value) => value < 80));
        }
      },
    );

    await t.test(
      'changing the second imported video is detected before any paid speech call',
      async () => {
        approve(p, scriptHash(p.script));
        await fs.writeFile(p.sources[1].path, 'changed');
        engine.provider = () => {
          throw Error('must not call a model');
        };
        await assert.rejects(engine.generate(p.id), /原始素材已变更/);
        assert.equal(p.job, null);
      },
    );

    await t.test(
      'migration keeps old single-video scripts and approval hashes intact',
      async () => {
        const legacy = await store.create(inputs[0], '', '旧项目');
        legacy.script = normalizeScript(script(), 2);
        legacy.revision = 1;
        approve(legacy, scriptHash(legacy.script));
        delete legacy.approval.sourceHashes;
        delete legacy.sources;
        const before = scriptHash(legacy.script);
        await store.save(legacy);
        const reloaded = new Store(store.root);
        await reloaded.init();
        const migrated = reloaded.get(legacy.id);
        assert.equal(migrated.sources.length, 1);
        assert.equal(scriptHash(migrated.script), before);
        requireApproval(migrated);
      },
    );
  },
);
