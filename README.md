# Tutor

用录屏和知识资料制作教学视频的 Electron 工作台。全部业务代码、图片排版、音频调度与视频流程均为 JavaScript；媒体编解码使用随 npm 安装的 FFmpeg。

默认流程：

1. Qwen3.8 Omni Flash 读取视频并生成结构化初稿。
2. DeepSeek V4.1 Flash 根据初稿与知识资料修订错误、概念和表达。
3. Omni 再对照视频校对修订稿。
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

桌面工作台的“模型与制作设置”提供百炼、AIBalance 和自定义源。每个源配置 Chat 地址、语音协议、语音地址与 Key，三个角色分别选择源并继承连接设置。默认改稿模型为 AIBalance 的 deepseek-v4.1-flash，视觉和配音默认使用百炼；可以将三个角色都切换到 AIBalance。模型通过选择框选择，也支持从源加载模型列表或手动输入。旧版的接口与独立凭据自动迁移，音频缓存继续复用。公开代码只包含服务的通用接口，不包含个人业务空间地址或预置密钥。首次启动可用 QWEN_BASE_ORIGIN 指定百炼业务空间域名，本机已保存的设置优先。各源的 Key 使用 Electron safeStorage 加密保存在本机用户数据目录，不进入仓库，也不会返回到页面。

API Key 也可用 QWEN_API_KEY 和 AIBALANCE_API_KEY 环境变量传入。设置 TUTOR_DATA_DIR 可修改项目数据位置。桌面模式会保留加密凭据；CLI 模式只使用本次进程的环境变量，不写入明文密钥。更换模型或源后价格保持未知，按实际单价更新高级配置并设置 pricingKnown 为 true 后才估算费用。

## 工作台

顶栏：导入素材 → 对话改稿 → 审核制作 → 导出成片，当前阶段和下一步操作都明确显示。桌面窗口采用沉浸式深色标题栏，应用顶栏可拖动，保留系统的最小化、最大化、关闭与窗口吸附。

左侧：AI 对话与修改建议。模型中间输出显示在独立 JSON 代码框中，完整内容可滚动、选择与复制，显示当前阶段及 Token 估计；最终说明仍以正文显示。点选右侧分镜后，“让 AI 改这一段”将段落名称放入对话框；Enter 发送，Shift + Enter 换行，Ctrl + K 聚焦输入。

右侧：导入视频与知识、分镜时间轴、解说编辑、对应原片时间点、大画面原始与成品预览、格式化 JSON Dump 和制作记录。

底栏和制作记录：接口实际输入输出 Token、当前生成 Token 估计、调用次数、请求与响应载荷流量和估算费用。未知的计费用量保持未知，不记为零成本。

审核对话框：确认当前版本后才进行配音和制作。未保存的编辑不能用于制作，AI 不能代替人工确认。

## 配音与风格

- 模型：qwen-audio-3.1-tts-flash。
- 界面“沉稳男声”：龙安朗，longanlang_v3.1，默认使用。
- 界面“解说女声”：许言初，xuyanchu_v3.1。
- 48 kHz WAV，中性普通话教程指令，默认语速 1.0。
- Yak 米白底、墨色文字、橙色和陶土色点缀、大录屏区域、底部字幕和章节时间轴。
- 界面与视频标题、字幕、时间轴内置 Noto Sans CJK SC 中文字体，离线加载，随发行包携带，不需要操作系统预装字体。已导出的成片需重新制作才会使用新字体。
- 成片左上角使用内置 Space Grotesk 粗体商标字体，中文品牌名称使用内置中文字体。设置中的“成片品牌与章节”可配置品牌名称、副标题、显示开关、点缀色及章节分段间距，并提供即时预览。名称、步骤标题和计时统一对齐，长文字自动省略，避免相互遮挡。
- 底部进度条按真实章节时长分段，章节之间保留清晰间隔；进度填充不会覆盖断点。新样式用于下一次制作，已有成片文件保持原样。

支持 1 到 5 个章节，输入视频最长 10 分钟。画面等比缩放，输出画布随素材纵横比调整。知识文件支持 TXT、MD、JSON、DOCX。字幕按句呈现，句内时序根据旁白长度分配，不是逐字强制对齐。

## 自定义接口与 AI Balance

在设置中选择内置 AIBalance 源并填写 Key，或点“添加自定义源”配置其他服务，再将需要的模型切换到此源：

- 视觉与改写模型：OpenAI Chat 协议，地址填到 /v1 或 compatible-mode/v1，程序追加 /chat/completions。
- 百炼原生 TTS：地址填完整 SpeechSynthesizer 端点。
- OpenAI Speech TTS：地址填到 /v1，程序追加 /audio/speech。

