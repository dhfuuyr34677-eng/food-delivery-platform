// WeChat Pay v3 API service
// JSAPI payment for mini-program: prepay → user pays → callback → confirm
// Mock mode when WECHAT_PAY_MCH_ID is not set
import crypto from 'node:crypto';
import fs from 'node:fs';

const BASE_URL = 'https://api.mch.weixin.qq.com';

// ── Helpers ─────────────────────────────────────────

function isMock(): boolean {
  return !process.env.WECHAT_PAY_MCH_ID;
}

let _privateKey: string | null = null;
function getPrivateKey(): string {
  if (_privateKey) return _privateKey;
  const path = process.env.WECHAT_PAY_PRIVATE_KEY_PATH;
  if (!path) return '';
  _privateKey = fs.readFileSync(path, 'utf8');
  return _privateKey;
}

function buildAuthHeader(
  method: string,
  path: string,
  body: string | null,
): string {
  const mchId = process.env.WECHAT_PAY_MCH_ID!;
  const serialNo = process.env.WECHAT_PAY_SERIAL_NO!;
  const privateKey = getPrivateKey();

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomBytes(16).toString('hex');
  const message = `${method}\n${path}\n${timestamp}\n${nonce}\n${body ?? ''}\n`;

  const sign = crypto.createSign('SHA256');
  sign.update(message);
  sign.end();
  const signature = sign.sign(privateKey, 'base64');

  return `WECHATPAY2-SHA256-RSA2048 mchid="${mchId}",nonce_str="${nonce}",signature="${signature}",timestamp="${timestamp}",serial_no="${serialNo}"`;
}

async function v3Request<T>(
  method: string,
  path: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const bodyStr = body ? JSON.stringify(body) : null;

  const headers: Record<string, string> = {
    Authorization: buildAuthHeader(method, path, bodyStr),
    Accept: 'application/json',
    'User-Agent': 'food-delivery/0.1.0',
  };
  if (bodyStr) {
    headers['Content-Type'] = 'application/json';
  }

  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, { method, headers, body: bodyStr });

  if (res.ok) {
    return (await res.json()) as T;
  }

  const errorBody = (await res.json().catch(() => ({}))) as any;
  throw new Error(
    `WeChat Pay v3 error [${res.status}]: ${errorBody.message ?? errorBody.code ?? 'unknown'}`,
  );
}

// ── Platform certificates (cached 1h) ─────────────

let _platformCerts: Map<string, string> | null = null;
let _certFetchTime = 0;

async function getPlatformPublicKey(serial: string): Promise<string> {
  if (!_platformCerts || Date.now() - _certFetchTime > 3600000) {
    const res = await v3Request<{
      data: Array<{
        serial_no: string;
        encrypt_certificate: {
          ciphertext: string;
          associated_data: string;
          nonce: string;
        };
      }>;
    }>('GET', '/v3/certificates');

    const apiKey = process.env.WECHAT_PAY_API_KEY_V3!;
    _platformCerts = new Map();

    for (const cert of res.data) {
      const decrypted = aeadDecrypt(
        cert.encrypt_certificate.ciphertext,
        apiKey,
        cert.encrypt_certificate.nonce,
        cert.encrypt_certificate.associated_data,
      );
      _platformCerts.set(cert.serial_no, decrypted);
    }
    _certFetchTime = Date.now();
  }

  const cert = _platformCerts.get(serial);
  if (!cert) throw new Error(`Platform certificate not found for serial: ${serial}`);
  return cert;
}

function aeadDecrypt(
  ciphertextB64: string,
  keyStr: string,
  nonce: string,
  aad: string,
): string {
  const ciphertext = Buffer.from(ciphertextB64, 'base64');
  const authTag = ciphertext.subarray(ciphertext.length - 16);
  const encrypted = ciphertext.subarray(0, ciphertext.length - 16);

  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    Buffer.from(keyStr),
    Buffer.from(nonce),
    { authTagLength: 16 },
  );
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted, undefined, 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// ── Types ──────────────────────────────────────────

interface PrepayRequest {
  appid: string;
  mchid: string;
  description: string;
  out_trade_no: string;
  notify_url: string;
  amount: { total: number; currency: 'CNY' };
  payer: { openid: string };
}

interface PrepayResponse {
  prepay_id: string;
}

export interface JSAPIParams {
  appId: string;
  timeStamp: string;
  nonceStr: string;
  package: string;
  signType: string;
  paySign: string;
}

export interface CallbackHeaders {
  'wechatpay-timestamp': string;
  'wechatpay-nonce': string;
  'wechatpay-signature': string;
  'wechatpay-serial': string;
}

export interface CallbackResource {
  out_trade_no: string;
  transaction_id: string;
  trade_state: string;
  amount?: { total: number };
}

