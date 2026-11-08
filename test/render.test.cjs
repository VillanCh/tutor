const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs/promises'),
  path = require('node:path'),
  os = require('node:os');
const { render } = require('../src/render.cjs'),
  { FFMPEG, run, probe, wav } = require('../src/media.cjs'),
  { normalizeScript } = require('../src/script.cjs'),
  { DEFAULTS } = require('../src/config.cjs');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
test(
  'generic renderer preserves wide video aspect and muxes exact narration gaps',
  async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tutor-render-')),
      source = path.join(dir, 'source.mp4');
    await run(FFMPEG, [
      '-hide_banner',
      '-v',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=640x360:rate=30:duration=3',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      source,
    ]);
    const script = normalizeScript(
      {
        title: '通用渲染测试',
        chapters: ['第一章', '第二章'],
        scenes: [
          {
            kind: 'title',
            chapter: 0,
            heading: '第一章',
            narration: '标题',
            min_view_seconds: 1,
            silent_tail_seconds: 0.7,
          },
          {
            kind: 'action',
            chapter: 0,
            heading: '操作',
            source_start: 0,
            source_end: 1,
            hold_at: 0.5,
            narration: '解说',
            min_view_seconds: 1,
            silent_tail_seconds: 0.7,
          },
          {
            kind: 'observe',
            chapter: 1,
            heading: '观察',
            motion_mode: 'freeze',
            freeze_at: 2,
            narration: '观察',
            min_view_seconds: 1,
            silent_tail_seconds: 0.7,
          },
        ],
      },
      3,
    );
    const audio = [];
    for (let i = 0; i < 3; i++) {
      const pcm = Buffer.alloc(48000 * 2);
      for (let n = 0; n < 48000; n++)
        pcm.writeInt16LE(Math.round(Math.sin((n * 2 * Math.PI * 220) / 48000) * 3000), n * 2);
      const file = path.join(dir, 'voice-' + i + '.wav');
      await fs.writeFile(file, wav(pcm));
      audio.push({ file, pcm, duration: 1 });
    }
    const progress = [];
    const result = await render({
      source,
      info: await probe(source),
      script,
      audio,
      config: DEFAULTS,
      dir,
      progress: (ratio) => progress.push(ratio),
    });
    assert.equal(result.verification.passed, true);
    assert(progress.length > 0);
    assert(progress.every((ratio) => Number.isFinite(ratio) && ratio >= 0 && ratio <= 1));
    assert.equal(result.plan.canvas.video_width / result.plan.canvas.video_height, 16 / 9);
    assert.equal(result.verification.decodedSpeechGaps.length, 2);
    assert(
      result.plan.timeline.labelBaseline - 18 > result.plan.caption.y + result.plan.caption.height,
      'subtitle layer must leave a separate clear band for chapter labels',
    );
    const lastScene = result.plan.scenes.at(-1);
    const labelSegment = result.plan.chapterSegments.at(-1);
    const labelX = Math.round(16 + labelSegment.x),
      labelY = result.plan.timeline.labelBaseline - 18;
    const labelWidth = Math.floor(labelSegment.width - 2),
      labelHeight = 24;
    const { stdout: labelPixels } = await run(FFMPEG, [
      '-v',
      'error',
      '-ss',
      String(lastScene.audio_start + 0.2),
      '-i',
      result.output,
      '-frames:v',
      '1',
      '-vf',
      'crop=' + labelWidth + ':' + labelHeight + ':' + labelX + ':' + labelY,
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgb24',
      '-',
    ]);
    const expected = createCanvas(labelWidth, labelHeight).getContext('2d');
    expected.drawImage(
      await loadImage(path.join(dir, 'assets', 'overlay-2.png')),
      labelX,
      labelY,
      labelWidth,
      labelHeight,
      0,
      0,
      labelWidth,
      labelHeight,
    );
    const expectedPixels = expected.getImageData(0, 0, labelWidth, labelHeight).data;
    const dark = (pixels, stride) => {
      let count = 0;
      for (let n = 0; n < pixels.length; n += stride)
        if (pixels[n] < 180 && pixels[n + 1] < 180 && pixels[n + 2] < 180) count++;
      return count;
    };
    assert(dark(expectedPixels, 4) > 30);
    assert(
      dark(labelPixels, 3) >= dark(expectedPixels, 4) * 0.9,
      'active subtitles must not erase the upper strokes of decoded chapter text',
    );
    const firstChapter = result.plan.chapterSegments[0];
    for (const seconds of [firstChapter.end + 0.2, result.plan.total_duration - 0.1]) {
      const { stdout } = await run(FFMPEG, [
        '-v',
        'error',
        '-ss',
        String(seconds),
        '-i',
        result.output,
        '-frames:v',
        '1',
        '-vf',
        'crop=' + result.plan.canvas.video_width + ':8:16:' + result.plan.timeline.y,
        '-f',
        'rawvideo',
        '-pix_fmt',
        'rgb24',
        '-',
      ]);
      const pixel = (x) => [
        ...stdout.subarray(
          (4 * result.plan.canvas.video_width + Math.round(x)) * 3,
          (4 * result.plan.canvas.video_width + Math.round(x)) * 3 + 3,
        ),
      ];
      const gap = pixel(firstChapter.width + result.plan.timeline.gap / 2);
      assert(
        gap[1] > 225 && gap[2] > 210,
        'chapter separator must remain unfilled in the actual decoded video',
      );
      const completed = pixel(firstChapter.width / 2);
      assert(
        completed[1] < 180 && completed[2] < 90,
        'completed chapter must retain its own colored rail',
      );
    }
    assert((await fs.stat(path.join(dir, 'subtitles.srt'))).size > 50);
    const { Store, hashFile } = require('../src/store.cjs');
    const store = new Store(path.join(dir, 'workspaces'));
    await store.init();
    const originalHash = await hashFile(source);
    const imported = await store.create(source, '知识', '素材保存测试');
    assert.notEqual(imported.source, source);
    await fs.writeFile(source, 'external source changed');
    assert.equal(await hashFile(imported.source), originalHash);
    assert.equal(imported.sourceHash, originalHash);
  },
  { timeout: 120000 },
);
