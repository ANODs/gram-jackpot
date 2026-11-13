// Кошелёк банка: обычный кошелёк v4r2 в сети TON, ключ лежит в секрете HOT_KEY.
// Отсюда уходят выплаты победителям, пригласившим и автору. Сеть читаем и пишем через toncenter v3.
import { Address, SendMode, WalletContractV4, beginCell, external, internal, storeMessage } from '@ton/ton';

const api = (env) => env.TON_API || (env.TEST_ENV === '1' ? 'https://testnet.toncenter.com/api/v3' : 'https://toncenter.com/api/v3');
const headers = (env) => (env.TONCENTER_KEY ? { 'X-API-Key': env.TONCENTER_KEY } : {});

export function keyOf(env) {
  const secretKey = Buffer.from(env.HOT_KEY || '', 'hex');
  if (secretKey.length !== 64) return null;
  const wallet = WalletContractV4.create({ workchain: 0, publicKey: secretKey.subarray(32) });
  return { secretKey, wallet, address: wallet.address.toString({ bounceable: false, testOnly: env.TEST_ENV === '1' }) };
}

// Адрес в едином виде, чтобы сравнивать и хранить: принимает и raw (0:abc…), и user-friendly
export function friendly(address, env) {
  try {
    return Address.parse(address).toString({ bounceable: false, testOnly: env?.TEST_ENV === '1' });
  } catch {
    return null;
  }
}

export async function walletInfo(env, address) {
  const res = await fetch(`${api(env)}/walletInformation?address=${encodeURIComponent(address)}&use_v2=false`, { headers: headers(env) });
  if (!res.ok) throw new Error(`toncenter walletInformation: ${res.status}`);
  const info = await res.json();
  return { balance: Number(info.balance) || 0, seqno: Number(info.seqno) || 0, active: info.status === 'active' };
}

export async function transactions(env, address, since) {
  const url = `${api(env)}/transactions?account=${encodeURIComponent(address)}&start_utime=${since}&limit=100&sort=desc`;
  const res = await fetch(url, { headers: headers(env) });
  if (!res.ok) throw new Error(`toncenter transactions: ${res.status}`);
  return (await res.json()).transactions || [];
}

// Подписанное внешнее сообщение кошельку: до четырёх переводов [{to, amount, note}], действует до validUntil.
// Комиссию сети кошелёк платит сам (PAY_GAS_SEPARATELY), получатель видит ровно обещанную сумму.
export function transferBoc(key, { seqno, active, validUntil, transfers }) {
  const body = key.wallet.createTransfer({
    seqno,
    secretKey: key.secretKey,
    timeout: validUntil,
    sendMode: SendMode.PAY_GAS_SEPARATELY + SendMode.IGNORE_ERRORS,
    messages: transfers.map((t) => internal({ to: Address.parse(t.to), value: BigInt(t.amount), bounce: false, body: t.note })),
  });
  const message = external({ to: key.wallet.address, init: active ? undefined : key.wallet.init, body });
  return beginCell().store(storeMessage(message)).endCell().toBoc().toString('base64');
}

export async function broadcast(env, boc) {
  const res = await fetch(`${api(env)}/message`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers(env) },
    body: JSON.stringify({ boc }),
  });
  if (!res.ok) throw new Error(`toncenter message: ${res.status} ${(await res.text()).slice(0, 200)}`);
}
