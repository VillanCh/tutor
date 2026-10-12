# Tutor

用录屏和知识资料制作教学视频的 Electron 工作台。全部业务代码、图片排版、音频调度与视频流程均为 JavaScript；媒体编解码使用随 npm 安装的 FFmpeg。

默认流程：

1. Qwen3.8 Omni Flash 读取视频并生成结构化初稿。
2. Qwen3.8 Max 根据初稿与知识资料修订错误、概念和表达。
3. Omni 再对照视频校对修订稿。
4. 人工检查分镜或 JSON，确认当前版本。
5. Qwen Audio 3.1 TTS Flash 使用龙安朗配音。
6. 按真实音频长度安排定格、原速操作与无声观察，渲染 Yak 风格视频。

任何剧本或知识修改都会撤销旧确认。后端验证当前剧本哈希与版本，不允许绕过确认直接渲染。

## 启动

需要 Node.js 22.12 或以上。首次安装会下载 Electron、FFmpeg 和 FFprobe。

    npm install
    npm start

桌面工作台的“模型与配音设置”可配置三个角色的模型、接口、Key 和参考价格。公开代码默认使用百炼通用地址，不包含个人业务空间地址或任何预置密钥。首次启动可用 QWEN_BASE_ORIGIN 指定业务空间域名，本机已保存的设置优先。共享 Key 和独立 Key 使用 Electron safeStorage 加密后保存在本机用户数据目录，不进入仓库，也不会返回到页面。

API Key 也可用 QWEN_API_KEY 环境变量传入。设置 TUTOR_DATA_DIR 可修改项目数据位置。桌面模式会保留加密凭据；CLI 模式只使用本次进程的环境变量，不写入明文密钥。

## 工作台

左侧：选择视频、粘贴或导入知识、查看 AI 对话、提出剧本修改要求。

右侧：分镜编辑、对应源画面、格式化 JSON Dump、原始与成品视频预览，以及文件导出。

顶部：阶段进度、接口实际输入输出 Token、当前生成 Token 估计、请求与响应载荷流量和估算费用。未知的计费用量保持未知，不记为零成本。

底部：人工确认开关与开始制作。AI 不能代替人工确认。

## 配音与风格

- 模型：qwen-audio-3.1-tts-flash。
- 默认男声：龙安朗，longanlang_v3.1。
- 女声备选：许言初，xuyanchu_v3.1。
- 48 kHz WAV，中性普通话教程指令，默认语速 1.0。
- Yak 米白底、墨色文字、橙色和陶土色点缀、衬线章节标题、大录屏区域、底部字幕和章节时间轴。

支持 1 到 5 个章节，输入视频最长 10 分钟。画面等比缩放，输出画布随素材纵横比调整。知识文件支持 TXT、MD、JSON、DOCX。字幕按句呈现，句内时序根据旁白长度分配，不是逐字强制对齐。

## 自定义接口与 AI Balance

将服务商改为“自定义 / AI Balance”，分别填写实际的模型名称、地址和 Key：

- 视觉与改写模型：OpenAI Chat 协议，地址填到 /v1 或 compatible-mode/v1，程序追加 /chat/completions。
- 百炼原生 TTS：地址填完整 SpeechSynthesizer 端点。
- OpenAI Speech TTS：地址填到 /v1，程序追加 /audio/speech。

网关必须实际支持所选模型和视频输入或语音输出。声线名称以对应服务商支持的值为准。本项目没有硬编码或声称已验证未知 AI Balance 端点。

## CLI

    node src/cli.cjs prepare --video recording.mp4 --knowledge facts.txt --data ./projects

输出项目 ID、剧本位置和当前哈希。人工阅读后：

    node src/cli.cjs approve --project UUID --hash CURRENT_HASH --data ./projects
    node src/cli.cjs render --project UUID --data ./projects

可单独启动浏览器工作台：

    node src/cli.cjs studio --data ./projects

不要让多个进程同时写同一项目数据目录。

## 导出文件

每个确认版本使用独立输出目录，保留 tutorial.mp4、subtitles.srt、script.json、edit-plan.json、cost.json、verification.json、approval.json、config.json 和 narration.wav。逐段 WAV 按内容与模型参数缓存，取消后可重试，复用缓存不会重复调用 TTS。

项目保存初稿、Max 修订、视觉校对和人工编辑历史。源视频、生成文件、知识及密钥均保存在用户目录，Git 忽略项目数据与媒体。

## 验证

    npm run check
    npm test

测试覆盖模型配置、时间范围、人工确认与撤销、缓存 Token 计费、长解说的静音间隔，以及真实 FFmpeg 的等比画面合成与解码。

参考：

- [百炼音色目录](https://platform.qianwenai.com/docs/developer-guides/speech/voice-list/qwen-audio-tts)
- [百炼 TTS HTTP API](https://help.aliyun.com/zh/model-studio/qwen-audio-tts-http-api)
- [模型价格](https://help.aliyun.com/zh/model-studio/model-pricing)
- [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage)
