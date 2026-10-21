import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const out = fileURLToPath(new URL('../assets/', import.meta.url));
await mkdir(out, { recursive: true });
const defs = `<defs><linearGradient id="paper" x2=".8" y2="1"><stop stop-color="#fff"/><stop offset="1" stop-color="#eff4fc"/></linearGradient><linearGradient id="blue" x2="1" y2="1"><stop stop-color="#6da5ff"/><stop offset="1" stop-color="#2864c7"/></linearGradient><linearGradient id="navy" x2=".5" y2="1"><stop stop-color="#263e67"/><stop offset="1" stop-color="#13223c"/></linearGradient><filter id="shadow" x="-50%" y="-50%" width="200%" height="220%"><feDropShadow dx="0" dy="18" stdDeviation="16" flood-color="#29456a" flood-opacity=".14"/></filter><filter id="glow"><feGaussianBlur stdDeviation="35"/></filter></defs>`;
const docLines = (x, y, widths, color = '#c9d5e8') =>
  widths
    .map(
      (width, i) =>
        `<rect x="${x}" y="${y + i * 17}" width="${width}" height="5" rx="2.5" fill="${color}"/>`,
    )
    .join('');
const check = (x, y, bg = '#3785ff', scale = 1) =>
  `<g transform="translate(${x} ${y}) scale(${scale})"><circle r="13" fill="${bg}"/><path d="m-6 0 4 4 8-9" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></g>`;
