// 네트워크 없이 시험: node test/offline.test.js
'use strict';
process.env.FRED_MCP_NO_STDIO = '1';
const assert = require('assert');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const S = require('../server/index.js');

const KEY = 'abcdefghijklmnopqrstuvwxyz123456';
const seen = [];
let fail429 = 1;
const META = {
  WALCL: 'Millions of U.S. Dollars', WTREGEN: 'Billions of U.S. Dollars', RRPONTSYD: 'Billions of U.S. Dollars',
};
const srv = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  seen.push(u);
  const send = (code, o) => { res.statusCode = code; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); };
  if (u.searchParams.get('api_key') !== KEY) return send(400, { error_code: 400, error_message: 'Bad Request.  The value for variable api_key is not registered.' });
  assert.strictEqual(u.searchParams.get('file_type'), 'json');
  const ep = u.pathname.replace('/fred/', '');
  const id = u.searchParams.get('series_id');
  if (ep === 'series') {
    if (id === 'NOPE') return send(400, { error_code: 400, error_message: 'Bad Request.  The series does not exist.' });
    return send(200, { seriess: [{ id, title: 'T ' + id, frequency_short: ['WALCL', 'WTREGEN'].includes(id) ? 'W' : 'D', units: META[id] || 'Percent', units_short: '%', seasonal_adjustment_short: 'NSA', observation_start: '2000-01-01', observation_end: '2026-11-06', last_updated: '2026-11-06 16:05:00-06' }] });
  }
  if (ep === 'series/observations') {
    if (id === 'RATE' && fail429-- > 0) return send(429, { error_code: 429, error_message: 'Too Many Requests.' });
    let obs;
    if (id === 'WALCL') obs = [['2026-10-28', '6750000'], ['2026-11-04', '6748145']];
    else if (id === 'WTREGEN') obs = [['2026-10-28', '850'], ['2026-11-04', '900']];
    else if (id === 'RRPONTSYD') obs = [['2026-10-27', '120'], ['2026-11-03', '100'], ['2026-11-05', '95']];
    else if (id === 'CPIAUCSL' && u.searchParams.get('units') === 'pc1') obs = [['2026-08-01', '3.35'], ['2026-09-01', '3.72'], ['2026-10-01', '.']];
    else if (id === 'CPIAUCSL') obs = [['2026-10-01', '337.476']];
    else obs = [['2026-10-27', '4.40'], ['2026-11-03', '4.45'], ['2026-11-05', '.'], ['2026-11-06', '4.46']];
    if (u.searchParams.get('sort_order') === 'desc') obs = [...obs].reverse();
    return send(200, { count: obs.length, observations: obs.map(([date, value]) => ({ date, value })) });
  }
  if (ep === 'series/release') return send(200, { releases: [{ id: 18, name: 'H.15 Selected Interest Rates', link: 'http://x' }] });
  if (ep === 'release/dates') return send(200, { release_dates: [{ release_id: 18, date: '2099-01-02' }, { release_id: 18, date: '2026-01-02' }, { release_id: 18, date: '2099-01-01' }] });
  if (ep === 'releases/dates') return send(200, { release_dates: [
    { release_id: 10, release_name: 'Consumer Price Index', date: '2026-11-12' },
    { release_id: 50, release_name: 'Employment Situation', date: '2026-11-20' },
    { release_id: 99, release_name: 'Other', date: '2026-11-13' }] });
  if (ep === 'series/search') return send(200, { count: 1, seriess: [{ id: 'DEXKOUS', title: 'Won', frequency_short: 'D', units_short: 'Won/$', seasonal_adjustment_short: 'NSA', observation_start: '1981-04-13', observation_end: '2026-10-30', last_updated: 'x', popularity: 60 }] });
  return send(200, { ok: ep, params: Object.fromEntries(u.searchParams) });
});