Chat 和语音不是同一个协议：Omni 与改稿模型请求 /chat/completions；默认 Qwen TTS 请求原生 SpeechSynthesizer。内置 AIBalance Chat 地址为 https://aibalance.yaklang.com/v1，语音默认使用同域的 /api/v1/services/audio/tts/SpeechSynthesizer，也可切换到 /v1/audio/speech。其他网关需实际支持所选模型和视频输入或语音输出，声线名称以对应服务商支持的值为准。

高级 JSON 中 sources 是连接设置的来源，roles 使用 sourceId 选择源，baseUrl、protocol、credential 会据此解析。新增源可暂时留空，选中的源必须有对应接口地址。输入完整的 /chat/completions 或 /audio/speech 地址也会在保存时自动规范化。

## CLI

    node src/cli.cjs prepare --video recording.mp4 --knowledge facts.txt --data ./projects

输出项目 ID、剧本位置和当前哈希。人工阅读后：

    node src/cli.cjs approve --project UUID --hash CURRENT_HASH --data ./projects
    node src/cli.cjs render --project UUID --data ./projects

可单独启动浏览器工作台：

    npm run build
    node src/cli.cjs studio --data ./projects

不要让多个进程同时写同一项目数据目录。

## 导出文件

每个确认版本使用独立输出目录，保留 tutorial.mp4、subtitles.srt、script.json、edit-plan.json、cost.json、verification.json、approval.json、config.json 和 narration.wav。逐段 WAV 按内容与模型参数缓存，取消后可重试，复用缓存不会重复调用 TTS。

项目保存初稿、改稿模型修订、视觉校对和人工编辑历史。导入时会复制源视频并记录 SHA256，确认后修改素材或知识将无法直接复用确认。源视频、生成文件、知识及密钥均保存在用户目录，Git 忽略项目数据与媒体。桌面应用会记住上一次的工作目录。

## 桌面发行包

GitHub Releases 提供 macOS Apple Silicon / Intel 的 DMG 与 ZIP，以及 Windows 10/11 x64 安装程序与免安装 ZIP。发行包自带媒体工具、中文字体和商标字体，不依赖联网加载字体或系统字体。首次打开在设置中填写自己的模型 API Key。Windows 包未做代码签名；macOS 包采用本地临时签名，未进行 Apple Developer ID 签名及公证。

在有 ReactBits Pro 授权且已安装组件的 Windows x64 开发环境中：

    npm run release:win

在对应架构的 macOS 开发环境中，先安装 pkgconf 与 Xcode 命令行工具，然后运行：

    npm run release:mac

macOS 打包会从固定 SHA256 的 FFmpeg 6.1.1 和 x264 源码构建仅依赖系统库的媒体工具，构建缓存位于 build/generated。原始源码、构建参数与许可证随发行包提供。GitHub Actions 的原生 Windows / Intel Mac 构建使用开发者上传到 Release 草稿的已编译 UI，执行全部测试与发行包检查；不需要上传 ReactBits Pro 组件源码或授权 Key。

生成 release/Tutor-VERSION-windows-x64-setup.exe、portable.zip，或 Tutor-VERSION-macOS-ARCH.dmg、zip，以及对应平台的 SHA256 校验值。打包只携带编译后的应用界面、业务代码、运行时依赖和媒体工具；不携带组件 JSX、Agent Kit、密钥、个人设置或素材。FFmpeg/FFprobe 放在 resources/tools，原生 Canvas 模块解包到 app.asar.unpacked。许可证与媒体来源在 resources/licenses。

发行包可独立检查原生模块、真实视频合成与解码、静音间隔、文档模块和界面资源；不调用计费模型：

    Tutor.exe --smoke-test C:/Temp/tutor-release-check.json

## 验证

    npm run check
    npm run build
    npm test

测试覆盖模型源迁移、路由及 Key 继承、音频缓存兼容、时间范围、人工确认与撤销、缓存 Token 计费、长解说的静音间隔，以及真实 FFmpeg 的等比画面合成与解码。

参考：

- [百炼音色目录](https://platform.qianwenai.com/docs/developer-guides/speech/voice-list/qwen-audio-tts)
- [百炼 TTS HTTP API](https://help.aliyun.com/zh/model-studio/qwen-audio-tts-http-api)
- [模型价格](https://help.aliyun.com/zh/model-studio/model-pricing)
- [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage)
- [ReactBits Pro App UI](https://pro.reactbits.dev/docs/app-ui)
- [ReactBits Pro Agent Kit](https://pro.reactbits.dev/docs/agent-kit)
- [ReactBits Pro 许可证](https://pro.reactbits.dev/license)
