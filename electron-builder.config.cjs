const path = require('node:path');
const ffmpeg = require('ffmpeg-static');
const ffprobe = require('ffprobe-static').path;
module.exports = {
  appId: 'com.yaklang.tutor',
  productName: 'Tutor',
  copyright: 'Copyright © 2026 VillanCh',
  directories: { output: 'release', buildResources: 'build' },
  electronDist: path.join(__dirname, 'node_modules/electron/dist'),
  asar: true,
  npmRebuild: false,
  files: [
    'src/**/*.cjs',
    'src/**/*.mjs',
    'dist/ui/**',
    'build/tutor.png',
    'package.json',
    'LICENSE',
    'THIRD_PARTY.md',
    '!src/ui/**',
    '!node_modules/ffmpeg-static/**',
    '!node_modules/ffprobe-static/**',
    '!**/*.map',
  ],
  asarUnpack: ['**/*.node'],
  extraResources: [
    {
      from: path.dirname(ffmpeg),
      to: 'tools',
      filter: [
        path.basename(ffmpeg),
        path.basename(ffmpeg) + '.LICENSE',
        path.basename(ffmpeg) + '.README',
      ],
    },
    { from: path.dirname(ffprobe), to: 'tools', filter: [path.basename(ffprobe)] },
    { from: 'build/generated/licenses', to: 'licenses' },
  ],
  win: {
    target: [
      { target: 'nsis', arch: ['x64'] },
      { target: 'zip', arch: ['x64'] },
    ],
    icon: 'build/tutor.ico',
    signExecutable: false,
    signAndEditExecutable: true,
    artifactName: 'Tutor-${version}-windows-${arch}-portable.${ext}',
  },
  mac: {
    target: ['dmg', 'zip'],
    category: 'public.app-category.video',
    artifactName: 'Tutor-${version}-mac-${arch}.${ext}',
  },
  linux: {
    target: ['AppImage', 'tar.gz'],
    category: 'AudioVideo',
    artifactName: 'Tutor-${version}-linux-${arch}.${ext}',
  },
  nsis: {
    artifactName: 'Tutor-${version}-windows-${arch}-setup.${ext}',
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    deleteAppDataOnUninstall: false,
    packElevateHelper: false,
    installerLanguages: ['zh_CN', 'en_US'],
  },
  publish: null,
};
