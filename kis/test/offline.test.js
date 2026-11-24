// 네트워크 없이 시험: node test/offline.test.js
// 가짜 응답으로 서버 동작을 점검합니다 (실제 한국투자증권 서버에 접속하지 않음).
'use strict';
const assert = require('assert');
const os = require('os'); const path = require('path'); const fs = require('fs');
const { spawn } = require('child_process');
process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'kismcp-')); // 토큰 캐시를 임시 폴더로
process.env.KIS_MCP_NO_MAIN = '1';
const APP_KEY = 'PStestAppKey0123456789'; const APP_SECRET = 'testSecret/abcdefghijklmnopqrstuvwxyz+0123456789==';
process.env.KIS_APP_KEY = APP_KEY; process.env.KIS_APP_SECRET = APP_SECRET;

const ORIGIN = 'https://openapi.koreainvestment.com:9443';
const calls = [];
let tokenIssued = 0;
let expireOnce = false; let rateOnce = false; let rateAlways = false;
const kstStamp = (ms) => new Date(ms + 9 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ');

global.fetch = async (url, opt) => {
  const u = new URL(url); const h = opt.headers || {};
  calls.push({ method: opt.method, path: u.pathname, query: Object.fromEntries(u.searchParams), headers: h, body: opt.body });
  assert.strictEqual(u.origin, ORIGIN, '고정 주소가 아닌 곳으로 호출함');
  const reply = (o, status = 200, headers = {}) => ({ ok: status < 400, status, headers: new Map(Object.entries(headers)), text: async () => (typeof o === 'string' ? o : JSON.stringify(o)) });
  if (u.pathname === '/oauth2/tokenP') {
    assert.strictEqual(opt.method, 'POST');
    assert.deepStrictEqual(JSON.parse(opt.body), { grant_type: 'client_credentials', appkey: APP_KEY, appsecret: APP_SECRET });
    tokenIssued++;
    return reply({ access_token: 'tok' + tokenIssued + '-abcdef', token_type: 'Bearer', expires_in: 86400, access_token_token_expired: kstStamp(Date.now() + 86_400_000) });
  }
  assert.strictEqual(opt.method, 'GET', 'GET 외 메서드 호출됨');
  if (expireOnce) { expireOnce = false; return reply({ rt_cd: '1', msg_cd: 'EGW00123', msg1: '기간이 만료된 token 입니다.' }, 500); }
  if (rateOnce || rateAlways) { rateOnce = false; return reply({ rt_cd: '1', msg_cd: 'EGW00201', msg1: '초당 거래건수를 초과하였습니다.' }, 500); }
  if (u.pathname === '/uapi/domestic-stock/v1/quotations/inquire-price') {
    if (u.searchParams.get('FID_INPUT_ISCD') === '000000') return reply({ rt_cd: '1', msg_cd: 'TESTERR01', msg1: `없는 종목 ${h.appkey} ${h.appsecret} ${h.authorization}` });
    if (u.searchParams.get('FID_INPUT_ISCD') === '111111') return reply('<html>점검 중</html>', 503);
    if (u.searchParams.get('FID_INPUT_ISCD') === '999999') return reply({ rt_cd: '0', msg_cd: 'MCA00000', msg1: '정상처리 되었습니다.', output: { stck_prpr: '0', lstn_stcn: '0', acml_vol: '0' } });
    return reply({ rt_cd: '0', msg_cd: 'MCA00000', msg1: '정상처리 되었습니다.', output: { stck_prpr: '219500', prdy_vrss: '-2500', prdy_ctrt: '-1.13', acml_vol: '12345678', lstn_stcn: '5846278608' } });
  }
  const days = (n) => Array.from({ length: n }, (_, i) => ({ stck_bsop_date: String(20261124 - i), frgn_ntby_tr_pbmn: String(i) }));
  if (u.pathname.endsWith('/inquire-investor-daily-by-market')) return reply({ rt_cd: '0', output: days(300) });
  if (u.pathname.endsWith('/investor-trade-by-stock-daily')) return reply({ rt_cd: '0', output1: { stck_prpr: '1' }, output2: days(30) });
  if (u.pathname.endsWith('/daily-credit-balance')) return reply({ rt_cd: '0', output: days(30) });
  return reply({ rt_cd: '0', msg_cd: 'MCA00000', msg1: '정상처리 되었습니다.', output: {} });
};

const S = require('../server/index.js');
const { handle, TOOLS, READ_ENDPOINTS } = S;
const call = (id, name, args) => handle({ id, method: 'tools/call', params: { name, arguments: args } });
const tokenDir = () => path.join(process.env.HOME, '.kis-mcp');
const tokenPath = () => path.join(tokenDir(), fs.readdirSync(tokenDir()).filter((f) => f.startsWith('token-'))[0]);

(async () => {
  // 0) MCP 기본
  const init = await handle({ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } });
  assert.strictEqual(init.protocolVersion, '2025-06-18');
  assert.strictEqual(init.serverInfo.name, 'kis-readonly');
  const list = await handle({ id: 2, method: 'tools/list' });
  assert.strictEqual(list.tools.length, TOOLS.length);
  assert(list.tools.every((t) => t.name.startsWith('kis_') && t.annotations.readOnlyHint === true));
  await assert.rejects(handle({ id: 3, method: 'no/such' }), (e) => e.code === -32601);
  console.log('도구 수:', list.tools.length);

  // 1) 현재가: 주소·헤더·쿼리
  const r = await call(10, 'kis_stock_price', { symbol: '005930' });
  assert(!r.isError, r.content[0].text);
  const out = JSON.parse(r.content[0].text);
  assert.strictEqual(out.output.stck_prpr, '219500'); assert.strictEqual(out.market, 'J');
  const g = calls[calls.length - 1];
  assert.strictEqual(g.path, READ_ENDPOINTS.stockPrice.path);
  assert.deepStrictEqual(g.query, { FID_COND_MRKT_DIV_CODE: 'J', FID_INPUT_ISCD: '005930' });
  assert.strictEqual(g.headers.authorization, 'Bearer tok1-abcdef');
  assert.strictEqual(g.headers.appkey, APP_KEY); assert.strictEqual(g.headers.appsecret, APP_SECRET);
  assert.strictEqual(g.headers.tr_id, 'FHKST01010100'); assert.strictEqual(g.headers.custtype, 'P'); assert.strictEqual(g.headers.tr_cont, '');
  console.log('현재가 조회: 헤더·쿼리 확인, stck_prpr', out.output.stck_prpr);

  // 2) 토큰 재사용 + 캐시 파일 권한·만료 시각
  await call(11, 'kis_stock_price', { symbol: '000660', market: 'UN' });
  assert.strictEqual(calls[calls.length - 1].query.FID_COND_MRKT_DIV_CODE, 'UN');
  assert.strictEqual(tokenIssued, 1, '토큰을 불필요하게 재발급함');
  assert.strictEqual(fs.statSync(tokenPath()).mode & 0o777, 0o600);
  const saved = JSON.parse(fs.readFileSync(tokenPath(), 'utf8'));
  assert(Math.abs(saved.expiresAt - (Date.now() + 86_400_000)) < 5000, '만료 시각을 한국 시각으로 해석하지 못함');
  assert(!fs.readFileSync(tokenPath(), 'utf8').includes(APP_KEY));
  console.log('토큰 재사용 1회 발급, 캐시 권한 600');

  // 3) 만료 시각 해석
  const now = Date.UTC(2026, 10, 24, 0, 0, 0); // 2026-11-24 09:00 KST
  assert.strictEqual(S.expiryOf({ access_token_token_expired: '2026-11-25 09:00:00', expires_in: 10 }, now), now + 86_400_000);
  assert.strictEqual(S.expiryOf({ expires_in: 3600 }, now), now + 3_600_000);
  assert.strictEqual(S.expiryOf({ access_token_token_expired: '이상한 값' }, now), now + 86_400_000);

  // 4) 방금 발급한 토큰이 거부되면 1분 제한 때문에 재발급하지 않고 안내
  expireOnce = true;
  const cool = await call(12, 'kis_stock_price', { symbol: '005930' });
  assert(cool.isError && /1분/.test(cool.content[0].text), cool.content[0].text);
  assert.strictEqual(tokenIssued, 1);
  console.log('발급 직후 거부:', cool.content[0].text);

  // 5) 오래된 토큰이 만료(EGW00123)면 한 번만 재발급하고 성공. 메모리 대신 파일에서 다시 읽는지도 확인
  fs.writeFileSync(tokenPath(), JSON.stringify({ ...saved, issuedAt: Date.now() - 3_600_000 }), { mode: 0o600 });
  S._forgetMemToken();
  expireOnce = true;
  const re = await call(13, 'kis_stock_price', { symbol: '005930' });
  assert(!re.isError, re.content[0].text); assert.strictEqual(tokenIssued, 2);
  assert.strictEqual(calls[calls.length - 1].headers.authorization, 'Bearer tok2-abcdef');
  console.log('EGW00123 → 재발급 1회 후 성공');

  // 6) 파일의 토큰이 이미 만료됐으면 호출 전에 재발급
  fs.writeFileSync(tokenPath(), JSON.stringify({ accessToken: 'old', expiresAt: Date.now() - 1000, issuedAt: Date.now() - 90_000_000 }), { mode: 0o600 });
  S._forgetMemToken();
  await call(14, 'kis_stock_price', { symbol: '005930' });
  assert.strictEqual(tokenIssued, 3); assert.strictEqual(calls[calls.length - 1].headers.authorization, 'Bearer tok3-abcdef');

  // 7) 초당 건수 초과(EGW00201): 한 번 기다렸다 재시도, 계속 실패하면 오류
  rateOnce = true; const n0 = calls.length;
  const rr = await call(15, 'kis_stock_price', { symbol: '005930' });
  assert(!rr.isError, rr.content[0].text); assert.strictEqual(calls.length - n0, 2);
  rateAlways = true; const n1 = calls.length;
  const rf = await call(16, 'kis_stock_price', { symbol: '005930' });
  rateAlways = false;
  assert(rf.isError && /EGW00201/.test(rf.content[0].text) && /한도/.test(rf.content[0].text)); assert.strictEqual(calls.length - n1, 2);
  console.log('EGW00201 → 재시도 1회:', rf.content[0].text);

  // 8) rt_cd 오류는 HTTP 200 이어도 실패로 돌려주고, 키·토큰은 가림
  const bad = await call(17, 'kis_stock_price', { symbol: '000000' });
  assert(bad.isError && /TESTERR01/.test(bad.content[0].text));
  for (const secret of [APP_KEY, APP_SECRET, 'tok3-abcdef']) assert(!bad.content[0].text.includes(secret), '오류 문구에 인증 정보가 노출됨');
  const html = await call(18, 'kis_stock_price', { symbol: '111111' });
  assert(html.isError && /HTTP 503/.test(html.content[0].text));
  console.log('rt_cd 오류:', bad.content[0].text);

  // 9) 잘못된 입력은 서버에 보내지 않고 거부
  const n2 = calls.length;
  for (const args of [{ symbol: '../orders' }, { symbol: '5930' }, {}, { symbol: '005930', market: 'KRX' }]) {
    const x = await call(19, 'kis_stock_price', args); assert(x.isError, JSON.stringify(args));
  }
  assert.strictEqual(calls.length, n2);
  const unknown = await call(20, 'kis_order', {}); assert(unknown.isError);

  // 9-1) 나머지 도구: 등록된 주소·tr_id·쿼리로 나가는지
  const EP = READ_ENDPOINTS;
  const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10).replace(/-/g, '');
  const cases = [
    ['kis_stock_daily_chart', { symbol: '005930', from: '2026-11-02', to: '20261120' }, EP.stockDailyChart,
      { FID_COND_MRKT_DIV_CODE: 'J', FID_INPUT_ISCD: '005930', FID_INPUT_DATE_1: '20261102', FID_INPUT_DATE_2: '20261120', FID_PERIOD_DIV_CODE: 'D', FID_ORG_ADJ_PRC: '0' }],
    ['kis_stock_daily_chart', { symbol: '005930', market: 'UN', period: 'W', to: '2026-11-20', adjusted: false }, EP.stockDailyChart,
      { FID_COND_MRKT_DIV_CODE: 'UN', FID_INPUT_ISCD: '005930', FID_INPUT_DATE_1: S.addDays('20261120', -420), FID_INPUT_DATE_2: '20261120', FID_PERIOD_DIV_CODE: 'W', FID_ORG_ADJ_PRC: '1' }],
    ['kis_stock_minute_chart', { symbol: '005930', market: 'NX', time: '10:30' }, EP.stockMinuteChart,
      { FID_COND_MRKT_DIV_CODE: 'NX', FID_INPUT_ISCD: '005930', FID_INPUT_HOUR_1: '103000', FID_PW_DATA_INCU_YN: 'Y', FID_ETC_CLS_CODE: '' }],
    ['kis_index_price', {}, EP.indexPrice, { FID_COND_MRKT_DIV_CODE: 'U', FID_INPUT_ISCD: '0001' }],
    ['kis_index_daily_chart', { index: '1001', period: 'M', from: '2025-01-01', to: '2026-11-20' }, EP.indexDailyChart,
      { FID_COND_MRKT_DIV_CODE: 'U', FID_INPUT_ISCD: '1001', FID_INPUT_DATE_1: '20250101', FID_INPUT_DATE_2: '20261120', FID_PERIOD_DIV_CODE: 'M' }],
    ['kis_market_investor_daily', { market: 'KOSPI', date: '2026-11-20' }, EP.marketInvestorDaily,
      { FID_COND_MRKT_DIV_CODE: 'U', FID_INPUT_ISCD: '0001', FID_INPUT_DATE_1: '20261120', FID_INPUT_ISCD_1: 'KSP', FID_INPUT_DATE_2: '20261120', FID_INPUT_ISCD_2: '0001' }],
    ['kis_market_investor_daily', { market: 'KOSDAQ' }, EP.marketInvestorDaily,
      { FID_COND_MRKT_DIV_CODE: 'U', FID_INPUT_ISCD: '1001', FID_INPUT_DATE_1: today, FID_INPUT_ISCD_1: 'KSQ', FID_INPUT_DATE_2: today, FID_INPUT_ISCD_2: '1001' }],
    ['kis_stock_investor_daily', { symbol: '005930', date: '2026-11-20' }, EP.stockInvestorDaily,
      { FID_COND_MRKT_DIV_CODE: 'J', FID_INPUT_ISCD: '005930', FID_INPUT_DATE_1: '20261120', FID_ORG_ADJ_PRC: '', FID_ETC_CLS_CODE: '' }],
    ['kis_credit_balance_daily', { symbol: '005930', date: '2026-11-20' }, EP.creditBalanceDaily,
      { FID_COND_MRKT_DIV_CODE: 'J', FID_COND_SCR_DIV_CODE: '20476', FID_INPUT_ISCD: '005930', FID_INPUT_DATE_1: '20261120' }],
    ['kis_overseas_price', { exchange: 'nas', symbol: 'aapl' }, EP.overseasPrice, { AUTH: '', EXCD: 'NAS', SYMB: 'AAPL' }],
    ['kis_overseas_daily_chart', { kind: 'N', code: '.DJI', from: '2026-11-02', to: '2026-11-20' }, EP.overseasDailyChart,
      { FID_COND_MRKT_DIV_CODE: 'N', FID_INPUT_ISCD: '.DJI', FID_INPUT_DATE_1: '20261102', FID_INPUT_DATE_2: '20261120', FID_PERIOD_DIV_CODE: 'D' }],
  ];
  for (const [name, args, ep, query] of cases) {
    const x = await call(21, name, args); assert(!x.isError, name + ': ' + x.content[0].text);
    const c = calls[calls.length - 1];
    assert.strictEqual(c.path, ep.path, name); assert.strictEqual(c.headers.tr_id, ep.trId, name); assert.deepStrictEqual(c.query, query, name);
  }
  assert.deepStrictEqual(new Set(cases.map((c) => c[0])).size + 1, TOOLS.length, '시험하지 않은 도구가 있음');
  assert.strictEqual(new Set(Object.values(EP).map((e) => e.trId)).size, Object.keys(EP).length, 'tr_id 가 겹침');
  assert.strictEqual(TOOLS.length, 10);
  console.log('도구 10개: 주소·tr_id·쿼리 확인');

  // 9-1b) 긴 응답은 count 만큼만 돌려줌 (KIS 는 시장 수급 300일치, 종목 수급·신용잔고 30일치를 한 번에 줌)
  const rows = async (name, args, key) => JSON.parse((await call(23, name, args)).content[0].text)[key];
  assert.strictEqual((await rows('kis_market_investor_daily', { market: 'KOSPI' }, 'output')).length, 5);
  assert.strictEqual((await rows('kis_market_investor_daily', { market: 'KOSPI', count: 300 }, 'output')).length, 300);
  assert.strictEqual((await rows('kis_stock_investor_daily', { symbol: '005930' }, 'output2')).length, 5);
  assert.strictEqual((await rows('kis_stock_investor_daily', { symbol: '005930', count: 30 }, 'output2')).length, 30);
  const cr = await rows('kis_credit_balance_daily', { symbol: '005930' }, 'output');
  assert.strictEqual(cr.length, 10); assert.strictEqual(cr[0].stck_bsop_date, '20261124', '최신 행부터 잘라야 함');
  // 없는 종목은 KIS 가 0 으로 채운 정상 응답을 주므로 오류로 바꿈
  const zero = await call(24, 'kis_stock_price', { symbol: '999999' });
  assert(zero.isError && /시세가 없습니다/.test(zero.content[0].text));
  console.log('count 자르기·없는 종목 처리 확인');

  // 9-2) 날짜·시각·코드 검증
  assert.strictEqual(S.ymd('2026-11-24', 'd'), '20261124'); assert.strictEqual(S.ymd('20261124', 'd'), '20261124'); assert.strictEqual(S.ymd('', 'd', 'x'), 'x');
  assert.throws(() => S.ymd('2026-02-30', 'd')); assert.throws(() => S.ymd('어제', 'd'));
  assert.strictEqual(S.addDays('20260301', -1), '20260228'); assert.strictEqual(S.hhmmss('0930'), '093000'); assert.throws(() => S.hhmmss('25:00'));
  const n3 = calls.length;
  for (const [name, args] of [
    ['kis_stock_daily_chart', { symbol: '005930', from: '2026-11-20', to: '2026-11-01' }], ['kis_stock_daily_chart', { symbol: '005930', period: '1d' }],
    ['kis_stock_minute_chart', { symbol: '005930', time: '9시' }], ['kis_index_price', { index: 'KOSPI' }], ['kis_index_daily_chart', { index: '1' }],
    ['kis_market_investor_daily', {}], ['kis_market_investor_daily', { market: 'KOSPI', sector: '../x' }], ['kis_stock_investor_daily', { symbol: '005930', date: '11/20' }],
    ['kis_credit_balance_daily', { symbol: 'x' }], ['kis_overseas_price', { exchange: 'NASDAQ', symbol: 'AAPL' }], ['kis_overseas_price', { exchange: 'NAS', symbol: 'A/../B' }],
    ['kis_overseas_daily_chart', { kind: 'Z', code: '.DJI' }], ['kis_overseas_daily_chart', { kind: 'N', code: 'a b' }],
    ['kis_market_investor_daily', { market: 'KOSPI', count: 301 }], ['kis_stock_investor_daily', { symbol: '005930', count: 0 }], ['kis_credit_balance_daily', { symbol: '005930', count: 1.5 }],
  ]) { const x = await call(22, name, args); assert(x.isError, name + ' ' + JSON.stringify(args)); }
  assert.strictEqual(calls.length, n3, '잘못된 입력이 서버로 나감');
  console.log('잘못된 입력 16건 거부');

  // 10) 동시에 여러 번 불러도 토큰은 한 번만 발급
  fs.rmSync(tokenPath()); S._forgetMemToken(); const t0 = tokenIssued;
  const many = await Promise.all([1, 2, 3, 4, 5].map((i) => call(30 + i, 'kis_stock_price', { symbol: '005930' })));
  assert(many.every((x) => !x.isError)); assert.strictEqual(tokenIssued - t0, 1, '동시 호출에서 토큰을 여러 번 발급함');
  console.log('동시 5건 → 토큰 발급 1회');

  // 11) 조회 전용: POST 는 토큰 발급뿐, 등록 주소는 GET 시세 경로뿐, 주문·계좌 주소는 코드에 없음
  assert(calls.filter((c) => c.method !== 'GET').every((c) => c.method === 'POST' && c.path === '/oauth2/tokenP'));
  const src = fs.readFileSync(path.join(__dirname, '..', 'server', 'index.js'), 'utf8');
  for (const word of ['/trading/', 'order-cash', 'order-rvsecncl', 'hashkey', 'CANO', 'ACNT_PRDT_CD', 'openapivts']) assert(!src.includes(word), `코드에 ${word} 가 있음`);
  for (const [name, ep] of Object.entries(READ_ENDPOINTS)) {
    assert(/^\/uapi\/(domestic-stock|overseas-price)\/v1\/(quotations|ranking)\/[a-z-]+$/.test(ep.path), `${name} 주소가 시세 조회 경로가 아님`);
    assert(/^[A-Z0-9]+$/.test(ep.trId) && !/^[TVJ]TT/.test(ep.trId), `${name} tr_id 가 주문·계좌용으로 보임`);
  }
  assert.strictEqual(S.BASE_URL, ORIGIN);

  // 12) 인증 정보가 없으면 안내 (자식 프로세스로 실제 stdio 통신 확인)
  const lines = await new Promise((resolve, reject) => {
    const env = { ...process.env, KIS_APP_KEY: '', KIS_APP_SECRET: '${user_config.app_secret}' }; delete env.KIS_MCP_NO_MAIN;
    const p = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], { env, stdio: ['pipe', 'pipe', 'ignore'] });
    let buf = ''; p.stdout.on('data', (d) => { buf += d; }); p.on('error', reject);
    p.on('close', () => resolve(buf.trim().split('\n').map((l) => JSON.parse(l))));
    p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }) + '\n');
    p.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    p.stdin.write('깨진 줄\n');
    p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'kis_stock_price', arguments: { symbol: '005930' } } }) + '\n');
    setTimeout(() => p.stdin.end(), 300);
  });
  assert.strictEqual(lines.length, 3); // 알림에는 답하지 않음. 응답 순서는 보장되지 않으므로 id 로 찾음
  const byId = (id) => lines.find((l) => l.id === id);
  assert.strictEqual(byId(1).result.serverInfo.name, 'kis-readonly');
  assert.strictEqual(byId(null).error.code, -32700);
  assert(byId(2).result.isError && /KIS_APP_KEY/.test(byId(2).result.content[0].text));
  console.log('stdio 통신·인증 정보 없음 안내:', byId(2).result.content[0].text.slice(0, 40) + '…');

  console.log('모두 통과');
})().catch((e) => { console.error('실패:', e); process.exit(1); });
