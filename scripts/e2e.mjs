// Сквозная проверка воркера на заглушках Telegram и toncenter. Запуск: wrangler dev --port 8798 с TG_API и TON_API на localhost:8799 и секретами в .dev.vars, затем node scripts/e2e.mjs
import http from 'node:http';
import { Cell, loadMessage, loadMessageRelaxed, Address } from '@ton/core';
const calls = [], txs = []; let seqno = 0, balance = 0; const bocs = [];
const srv = http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => body += c); req.on('end', () => {
    const u = new URL(req.url, 'http://x'); res.setHeader('content-type', 'application/json');
    if (u.pathname.startsWith('/bot')) {
      const method = u.pathname.split('/').pop(); const params = JSON.parse(body || '{}'); calls.push([method, params]);
      const result = method === 'getMe' ? { username: 'pot_test_bot' } : method === 'sendWidget' ? { message_id: calls.length } : true;
      return res.end(JSON.stringify({ ok: true, result }));
    }
    if (u.pathname.endsWith('/transactions')) return res.end(JSON.stringify({ transactions: [...txs].reverse() }));
    if (u.pathname.endsWith('/walletInformation')) return res.end(JSON.stringify({ balance: String(balance), seqno, status: seqno ? 'active' : 'uninit' }));
    if (u.pathname.endsWith('/message')) { bocs.push(JSON.parse(body).boc); seqno++; return res.end('{}'); }
    res.statusCode = 404; res.end('{}');
  });
}).listen(8799);
const W = 'http://localhost:8798/tg';
const post = (update) => fetch(W, { method: 'POST', headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': 's' }, body: JSON.stringify(update) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const user = (id, name) => ({ id, first_name: name, language_code: 'ru', username: 'u' + id });
const waitCall = async (method, pred = () => true, ms = 15000) => { const t = Date.now(); for (;;) { const c = calls.find((c) => c[0] === method && pred(c[1])); if (c) return c[1]; if (Date.now() - t > ms) throw new Error('нет вызова ' + method + '\n' + calls.map((c) => c[0]).join(',')); await sleep(100); } };
const ADDR = { 1: '0:' + '11'.repeat(32), 2: '0:' + '22'.repeat(32) };
let qid = 0;
const bet = async (id, name, amount) => {
  const q = String(++qid);
  await post({ widget_query: { id: q, from: user(id, name), chat: { id, type: 'private' }, type: { type: 'data' }, data: 'b:' + amount } });
  const tx = JSON.parse((await waitCall('answerWidgetQuery', (p) => p.widget_query_id === q)).data);
  const comment = Cell.fromBase64(tx.messages[0].payload).beginParse().skip(32).loadStringTail();
  txs.push({ hash: 'h' + q, now: Math.floor(Date.now() / 1000), in_msg: { source: ADDR[id], value: tx.messages[0].amount, message_content: { decoded: { comment } } }, out_msgs: [] });
  balance += Number(tx.messages[0].amount);
  const q2 = String(++qid);
  await post({ widget_query: { id: q2, from: user(id, name), chat: { id, type: 'private' }, type: { type: 'sent_transaction', wallet: { address: ADDR[id] } }, data: 'p' } });
  const a = await waitCall('answerWidgetQuery', (p) => p.widget_query_id === q2);
  console.log('ставка', name, amount, '→', a.data, '| адрес банка', tx.messages[0].address, '| метка', comment);
  return tx.messages[0].address;
};
try {
  await post({ message: { text: '/start', chat: { id: 1, type: 'private' }, from: user(1, 'Аня') } });
  await post({ message: { text: '/start r1', chat: { id: 2, type: 'private' }, from: user(2, 'Боря') } });
  const w = await waitCall('sendWidget', (p) => p.chat_id === 2);
  console.log('виджет отправлен, html', w.html.length, 'байт; состояние', w.public_data, w.chat_data);
  const hot = await bet(1, 'Аня', 1);
  await bet(2, 'Боря', 2);
  const run = await waitCall('editMessageWidgetData', (p) => JSON.parse(p.public_data).e > 0);
  console.log('таймер пошёл:', run.public_data, run.chat_data);
  const done = await waitCall('editMessageWidgetData', (p) => JSON.parse(p.public_data).w, 20000);
  console.log('розыгрыш:', done.public_data);
  const dm = await waitCall('sendMessage', (p) => /Банк раунда/.test(p.text));
  console.log('победителю:', dm.chat_id, dm.text.replace(/\n/g, ' '));
  const t = Date.now(); while (!bocs.length && Date.now() - t < 20000) await sleep(200);
  if (!bocs.length) throw new Error('выплата не отправлена');
  const msg = loadMessage(Cell.fromBase64(bocs[0]).beginParse());
  console.log('выплата: кошелёк', msg.info.dest.toString({ bounceable: false }) === hot, 'init', !!msg.init);
  for (const ref of msg.body.refs) { const m = loadMessageRelaxed(ref.beginParse()); console.log('  перевод', Number(m.info.value.coins) / 1e9, 'GRAM →', m.info.dest.toRawString(), '|', m.body.beginParse().skip(32).loadStringTail()); }
  const next = await waitCall('editMessageWidgetData', (p) => { const d = JSON.parse(p.public_data); return d.l && !d.w; }, 15000);
  console.log('новый раунд:', next.public_data);
  await post({ message: { text: '/fair', chat: { id: 1, type: 'private' }, from: user(1, 'Аня') } });
  console.log((await waitCall('sendMessage', (p) => /Проверка/.test(p.text))).text);
  await post({ message: { text: '/ref', chat: { id: 1, type: 'private' }, from: user(1, 'Аня') } });
  console.log((await waitCall('sendMessage', (p) => /Твоя ссылка/.test(p.text))).text);
  const q = String(++qid);
  await post({ widget_query: { id: q, from: user(1, 'Аня'), chat: { id: 1, type: 'private' }, type: { type: 'data' }, data: 'i' } });
  const rules = (await waitCall('answerWidgetQuery', (p) => p.widget_query_id === q)).data;
  console.log('правила', Buffer.byteLength(rules), 'байт:', rules.slice(-120));
  console.log('OK');
} catch (e) { console.error('FAIL', e.message); process.exitCode = 1; }
srv.close();