export interface RefundResult {
  refund_id: string;
  status: string;
}

export interface OrderQueryResult {
  trade_state: string;
  transaction_id?: string;
}

// ── Public API ─────────────────────────────────────

export async function createJSAPIPrepay(params: {
  orderNo: string;
  openid: string;
  totalAmount: number;
  description?: string;
}): Promise<{ prepay_id: string }> {
  if (isMock()) {
    console.warn('[WeChatPay] Mock mode: createJSAPIPrepay');
    return { prepay_id: `mock_prepay_${params.orderNo}` };
  }

  const body: PrepayRequest = {
    appid: process.env.WECHAT_APP_ID!,
    mchid: process.env.WECHAT_PAY_MCH_ID!,
    description: params.description ?? '外卖订单',
    out_trade_no: params.orderNo,
    notify_url: process.env.WECHAT_PAY_NOTIFY_URL!,
    amount: { total: params.totalAmount, currency: 'CNY' },
    payer: { openid: params.openid },
  };

  return v3Request<PrepayResponse>(
    'POST',
    '/v3/pay/transactions/jsapi',
    body as any,
  );
}

export function buildJSAPIParams(prepayId: string): JSAPIParams {
  const appId = process.env.WECHAT_APP_ID ?? 'MOCK_APPID';
  const timeStamp = Math.floor(Date.now() / 1000).toString();
  const nonceStr = crypto.randomBytes(16).toString('hex');
  const packageStr = `prepay_id=${prepayId}`;

  if (isMock()) {
    return {
      appId,
      timeStamp,
      nonceStr,
      package: packageStr,
      signType: 'RSA',
      paySign: 'MOCK_PAY_SIGN',
    };
  }

  const message = `${appId}\n${timeStamp}\n${nonceStr}\n${packageStr}\n`;

  const sign = crypto.createSign('SHA256');
  sign.update(message);
  sign.end();
  const paySign = sign.sign(getPrivateKey(), 'base64');

  return { appId, timeStamp, nonceStr, package: packageStr, signType: 'RSA', paySign };
}

export async function verifyAndDecryptCallback(
  headers: CallbackHeaders,
  body: string,
): Promise<CallbackResource> {
  if (isMock()) {
    console.warn('[WeChatPay] Mock mode: callback verification skipped');
    const parsed = JSON.parse(body);
    return {
      out_trade_no:
        parsed.resource?.out_trade_no ?? parsed.out_trade_no ?? 'MOCK',
      transaction_id:
        parsed.resource?.transaction_id ??
        parsed.transaction_id ??
        `mock_txn_${Date.now()}`,
      trade_state: 'SUCCESS',
    };
  }

  // Verify signature
  const timestamp = headers['wechatpay-timestamp'];
  const nonce = headers['wechatpay-nonce'];
  const signature = headers['wechatpay-signature'];
  const serial = headers['wechatpay-serial'];

  const message = `${timestamp}\n${nonce}\n${body}\n`;
  const publicKey = await getPlatformPublicKey(serial);

  const verify = crypto.createVerify('SHA256');
  verify.update(message);
  verify.end();
  if (!verify.verify(publicKey, signature, 'base64')) {
    throw new Error('Callback signature verification failed');
  }

  // Decrypt resource
  const { resource } = JSON.parse(body);
  const apiKey = process.env.WECHAT_PAY_API_KEY_V3!;
  const decrypted = aeadDecrypt(
    resource.ciphertext,
    apiKey,
    resource.nonce,
    resource.associated_data,
  );
  return JSON.parse(decrypted) as CallbackResource;
}

export async function createRefund(params: {
  outTradeNo: string;
  transactionId: string;
  totalAmount: number;
  refundAmount: number;
}): Promise<RefundResult> {
  if (isMock()) {
    console.warn('[WeChatPay] Mock mode: createRefund');
    return {
      refund_id: `mock_refund_${params.outTradeNo}`,
      status: 'SUCCESS',
    };
  }

  const body = {
    out_trade_no: params.outTradeNo,
    transaction_id: params.transactionId,
    out_refund_no: `${params.outTradeNo}_R`,
    amount: {
      total: params.totalAmount,
      refund: params.refundAmount,
      currency: 'CNY',
    },
  };

  return v3Request<RefundResult>(
    'POST',
    '/v3/refund/domestic/refunds',
    body,
  );
}

export async function queryOrder(
  outTradeNo: string,
): Promise<OrderQueryResult> {
  if (isMock()) {
    return { trade_state: 'SUCCESS', transaction_id: `mock_txn_${outTradeNo}` };
  }

  const path = `/v3/pay/transactions/out-trade-no/${outTradeNo}?mchid=${process.env.WECHAT_PAY_MCH_ID}`;
  return v3Request<OrderQueryResult>('GET', path);
}
