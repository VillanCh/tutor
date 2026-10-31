const test = require('node:test'),
  assert = require('node:assert/strict');
const { safePercent, advancePercent } = require('../src/progress.mjs');
const { Engine } = require('../src/engine.cjs');
const { run } = require('../src/media.cjs');

const invalid = [
  -9223372036854775808,
  -1,
  101,
  1e20,
  NaN,
  Infinity,
  -Infinity,
  null,
  undefined,
  '69',
];

test('anomalous progress holds its last valid value and cannot rewind within a task', () => {
  for (const value of invalid) assert.equal(advancePercent(value, 69), 69);
  assert.equal(advancePercent(10, 69), 69);
  assert.equal(advancePercent(70, 69), 70);
  assert.equal(advancePercent(100, 99), 100);
  assert.equal(safePercent(Infinity), 0);
});

test('published snapshots preserve safe progress, but a new task starts from zero', async () => {
  const p = { id: 'test', progress: { percent: 69 }, usage: [] };
  const store = {
    public: (value) => structuredClone(value),
    get: () => p,
    save: async () => {},
    config: {},
  };
  const engine = new Engine(store);
  const values = [];
  engine.on('project', (value) => values.push(value));
  for (const percent of [...invalid, 30, 70])
    engine.publish(p, { percent, stage: '渲染场景 7 / 9' });
  assert(values.every((value) => value.progress.percent >= 69 && value.progress.percent <= 70));
  const oldTask = p.progress.taskId;
  await engine.task(p.id, '进度重试测试', async (value) => {
    assert.equal(value.progress.percent, 0);
    assert(value.progress.taskId && value.progress.taskId !== oldTask);
    engine.publish(value, { percent: 20 });
    engine.publish(value, { percent: -1e20 });
    assert.equal(value.progress.percent, 20);
  });
});

test('UI ignores invalid and regressing snapshots, while allowing a retry to reset to zero', async () => {
  const { mergeProjects, activitySteps } = await import('../src/ui/workbench.js');
  let current = {
    id: 'p',
    stateVersion: 1,
    job: { id: 'task-a', label: '生成旁白与视频' },
    progress: { taskId: 'task-a', percent: 69 },
  };
  for (const percent of [...invalid, 10]) {
    current = mergeProjects(
      [current],
      [
        {
          ...current,
          stateVersion: current.stateVersion + 1,
          progress: { ...current.progress, percent },
        },
      ],
    )[0];
    assert.equal(current.progress.percent, 69);
    assert.equal(activitySteps(current)[1].state, 'done');
    assert.equal(activitySteps(current)[2].state, 'running');
  }
  const retry = {
    ...current,
    stateVersion: current.stateVersion + 1,
    job: { id: 'task-b' },
    progress: { taskId: 'task-b', percent: 0 },
  };
  assert.equal(mergeProjects([current], [retry])[0].progress.percent, 0);
  assert.equal(mergeProjects([retry], [current])[0].progress.percent, 0);
});

test('the actual child-process progress parser ignores FFmpeg sentinels, malformed values and rewinds', async () => {
  const output =
    [
      'out_time_us=0',
      'out_time_us=690000',
      'out_time_us=-9223372036854775808',
      'out_time_us=NaN',
      'out_time_us=Infinity',
      'out_time_us=100000',
      'out_time_us=9223372036854775807',
      'out_time_us=700000',
      'out_time_us=1000000',
    ].join('\n') + '\n';
  const values = [];
  await run(process.execPath, ['-e', 'process.stdout.write(' + JSON.stringify(output) + ')'], {
    duration: 1,
    onProgress: (value) => values.push(value),
  });
  assert.deepEqual(values, [0, 0.69, 0.7, 1]);
});
