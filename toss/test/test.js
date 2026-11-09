// 가짜 응답으로 서버 동작을 점검합니다 (실제 토스 서버에 접속하지 않음).
'use strict';
const assert = require('assert');
const os = require('os'); const path = require('path'); const fs = require('fs');
process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'tossmcp-')); // 토큰 캐시를 임시 폴더로
process.env.TOSS_MCP_NO_MAIN = '1'; process.env.TOSS_CLIENT_ID = 'test-id'; process.env.TOSS_CLIENT_SECRET = 'test-secret';
const calls = [];
let tokenIssued = 0; let fail401Once = false;
global.fetch = async (url, opt) => {
  const u = new URL(url); calls.push({ method: opt.method, path: u.pathname, query: u.search, auth: opt.headers && opt.headers.Authorization });
  assert.strictEqual(u.origin, 'https://openapi.tossinvest.com');
  const ok = (o, status = 200) => ({ ok: status < 400, status, headers: new Map(), text: async () => JSON.stringify(o) });
  if (u.pathname === '/oauth2/token') { tokenIssued++; return ok({ access_token: 'tok' + tokenIssued, token_type: 'Bearer', expires_in: 86400 }); }
  assert.strictEqual(opt.method, 'GET', 'GET 외 메서드 호출됨');
  if (fail401Once) { fail401Once = false; return ok({ error: { code: 'token-revoked', message: '', requestId: 'r1' } }, 401); }
  if (u.pathname === '/api/v1/market-indicators/KOSPI/investor-trading') {
    const A = (b, s) => ({ buyAmount: String(b), sellAmount: String(s) });
    return ok({ result: { nextUntil: '2026-11-03', records: [{
      date: '2026-11-04', updatedAt: '2026-11-04T15:45:00+09:00',
      individual: A(9_000_000_000_000, 7_500_000_000_000),         // +15000억
      foreigner: A(6_000_000_000_000, 7_200_000_000_000),          // -12000억
      institution: { ...A(4_000_000_000_000, 4_250_000_000_000), breakdown: {   // -2500억
        financialInvestment: A(2_000_000_000_000, 2_100_000_000_000), insurance: A(100_000_000_000, 120_000_000_000),
        trust: A(300_000_000_000, 350_000_000_000), privateEquityFund: A(100_000_000_000, 90_000_000_000),
        bank: A(10_000_000_000, 10_000_000_000), otherFinancialInstitution: A(40_000_000_000, 30_000_000_000),
        pensionFund: A(1_450_000_000_000, 1_550_000_000_000) } },
      otherCorporation: A(300_000_000_000, 350_000_000_000),       // -500억
    }] } });
  }
  if (u.pathname === '/api/v1/market-indicators/prices') return ok({ result: [{ symbol: 'KOSPI', lastPrice: '5448.47' }] });
  return ok({ result: { echo: u.pathname } });
};
const { handle, TOOLS, READ_ENDPOINTS } = require('../server/index.js');
(async () => {
  const init = await handle({ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } });
  assert.strictEqual(init.protocolVersion, '2025-06-18');
  const list = await handle({ id: 2, method: 'tools/list' });
  assert.strictEqual(list.tools.length, 13);
  // 1) 시장 수급 요약
  const r = await handle({ id: 3, method: 'tools/call', params: { name: 'toss_market_investor_trading', arguments: { market: 'KOSPI', count: 1 } } });
  assert(!r.isError, r.content[0].text);
  const s = JSON.parse(r.content[0].text).요약[0];
  assert.deepStrictEqual(s.순매수_억원, { 개인: 15000, 외국인: -12000, 기관: -2500, 기타법인: -500 });
  assert.strictEqual(s.네주체합_억원, 0);
  assert.strictEqual(s.기관세부_순매수_억원.연기금, -1000);
  console.log('수급 요약:', JSON.stringify(s.순매수_억원), '합', s.네주체합_억원, '| 연기금', s.기관세부_순매수_억원.연기금);
  // 2) 토큰 재사용 (두 번째 호출에서 재발급하지 않아야 함)
  await handle({ id: 4, method: 'tools/call', params: { name: 'toss_market_indicator_prices', arguments: {} } });
  assert.strictEqual(tokenIssued, 1, '토큰을 불필요하게 재발급함');
  const cacheFiles = fs.readdirSync(path.join(process.env.HOME, '.toss-mcp'));
  const mode = fs.statSync(path.join(process.env.HOME, '.toss-mcp', cacheFiles[0])).mode & 0o777;
  assert.strictEqual(mode, 0o600); console.log('토큰 캐시 권한:', mode.toString(8));
  // 3) 401 이면 한 번만 재발급
  fail401Once = true;
  const r401 = await handle({ id: 5, method: 'tools/call', params: { name: 'toss_kr_market_calendar', arguments: {} } });
  assert(!r401.isError); assert.strictEqual(tokenIssued, 2); console.log('401 → 재발급 1회 후 성공');
  // 4) 잘못된 입력
  const bad = await handle({ id: 6, method: 'tools/call', params: { name: 'toss_stock_investor_trading', arguments: { symbol: '../orders' } } });
  assert(bad.isError); console.log('잘못된 종목코드 거부:', bad.content[0].text);
  // 5) 주문·계좌 경로가 코드에 없는지
  const src = fs.readFileSync(path.join(__dirname, '../server/index.js'), 'utf8');
  for (const p of ['/api/v1/orders', 'conditional-orders', '/api/v1/accounts', '/api/v1/holdings', 'buying-power', 'sellable-quantity', 'X-Tossinvest-Account']) assert(!src.includes(p), '금지 경로 포함: ' + p);
  assert(!/method:\s*'(POST|PUT|DELETE|PATCH)'/.test(src.replace("method: 'POST',\n    headers: { 'Content-Type': 'application/x-www-form-urlencoded'", '')), 'GET 외 메서드 사용');
  // 5-1) 새 도구 6개: 경로·쿼리 확인과 입력 검증
  const call = (name, args) => handle({ id: 99, method: 'tools/call', params: { name, arguments: args } });
  const last = () => calls[calls.length - 1];
  for (const [name, args, wantPath, wantQ] of [
    ['toss_stock_short_selling', { symbol: '005930' }, '/api/v1/stocks/005930/short-selling', 'count=10'],
    ['toss_stock_program_trades', { symbol: '000660', count: 3 }, '/api/v1/stocks/000660/program-trades', 'count=3'],
    ['toss_sector_rankings', {}, '/api/v1/sectors/rankings', 'type=MARKET_TRADING_AMOUNT'],
    ['toss_stock_rankings', { type: 'TOP_LOSERS' }, '/api/v1/rankings', 'type=TOP_LOSERS'],
    ['toss_stock_prices', { symbols: ['005930', 'MU', 'EWY'] }, '/api/v1/prices', 'symbols=005930%2CMU%2CEWY'],
    ['toss_stock_candles', { symbol: 'EWY', before: '2026-11-04T09:00:00+09:00' }, '/api/v1/candles', 'before=2026-11-04T09%3A00%3A00%2B09%3A00'],
  ]) {
    const r2 = await call(name, args); assert(!r2.isError, name + ': ' + r2.content[0].text);
    assert.strictEqual(last().path, wantPath, name); assert(last().query.includes(wantQ), name + ' query ' + last().query);
  }
  for (const [name, args] of [
    ['toss_stock_short_selling', { symbol: '../orders' }],
    ['toss_stock_rankings', { type: 'TOP_GAINERS', duration: 'realtime' }],
    ['toss_sector_rankings', { type: 'BAD' }],
    ['toss_stock_prices', { symbols: ['005930', 'A/B'] }],
    ['toss_stock_candles', { symbol: '../../oauth2' }],
  ]) { const r3 = await call(name, args); assert(r3.isError, name + ' 잘못된 입력이 통과함'); }
  console.log('새 도구 6개 경로·입력 검증 통과');
  // 6) 실제로 나간 호출 목록
  const nonGet = calls.filter((c) => c.method !== 'GET' && c.path !== '/oauth2/token');
  assert.strictEqual(nonGet.length, 0);
  console.log('호출된 주소:', [...new Set(calls.map((c) => c.method + ' ' + c.path))].join(', '));
  console.log('ALL TESTS PASSED');
})().catch((e) => { console.error('TEST FAILED:', e); process.exit(1); });