const wrap = (content) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="680" height="600" viewBox="0 0 680 600" fill="none">${defs}<g font-family="Inter,-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif">${content}</g></svg>\n`;
const arts = {
  'art-import': `
    <ellipse cx="350" cy="345" rx="220" ry="160" fill="#9ebff3" opacity=".23" filter="url(#glow)"/>
    <path d="M95 390c60 100 328 132 474-30" stroke="#9bb8e3" stroke-dasharray="3 8"/>
    <g transform="translate(110 138) rotate(-10 145 160)" filter="url(#shadow)"><rect width="275" height="280" rx="20" fill="url(#paper)" stroke="#fff" stroke-width="2"/><rect x="20" y="21" width="235" height="152" rx="11" fill="url(#navy)"/><path d="m130 71 39 26-39 25Z" fill="#fff"/><path d="M37 39h8m0 116h-8m192-116h8m-8 116h8" stroke="#7c9ac7" stroke-width="5" stroke-linecap="round"/>${docLines(27, 202, [169, 213, 130])}<rect x="26" y="252" width="63" height="10" rx="5" fill="#d5e4fc"/><text x="26" y="189" fill="#68819e" font-size="9" letter-spacing="1.6">SCREEN RECORDING</text></g>
    <g transform="translate(333 207) rotate(10 100 120)" filter="url(#shadow)"><rect width="209" height="246" rx="17" fill="#fff" stroke="#dae4f3"/><rect x="22" y="23" width="33" height="40" rx="6" fill="#e4eeff"/><path d="M30 35h16m-16 8h16m-16 8h9" stroke="#508bea" stroke-width="2" stroke-linecap="round"/><text x="22" y="89" fill="#354b6d" font-size="13" font-weight="600">你的知识资料</text>${docLines(22, 109, [158, 143, 161, 112])}<rect x="22" y="198" width="67" height="24" rx="12" fill="#f0f4fa"/><text x="37" y="214" fill="#7285a1" font-size="9">DOCX</text></g>
    <g transform="translate(463 116) rotate(9)"><rect width="77" height="77" rx="22" fill="url(#blue)" filter="url(#shadow)"/><path d="M22 21h34M39 22v35" stroke="#fff" stroke-width="7" stroke-linecap="round"/><circle cx="59" cy="58" r="3" fill="#bddeff"/></g>
    <circle cx="147" cy="437" r="6" fill="#699be7" opacity=".5"/><path d="M562 354v16m-8-8h16" stroke="#86a7d9" stroke-width="2" stroke-linecap="round"/>
  `,
  'art-review': `
    <ellipse cx="356" cy="342" rx="214" ry="155" fill="#a7bfe2" opacity=".2" filter="url(#glow)"/>
    <g transform="translate(150 129) rotate(-7 150 170)" filter="url(#shadow)"><rect width="316" height="335" rx="22" fill="url(#paper)" stroke="#fff" stroke-width="2"/><rect x="24" y="24" width="72" height="21" rx="10.5" fill="#e7effa"/><text x="37" y="38" fill="#6182b2" font-size="9" letter-spacing="1">SCRIPT / 02</text><text x="25" y="82" fill="#283d5b" font-size="19" font-weight="600">把每一步讲清楚</text><path d="M25 100h265" stroke="#e4eaf2"/>${check(38, 133)}${docLines(64, 125, [173, 213])}${check(38, 194)}${docLines(64, 186, [208, 161])}<circle cx="38" cy="255" r="13" fill="#edf2fa" stroke="#a6bce0"/><text x="34" y="259" font-size="10" fill="#8da7d1">3</text>${docLines(64, 247, [183, 205])}<rect x="25" y="294" width="265" height="19" rx="5" fill="#eef3fa"/></g>
    <g transform="translate(358 318) rotate(8)" filter="url(#shadow)"><rect width="207" height="112" rx="17" fill="#fff" stroke="#dbe5f5"/><circle cx="29" cy="31" r="12" fill="#e7f0ff"/><path d="m23 31 5 4 8-9" stroke="#3785ff" stroke-width="1.7" stroke-linecap="round"/><text x="50" y="36" fill="#34537e" font-size="13" font-weight="600">由你确认，再制作</text><rect x="20" y="58" width="167" height="33" rx="16.5" fill="url(#blue)"/><text x="66" y="79" fill="#fff" font-size="11">确认当前版本</text></g>
    <path d="m492 195 42 26-23 5-7 24Z" fill="#3785ff" stroke="#d6e5ff" stroke-width="3" stroke-linejoin="round"/><path d="M110 335v17m-8-9h16" stroke="#8caddb" stroke-width="2" stroke-linecap="round"/><circle cx="498" cy="144" r="5" fill="#a0b7d9"/>
  `,
  'art-voice': `
    <ellipse cx="360" cy="325" rx="206" ry="142" fill="#4786e5" opacity=".15" filter="url(#glow)"/>
    <g transform="translate(106 146) rotate(-6 225 170)" filter="url(#shadow)"><rect width="447" height="315" rx="23" fill="#172b49" stroke="#49638b" stroke-opacity=".55"/><path d="M0 54h447" stroke="#3b5073"/><circle cx="26" cy="28" r="4" fill="#6480a8"/><circle cx="42" cy="28" r="4" fill="#506c94"/><circle cx="58" cy="28" r="4" fill="#3e5b83"/><text x="317" y="33" fill="#9cb4d7" font-size="9" letter-spacing="1.5">THE RIGHT PACE</text><g transform="translate(25 85)"><rect width="120" height="77" rx="9" fill="#294672"/><rect x="133" width="131" height="77" rx="9" fill="#375b8e"/><rect x="277" width="120" height="77" rx="9" fill="#28456f"/><path d="m50 26 24 13-24 13Zm137 0 24 13-24 13Zm139 0 24 13-24 13Z" fill="#a8c8f8" opacity=".7"/></g><rect x="25" y="184" width="397" height="54" rx="8" fill="#203b61"/>${Array.from(
      { length: 54 },
      (_, i) => {
        const height = 6 + Math.abs(Math.sin(i * 0.8) * Math.cos(i * 0.17)) * 32;
        return `<rect x="${35 + i * 7}" y="${211 - height / 2}" width="3" height="${height}" rx="1.5" fill="${i < 25 ? '#76adff' : '#547caf'}"/>`;
      },
    ).join(
      '',
    )}<rect x="25" y="255" width="169" height="26" rx="6" fill="#3b5476"/><rect x="205" y="255" width="217" height="26" rx="6" fill="#304c73"/><text x="45" y="272" fill="#a7bcda" font-size="10">讲解与画面，同一个节奏</text><path d="M205 73v216" stroke="#f5ba76" stroke-width="2"/><path d="m200 69 5 7 5-7" fill="#f5ba76"/></g>
    <g transform="translate(438 116) rotate(9)" filter="url(#shadow)"><rect width="93" height="93" rx="25" fill="url(#blue)"/><rect x="37" y="22" width="19" height="31" rx="9.5" stroke="#e4efff" stroke-width="3"/><path d="M29 43v3a18 18 0 0 0 36 0v-3M47 65v9m-10 0h20" stroke="#e4efff" stroke-width="3" stroke-linecap="round"/></g><circle cx="153" cy="120" r="4" fill="#6d9fdf" opacity=".5"/>
  `,
  'art-export': `
    <ellipse cx="340" cy="355" rx="219" ry="150" fill="#a5bce1" opacity=".23" filter="url(#glow)"/>
    <g transform="translate(110 139) rotate(-7 200 140)" filter="url(#shadow)"><rect width="388" height="269" rx="19" fill="#fcfaf4" stroke="#fff" stroke-width="2"/><text x="21" y="32" fill="#28394b" font-size="13" font-weight="700" letter-spacing="1.3">TUTOR</text><rect x="83" y="22" width="53" height="2" rx="1" fill="#d0b997"/><text x="290" y="32" font-size="9" fill="#9b8c79">01 / 创建知识库</text><rect x="15" y="48" width="358" height="164" rx="6" fill="url(#navy)"/><rect x="37" y="65" width="57" height="132" rx="4" fill="#2c4670"/><rect x="107" y="65" width="248" height="26" rx="4" fill="#e8eef7"/><rect x="107" y="103" width="116" height="93" rx="5" fill="#496c9c"/><rect x="235" y="103" width="120" height="93" rx="5" fill="#314f79"/><path d="m229 115 33 18-33 18Z" fill="#fff" opacity=".95"/><text x="84" y="235" font-size="11" fill="#877d6e">把你的经验，讲给更多人。</text><rect x="15" y="251" width="112" height="4" rx="2" fill="#df9b55"/><rect x="138" y="251" width="112" height="4" rx="2" fill="#d6cebe"/><rect x="261" y="251" width="112" height="4" rx="2" fill="#d6cebe"/></g>
    <g transform="translate(207 377) rotate(8)" filter="url(#shadow)"><rect width="107" height="93" rx="13" fill="#fff" stroke="#dce6f4"/><rect x="14" y="14" width="31" height="31" rx="9" fill="#e3edff"/><path d="m25 23 12 7-12 7Z" fill="#3785ff"/><text x="15" y="70" font-size="12" fill="#526a8e" font-weight="600">MP4</text></g><g transform="translate(322 395) rotate(8)" filter="url(#shadow)"><rect width="107" height="93" rx="13" fill="#fff" stroke="#dce6f4"/><rect x="14" y="14" width="31" height="31" rx="9" fill="#eef2f7"/><path d="M22 25h15m-15 7h11" stroke="#91a8c6" stroke-width="2" stroke-linecap="round"/><text x="15" y="70" font-size="12" fill="#526a8e" font-weight="600">SRT</text></g><g transform="translate(436 413) rotate(8)" filter="url(#shadow)"><rect width="107" height="93" rx="13" fill="#fff" stroke="#dce6f4"/><text x="20" y="40" fill="#7b97c1" font-size="20" font-weight="600">{ }</text><text x="15" y="70" font-size="12" fill="#526a8e" font-weight="600">JSON</text></g>${check(522, 172, '#3785ff', 1.5)}
  `,
};
for (const [name, content] of Object.entries(arts))
  await writeFile(`${out}${name}.svg`, wrap(content));

const ribbons = Array.from({ length: 90 }, (_, i) => {
  const y = 168 + i * 8;
  const hue = i < 40 ? '#6e9ee8' : '#a1c0ef';
  const opacity = 0.055 + Math.sin((i / 90) * Math.PI) * 0.12;
  return `<path d="M-180 ${y + 170}C180 ${y - 340},470 ${y + 435},800 ${y + 20}S1340 ${y - 410},1810 ${y + 50}" stroke="${hue}" stroke-width="${i % 4 === 0 ? 9 : 2}" opacity="${opacity.toFixed(3)}"/>`;
}).join('');
await writeFile(
  `${out}silk.svg`,
  `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1100" viewBox="0 0 1600 1100" fill="none"><defs><radialGradient id="wash"><stop stop-color="#b9d1f5" stop-opacity=".5"/><stop offset="1" stop-color="#f5f3ee" stop-opacity="0"/></radialGradient><filter id="soft"><feGaussianBlur stdDeviation="1.5"/></filter></defs><path fill="#f5f3ee" d="M0 0h1600v1100H0z"/><ellipse cx="780" cy="430" rx="830" ry="470" fill="url(#wash)"/><g filter="url(#soft)">${ribbons}</g></svg>\n`,
);
console.log('Generated four original workflow illustrations and the silk backdrop.');
