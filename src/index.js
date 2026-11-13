// «Банка»: бот на Cloudflare Workers. Шлёт в чат виджет-рулетку (Bot API 10.4): игроки закидывают GRAM
// в общий банк, колесо выбирает одного, он забирает банк. Шанс равен доле в банке.
// Игра одна на всех и живёт в одном Durable Object; ставки приходят на кошелёк банка, выплаты уходят с него же.
import { DurableObject } from 'cloudflare:workers';
import HTML_RU from './widget.html';
import HTML_EN from './widget.en.html';
import { NANO, batch, buildState, commentBoc, displayName, draw, gram, houseFree, incoming, landing, langOf, list, parseStakeComment, sectors, settle, sha256hex, stakeComment } from './lib.js';
import { broadcast, friendly, keyOf, transactions, transferBoc, walletInfo } from './wallet.js';

const WIDGETS = { ru: HTML_RU, en: HTML_EN };
const FLUSH_MS = 1100; // чаще раза в секунду состояние не рассылаем
const WAIT_INTENT_MS = 5 * 60_000; // сколько ждём перевод после нажатия кнопки
const WAIT_SENT_MS = 20 * 60_000; // и сколько после того, как кошелёк его отправил
const REFUND_FEE = 0.01 * NANO; // комиссия сети при возврате одинокой ставки

