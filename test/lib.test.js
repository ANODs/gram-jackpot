import test from 'node:test';
import assert from 'node:assert/strict';
import { Cell, loadMessage } from '@ton/core';
import { keyPairFromSeed, signVerify } from '@ton/crypto';
import { STATE_LIMIT, buildState, commentBoc, draw, houseFree, incoming, landing, parseStakeComment, sectors, settle, sha256hex, stakeComment } from '../src/lib.js';
import { friendly, keyOf, transferBoc } from '../src/wallet.js';

const stakes = [
  { user: 1, amount: 5e9, at: 1 },
  { user: 2, amount: 3e9, at: 2 },
  { user: 3, amount: 2e9, at: 3 },
];

test('банк делится: 95% победителю, по 2,5% автору и пригласившим', () => {
  const money = settle(stakes, (id) => ({ 1: 9, 2: 9 })[id], 250, 250);
  assert.equal(money.pot, 10e9);
  assert.equal(money.refs.get(9), 0.2e9); // 2,5% со ставок игроков 1 и 2
  assert.equal(money.house, 0.25e9 + 0.05e9); // доля автора и доля за игрока, которого никто не привёл
  assert.equal(money.payout, 9.5e9);
  assert.equal(money.payout + money.house + 0.2e9, money.pot);
});

test('сам себя привести нельзя', () => {
  const money = settle(stakes, () => 1, 250, 250);
  assert.equal(money.refs.get(1), 0.125e9); // только со ставок игроков 2 и 3
});

test('розыгрыш пересчитывается по сиду и шансы равны долям', async () => {
  const a = await draw('seed', 7, stakes);
  assert.deepEqual(a, await draw('seed', 7, stakes));
  assert.equal(a.ticket, Number(BigInt('0x' + (await sha256hex('seed:7:10000000000'))) % 10000000000n));
  const wins = { 1: 0, 2: 0, 3: 0 };
  for (let i = 0; i < 3000; i++) wins[(await draw('s' + i, 1, stakes)).winner]++;
  assert.ok(Math.abs(wins[1] / 3000 - 0.5) < 0.04 && Math.abs(wins[2] / 3000 - 0.3) < 0.04, JSON.stringify(wins));
});

test('стрелка встаёт внутрь сектора победителя', () => {
  const many = Array.from({ length: 9 }, (_, i) => ({ user: i + 1, amount: (10 - i) * 1e9, at: i }));
  const view = sectors(many, 9); // победитель с самой маленькой ставкой всё равно показан поимённо
  assert.equal(view.shown.length, 6);
  assert.equal(view.shown[5].user, 9);
  assert.equal(view.restCount, 3);
  const total = many.reduce((sum, s) => sum + s.amount, 0) / 1e9;
  const before = view.shown.slice(0, 5).reduce((sum, s) => sum + s.amount, 0) / 1e9;
  for (const inside of [0, 0.5, 0.999]) {
    const land = landing(view.shown, view.restSum, 9, inside) / 1000;
    assert.ok(land > before / total && land < (before + 2) / total, String(land));
  }
});

test('состояние виджета влезает в лимит', () => {
  const players = Array.from({ length: 6 }, (_, i) => [7000000000 + i, 'Очень длинное имя', 12345.67, 'a_very_long_username_of_32_chars']);
  const json = buildState({ round: 1234567, deadline: 1794586549, now: 1794586535, pot: 123456.78, players, rest: [1234, 99999.99], amounts: [0.5, 1, 2, 5, 10, 25, 50], bot: 'GramJackpotAppBot', hash: 'a41c09e2', win: [7000000001, 99999.99, 500, 1794586535] });
  assert.ok(new TextEncoder().encode(json).length <= STATE_LIMIT);
  assert.equal(JSON.parse(json).p.length, 6);
});

test('метка ставки и входящий перевод', () => {
  assert.equal(parseStakeComment(stakeComment(42)), 42);
  assert.equal(parseStakeComment('rich:42'), null);
  assert.equal(Cell.fromBase64(commentBoc('pot:42')).beginParse().skip(32).loadStringTail(), 'pot:42');
  const tx = { hash: 'h', in_msg: { source: '0:ab', value: '500000000', message_content: { decoded: { comment: 'pot:42' } } }, out_msgs: [] };
  assert.deepEqual(incoming(tx), { hash: 'h', value: 5e8, comment: 'pot:42', source: '0:ab' });
  assert.equal(incoming({ ...tx, in_msg: { ...tx.in_msg, bounced: true } }), null);
  assert.equal(incoming({ hash: 'x', in_msg: { source: null }, out_msgs: [{}] }), null);
});

test('автору уходит только то, что сверх долгов и запаса', () => {
  assert.equal(houseFree(10e9, 7e9, 0.3e9), 2.7e9);
  assert.equal(houseFree(1e9, 7e9, 0.3e9), 0);
});

test('выплата: подписанное сообщение кошельку с переводами', () => {
  const pair = keyPairFromSeed(Buffer.alloc(32, 7));
  const key = keyOf({ HOT_KEY: pair.secretKey.toString('hex') });
  const to = 'UQBL25Vs64NOZszedMeDZBEQvajJBCARESq9iE2DofF9xP5u';
  const boc = transferBoc(key, { seqno: 0, active: false, validUntil: 1794586535, transfers: [{ to, amount: 9.5e9, note: 'Pot #1' }, { to, amount: 1e8, note: 'Referral' }] });
  const message = loadMessage(Cell.fromBase64(boc).beginParse());
  assert.equal(message.info.dest.toString(), key.wallet.address.toString());
  assert.ok(message.init); // первый перевод разворачивает кошелёк
  const body = message.body.beginParse();
  const signature = body.loadBuffer(64);
  assert.ok(signVerify(body.asCell().hash(), signature, pair.publicKey));
  body.skip(32);
  assert.equal(body.loadUint(32), 1794586535);
  assert.equal(body.loadUint(32), 0);
  assert.equal(message.body.refs.length, 2);
  assert.equal(friendly('0:' + key.wallet.address.hash.toString('hex'), {}), key.address);
  assert.equal(keyOf({ HOT_KEY: '' }), null);
});
