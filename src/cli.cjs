const path = require('node:path'),
  os = require('node:os');
const args = process.argv.slice(2),
  command = args.shift();
function option(name, fallback = '') {
  const i = args.indexOf('--' + name);
  return i < 0 ? fallback : args[i + 1];
}
(async () => {
  if (command !== 'studio')
    throw Error('请启动 Tutor 桌面版并登录 YAKCOOL 后制作视频。命令行不再接受手动 API Key。');
  const studio = await require('./server.cjs').startServer({
    dataDir: path.resolve(
      option('data', process.env.TUTOR_DATA_DIR || path.join(os.homedir(), '.tutor')),
    ),
    port: Number(option('port', '0')),
  });
  console.log(studio.url);
  console.log('请使用 Tutor 桌面版完成 YAKCOOL 扫码登录。');
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