(async () => {
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  S._setKey(KEY); S._setHost(srv.address().port); S._setGap(5);
  const tool = (n) => S.TOOLS.find((t) => t.name === n);

  // 1) 공식 문서(2026-11-10)의 v1 경로 31개와 같은지
  const OFFICIAL = 'category category/children category/related category/series category/tags category/related_tags releases releases/dates release release/dates release/series release/sources release/tags release/related_tags release/tables series series/categories series/observations series/release series/search series/search/tags series/search/related_tags series/tags series/updates series/vintagedates sources source source/releases tags related_tags tags/series'.split(' ');
  assert.deepStrictEqual(Object.keys(S.ENDPOINTS).sort(), OFFICIAL.sort());
  await assert.rejects(() => tool('fred_get').run({ endpoint: 'series/delete' }), /허용되지 않은 경로/);

  // 2) 묶음 시리즈가 2026-11-10 공개 페이지에서 존재 확인한 목록 안에 있는지
  const VERIFIED = 'DGS1MO DGS3MO DGS6MO DGS1 DGS2 DGS5 DGS10 DGS30 T10Y2Y T10Y3M T10YIE T5YIE T5YIFR DFII5 DFII10 BAMLH0A0HYM2 BAMLC0A0CM BAMLH0A0HYM2EY BAMLC0A4CBBB STLFSI4 NFCI ANFCI VIXCLS WALCL RRPONTSYD WTREGEN WRESBAL SOFR EFFR DFF DFEDTARU DFEDTARL CPIAUCSL CPILFESL PCEPI PCEPILFE PAYEMS UNRATE ICSA CCSA UMCSENT INDPRO IPG3344S GDPC1 DEXKOUS DTWEXBGS DCOILWTICO M2SL MORTGAGE30US SP500 USREC'.split(' ');
  for (const id of S.BUNDLE_SERIES) assert.ok(VERIFIED.includes(id), '확인 안 된 시리즈: ' + id);

  // 3) 결측 "." → null, 단위 배율
  assert.strictEqual(S.num('.'), null); assert.strictEqual(S.num('4.46'), 4.46);
  assert.strictEqual(S.toMillions('Millions of U.S. Dollars'), 1); assert.strictEqual(S.toMillions('Billions of U.S. Dollars'), 1000);
  assert.strictEqual(S.toMillions('Percent'), null);

  // 4) 여러 시리즈 표 + 결측
  const ob = await tool('fred_observations').run({ series_ids: ['dgs2', 'DGS10'], start: '2026-10-01' });
  assert.strictEqual(ob.count, 4);
  assert.strictEqual(ob.rows.find((r) => r.date === '2026-11-05').DGS2, null);
  assert.strictEqual(ob.rows[3].DGS10, 4.46);
  const q = seen.filter((u) => u.pathname === '/fred/series/observations').pop();
  assert.strictEqual(q.searchParams.get('observation_start'), '2026-10-01');
  await assert.rejects(() => tool('fred_observations').run({ series_ids: ['DGS2'], start: '2026/10/01' }), /YYYY-MM-DD/);

  // 5) 묶음: 결측 건너뛰고 최신·직전·1주 전
  const b = await tool('fred_bundle').run({ bundle: 'rates' });
  const r2 = b.rows.find((r) => r.id === 'DGS2');
  assert.strictEqual(r2.date, '2026-11-06'); assert.strictEqual(r2.value, 4.46);
  assert.strictEqual(r2.prev_date, '2026-11-03'); assert.strictEqual(r2.change, 0.01);
  assert.strictEqual(r2.change_1w, 0.06, '1주 전(10/27) 대비');
  const m = await tool('fred_bundle').run({ bundle: 'macro' });
  const cpiRow = m.rows.find((r) => r.id === 'CPIAUCSL');
  assert.strictEqual(cpiRow.units, '전년 대비 변화율(%)');
  assert.strictEqual(cpiRow.date, '2026-09-01'); assert.strictEqual(cpiRow.missing_latest.date, '2026-10-01'); assert.strictEqual(cpiRow.missing_latest.level_value, 337.476, '결측 변환값이면 원 수준값 함께');
  assert.ok(seen.some((x) => x.searchParams.get('series_id') === 'CPIAUCSL' && x.searchParams.get('units') === 'pc1'));

  // 6) 순유동성: 단위 맞춤 (WALCL 백만, TGA·RRP 십억), 역레포는 그 수요일 또는 직전 값
  const l = await tool('fred_bundle').run({ bundle: 'liquidity' });
  const nl = l.net_liquidity.rows.find((r) => r.date === '2026-11-04');
  assert.strictEqual(nl.fed_assets_bil, 6748.1); assert.strictEqual(nl.tga_bil, 900); assert.strictEqual(nl.rrp_bil, 100); assert.strictEqual(nl.rrp_date, '2026-11-03');
  assert.strictEqual(nl.net_liquidity_bil, 5748.1);

  // 7) 발표 일정·시리즈 정보(미래 발표일만, 오름차순)
  const cal = await tool('fred_release_calendar').run({ start: '2026-11-10', end: '2026-11-25', name_contains: ['consumer price', 'employment'] });
  assert.deepStrictEqual(cal.rows.map((x) => x.release), ['Consumer Price Index', 'Employment Situation']);
  const rd = seen.filter((u) => u.pathname === '/fred/releases/dates').pop();
  assert.strictEqual(rd.searchParams.get('include_release_dates_with_no_data'), 'true');
  const info = await tool('fred_series_info').run({ series_id: 'DGS2' });
  assert.deepStrictEqual(info.upcoming_release_dates, ['2099-01-01', '2099-01-02']);

  // 8) 오류: 키 가림, 시리즈 없음, 429 한 번 재시도
  await assert.rejects(() => tool('fred_series_info').run({ series_id: 'NOPE' }), /series does not exist/);
  S._setKey('zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz');
  await assert.rejects(() => tool('fred_search').run({ text: 'x' }), (e) => /not registered/.test(e.message) && !e.message.includes('zzzz'));
  S._setKey(KEY);
  const r429 = await tool('fred_observations').run({ series_ids: ['RATE'] });
  assert.strictEqual(r429.count, 4, '429 뒤 재시도 성공');
  assert.ok(S.mask('?api_key=' + KEY + '&x=1').includes('api_key=***'));

  // 9) 일반 경로: 인자 전달, file_type·api_key 덮어쓰기 금지
  const g = await tool('fred_get').run({ endpoint: 'category/children', params: { category_id: 32991, file_type: 'xml', api_key: 'evil' } });
  assert.strictEqual(g.params.category_id, '32991'); assert.strictEqual(g.params.file_type, 'json'); assert.strictEqual(g.params.api_key, KEY);

  // 10) 요청 간격: 동시 요청도 줄 세움
  S._setGap(80);
  const t0 = Date.now();
  await Promise.all([tool('fred_get').run({ endpoint: 'sources' }), tool('fred_get').run({ endpoint: 'tags' }), tool('fred_get').run({ endpoint: 'releases' })]);
  assert.ok(Date.now() - t0 >= 150, '동시 3건이 간격을 두고 나감: ' + (Date.now() - t0) + 'ms');
  S._setGap(5);

  // 11) Desktop처럼 래퍼로 불러온 MCP 통신 (키 없음 안내)
  const wrap = path.join(os.tmpdir(), 'fred-wrap-' + process.pid + '.js');
  fs.writeFileSync(wrap, `require(${JSON.stringify(path.join(__dirname, '../server/index.js'))});`);
  const p = spawn(process.execPath, [wrap], { env: { ...process.env, FRED_MCP_NO_STDIO: '0', FRED_API_KEY: '${user_config.api_key}', HOME: '/tmp/fred-mcp-test-home' } });
  let out = '';
  p.stdout.on('data', (d) => (out += d));
  for (const msg of [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'fred_search', arguments: { text: 'x' } } },
  ]) p.stdin.write(JSON.stringify(msg) + '\n');
  await new Promise((r) => setTimeout(r, 1200));
  p.stdin.end();
  await new Promise((r) => p.on('close', r));
  fs.unlinkSync(wrap);
  const resp = out.trim().split('\n').map((x) => JSON.parse(x)).sort((a, c) => a.id - c.id);
  assert.strictEqual(resp.length, 3, out);
  assert.strictEqual(resp[0].result.serverInfo.name, 'fred-readonly');
  assert.strictEqual(resp[1].result.tools.length, 6);
  assert.ok(resp[2].result.isError && /키가 없습니다/.test(resp[2].result.content[0].text));

  srv.close();
  console.log('통과: 공식 v1 경로 31개 대조·차단, 묶음 시리즈 35개 존재 목록 대조, 결측·단위, 여러 시리즈 표, 묶음 최신·직전·1주 변화, 전년비 변환·최신 결측 알림, 순유동성 단위 맞춤, 발표 일정·다음 발표일, 오류·키 가림·429 재시도, 인자 덮어쓰기 금지, 동시 요청 간격, 래퍼 실행 MCP 통신(6개 도구)');
})().catch((e) => { console.error('실패:', e); srv.close(); process.exit(1); });
