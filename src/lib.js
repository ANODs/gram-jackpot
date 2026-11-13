// Чистые функции «Банки»: проверяются тестами без Cloudflare, Telegram и блокчейна.

export const SHOWN = 6; // сколько игроков виджет показывает на колесе поимённо; остальные — один серый сектор
export const STATE_LIMIT = 1024; // лимит public_data в байтах
export const NANO = 1e9;

export const list = (csv) => String(csv || '').split(',').map(Number).filter((n) => n > 0);
export const displayName = (user) => [...(user?.first_name || 'Аноним')].slice(0, 14).join('');
// Суммы в состоянии виджета — GRAM с двумя знаками: так короче, а колесу точнее не нужно
export const gram = (nano) => Math.round(nano / 1e7) / 100;
export const langOf = (user) => (/^(ru|uk|be|kk)/.test(user?.language_code || '') ? 'ru' : 'en');

// ───── Деньги раунда ─────
// С банка уходят две доли: автору и тем, кто привёл игроков. Доля пригласившего считается с каждой ставки
// его игрока; если игрока никто не привёл, она остаётся автору. Победитель получает всё остальное.
export function settle(stakes, refOf, houseBp, refBp) {
  const pot = stakes.reduce((sum, s) => sum + s.amount, 0);
  const refs = new Map();
  let refTotal = 0, house = Math.floor((pot * houseBp) / 10000);
  for (const s of stakes) {
    const cut = Math.floor((s.amount * refBp) / 10000);
    const ref = refOf(s.user);
    if (ref && ref !== s.user) {
      refs.set(ref, (refs.get(ref) || 0) + cut);
      refTotal += cut;
    } else house += cut;
  }
  return { pot, house, refs, payout: pot - house - refTotal };
}

// ───── Честный розыгрыш ─────
// До раунда публикуется sha256(seed). После него seed раскрывается, и любой может пересчитать билет:
// ticket = sha256(`${seed}:${round}:${pot}`) mod pot. Игроки стоят в порядке первой ставки;
// выигрывает тот, в чей отрезок [начало, начало + ставка) попал билет.
export async function sha256hex(text) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function draw(seed, round, stakes) {
  const pot = stakes.reduce((sum, s) => sum + s.amount, 0);
  const ticket = Number(BigInt('0x' + (await sha256hex(`${seed}:${round}:${pot}`))) % BigInt(pot));
  let start = 0;
  for (const s of stakes) {
    if (ticket < start + s.amount) return { ticket, winner: s.user, inside: (ticket - start) / s.amount, pot };
    start += s.amount;
  }
  throw new Error('Билет вне банка');
}

// ───── Колесо ─────
// Секторы колеса: игроки по убыванию ставки (при равенстве раньше тот, кто вошёл первым), не больше SHOWN;
// остальные сливаются в один сектор «ещё N». Победитель всегда показан поимённо.
export function sectors(stakes, winner) {
  const sorted = [...stakes].sort((a, b) => b.amount - a.amount || a.at - b.at);
  const shown = sorted.slice(0, SHOWN);
  if (winner != null && !shown.some((s) => s.user === winner)) shown[SHOWN - 1] = sorted.find((s) => s.user === winner);
  const rest = sorted.filter((s) => !shown.includes(s));
  return { shown, restCount: rest.length, restSum: rest.reduce((sum, s) => sum + s.amount, 0) };
}

// Куда встанет стрелка: доля окружности от начала первого сектора, в тысячных. Положение внутри сектора
// победителя берётся из билета, но не ближе 12% к краям, чтобы исход читался однозначно.
// Доли считаются по тем же округлённым суммам, которые видит виджет.
export function landing(shown, restSum, winner, inside) {
  const sizes = shown.map((s) => gram(s.amount) || 0.01);
  const total = sizes.reduce((sum, n) => sum + n, 0) + gram(restSum);
  const i = shown.findIndex((s) => s.user === winner);
  const before = sizes.slice(0, i).reduce((sum, n) => sum + n, 0);
  return Math.round(((before + sizes[i] * (0.12 + 0.76 * inside)) / total) * 1000);
}

// ───── Состояние виджета ─────
// {i: раунд, e: когда крутим (unix, 0 — ждём игроков), c: время сервера, t: банк, p: [[id, имя, ставка, ник]],
//  o: [сколько ещё игроков, их сумма], x: [лесенка ставок], u: ник бота, h: начало хеша сида,
//  w: [id победителя, выплата, куда встаёт стрелка (‰), когда разыграли], l: [имя, выплата] прошлого победителя}
export function buildState(s) {
  const state = { i: s.round, e: s.deadline, c: s.now, t: s.pot, p: s.players, o: s.rest, x: s.amounts, u: s.bot || '', h: s.hash };
  if (s.win) state.w = s.win;
  if (s.last) state.l = s.last;
  const size = () => new TextEncoder().encode(JSON.stringify(state)).length;
  // Не влезли: сначала убираем ники (без них не открыть профиль), потом укорачиваем имена
  if (size() > STATE_LIMIT) state.p = state.p.map((p) => [p[0], p[1], p[2], '']);
  for (let n = 10; size() > STATE_LIMIT && n > 2; n -= 2) state.p = state.p.map((p) => [p[0], [...p[1]].slice(0, n).join(''), p[2], '']);
  return JSON.stringify(state);
}

// ───── Ставки в блокчейне ─────
// Метка в комментарии перевода: по ней бот узнаёт игрока
export const stakeComment = (userId) => `pot:${userId}`;
export function parseStakeComment(text) {
  const m = /^pot:(\d+)$/.exec(text || '');
  return m && Number(m[1]);
}

// Текстовый комментарий как BoC из одной ячейки (формат payload в TON Connect):
// заголовок BoC без индекса и CRC, затем ячейка: 32 нулевых бита и текст
export function commentBoc(text) {
  const data = new TextEncoder().encode(text);
  if (data.length > 120) throw new Error('Комментарий не влезает в одну ячейку');
  const cell = [0, 2 * (4 + data.length), 0, 0, 0, 0, ...data];
  const boc = [0xb5, 0xee, 0x9c, 0x72, 1, 1, 1, 1, 0, cell.length, 0, ...cell];
  return btoa(String.fromCharCode(...boc));
}

// Транзакция из toncenter v3 как ставка: {hash, value, comment, source} или null.
// Поле aborted не смотрим: у перевода на ещё не развёрнутый кошелёк оно true, хотя деньги пришли.
export function incoming(tx) {
  const m = tx.in_msg;
  if (!m || !m.source || m.bounced || tx.emulated) return null; // исходящие и вернувшиеся к нам переводы
  if (tx.finality !== undefined && tx.finality !== 'finalized' && tx.finality !== 2) return null;
  if ((tx.out_msgs || []).some((o) => o.bounced)) return null; // перевод отскочил обратно отправителю
  return { hash: tx.hash, value: Number(m.value), comment: m.message_content?.decoded?.comment, source: m.source };
}

// Очередная пачка выплат: кошелёк v4 отправляет до четырёх переводов одним сообщением
export const batch = (queued) => queued.slice(0, 4);

// Сколько можно вывести автору: всё, что лежит на кошельке сверх долгов перед игроками и запаса на комиссии сети
export const houseFree = (balance, owed, reserve) => Math.max(0, balance - owed - reserve);