const TEXT = {
  ru: {
    rules: '<b>Скинь в чат — получай 2,5%</b>Поделись банкой с другом или в чате: 2,5% с каждой ставки тех, кто пришёл от тебя, твои. Привёл: {n}, заработано: {g} GRAM.<b>Как играть</b>Закинь GRAM в общий банк. Когда игроков двое, включается таймер, потом колесо выбирает одного: он забирает банк.<b>Шансы</b>Твой сектор равен твоей доле в банке. Больше закинул — выше шанс.<b>Кому сколько</b>Победителю 95%, 2,5% — пригласившим, 2,5% — автору.<b>Честно</b>Хеш раунда {h}… известен до старта. Проверка: /fair',
    credited: 'Ставка в банке',
    linked: 'Кошелёк привязан. Жми ещё раз',
    shareGo: 'Жми ещё раз, чтобы поделиться',
    onTheWay: 'Перевод в пути. Зачислим, как дойдёт',
    closed: 'Кошелёк банка не настроен',
    won: (r, sum, addr) => `🏆 <b>Банк раунда #${r} твой</b>\n\n+${sum} GRAM уже летят на <code>${addr}</code>`,
    refPaid: (sum) => `💸 Реферальные <b>${sum} GRAM</b> отправлены на твой кошелёк.`,
    noWallet: (sum) => `🤝 Тебе начислено <b>${sum} GRAM</b> за игроков, которых ты привёл.\n\nЧтобы получать выплаты, привяжи кошелёк: открой /pot и нажми кнопку «поделиться» или «Закинуть». Кошелёк запомнится по нажатию, переводить ничего не нужно.`,
    refund: (sum) => `↩️ К тебе никто не присоединился, ставка возвращена: <b>${sum} GRAM</b> (за вычетом комиссии сети).`,
    ref: (link, n, total, due) => `<b>Твоя ссылка</b>\n<code>${link}</code>\n\nС каждой ставки тех, кто пришёл по ней, тебе идёт 2,5%.\n\nПривёл: <b>${n}</b>\nЗаработано: <b>${total} GRAM</b>\nК выплате: <b>${due} GRAM</b>\n\nВыплата уходит сама, когда накопится {m} GRAM, на твой кошелёк. Он привязывается, когда ты жмёшь «поделиться» или «Закинуть» в виджете.`,
    fairHead: '<b>Проверка раундов</b>\nбилет = sha256("seed:раунд:банк") mod банк, банк в нано-GRAM. Игроки стоят в порядке первой ставки.\n',
    fairNow: (r, h) => `\n<b>#${r}</b> идёт\nхеш <code>${h}</code>`,
    fairRow: (r) => `\n<b>#${r.id}</b> банк ${gram(r.pot)} GRAM · билет ${r.ticket}\nхеш <code>${r.hash}</code>\nseed <code>${r.seed}</code>`,
    failed: 'Не получилось отправить виджет: ',
    groups: 'Не получилось отправить виджет в этот чат. Сейчас Telegram показывает виджеты в группах только на тестовом сервере, а в личке со мной они уже работают.',
  },
  en: {
    rules: '<b>Share it, earn 2.5%</b>Send the pot to a friend or a chat: 2.5% of every bet made by people who came from you is yours. Invited: {n}, earned: {g} GRAM.<b>How to play</b>Send GRAM to the shared pot. Once there are two players a timer starts, then the wheel picks one: they take the pot.<b>Odds</b>Your sector equals your share of the pot. Send more, win more often.<b>Who gets what</b>95% to the winner, 2.5% to inviters, 2.5% to the author.<b>Fair</b>The round hash {h}… is known before the start. Verify: /fair',
    credited: 'Your bet is in the pot',
    linked: 'Wallet linked. Tap again',
    shareGo: 'Tap again to share',
    onTheWay: 'Transfer is on its way. We will add it once it arrives',
    closed: 'The pot wallet is not set up',
    won: (r, sum, addr) => `🏆 <b>The pot of round #${r} is yours</b>\n\n+${sum} GRAM are on their way to <code>${addr}</code>`,
    refPaid: (sum) => `💸 Referral <b>${sum} GRAM</b> sent to your wallet.`,
    noWallet: (sum) => `🤝 You earned <b>${sum} GRAM</b> from players you invited.\n\nTo receive payouts, link a wallet: open /pot and tap the share button or Bet. The wallet is remembered on the tap, no transfer needed.`,
    refund: (sum) => `↩️ Nobody joined you, so the bet is refunded: <b>${sum} GRAM</b> (minus the network fee).`,
    ref: (link, n, total, due) => `<b>Your link</b>\n<code>${link}</code>\n\nYou get 2.5% of every bet made by people who came through it.\n\nInvited: <b>${n}</b>\nEarned: <b>${total} GRAM</b>\nDue: <b>${due} GRAM</b>\n\nThe payout goes out by itself once it reaches {m} GRAM, to your wallet. It is linked when you tap the share button or Bet in the widget.`,
    fairHead: '<b>Round verification</b>\nticket = sha256("seed:round:pot") mod pot, pot in nano-GRAM. Players are ordered by their first bet.\n',
    fairNow: (r, h) => `\n<b>#${r}</b> in progress\nhash <code>${h}</code>`,
    fairRow: (r) => `\n<b>#${r.id}</b> pot ${gram(r.pot)} GRAM · ticket ${r.ticket}\nhash <code>${r.hash}</code>\nseed <code>${r.seed}</code>`,
    failed: 'Could not send the widget: ',
    groups: 'Could not send the widget to this chat. Telegram currently shows widgets in groups only on its test server; in a private chat with me they already work.',
  },
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const game = (env) => env.GAME.get(env.GAME.idFromName('game'));
const num = (value, fallback) => (Number(value) > 0 ? Number(value) : fallback);

async function tg(env, method, params) {
  const res = await fetch(`${env.TG_API || 'https://api.telegram.org'}/bot${env.BOT_TOKEN}${env.TEST_ENV === '1' ? '/test' : ''}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(params),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(`${method}: ${json.description}`);
  return json.result;
}

export default {
  async fetch(req, env, ctx) {
    if (req.method !== 'POST' || new URL(req.url).pathname !== '/tg') return new Response('Банка: бот работает');
    // Без секрета вебхука (или с чужим) обновления не принимаем
    if (!env.WEBHOOK_SECRET || req.headers.get('x-telegram-bot-api-secret-token') !== env.WEBHOOK_SECRET) {
      return new Response('forbidden', { status: 403 });
    }
    const update = await req.json();
    ctx.waitUntil(route(update, env).catch((e) => console.error(e)));
    return new Response('ok');
  },
};

async function route(update, env) {
  const query = update.widget_query || update.shared_widget_query;
  if (query) return game(env).query(query);

  if (update.my_chat_member) {
    // Бота добавили в группу: показываем банку. Кто добавил, тот и привёл всех, кто впервые сыграет отсюда
    const { chat, from, old_chat_member: was, new_chat_member: now } = update.my_chat_member;
    const inChat = (member) => member.status === 'member' || member.status === 'administrator';
    if (chat.type !== 'private' && chat.type !== 'channel' && inChat(now) && !inChat(was)) return game(env).show(chat, from, '');
    return;
  }

  const msg = update.message;
  if (!msg?.text || !msg.from) return;
  const [, command, arg = ''] = /^\/(\w+)(?:@\w+)?(?:\s+(\S+))?/.exec(msg.text) || [];
  if (command === 'start' || command === 'pot') return game(env).show(msg.chat, msg.from, arg);
  if (command === 'ref' || command === 'fair' || command === 'stat') {
    const text = await game(env).info(command, msg.from);
    if (text) return tg(env, 'sendMessage', { chat_id: msg.chat.id, text, parse_mode: 'HTML', link_preview_options: { is_disabled: true } });
  }
}

// Таблицы:
//   users    id, name, username, lang, ref (кто привёл), addr (кошелёк для выплат: из «поделиться» или ставки), due (реферальные к выплате), earned (реферальные за всё время)
//   chats    последнее сообщение с виджетом в каждом чате: его данные правим при каждом событии; ref — кто принёс банку в группу
//   rounds   id, hash, seed, status (open — ждём игроков, run — идёт таймер, done — разыгран, refund — ставка возвращена), deadline, pot, winner, ticket, land, payout, ended
//   stakes   ставки раунда: round, user, amount, at (первая ставка)
//   marks    уже учтённые переводы: tx:<hash>
//   pending  от кого ждём перевод: id, since, until
//   payouts  очередь выплат: user, addr, amount, kind (win, ref, refund, house), round, status (queued, sent, paid)
// В обычном хранилище: bot (ник), cursor (до какого времени блокчейн просмотрен), inflight (отправленная, но ещё не подтверждённая пачка выплат), dirty
export class Game extends DurableObject {
  queue = Promise.resolve();
  flushing = null;
  lastFlush = 0;

  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.key = keyOf(env);
    this.cfg = {
      amounts: list(env.AMOUNTS),
      roundMs: num(env.ROUND_SEC, 45) * 1000,
      extendMs: num(env.EXTEND_SEC, 10) * 1000,
      maxMs: num(env.MAX_SEC, 180) * 1000,
      showMs: num(env.SHOW_SEC, 14) * 1000,
      loneMs: num(env.LONE_MIN, 20) * 60_000,
      minStake: num(env.MIN_STAKE, 0.1) * NANO,
      houseBp: num(env.HOUSE_PERCENT, 2.5) * 100,
      refBp: num(env.REF_PERCENT, 2.5) * 100,
      refMin: num(env.REF_MIN, 0.1) * NANO,
      houseMin: num(env.HOUSE_MIN, 1) * NANO,
      reserve: num(env.RESERVE, 0.3) * NANO,
    };
    this.sql.exec(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, username TEXT, lang TEXT NOT NULL DEFAULT 'en',
      ref INTEGER, addr TEXT, due INTEGER NOT NULL DEFAULT 0, earned INTEGER NOT NULL DEFAULT 0, joined INTEGER NOT NULL)`);
    this.sql.exec('CREATE INDEX IF NOT EXISTS users_ref ON users (ref)');
    this.sql.exec("CREATE TABLE IF NOT EXISTS chats (chat INTEGER PRIMARY KEY, msg INTEGER NOT NULL, at INTEGER NOT NULL, lang TEXT NOT NULL DEFAULT 'en', ref INTEGER)");
    this.sql.exec(`CREATE TABLE IF NOT EXISTS rounds (id INTEGER PRIMARY KEY AUTOINCREMENT, hash TEXT NOT NULL, seed TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open',
      started INTEGER, deadline INTEGER, pot INTEGER NOT NULL DEFAULT 0, winner INTEGER, ticket INTEGER, land INTEGER, payout INTEGER, ended INTEGER)`);
    this.sql.exec('CREATE TABLE IF NOT EXISTS stakes (round INTEGER NOT NULL, user INTEGER NOT NULL, amount INTEGER NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (round, user))');
    this.sql.exec('CREATE TABLE IF NOT EXISTS marks (id TEXT PRIMARY KEY)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS pending (id INTEGER PRIMARY KEY, since INTEGER NOT NULL, until INTEGER NOT NULL)');
    this.sql.exec(`CREATE TABLE IF NOT EXISTS payouts (id INTEGER PRIMARY KEY AUTOINCREMENT, user INTEGER, addr TEXT NOT NULL, amount INTEGER NOT NULL,
      kind TEXT NOT NULL, round INTEGER, status TEXT NOT NULL DEFAULT 'queued', created INTEGER NOT NULL)`);
  }

  // Операции над раундом идут строго по очереди: розыгрыш не должен пересечься с зачислением ставки
  run(fn) {
    const result = this.queue.then(fn);
    this.queue = result.catch(() => {});
    return result;
  }

  one(query, ...args) {
    return this.sql.exec(query, ...args).toArray()[0];
  }

  // ───── Игроки ─────

  // Запоминает игрока и того, кто его привёл. Пригласивший назначается один раз и только тому, кто ещё не ставил
  seen(from, ref) {
    if (!from || from.is_bot) return;
    this.sql.exec(
      `INSERT INTO users (id, name, username, lang, joined) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET name = excluded.name, username = excluded.username, lang = excluded.lang`,
      from.id, displayName(from), from.username || null, langOf(from), Date.now(),
    );
    if (!ref || ref === from.id) return;
    const user = this.one('SELECT ref FROM users WHERE id = ?', from.id);
    if (user.ref || this.one('SELECT 1 FROM stakes WHERE user = ? LIMIT 1', from.id)) return;
    if (this.one('SELECT ref FROM users WHERE id = ?', ref)?.ref === from.id) return; // двое не могут привести друг друга
    if (this.one('SELECT 1 FROM users WHERE id = ?', ref)) this.sql.exec('UPDATE users SET ref = ? WHERE id = ?', ref, from.id);
  }

  setAddr(userId, address, force) {
    const addr = friendly(address, this.env);
    if (addr) this.sql.exec(`UPDATE users SET addr = ? WHERE id = ? ${force ? '' : 'AND addr IS NULL'}`, addr, userId);
  }

  // ───── Раунд ─────

  async current() {
    const round = this.one("SELECT * FROM rounds WHERE status IN ('open', 'run') ORDER BY id DESC LIMIT 1");
    if (round) return round;
    const seed = [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, '0')).join('');
    this.sql.exec('INSERT INTO rounds (hash, seed) VALUES (?, ?)', await sha256hex(seed), seed);
    return this.one("SELECT * FROM rounds WHERE status = 'open' ORDER BY id DESC LIMIT 1");
  }

  stakes(roundId) {
    return this.sql.exec('SELECT user, amount, at FROM stakes WHERE round = ? ORDER BY at, user', roundId).toArray();
  }

  async state() {
    const now = Date.now();
    const done = this.one("SELECT * FROM rounds WHERE status = 'done' ORDER BY id DESC LIMIT 1");
    // Пока колесо крутится и чествует победителя, виджет видит разыгранный раунд; новые ставки уже идут в следующий
    const showing = done && now - done.ended < this.cfg.showMs;
    const round = showing ? done : await this.current();
    const stakes = this.stakes(round.id);
    const view = sectors(stakes, showing ? done.winner : null);
    const user = (id) => this.one('SELECT name, username FROM users WHERE id = ?', id) || { name: '?' };
    const json = buildState({
      round: round.id,
      deadline: !showing && round.status === 'run' ? Math.ceil(round.deadline / 1000) : 0,
      now: Math.floor(now / 1000),
      pot: gram(stakes.reduce((sum, s) => sum + s.amount, 0)),
      players: view.shown.map((s) => { const u = user(s.user); return [s.user, u.name, gram(s.amount), u.username || '']; }),
      rest: [view.restCount, gram(view.restSum)],
      amounts: this.key ? this.cfg.amounts : [],
      bot: await this.ctx.storage.get('bot'),
      hash: round.hash.slice(0, 8),
      win: showing ? [done.winner, gram(done.payout), done.land, Math.floor(done.ended / 1000)] : null,
      last: !showing && done ? [user(done.winner).name, gram(done.payout)] : null,
    });
    return { json, stakes, round };
  }

  // Зачисляет ставку один раз на перевод. Второй игрок запускает таймер; ставка под самый конец его продлевает
  async credit(userId, amount, hash, source) {
    if (this.one('SELECT 1 FROM marks WHERE id = ?', `tx:${hash}`)) return false;
    const round = await this.current();
    const now = Date.now();
    this.ctx.storage.transactionSync(() => {
      this.sql.exec('INSERT INTO marks (id) VALUES (?)', `tx:${hash}`);
      this.sql.exec("INSERT INTO users (id, name, joined) VALUES (?, 'Аноним', ?) ON CONFLICT (id) DO NOTHING", userId, now);
      this.sql.exec('INSERT INTO stakes (round, user, amount, at) VALUES (?, ?, ?, ?) ON CONFLICT (round, user) DO UPDATE SET amount = amount + excluded.amount', round.id, userId, amount, now);
      this.sql.exec('UPDATE rounds SET pot = pot + ? WHERE id = ?', amount, round.id);
      const players = this.one('SELECT COUNT(*) AS n FROM stakes WHERE round = ?', round.id).n;
      if (round.status === 'open' && players >= 2) {
        this.sql.exec("UPDATE rounds SET status = 'run', started = ?, deadline = ? WHERE id = ?", now, now + this.cfg.roundMs, round.id);
      } else if (round.status === 'run' && round.deadline - now < this.cfg.extendMs) {
        this.sql.exec('UPDATE rounds SET deadline = ? WHERE id = ?', Math.min(now + this.cfg.extendMs, Math.max(round.deadline, round.started + this.cfg.maxMs)), round.id);
      }
    });
    this.setAddr(userId, source, false);
    return true;
  }

  // Розыгрыш: билет из сида, доли пригласившим и автору, выплата победителю в очередь, следующий раунд открыт сразу
  async finish(round) {
    const stakes = this.stakes(round.id);
    const result = await draw(round.seed, round.id, stakes);
    const refOf = (id) => this.one('SELECT ref FROM users WHERE id = ?', id)?.ref;
    const money = settle(stakes, refOf, this.cfg.houseBp, this.cfg.refBp);
    const view = sectors(stakes, result.winner);
    const land = landing(view.shown, view.restSum, result.winner, result.inside);
    const winner = this.one('SELECT * FROM users WHERE id = ?', result.winner);
    const now = Date.now();
    this.ctx.storage.transactionSync(() => {
      this.sql.exec("UPDATE rounds SET status = 'done', winner = ?, ticket = ?, land = ?, payout = ?, ended = ? WHERE id = ?", result.winner, result.ticket, land, money.payout, now, round.id);
      this.sql.exec("INSERT INTO payouts (user, addr, amount, kind, round, created) VALUES (?, ?, ?, 'win', ?, ?)", winner.id, winner.addr, money.payout, round.id, now);
      for (const [ref, cut] of money.refs) this.sql.exec('UPDATE users SET due = due + ?, earned = earned + ? WHERE id = ?', cut, cut, ref);
    });
    // Пригласившему, чей кошелёк ещё неизвестен, один раз подсказываем, как его привязать
    for (const [ref] of money.refs) {
      const u = this.one('SELECT addr, lang, due FROM users WHERE id = ?', ref);
      if (u.addr || this.one('SELECT 1 FROM marks WHERE id = ?', `nowallet:${ref}`)) continue;
      this.sql.exec('INSERT INTO marks (id) VALUES (?)', `nowallet:${ref}`);
      this.ctx.waitUntil(tg(this.env, 'sendMessage', { chat_id: ref, parse_mode: 'HTML', text: TEXT[u.lang].noWallet(gram(u.due)) }).catch(() => {}));
    }
    await this.current();
    await this.ctx.storage.put('dirty', now + this.cfg.showMs); // когда показ результата кончится, разошлём новый раунд
    this.ctx.waitUntil(tg(this.env, 'sendMessage', {
      chat_id: winner.id, parse_mode: 'HTML', text: TEXT[winner.lang].won(round.id, gram(money.payout), winner.addr),
    }).catch(() => {}));
  }

  // Одинокая ставка, к которой долго никто не присоединился, возвращается игроку
  async refundLone(round) {
    const [stake] = this.stakes(round.id);
    const user = this.one('SELECT * FROM users WHERE id = ?', stake.user);
    const amount = stake.amount - REFUND_FEE;
    this.ctx.storage.transactionSync(() => {
      this.sql.exec("UPDATE rounds SET status = 'refund', ended = ? WHERE id = ?", Date.now(), round.id);
      if (amount > 0 && user.addr) this.sql.exec("INSERT INTO payouts (user, addr, amount, kind, round, created) VALUES (?, ?, ?, 'refund', ?, ?)", user.id, user.addr, amount, round.id, Date.now());
    });
    await this.current();
    if (amount > 0) this.ctx.waitUntil(tg(this.env, 'sendMessage', { chat_id: user.id, parse_mode: 'HTML', text: TEXT[user.lang].refund(gram(amount)) }).catch(() => {}));
  }

  // ───── Блокчейн: входящие ставки ─────

  async expect(userId, waitMs) {
    const now = Date.now();
    this.sql.exec('INSERT INTO pending (id, since, until) VALUES (?, ?, ?) ON CONFLICT (id) DO UPDATE SET until = MAX(until, excluded.until)', userId, now, now + waitMs);
    await this.wake(3000);
  }

  // Ищет на кошельке банка переводы с меткой игрока и зачисляет ещё не учтённые.
  // Смотрим именно входящую транзакцию на нашем адресе, а не то, что прислал клиент.
  async reconcile() {
    if (!this.key) return false;
    const cursor = (await this.ctx.storage.get('cursor')) || Math.floor(Date.now() / 1000) - 3600;
    const txs = await transactions(this.env, this.key.address, cursor - 120);
    let credited = false, newest = cursor;
    for (const tx of txs.reverse()) {
      const pay = incoming(tx);
      const userId = pay && parseStakeComment(pay.comment);
      if (!userId || pay.value < this.cfg.minStake) continue;
      if (!(await this.credit(userId, pay.value, pay.hash, pay.source))) continue;
      this.sql.exec('DELETE FROM pending WHERE id = ?', userId);
      credited = true;
    }
    for (const tx of txs) newest = Math.max(newest, Number(tx.now) || 0);
    if (txs.length < 100 && newest > cursor) await this.ctx.storage.put('cursor', newest);
    return credited;
  }

  // ───── Выплаты ─────

  // Выплаты уходят пачками до четырёх переводов. Пока пачка в полёте, новую не шлём: номер сообщения (seqno) кошелька
  // вырос — пачка исполнена; срок её действия вышел, а номер прежний — она уже не исполнится, шлём заново.
  async pay() {
    if (!this.key) return;
    const queuedCount = this.one("SELECT COUNT(*) AS n FROM payouts WHERE status != 'paid'").n;
    const dueRefs = this.sql.exec('SELECT id, addr, due, lang FROM users WHERE due >= ? AND addr IS NOT NULL', this.cfg.refMin).toArray();
    const lastHouse = (await this.ctx.storage.get('houseAt')) || 0;
    const houseTime = this.env.AUTHOR_ADDRESS && Date.now() - lastHouse > 600_000;
    if (!queuedCount && !dueRefs.length && !houseTime) return;

    const info = await walletInfo(this.env, this.key.address);
    const inflight = await this.ctx.storage.get('inflight');
    if (inflight) {
      if (info.seqno > inflight.seqno) {
        for (const id of inflight.ids) {
          const p = this.one('SELECT * FROM payouts WHERE id = ?', id);
          this.sql.exec("UPDATE payouts SET status = 'paid' WHERE id = ?", id);
          if (p?.kind === 'ref') this.ctx.waitUntil(tg(this.env, 'sendMessage', { chat_id: p.user, parse_mode: 'HTML', text: TEXT[this.one('SELECT lang FROM users WHERE id = ?', p.user)?.lang || 'en'].refPaid(gram(p.amount)) }).catch(() => {}));
        }
      } else if (Date.now() / 1000 > inflight.until + 20) {
        for (const id of inflight.ids) this.sql.exec("UPDATE payouts SET status = 'queued' WHERE id = ?", id);
      } else return;
      await this.ctx.storage.delete('inflight');
      return; // новую пачку соберём на следующем шаге, когда toncenter точно увидит новый баланс
    }

    // Реферальные, набравшие минимум, переходят из начислений в очередь
    for (const u of dueRefs) {
      this.ctx.storage.transactionSync(() => {
        this.sql.exec('UPDATE users SET due = 0 WHERE id = ?', u.id);
        this.sql.exec("INSERT INTO payouts (user, addr, amount, kind, created) VALUES (?, ?, ?, 'ref', ?)", u.id, u.addr, u.due, Date.now());
      });
    }
    // Автору уходит всё, что лежит сверх долгов перед игроками и запаса на комиссии сети
    if (houseTime) {
      await this.ctx.storage.put('houseAt', Date.now());
      const free = houseFree(info.balance, this.owed(), this.cfg.reserve);
      if (free >= this.cfg.houseMin) this.sql.exec("INSERT INTO payouts (addr, amount, kind, created) VALUES (?, ?, 'house', ?)", this.env.AUTHOR_ADDRESS, free, Date.now());
    }

    const rows = batch(this.sql.exec("SELECT * FROM payouts WHERE status = 'queued' ORDER BY id").toArray());
    if (!rows.length) return;
    const total = rows.reduce((sum, p) => sum + p.amount, 0);
    if (info.balance < total + 0.05 * NANO) return console.error(`На кошельке банка ${gram(info.balance)} GRAM, а выплатить нужно ${gram(total)}`);
    const validUntil = Math.floor(Date.now() / 1000) + 90;
    const note = { win: 'Pot #', refund: 'Refund #', ref: 'Referral', house: 'Fee' };
    const boc = transferBoc(this.key, {
      seqno: info.seqno, active: info.active, validUntil,
      transfers: rows.map((p) => ({ to: p.addr, amount: p.amount, note: note[p.kind] + (p.round || '') })),
    });
    // Сначала запоминаем пачку, потом отправляем: если ответ сети потеряется, её судьбу решит seqno, а не повторная отправка
    await this.ctx.storage.put('inflight', { seqno: info.seqno, until: validUntil, ids: rows.map((p) => p.id) });
    for (const p of rows) this.sql.exec("UPDATE payouts SET status = 'sent' WHERE id = ?", p.id);
    await broadcast(this.env, boc).catch((e) => console.error(e.message));
  }

  // Сколько денег на кошельке банка чужие: ставки открытого раунда, невыплаченные выплаты и реферальные начисления
  owed() {
    const open = this.one("SELECT COALESCE(SUM(pot), 0) AS s FROM rounds WHERE status IN ('open', 'run')").s;
    const queued = this.one("SELECT COALESCE(SUM(amount), 0) AS s FROM payouts WHERE status != 'paid'").s;
    const due = this.one('SELECT COALESCE(SUM(due), 0) AS s FROM users').s;
    return open + queued + due;
  }

  // ───── Такт игры ─────

  async wake(inMs) {
    const at = Date.now() + inMs, alarm = await this.ctx.storage.getAlarm();
    if (!alarm || alarm > at) await this.ctx.storage.setAlarm(at);
  }

  alarm() {
    return this.run(() => this.tick());
  }

  async tick() {
    const now = Date.now();
    let changed = false;
    this.sql.exec('DELETE FROM pending WHERE until < ?', now);
    let round = await this.current();
    const waiting = this.one('SELECT COUNT(*) AS n FROM pending').n;
    if (waiting || round.status === 'run') changed = await this.reconcile().catch((e) => (console.error(e.message), false));

    round = await this.current();
    if (round.status === 'run' && Date.now() >= round.deadline) {
      await this.finish(round);
      changed = true;
    } else if (round.status === 'open' && round.pot > 0) {
      const [stake] = this.stakes(round.id);
      if (Date.now() - stake.at > this.cfg.loneMs) {
        await this.refundLone(round);
        changed = true;
      }
    }

    const dirty = await this.ctx.storage.get('dirty');
    if (dirty && Date.now() >= dirty) {
      await this.ctx.storage.delete('dirty');
      changed = true;
    }
    if (changed) await this.flush();
    await this.pay().catch((e) => console.error(e.message));

    // Когда проснуться снова
    round = await this.current();
    const next = [];
    if (round.status === 'run') next.push(Math.min(round.deadline - Date.now(), 4000));
    if (this.one('SELECT COUNT(*) AS n FROM pending').n) next.push(4000);
    const dirtyAt = await this.ctx.storage.get('dirty');
    if (dirtyAt) next.push(dirtyAt - Date.now());
    if (this.one("SELECT COUNT(*) AS n FROM payouts WHERE status != 'paid'").n) next.push(8000);
    if (round.status === 'open' && round.pot > 0) next.push(60_000);
    if (this.one('SELECT COUNT(*) AS n FROM users WHERE due >= ? AND addr IS NOT NULL', this.cfg.refMin).n) next.push(8000);
    if (next.length) await this.ctx.storage.setAlarm(Date.now() + Math.max(300, Math.min(...next)));
  }

  // ───── Виджет в чатах ─────

  chatData(userId, stakes) {
    const mine = stakes.find((s) => s.user === userId);
    const known = this.one('SELECT addr FROM users WHERE id = ?', userId)?.addr;
    return JSON.stringify({ s: mine ? gram(mine.amount) : 0, a: known ? 1 : 0 });
  }

  // Отправляет в чат сообщение с виджетом: без подписи и кнопок, только сам виджет
  async show(chat, from, arg) {
    const ref = Number(/^r(\d+)$/.exec(arg || '')?.[1]) || null;
    const priv = chat.type === 'private';
    try {
      this.seen(from, priv ? ref : this.one('SELECT ref FROM chats WHERE chat = ?', chat.id)?.ref);
      if (!(await this.ctx.storage.get('bot'))) await this.ctx.storage.put('bot', (await tg(this.env, 'getMe')).username);
      const lang = langOf(from);
      const { json, stakes } = await this.state();
      const msg = await tg(this.env, 'sendWidget', {
        chat_id: chat.id, html: WIDGETS[lang], public_data: json, allow_queries: true, // без запросов виджет не узнает зрителя и не попросит перевод
        ...(priv ? { chat_data: this.chatData(chat.id, stakes) } : {}),
      });
      this.sql.exec(
        `INSERT INTO chats (chat, msg, at, lang, ref) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (chat) DO UPDATE SET msg = excluded.msg, at = excluded.at, lang = excluded.lang, ref = COALESCE(ref, excluded.ref)`,
        chat.id, msg.message_id, Date.now(), lang, priv ? null : from?.id || null,
      );
    } catch (e) {
      console.error(e);
      const t = TEXT[langOf(from)];
      await tg(this.env, 'sendMessage', { chat_id: chat.id, text: priv ? t.failed + e.message : t.groups }).catch(() => {});
    }
  }

  // Рассылает свежее состояние в последнее сообщение каждого чата. Вызовы за одну секунду склеиваются в один.
  flush() {
    if (!this.flushing) {
      this.flushing = (async () => {
        // Пауза обязательна даже нулевая: иначе код ниже выполнится раньше, чем this.flushing получит значение
        await sleep(Math.max(0, this.lastFlush + FLUSH_MS - Date.now()));
        this.flushing = null; // события после этой точки запросят следующую рассылку
        this.lastFlush = Date.now();
        const { json, stakes } = await this.state();
        const chats = this.sql.exec('SELECT chat, msg FROM chats ORDER BY at DESC LIMIT 300').toArray();
        // В фоне и пачками по 20, чтобы зачисление ставки не ждало рассылку
        this.ctx.waitUntil((async () => {
          for (let i = 0; i < chats.length; i += 20) {
            await Promise.all(chats.slice(i, i + 20).map((row) => tg(this.env, 'editMessageWidgetData', {
              chat_id: row.chat, message_id: row.msg, public_data: json, ...(row.chat > 0 ? { chat_data: this.chatData(row.chat, stakes) } : {}),
            }).catch((e) => {
              // Сообщение удалили или бота заблокировали: больше его не обновляем
              if (/not found|blocked|deactivated|kicked|can't be edited/i.test(e.message)) this.sql.exec('DELETE FROM chats WHERE chat = ?', row.chat);
            })));
          }
        })());
      })();
    }
    return this.flushing;
  }

  // ───── Запросы из виджета ─────

  async query(q) {
    const answer = (data) => tg(this.env, 'answerWidgetQuery', { widget_query_id: q.id, data }).catch((e) => console.error(e.message));
    const kind = q.type?.type || 'data';
    const from = q.from, t = TEXT[langOf(from)];
    // В группе игрока привёл тот, кто принёс туда банку
    this.seen(from, q.chat && q.chat.type !== 'private' ? this.one('SELECT ref FROM chats WHERE chat = ?', q.chat.id)?.ref : null);
    if (q.chat) this.sql.exec('UPDATE chats SET at = ? WHERE chat = ?', Date.now(), q.chat.id);

    // Фоновый опрос из лички: свежее состояние и моя ставка. Заодно будим игру, если будильник потерялся
    if (kind === 'data' && q.data === 's') {
      await this.wake(1000);
      const { json, stakes } = await this.state();
      return answer(json.slice(0, -1) + ',"m":' + this.chatData(from.id, stakes) + '}');
    }

    if (kind === 'data' && q.data === 'i') {
      const round = await this.current();
      const me = this.one('SELECT earned FROM users WHERE id = ?', from.id);
      const invited = this.one('SELECT COUNT(*) AS n FROM users WHERE ref = ?', from.id).n;
      return answer(t.rules.replace('{h}', round.hash.slice(0, 8)).replace('{n}', invited).replace('{g}', gram(me?.earned || 0)));
    }

    // Первое касание «поделиться»: виджет отдаёт адрес кошелька, на него пойдут реферальные
    if (kind === 'data' && q.data === 'r') {
      if (q.type.wallet_card?.address) this.setAddr(from.id, q.type.wallet_card.address, false);
      return answer(this.one('SELECT addr FROM users WHERE id = ?', from.id)?.addr ? t.linked : t.shareGo);
    }

    if (kind === 'data' && q.data.startsWith('b:')) {
      const amount = Number(q.data.slice(2));
      if (!this.key) return answer(JSON.stringify({ error: t.closed }));
      if (!this.cfg.amounts.includes(amount)) return answer();
      if (q.type.wallet_card?.address) this.setAddr(from.id, q.type.wallet_card.address, false);
      await this.expect(from.id, WAIT_INTENT_MS);
      return answer(JSON.stringify({
        valid_until: Math.floor(Date.now() / 1000) + 300,
        messages: [{ address: this.key.address, amount: String(Math.round(amount * NANO)), payload: commentBoc(stakeComment(from.id)) }],
      }));
    }

    if (kind === 'sent_transaction') {
      // Выплаты пойдут на тот кошелёк, с которого игрок только что поставил
      if (q.type.wallet?.address) this.setAddr(from.id, q.type.wallet.address, true);
      await this.expect(from.id, WAIT_SENT_MS);
      // На ответ виджету есть 15 секунд: около 11 из них ищем перевод в блокчейне
      for (let i = 0; i < 4; i++) {
        await sleep(2700);
        const credited = await this.run(() => this.reconcile()).catch(() => false);
        if (credited) await this.flush();
        if (!this.one('SELECT 1 FROM pending WHERE id = ?', from.id)) {
          await this.wake(500);
          return answer(t.credited);
        }
      }
      return answer(t.onTheWay);
    }

    return answer();
  }

  // ───── Команды бота ─────

  async info(command, from) {
    this.seen(from);
    const lang = langOf(from), t = TEXT[lang];
    if (command === 'ref') {
      const bot = (await this.ctx.storage.get('bot')) || (await tg(this.env, 'getMe')).username;
      const me = this.one('SELECT due, earned FROM users WHERE id = ?', from.id);
      const invited = this.one('SELECT COUNT(*) AS n FROM users WHERE ref = ?', from.id).n;
      return t.ref(`https://t.me/${bot}?start=r${from.id}`, invited, gram(me.earned), gram(me.due)).replace('{m}', gram(this.cfg.refMin));
    }
    if (command === 'fair') {
      const round = await this.current();
      const rows = this.sql.exec("SELECT id, hash, seed, pot, ticket FROM rounds WHERE status = 'done' ORDER BY id DESC LIMIT 5").toArray();
      return t.fairHead + t.fairNow(round.id, round.hash) + rows.map(t.fairRow).join('');
    }
    if (command === 'stat' && String(from.id) === this.env.OWNER_ID) {
      const info = this.key ? await walletInfo(this.env, this.key.address).catch(() => null) : null;
      const owed = this.owed();
      const rounds = this.one("SELECT COUNT(*) AS n, COALESCE(SUM(pot), 0) AS s FROM rounds WHERE status = 'done'");
      return [
        `Кошелёк банка: <code>${this.key?.address || 'не настроен'}</code>`,
        `На кошельке: ${info ? gram(info.balance) : '?'} GRAM`,
        `Должны игрокам: ${gram(owed)} GRAM`,
        `Свободно автору: ${info ? gram(houseFree(info.balance, owed, this.cfg.reserve)) : '?'} GRAM`,
        `Разыграно раундов: ${rounds.n}, оборот ${gram(rounds.s)} GRAM`,
        `Игроков: ${this.one('SELECT COUNT(*) AS n FROM users').n}, выплат в очереди: ${this.one("SELECT COUNT(*) AS n FROM payouts WHERE status != 'paid'").n}`,
      ].join('\n');
    }
  }
}
