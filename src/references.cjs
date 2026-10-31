const fs = require('node:fs/promises'),
  path = require('node:path'),
  crypto = require('node:crypto');
const { IMAGE_TYPES, REFERENCE_LIMITS } = require('./file-policy.mjs');

function parseReferences(input = []) {
  if (!Array.isArray(input) || input.length > REFERENCE_LIMITS.count)
    throw Error('最多添加 4 张参考图片');
  let total = 0;
  return input.map((image, index) => {
    const value = image?.dataUrl;
    if (
      typeof value !== 'string' ||
      value.length > Math.ceil(REFERENCE_LIMITS.fileBytes / 3) * 4 + 100
    )
      throw Error('每张参考图片不能超过 5 MB');
    const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
    if (!match || !IMAGE_TYPES.includes(match[1])) throw Error('参考图片仅支持 PNG、JPEG 和 WebP');
    const buffer = Buffer.from(match[2], 'base64'),
      mime = match[1];
    if (buffer.toString('base64') !== match[2]) throw Error('参考图片编码无效');
    const valid =
      mime === 'image/png'
        ? buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        : mime === 'image/jpeg'
          ? buffer.subarray(0, 3).equals(Buffer.from([255, 216, 255]))
          : buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP';
    if (!valid) throw Error('参考图片内容与格式不符');
    total += buffer.length;
    if (buffer.length > REFERENCE_LIMITS.fileBytes || total > REFERENCE_LIMITS.totalBytes)
      throw Error('参考图片总大小不能超过 12 MB，每张不能超过 5 MB');
    return {
      name: String(image.name || '参考图片 ' + (index + 1)).slice(0, 120),
      dataUrl: value,
      buffer,
      mime,
    };
  });
}
async function saveReferences(dir, images) {
  for (const image of images) {
    const decoded = await require('@napi-rs/canvas').loadImage(image.buffer);
    if (!decoded.width || !decoded.height || decoded.width * decoded.height > 40000000)
      throw Error('参考图片尺寸过大，请缩小后重试');
  }
  const attachments = [];
  for (const image of images) {
    const id = crypto.randomUUID(),
      file =
        'reference-' +
        id +
        { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' }[image.mime];
    await fs.writeFile(path.join(dir, file), image.buffer);
    attachments.push({ id, file, name: image.name, mime: image.mime, size: image.buffer.length });
  }
  return attachments;
}
module.exports = { parseReferences, saveReferences };
