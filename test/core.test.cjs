const test = require('node:test'),
  assert = require('node:assert/strict');
const { DEFAULTS, validateConfig } = require('../src/config.cjs');
const {
  normalizeScript,
  approve,
  requireApproval,
  revise,
  scriptHash,
  schedule,
  parseJson,
} = require('../src/script.cjs');
const { usageRecord } = require('../src/provider.cjs'),
  { totals } = require('../src/store.cjs');
function script() {
  return normalizeScript(
    {
      title: '测试教程',
      chapters: ['启动', '观察'],
      scenes: [
        {
          id: 'a',
          kind: 'action',
          chapter: 0,
          heading: '启动',
          source_start: 0,
          source_end: 3,
          hold_at: 2,
          narration: '启动教程。',
          min_view_seconds: 3,
          silent_tail_seconds: 0.7,
        },
        {
          id: 'b',
          kind: 'observe',
          chapter: 1,
          heading: '观察',
          freeze_at: 3,
          motion_mode: 'freeze',
          narration: '查看结果。',
          min_view_seconds: 2,
          silent_tail_seconds: 1.5,
        },
      ],
    },
    5,
  );
}
test('all three roles are configurable and required', () => {
  const c = validateConfig(DEFAULTS);
  assert.equal(c.roles.editor.model, 'qwen3.8-max');
  delete c.roles.editor;
  assert.throws(() => validateConfig(c), /不完整/);
});
test('AI Balance adapter allows independent endpoints and keys', () => {
  const c = structuredClone(DEFAULTS);
  c.provider = 'custom';
  c.roles.speech.protocol = 'openai-speech';
  c.roles.speech.baseUrl = 'https://example.com/v1';
  c.roles.speech.credential = 'speech';
  assert.equal(validateConfig(c).roles.speech.protocol, 'openai-speech');
});
test('rejects invalid timestamps instead of silently clipping source', () => {
  const s = script();
  s.scenes[0].source_end = 50;
  assert.throws(() => normalizeScript(s, 5), /超出/);
  s.scenes[0].source_end = 3;
  s.scenes[0].hold_at = 4;
  assert.throws(() => normalizeScript(s, 5), /片段内/);
});
test('render requires approval of exact current revision', () => {
  const p = { script: script(), revision: 1 };
  assert.throws(() => requireApproval(p), /人工确认/);
  assert.throws(() => approve(p, 'stale'), /已更新/);
  approve(p, scriptHash(p.script));
  requireApproval(p);
  const edited = script();
  edited.scenes[0].narration = '改写';
  revise(p, edited);
  assert.equal(p.approval, null);
  assert.throws(() => requireApproval(p), /人工确认/);
});
test('blocking review cannot be approved', () => {
  const p = { script: script(), revision: 1, review: { issues: [{ severity: 'blocking' }] } };
  assert.throws(() => approve(p, scriptHash(p.script)), /阻断/);
});
test('long narration freezes picture and never overlaps', () => {
  const p = schedule(script(), [9, 4], DEFAULTS.style);
  assert(p.scenes[0].hold_extra > 6);
  assert(p.scenes[1].audio_start - p.scenes[0].audio_end >= 0.7);
  assert.equal(p.chapters_timed.length, 2);
  assert.throws(() => schedule(script(), [0, 4], DEFAULTS.style), /缺失/);
});
test('cache tokens billed at cache price and missing usage remains unknown', () => {
  const u = usageRecord(
    DEFAULTS.roles.editor,
    'edit',
    { prompt_tokens: 2000, completion_tokens: 100, prompt_tokens_details: { cached_tokens: 1000 } },
    200,
    300,
    1,
  );
  assert.equal(u.estimated_cny, 0.0171);
  const missing = usageRecord(DEFAULTS.roles.speech, 'tts', null, 10, 20, 2);
  assert.equal(missing.estimated_cny, null);
  assert.equal(totals([u, missing]).unpriced, 1);
});
test('accepts fenced JSON without evaluating model content', () => {
  assert.equal(
    parseJson(
      String.fromCharCode(96).repeat(3) +
        'json\n{"title":"x"}\n' +
        String.fromCharCode(96).repeat(3),
    ).title,
    'x',
  );
  assert.throws(() => parseJson('process.exit()'));
});
test('knowledge changes cannot reuse an approval even outside the UI', () => {
  const p = { script: script(), revision: 1, knowledge: 'before' };
  approve(p, scriptHash(p.script));
  p.knowledge = 'after';
  assert.throws(() => requireApproval(p), /知识资料已变更/);
});
test('character-only billing is not falsely treated as zero-cost token usage', () => {
  const record = usageRecord(DEFAULTS.roles.speech, 'tts', { characters: 100 }, 10, 20, 1);
  assert.equal(record.estimated_cny, null);
  assert.equal(record.usage_reported, false);
});
test('approval is bound to the imported source identity', () => {
  const p = { script: script(), revision: 1, sourceHash: 'first' };
  approve(p, scriptHash(p.script));
  p.sourceHash = 'second';
  assert.throws(() => requireApproval(p), /视频素材已变更/);
});
