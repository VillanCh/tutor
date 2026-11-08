# Third party components

Tutor business code is MIT licensed. That license does not apply to third party packages or to locally installed ReactBits Pro content.

- ReactBits Pro App UI and Agent Kit: proprietary, installed with the developer's own license from the official registry. Source, adapted source, skills, license key, and built frontend stay outside version control. See https://pro.reactbits.dev/license.
- shadcn/ui and Radix UI: MIT. Standard controls are installed into src/ui/components/ui.
- Inter and JetBrains Mono: SIL Open Font License 1.1. Their license files are supplied by the @fontsource-variable packages in node_modules.
- Noto Sans CJK SC Regular: SIL Open Font License 1.1, bundled for portable Chinese video rendering. Original font and license: https://github.com/notofonts/noto-cjk/tree/main/Sans. License is retained in build/fonts/LICENSE.txt.
- Space Grotesk: SIL Open Font License 1.1, bundled for offline wordmark rendering and preview. Original unmodified variable font: https://github.com/google/fonts/tree/main/ofl/spacegrotesk. License is retained in build/fonts/SpaceGrotesk-LICENSE.txt.
- Electron, React, Motion, Lucide, FFmpeg and other npm packages retain their respective licenses. FFmpeg is a separate executable launched by the JavaScript application.

The install and adaptation scripts contain Tutor business integration logic. They obtain licensed component markup locally and do not provide a public mirror of ReactBits Pro source.
