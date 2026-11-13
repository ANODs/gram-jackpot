// Собирает стартовую гифку бота (картинка описания в BotFather): art/start.mp4, art/start.gif, art/start.png.
// Слева название и подпись, справа белая карточка с настоящим виджетом (docs/widget.en.html), который играет
// раунд по сценарию: ставки, таймер, раскрутка, победитель. Кадры снимает headless Chrome. Часы внутри виджета
// подменены: страница сама проматывает игру до нужной миллисекунды, поэтому каждый кадр точный. CSS-анимации
// виджета в кадрах отключены (headless Chrome их не проматывает): строки игроков появляются сразу.
//   node art/build-start.mjs        (нужны Google Chrome и ffmpeg; сначала npm run build)
import { execFile, execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const art = fileURLToPath(new URL('.', import.meta.url));
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const FROM = 700, TO = 11500, STEP = 100, FPS = 12.5; // миллисекунды сценария; гифка идёт чуть быстрее жизни

const widget = readFileSync(new URL('../docs/widget.en.html', import.meta.url), 'utf8');
const GEM = '<path d="M2 10 7 4h3l-2 6z" fill="#5CC4F2"/><path d="M10 4h4l2 6H8z" fill="#8FDAFA"/><path d="M14 4h3l5 6h-6z" fill="#41B4EA"/><path d="M2 10h6l4 11z" fill="#2A9FDD"/><path d="M8 10h8l-4 11z" fill="#37AEE2"/><path d="M16 10h6L12 21z" fill="#1A8AD0"/>';

// Внутренность iframe: подменённые часы, бот-заглушка со сценарием раунда и сам виджет
const inner = (t) => `<!doctype html><meta charset="utf-8"><style>:root{--tg-theme-bg-color:#fff;--tg-theme-text-color:#000;--tg-theme-hint-color:#8a8f96}html{background:#fff;color:#000;font:15px -apple-system,"SF Pro Text","Helvetica Neue",sans-serif}*{animation:none!important;transition:none!important}</style><script>
const BASE = 1794600000000; let NOW = BASE, timers = [], rafs = [];
Date.now = () => NOW;
window.setTimeout = (fn, ms) => { timers.push([NOW + (ms || 0), fn]); };
window.requestAnimationFrame = (fn) => { rafs.push(fn); };
const sec = () => Math.floor(NOW / 1000), handlers = {};
let stakes = [[11, 'Anna', 5], [12, 'Max', 3], [13, 'Kira', 2]], win = null;
const state = () => {
  const p = [...stakes].sort((a, b) => b[2] - a[2]);
  const d = { i: 7, e: win ? 0 : BASE / 1000 + 3, c: sec(), t: p.reduce((s, x) => s + x[2], 0), p: p.map((x) => [x[0], x[1], x[2], '']), o: [0, 0], x: [0.5, 1, 2, 5, 10], u: 'TheGramPotBot', h: 'a41c09e2' };
  if (win) d.w = win;
  return JSON.stringify(d);
};
const push = () => { TelegramWidget.publicData = state(); handlers.publicDataChanged && handlers.publicDataChanged(); };
const bet = (id, name, amount) => { const s = stakes.find((x) => x[0] === id); s ? s[2] += amount : stakes.push([id, name, amount]); push(); };
window.TelegramWidget = {
  viewer: { id: 14, first_name: 'Leo' }, chatType: 'group', isActive: true, themeParams: { text_color: '#000000', bg_color: '#ffffff' },
  publicData: state(), chatData: '{"s":0}', wallet: {},
  HapticFeedback: { impactOccurred() {}, notificationOccurred() {}, selectionChanged() {} },
  request: () => new Promise(() => {}), openTelegramLink() {}, onEvent: (name, fn) => { handlers[name] = fn; }, ready() {},
};
// Сценарий: две ставки, на третьей секунде розыгрыш. Побеждает Max: его сектор второй, стрелка встаёт в его середину
setTimeout(() => bet(15, 'Rustam', 4), 900);
setTimeout(() => bet(12, 'Max', 2), 1900);
setTimeout(() => { win = [12, 15.2, 469, sec()]; push(); }, 3000);
addEventListener('load', async () => {
  while (NOW < BASE + ${t}) {
    NOW += 16;
    const due = timers.filter((x) => x[0] <= NOW); timers = timers.filter((x) => x[0] > NOW);
    for (const x of due) x[1]();
    const now = rafs; rafs = [];
    for (const fn of now) fn(NOW);
    await null; await null;
  }
});
<\/script>${widget}`;

const esc = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const page = (t) => `<!doctype html><meta charset="utf-8"><style>
html,body{margin:0;width:640px;height:360px;overflow:hidden;font-family:-apple-system,"SF Pro Display","Helvetica Neue",sans-serif}
body{position:relative;background:linear-gradient(135deg,#41C0F5,#1A8AD0)}
.glow{position:absolute;inset:0;background:radial-gradient(circle at 28% 20%,rgba(255,255,255,.28),transparent 70%)}
.left{position:absolute;left:40px;top:0;bottom:0;width:270px;display:flex;flex-direction:column;justify-content:center;color:#fff}
.logo{width:64px;height:64px;border-radius:18px;background:#fff;box-shadow:0 8px 18px rgba(11,79,126,.28);display:grid;place-items:center}
.logo svg{width:52px;height:52px}
h1{margin:18px 0 0;font-size:44px;line-height:1.02;font-weight:800;letter-spacing:-.03em}
p{margin:10px 0 0;font-size:16px;line-height:1.3;opacity:.92}
.pill{margin-top:20px;align-self:flex-start;background:#fff;color:#1E96C8;font-weight:700;font-size:15px;padding:9px 18px;border-radius:30px;box-shadow:0 6px 16px rgba(11,79,126,.25)}
.card{position:absolute;left:340px;top:21px;width:270px;height:318px;overflow:hidden;background:#fff;border-radius:22px 22px 22px 6px;box-shadow:0 16px 36px rgba(11,79,126,.35)}
iframe{width:370px;height:436px;border:0;transform:scale(.73);transform-origin:0 0}
</style>
<div class="glow"></div>
<div class="left">
  <div class="logo"><svg viewBox="0 0 52 52"><g fill="none" stroke-width="7" transform="rotate(-90 26 26)"><circle cx="26" cy="26" r="19" stroke="#37AEE2" stroke-dasharray="51 68.4" stroke-dashoffset="-1.5"/><circle cx="26" cy="26" r="19" stroke="#F7A928" stroke-dasharray="27 92.4" stroke-dashoffset="-55.5"/><circle cx="26" cy="26" r="19" stroke="#1A8AD0" stroke-dasharray="20 99.4" stroke-dashoffset="-85.5"/><circle cx="26" cy="26" r="19" stroke="#8FDAFA" stroke-dasharray="9.5 109.9" stroke-dashoffset="-108.5"/></g><g transform="translate(26 26.5) scale(.95) translate(-12 -12.5)">${GEM}</g></svg></div>
  <h1>Gram<br>Pot</h1>
  <p>One pot. One winner.<br>Right in the chat.</p>
  <div class="pill">Open the pot</div>
</div>
<div class="card"><iframe srcdoc="${esc(inner(t))}"></iframe></div>`;

const dir = mkdtempSync(join(tmpdir(), 'pot-start-'));
const times = [];
for (let t = FROM; t <= TO; t += STEP) times.push(t);
const shot = async (t, i) => {
  const html = join(dir, `f${i}.html`), png = join(dir, `f${String(i).padStart(4, '0')}.png`);
  writeFileSync(html, page(t));
  await run(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1', '--window-size=640,360',
    `--user-data-dir=${join(dir, 'p' + i)}`, '--virtual-time-budget=1500', `--screenshot=${png}`, `file://${html}`]).catch(() => {});
};
const only = process.argv[2];
if (only) {
  await shot(Number(only), 0);
  execFileSync('cp', [join(dir, 'f0000.png'), join(art, 'start.png')]);
} else {
  for (let i = 0; i < times.length; i += 8) {
    await Promise.all(times.slice(i, i + 8).map((t, k) => shot(t, i + k)));
    process.stdout.write(`\r${Math.min(i + 8, times.length)}/${times.length}`);
  }
  const frames = join(dir, 'f%04d.png');
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-framerate', String(FPS), '-i', frames, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-an', join(art, 'start.mp4')]);
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-framerate', String(FPS), '-i', frames, '-vf', 'split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer:bayer_scale=4', join(art, 'start.gif')]);
  execFileSync('cp', [join(dir, `f${String(Math.round((9800 - FROM) / STEP)).padStart(4, '0')}.png`), join(art, 'start.png')]);
  console.log('\nготово');
}
rmSync(dir, { recursive: true });
