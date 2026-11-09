const fs = require('node:fs/promises');
const path = require('node:path');
const { createCanvas } = require('@napi-rs/canvas');
const { font, brandFont } = require('../../src/fonts.cjs');
const { FFMPEG, run } = require('../../src/media.cjs');

async function demoSource(dir) {
  const W = 1600,
    H = 900,
    canvas = createCanvas(W, H),
    ctx = canvas.getContext('2d');
  const rect = (x, y, w, h, c, r = 0) => {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    ctx.fill();
  };
  const text = (v, x, y, size = 24, color = '#303b4c', brand = false) => {
    ctx.font = brand ? brandFont(size) : font(size);
    ctx.fillStyle = color;
    ctx.textBaseline = 'top';
    ctx.fillText(v, x, y);
  };
  rect(0, 0, W, H, '#f4f5f9');
  rect(0, 0, W, 66, '#212733');
  text('Yakit', 28, 16, 29, '#f2f3f7', true);
  text('/  HTTP Fuzzer', 130, 25, 18, '#b4bcc9');
  rect(1404, 19, 166, 29, '#354d40', 6);
  text('本地教学示例', 1423, 24, 15, '#c3e1b3');
  rect(0, 66, 225, H - 66, '#e9eaf2');
  text('WORKSPACE', 25, 104, 15, '#858ca0', true);
  ['HTTP Fuzzer', '请求历史', '参数管理', '结果导出'].forEach((name, i) => {
    if (i === 0) rect(14, 148, 197, 53, '#d9d9ed', 7);
    text(name, 30, 163 + i * 78, 21, i === 0 ? '#625575' : '#697384');
  });
  text('请求与响应核对', 263, 103, 34, '#263247');
  text('先构造请求，再检查响应是否符合预期。', 265, 151, 19, '#798295');
  rect(263, 204, 1302, 61, '#fff', 9);
  rect(278, 217, 75, 35, '#e7edf7', 5);
  text('GET', 295, 223, 19, '#456485', true);
  text('http://demo.local/api/tutorials', 374, 224, 21, '#465571');
  rect(1383, 217, 163, 35, '#66527d', 5);
  text('发送请求', 1420, 223, 19, '#fff');
  rect(263, 290, 620, 520, '#fff', 10);
  rect(903, 290, 662, 520, '#fff', 10);
  text('01 / 构造请求', 287, 314, 21, '#675278');
  text('02 / 核对响应', 928, 314, 21, '#675278');
  const request = [
    'GET /api/tutorials HTTP/1.1',
    'Host: demo.local',
    'Accept: application/json',
    '',
    '// 检查请求方法与路径',
    '// 使用本地示例，不发送真实数据',
  ];
  request.forEach((line, i) => {
    text(String(i + 1).padStart(2, '0'), 286, 370 + i * 47, 16, '#b0b6c3');
    text(line, 326, 367 + i * 47, i === 4 || i === 5 ? 20 : 22, i > 3 ? '#8793a7' : '#435878');
  });
  rect(928, 366, 196, 36, '#e8f1ec', 5);
  text('HTTP/1.1 200 OK', 942, 373, 18, '#578974');
  ['{', '  "success": true,', '  "data": [', '    { "title": "HTTP 入门" }', '  ]', '}'].forEach(
    (line, i) => text(line, 930, 432 + i * 44, 21, i === 1 ? '#5f8a75' : '#54647f'),
  );
  rect(283, 744, 579, 41, '#f0edf6', 5);
  text('核对路径、请求头与响应字段', 300, 754, 17, '#8b7a9f');
  rect(263, 833, 1302, 37, '#e8edf3', 5);
  text('状态 200     /     耗时 12 ms     /     响应完整', 281, 843, 15, '#728396');
  const image = path.join(dir, 'sample-recording.png'),
    video = path.join(dir, 'sample-recording.mp4');
  await fs.writeFile(image, canvas.toBuffer('image/png'));
  await run(FFMPEG, [
    '-v',
    'error',
    '-y',
    '-loop',
    '1',
    '-i',
    image,
    '-t',
    '4',
    '-r',
    '24',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    video,
  ]);
  return { image, video };
}

module.exports = { demoSource };
