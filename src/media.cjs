const fs = require('node:fs/promises'),
  path = require('node:path'),
  { spawn } = require('node:child_process');
const packaged = process.resourcesPath && path.basename(path.dirname(__dirname)) === 'app.asar';
const FFMPEG = packaged
    ? path.join(process.resourcesPath, 'tools/ffmpeg.exe')
    : require('ffmpeg-static'),
  FFPROBE = packaged
    ? path.join(process.resourcesPath, 'tools/ffprobe.exe')
    : require('ffprobe-static').path;
function run(binary, args, { signal, onProgress, duration } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(Error('任务已取消'));
    const child = spawn(binary, args, { windowsHide: true });
    let stdout = [],
      stderr = '',
      carry = '';
    const abort = () => child.kill();
    signal?.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', (chunk) => {
      stdout.push(chunk);
      if (onProgress) {
        carry += chunk.toString();
        const lines = carry.split('\n');
        carry = lines.pop();
        for (const line of lines)
          if (line.startsWith('out_time_us='))
            onProgress(Math.min(1, Number(line.split('=')[1]) / 1e6 / duration));
      }
    });
    child.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk).slice(-12000);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      signal?.removeEventListener('abort', abort);
      if (signal?.aborted) return reject(Error('任务已取消'));
      if (code !== 0) return reject(Error('媒体处理失败：' + stderr.slice(-4000)));
      resolve({ stdout: Buffer.concat(stdout), stderr });
    });
  });
}
async function probe(file, signal) {
  const { stdout } = await run(
    FFPROBE,
    ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', file],
    { signal },
  );
  const info = JSON.parse(stdout),
    v = info.streams.find((s) => s.codec_type === 'video'),
    a = info.streams.find((s) => s.codec_type === 'audio');
  return {
    duration: Number(info.format.duration),
    width: v?.width,
    height: v?.height,
    audio: Boolean(a),
    sampleRate: Number(a?.sample_rate),
    channels: a?.channels,
    bytes: Number(info.format.size),
  };
}
async function analysisVideo(source, target, signal, progress) {
  await run(
    FFMPEG,
    [
      '-hide_banner',
      '-v',
      'error',
      '-y',
      '-i',
      source,
      '-map',
      '0:v:0',
      '-map',
      '0:a?',
      '-vf',
      "scale='min(960,iw)':-2,fps=2",
      '-c:v',
      'libx264',
      '-crf',
      '26',
      '-preset',
      'fast',
      '-c:a',
      'aac',
      '-b:a',
      '64k',
      '-movflags',
      '+faststart',
      '-progress',
      'pipe:1',
      target,
    ],
    { signal, onProgress: progress, duration: (await probe(source, signal)).duration },
  );
  return fs.readFile(target);
}
async function frame(source, seconds, target, signal) {
  await run(
    FFMPEG,
    [
      '-hide_banner',
      '-v',
      'error',
      '-y',
      '-ss',
      String(seconds),
      '-i',
      source,
      '-frames:v',
      '1',
      target,
    ],
    { signal },
  );
  return target;
}
async function pcm(file, signal, rate = 48000) {
  return (
    await run(
      FFMPEG,
      [
        '-hide_banner',
        '-v',
        'error',
        '-i',
        file,
        '-vn',
        '-ac',
        '1',
        '-ar',
        String(rate),
        '-f',
        's16le',
        '-',
      ],
      { signal },
    )
  ).stdout;
}
function wav(data, rate = 48000) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(data.length + 36, 4);
  h.write('WAVEfmt ', 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}
async function normalizedAudio(bytes, dir, name, signal) {
  const raw = path.join(dir, name + '.received');
  await fs.writeFile(raw, bytes);
  const data = await pcm(raw, signal);
  if (data.length < 9600) throw Error('生成的旁白为空或过短');
  const file = path.join(dir, name + '.wav');
  await fs.writeFile(file, wav(data));
  return { file, duration: data.length / 96000, pcm: data };
}
module.exports = { FFMPEG, FFPROBE, run, probe, analysisVideo, frame, pcm, wav, normalizedAudio };
