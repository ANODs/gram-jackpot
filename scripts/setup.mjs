// Один запуск: кошелёк банка, сборка и деплой на Cloudflare, секреты, вебхук и профиль бота.
//   BOT_TOKEN=токен_от_BotFather npm run setup
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mnemonicNew, mnemonicToPrivateKey } from '@ton/crypto';
import { WalletContractV4 } from '@ton/ton';

const token = process.env.BOT_TOKEN;
if (!token) {
  console.error('Запусти так: BOT_TOKEN=токен_от_BotFather npm run setup');
  process.exit(1);
}

const toml = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
const test = /^TEST_ENV\s*=\s*"1"/m.test(toml);

const api = async (method, params) => {
  const res = await fetch(`https://api.telegram.org/bot${token}${test ? '/test' : ''}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(params || {}),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(`${method}: ${json.description}`);
  return json.result;
};

// Токен проверяем до деплоя
const me = await api('getMe');
console.log(`Бот: @${me.username} (${test ? 'тестовый сервер' : 'обычный Telegram'})`);

// 1. Кошелёк банка. Создаётся один раз; 24 слова лежат только в .hot-wallet.txt на этом компьютере (в git файл не попадает).
// По этим словам кошелёк можно открыть в любом TON-кошельке как v4R2. Потеряешь файл — потеряешь доступ к деньгам банка.
const walletFile = fileURLToPath(new URL('../.hot-wallet.txt', import.meta.url));
let words;
if (existsSync(walletFile)) {
  words = readFileSync(walletFile, 'utf8').split('\n')[0].trim().split(/\s+/);
} else {
  words = await mnemonicNew();
  writeFileSync(walletFile, `${words.join(' ')}\n`, { mode: 0o600 });
}
const keys = await mnemonicToPrivateKey(words);
const address = WalletContractV4.create({ workchain: 0, publicKey: keys.publicKey }).address.toString({ bounceable: false, testOnly: test });
console.log(`Кошелёк банка: ${address}`);

// 2. Деплой: вывод показываем сразу и заодно ищем в нём адрес воркера
const output = await new Promise((resolve, reject) => {
  const child = spawn('npx', ['wrangler', 'deploy'], { stdio: ['inherit', 'pipe', 'inherit'] });
  let text = '';
  child.stdout.on('data', (chunk) => { text += chunk; process.stdout.write(chunk); });
  child.on('close', (code) => (code ? reject(new Error('wrangler deploy завершился с ошибкой')) : resolve(text)));
});
const url = /https:\/\/[^\s]+\.workers\.dev/.exec(output)?.[0];
if (!url) throw new Error('Не нашёл адрес воркера в выводе wrangler');

// 3. Секреты уходят в Cloudflare через временный файл, который сразу удаляется
const secret = randomBytes(24).toString('hex');
const dir = mkdtempSync(join(tmpdir(), 'pot-'));
const file = join(dir, 'secrets.json');
writeFileSync(file, JSON.stringify({ BOT_TOKEN: token, WEBHOOK_SECRET: secret, HOT_KEY: keys.secretKey.toString('hex') }), { mode: 0o600 });
try {
  execFileSync('npx', ['wrangler', 'secret', 'bulk', file], { stdio: 'inherit' });
} finally {
  rmSync(dir, { recursive: true });
}

// 4. Вебхук и профиль бота на двух языках
await api('setWebhook', { url: `${url}/tg`, secret_token: secret, allowed_updates: ['message', 'widget_query', 'shared_widget_query', 'my_chat_member'] });
const PROFILE = {
  ru: {
    name: 'Банка',
    short: 'Рулетка на GRAM прямо в чате. Общий банк, шанс равен доле, победитель забирает всё.',
    description: 'Банка — рулетка на GRAM прямо в сообщении.\n\n• Закидывай GRAM в общий банк\n• Твой сектор на колесе равен твоей доле\n• Колесо выбирает одного: он забирает 95% банка\n• Зови друзей: 2,5% с каждой их ставки твои\n• Розыгрыш честный: хеш раунда известен заранее, проверка в /fair\n\nНапиши /pot, чтобы открыть банку.',
    commands: [['pot', 'Открыть банку'], ['ref', 'Моя ссылка и доход'], ['fair', 'Проверить честность']],
  },
  en: {
    name: 'Gram Pot',
    short: 'A GRAM roulette right in the chat. One shared pot, odds equal your share, winner takes all.',
    description: 'Gram Pot is a GRAM roulette right inside a message.\n\n• Send GRAM to the shared pot\n• Your sector on the wheel equals your share\n• The wheel picks one player: they take 95% of the pot\n• Invite friends: 2.5% of every bet they make is yours\n• Provably fair: the round hash is known in advance, verify with /fair\n\nSend /pot to open the pot.',
    commands: [['pot', 'Open the pot'], ['ref', 'My link and earnings'], ['fair', 'Verify fairness']],
  },
};
for (const [lang, p] of Object.entries(PROFILE)) {
  const language_code = lang === 'en' ? undefined : lang;
  await api('setMyName', { name: p.name, language_code }).catch((e) => console.warn(e.message));
  await api('setMyShortDescription', { short_description: p.short, language_code });
  await api('setMyDescription', { description: p.description, language_code });
  await api('setMyCommands', { commands: p.commands.map(([command, description]) => ({ command, description })), language_code });
}
console.log(`Готово. Напиши боту /pot: https://t.me/${me.username}`);
console.log('Чтобы работала команда /stat, впиши свой Telegram id в OWNER_ID в wrangler.toml и запусти npx wrangler deploy.');
