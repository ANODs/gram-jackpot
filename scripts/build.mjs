// Сжимает src/widget.src.html в src/widget.html и src/widget.en.html (их отправляет бот) и кладёт копии в docs/ (демо).
// Telegram принимает виджет до 32768 байт и до 4096 байт после zlib уровня 9.
import { readFileSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { minify } from 'terser';

const root = new URL('..', import.meta.url);
const src = readFileSync(new URL('src/widget.src.html', root), 'utf8');

const css = /<style>([\s\S]*?)<\/style>/.exec(src)[1];
const js = /<script>([\s\S]*?)<\/script>/.exec(src)[1];
const body = src
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/<style>[\s\S]*?<\/style>/, '')
  .replace(/<script>[\s\S]*?<\/script>/, '')
  .replace(/>\s+</g, '><')
  .trim();

// CSS сжимаем сами, без esbuild: он переписывает ::after в :after и rgba() в #rrggbbaa,
// а профиль виджетов таких форм не обещает. Исходник уже плотный, убираем только комментарии и переносы.
const minCss = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s*\n\s*/g, '').trim();
const minJs = (await minify(js, { ecma: 2020, compress: { passes: 3, unsafe_arrows: true, unsafe_math: true }, mangle: true, format: { comments: false } })).code;

const html = `<style>${minCss}</style>${body}<script>${minJs}</script>`;

// Сервер Telegram считает как zlib из Python; zlib в Node даёт на 50–150 байт больше.
// Поэтому точный размер берём у python3, а без него сверяемся с Node, вычитая типичную разницу.
const packedSize = (text) => {
  try {
    return Number(execFileSync('python3', ['-c', 'import sys,zlib;print(len(zlib.compress(sys.stdin.buffer.read(),9)))'], { input: text }));
  } catch {
    return deflateSync(text, { level: 9 }).length - 50;
  }
};
const check = (name, text) => {
  const raw = Buffer.byteLength(text), packed = packedSize(text);
  console.log(`${name}: ${raw} байт, после zlib ${packed} из 4096`);
  if (raw > 32768 || packed > 4096) {
    console.error('Виджет не влезает в лимит Telegram');
    process.exit(1);
  }
};

// Английская версия: тот же виджет с переведёнными строками. Версий две, а не одна с переключателем,
// потому что обе вместе не влезают в лимит; бот шлёт нужную по языку пользователя.
const EN = {
  'Стань первым': 'Be the first',
  'Крутим': 'Spinning',
  'Ждём соперника': 'Waiting for a rival',
  'Подробнее о виджете': 'About this widget',
  'Отменено': 'Cancelled',
  'Сбой. Если GRAM списан, зачислим': 'Failed. Charged GRAM will be counted',
  'Закинуть ': 'Bet ',
};
let en = html;
for (const [ru, text] of Object.entries(EN)) {
  if (!en.includes(ru)) throw new Error(`Нет строки для перевода: ${ru}`);
  en = en.split(ru).join(text);
}
const left = en.match(/[А-Яа-яЁё]+/g);
if (left) throw new Error(`Остались непереведённые строки: ${left.join(', ')}`);

check('widget.html', html);
check('widget.en.html', en);
for (const dir of ['src', 'docs']) {
  writeFileSync(new URL(`${dir}/widget.html`, root), html);
  writeFileSync(new URL(`${dir}/widget.en.html`, root), en);
}
