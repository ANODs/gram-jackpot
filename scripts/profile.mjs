// Профиль бота на двух языках: имя, описания, команды и аватар (art/avatar.jpg).
//   BOT_TOKEN=токен node scripts/profile.mjs   — применить отдельно; npm run setup делает это сам.
// Гифка на экране «Что умеет этот бот» (art/start.gif) ставится только вручную: BotFather → Edit Bot → Edit Description Picture.
import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const PROFILE = {
  ru: {
    name: 'Банка',
    short: 'Рулетка на GRAM прямо в чате. Скинул другу или в чат — получаешь 2,5% с каждой игры.',
    description: 'Банка — рулетка на GRAM прямо в сообщении.\n\n🤝 Скинь банку другу или в чат: 2,5% с каждой ставки тех, кто пришёл от тебя, твои\n💎 Закидывай GRAM в общий банк\n🎡 Твой сектор на колесе равен твоей доле\n🏆 Колесо выбирает одного: он забирает 95% банка\n🔐 Хеш раунда известен заранее, проверка в /fair\n\nНажми «Старт», чтобы открыть банку.',
    commands: [['pot', 'Открыть банку'], ['ref', 'Моя ссылка и доход'], ['fair', 'Проверить честность']],
  },
  en: {
    name: 'Gram Pot',
    short: 'A GRAM roulette right in the chat. Share it with a friend or a chat and earn 2.5% of every game.',
    description: 'Gram Pot is a GRAM roulette right inside a message.\n\n🤝 Share the pot with a friend or a chat: 2.5% of every bet made by people who came from you is yours\n💎 Send GRAM to the shared pot\n🎡 Your sector on the wheel equals your share\n🏆 The wheel picks one player: they take 95% of the pot\n🔐 The round hash is known in advance, verify with /fair\n\nTap Start to open the pot.',
    commands: [['pot', 'Open the pot'], ['ref', 'My link and earnings'], ['fair', 'Verify fairness']],
  },
};

export async function applyProfile(token, test) {
  const call = async (method, body) => {
    const res = await fetch(`https://api.telegram.org/bot${token}${test ? '/test' : ''}/${method}`, body instanceof FormData
      ? { method: 'POST', body }
      : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const json = await res.json();
    console.log(method, body.language_code || '', json.ok ? 'ok' : json.description);
  };
  for (const [lang, p] of Object.entries(PROFILE)) {
    const language_code = lang === 'en' ? undefined : lang;
    await call('setMyName', { name: p.name, language_code });
    await call('setMyShortDescription', { short_description: p.short, language_code });
    await call('setMyDescription', { description: p.description, language_code });
    await call('setMyCommands', { commands: p.commands.map(([command, description]) => ({ command, description })), language_code });
  }
  const photo = new URL('../art/avatar.jpg', import.meta.url);
  if (existsSync(photo)) {
    const form = new FormData();
    form.append('photo', JSON.stringify({ type: 'static', photo: 'attach://file' }));
    form.append('file', new Blob([readFileSync(photo)], { type: 'image/jpeg' }), 'avatar.jpg');
    await call('setMyProfilePhoto', form);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.env.BOT_TOKEN) throw new Error('Запусти так: BOT_TOKEN=токен node scripts/profile.mjs');
  await applyProfile(process.env.BOT_TOKEN, false);
}
