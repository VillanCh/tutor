# Tutor

[官网与免费下载](https://villanch.github.io/tutor/) · [正式发行包](https://github.com/VillanCh/tutor/releases/latest)

Tutor 软件免费。使用 AI 功能，需要先前往 [yakcool.com](https://yakcool.com) 充值并获取自己的 API KEY，再在应用的「模型与制作设置」中配置对应模型源；AI 服务按实际用量计费。

用录屏和知识资料制作教学视频的 Electron 工作台。全部业务代码、图片排版、音频调度与视频流程均为 JavaScript；媒体编解码使用随 npm 安装的 FFmpeg。

默认流程：

1. 拖入或多选一个或多个原始视频，Qwen3.8 Omni Flash 逐个读取并生成带素材编号的结构化初稿。
2. Qwen3.8 Max 汇总全部初稿与知识资料，跨素材选择、重排片段并修订错误、概念和表达，生成一份完整的剪辑脚本。
3. Omni 再逐个对照原视频，校对脚本中引用该素材的分镜。
4. 人工检查分镜或 JSON，确认当前版本。
5. Qwen Audio 3.1 TTS Flash 使用龙安朗配音。
6. 按真实音频长度安排定格、原速操作与无声观察，渲染 Yak 风格视频。

任何剧本或知识修改都会撤销旧确认。后端验证当前剧本哈希与版本，不允许绕过确认直接渲染。

## 启动

需要 Node.js 22.12 或以上。首次安装会下载 Electron、FFmpeg 和 FFprobe。React 工作台使用真实的 ReactBits Pro App UI，界面构建需要你自己的 Pro 授权。

    npm install
    # 在 .env.local 填写 REACTBITS_LICENSE_KEY，密钥不要提交到 Git
    npm run setup-ui
    npm start

Windows 安装依赖和组件后也可以双击 start.cmd 启动。它会使用 Electron 自带的 Node 运行时构建界面，不依赖系统中旧版本的 Node，也不需要重新输入已保存的模型 Key。

ReactBits Pro 的源码、Agent Kit、授权密钥与构建产物按许可证仅保存在本地，公开仓库包含 Tutor 的业务代码和组件安装、适配脚本。npm run setup-ui 从官方授权注册表获取源码，再生成与 Tutor API 连接的组件；没有复制付费源码到仓库。仅使用 CLI 制作视频不需要 ReactBits 授权。

采用 App Shell 9、AI Chat 2、Wizard 1、Agent Approval 1、Agent Activity 1 和 AI Usage 1，并应用 Agent Kit Terminal Dark 的颜色、层次、字体与动效规则。组件保持独立滚动区域；对话、审核和费用数据来自真实后端。标准表单、对话框和提示使用 shadcn/ui。所有前端源文件也是 JavaScript / JSX。

桌面工作台的“模型与制作设置”提供百炼源和自定义源。每个源配置 Chat 地址、语音协议、语音地址与 Key，三个角色分别选择源并继承连接设置；模型名称和参考价格独立配置。旧版的接口与独立凭据自动迁移，音频缓存继续复用。公开代码默认使用百炼通用地址，不包含个人业务空间地址或任何预置密钥。首次启动可用 QWEN_BASE_ORIGIN 指定业务空间域名，本机已保存的设置优先。各源的 Key 使用 Electron safeStorage 加密保存在本机用户数据目录，不进入仓库，也不会返回到页面。

API Key 也可用 QWEN_API_KEY 环境变量传入。设置 TUTOR_DATA_DIR 可修改项目数据位置。桌面模式会保留加密凭据；CLI 模式只使用本次进程的环境变量，不写入明文密钥。

## 工作台

顶栏：导入素材 → 对话改稿 → 审核制作 → 导出成片，当前阶段和下一步操作都明确显示。桌面窗口采用沉浸式深色标题栏，应用顶栏可拖动，保留系统的最小化、最大化、关闭与窗口吸附。

左侧：AI 对话与修改建议。模型中间输出显示在独立 JSON 代码框中，完整内容可滚动、选择与复制，显示当前阶段及 Token 估计；最终说明仍以正文显示。点选右侧分镜后，“让 AI 改这一段”将段落名称放入对话框；Enter 发送，Shift + Enter 换行，Ctrl + K 聚焦输入。

右侧：导入视频与知识、分镜时间轴、解说编辑、对应原片时间点、大画面原始与成品预览、格式化 JSON Dump 和制作记录。

导入区支持一次拖入多个视频或在文件选择框中多选，也可继续追加、去重、上下调整素材顺序或移除。浏览器工作台可每行粘贴一个本地视频完整路径；系统文件拖入和文件选择使用桌面应用。支持 MP4、MOV、MKV、WebM、AVI、M4V。素材顺序用于初始分析，最终剪辑顺序可由脚本和对话调整。

选择后会先检查每个视频的时长、尺寸与可读性，并显示总时长；损坏文件和超长素材会直接提示。混入非视频文件时保留有效视频，重复添加也会提示。桌面版默认收起路径输入；未配置 Key 时也可先导入素材，配置画面理解和改稿模型后再生成脚本，配音 Key 只在制作时检查。

每个素材拥有独立的 `v01`、`v02` 等编号。非标题分镜通过 `source_id` 指定原片；`source_start`、`source_end`、`hold_at` 和 `freeze_at` 都是该原片内部从 0 开始的秒数。分镜预览、缩略图与剪辑使用同一编号；“时序与画面依据”中可切换素材并修改时间。视频页可单独预览各个原片。比如可以要求“先用 v02 的结果画面，再用 v01 讲操作，删掉重复步骤”。

底栏和制作记录：接口实际输入输出 Token、当前生成 Token 估计、调用次数、请求与响应载荷流量和估算费用。未知的计费用量保持未知，不记为零成本。

审核对话框：确认当前版本后才进行配音和制作。未保存的编辑不能用于制作，AI 不能代替人工确认。

阻断问题会直接显示在预览区，可定位到对应分镜。人工核对后点击“我已核对，标记解决”，再确认当前剧本进行制作；AI 返回的“已解决”字段不会替代人工核对。失败或取消后可直接重试当前步骤，已完成的音频和素材分析会复用。

导入内容与未提交的分镜/JSON 草稿会保存在本机，切换教程、刷新或重启本地服务后可恢复。草稿不会自动覆盖已确认的剧本；点击保存或按 Ctrl/Cmd + S 才提交为新版本。向 AI 发起改稿时会先提交当前有效修改。保存后保留当前分镜位置。

## 配音与风格

- 模型：qwen-audio-3.1-tts-flash。
- 界面“沉稳男声”：龙安朗，longanlang_v3.1，默认使用。
- 界面“解说女声”：许言初，xuyanchu_v3.1。
- 48 kHz WAV，中性普通话教程指令，默认语速 1.0。
- Yak 米白底、墨色文字、橙色和陶土色点缀、衬线章节标题、大录屏区域、底部字幕和章节时间轴。

支持 1 到 5 个章节，所有输入视频总时长默认最多 10 分钟，可在高级配置 `limits.maxDuration` 中调整（最多 3600 秒）。输出画布按首个素材纵横比设置，其余素材等比缩放并补边，支持混用横屏和竖屏。知识文件支持 TXT、MD、JSON、DOCX。字幕按句呈现，长句会按画面宽度继续拆分，最多两行一屏，完整保留内容；句内时序根据旁白长度分配，不是逐字强制对齐。

每段视频分别压缩和发送给视觉模型，每次请求只包含一段视频；联合编排使用全部分析结果，视觉校对逐段完成。素材数量增加时，视觉模型调用次数也相应增加。

## 自定义接口与 AI Balance

在设置中点“添加自定义源”，填写源名称（例如 AI Balance）、实际地址和 Key，再将需要的模型切换到此源：

- 视觉与改写模型：OpenAI Chat 协议，地址填到 /v1 或 compatible-mode/v1，程序追加 /chat/completions。
- 百炼原生 TTS：地址填完整 SpeechSynthesizer 端点。
- OpenAI Speech TTS：地址填到 /v1，程序追加 /audio/speech。

Chat 和语音不是同一个协议：Omni 与 Max 请求 /chat/completions；默认 Qwen TTS 请求百炼 SpeechSynthesizer。网关必须实际支持所选模型和视频输入或语音输出。声线名称以对应服务商支持的值为准。本项目没有硬编码或声称已验证未知 AI Balance 端点。

高级 JSON 中 sources 是连接设置的来源，roles 使用 sourceId 选择源，baseUrl、protocol、credential 会据此解析。新增源可暂时留空，选中的源必须有对应接口地址。输入完整的 /chat/completions 或 /audio/speech 地址也会在保存时自动规范化。

## CLI

    node src/cli.cjs prepare --video recording.mp4 --knowledge facts.txt --data ./projects

多个原片可重复使用 `--video`，路径包含空格时加引号，Windows、macOS、Linux 用法相同：

    node src/cli.cjs prepare --video "first recording.mp4" --video "second recording.mov" --knowledge facts.txt --data ./projects

输出项目 ID、剧本位置和当前哈希。人工阅读后：

    node src/cli.cjs approve --project UUID --hash CURRENT_HASH --data ./projects
    node src/cli.cjs render --project UUID --data ./projects

可单独启动浏览器工作台：

    npm run build
    node src/cli.cjs studio --data ./projects

不要让多个进程同时写同一项目数据目录。

## 导出文件

每个确认版本使用独立输出目录，保留 tutorial.mp4、subtitles.srt、script.json、edit-plan.json、cost.json、verification.json、approval.json、config.json 和 narration.wav。逐段 WAV 按内容与模型参数缓存，取消后可重试，复用缓存不会重复调用 TTS。

项目保存初稿、Max 修订、视觉校对和人工编辑历史。导入时独立复制每个源视频并记录 SHA256，同名文件不会覆盖。确认绑定完整素材清单，制作前重新检查所有原片内容；确认后修改任一素材或知识将无法直接复用确认。旧单视频项目自动补齐素材清单，保留原剧本和已有确认。`edit-plan.json` 同时记录素材清单与各分镜的 `source_id`，便于追溯剪辑来源。源视频、生成文件、知识及密钥均保存在用户目录，Git 忽略项目数据与媒体。桌面应用会记住上一次的工作目录。

桌面拖入使用 Electron 的 [webUtils.getPathForFile](https://www.electronjs.org/docs/latest/api/web-utils)，通过 preload 读取本机文件路径。媒体工具根据当前平台解析：Windows 使用 `.exe`，macOS 和 Linux 使用无后缀可执行文件；打包配置从本机安装的依赖提取对应平台和架构的工具。各平台应在对应操作系统、目标架构安装依赖后构建，不能把 Windows 的 `node_modules` 直接用于 macOS/Linux。渲染字体优先使用系统中文字体，Linux 建议安装 Noto CJK。

## Windows 发行包

GitHub Releases 提供 Windows 10/11 x64 安装程序与免安装 ZIP。下载发行包不需要 Node.js、FFmpeg 或 ReactBits 授权；首次打开在设置中填写自己的模型 API Key。当前版本未做代码签名。

在有 ReactBits Pro 授权且已安装组件的 Windows x64 开发环境中：

    npm run release:win

生成 release/Tutor-VERSION-windows-x64-setup.exe、portable.zip 和 SHA256SUMS.txt。打包只携带编译后的应用界面、业务代码、运行时依赖和媒体工具；不携带组件 JSX、Agent Kit、密钥、个人设置或素材。FFmpeg/FFprobe 放在 resources/tools，原生 Canvas 模块解包到 app.asar.unpacked。许可证与媒体来源在 resources/licenses。

发行包可独立检查原生模块、真实视频合成与解码、静音间隔、文档模块和界面资源；不调用计费模型：

    Tutor.exe --smoke-test C:/Temp/tutor-release-check.json

## 验证

    npm run check
    npm run build
    npm test

另可运行 `npm run test:desktop`：在隐藏的真实 Electron 窗口中检查多文件导入、损坏/超长素材、无 Key 导入、联合脚本、人工解决问题、跨端口草稿恢复、快捷键保存、非法 JSON、配音失败重试、实际导出播放、取消继续和小窗口布局。使用临时项目和模拟模型/音频响应，不调用付费接口，切割与编码使用真实 FFmpeg。截图、示例成片与报告保存在 `build/generated/multi-video-smoke`；长字幕和定格后继续动作的画面验证保存在 `build/generated/quality-check`。

测试覆盖模型源迁移、路由及 Key 继承、音频缓存兼容、多素材独立导入、联合脚本生成与逐素材校对、片内时间范围、旧项目迁移、全部素材的人工确认与变更检查、缓存 Token 计费、长解说的静音间隔，以及真实 FFmpeg 横竖屏混合剪辑与画面颜色验证。平台工具路径会分别模拟 Windows、macOS 和 Linux；本机测试不替代其他操作系统的实际运行验证。

参考：

- [百炼音色目录](https://platform.qianwenai.com/docs/developer-guides/speech/voice-list/qwen-audio-tts)
- [百炼 TTS HTTP API](https://help.aliyun.com/zh/model-studio/qwen-audio-tts-http-api)
- [模型价格](https://help.aliyun.com/zh/model-studio/model-pricing)
- [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage)
- [ReactBits Pro App UI](https://pro.reactbits.dev/docs/app-ui)
- [ReactBits Pro Agent Kit](https://pro.reactbits.dev/docs/agent-kit)
- [ReactBits Pro 许可证](https://pro.reactbits.dev/license)
