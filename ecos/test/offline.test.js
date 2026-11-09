// 네트워크 없이 시험: node test/offline.test.js
// 가짜 ECOS 서버(로컬)로 주소 형식·오류 처리·시장금리 묶음을 확인하고,
// Desktop처럼 다른 스크립트에서 불러온 상태로 MCP 통신을 확인함
'use strict';
process.env.ECOS_MCP_NO_STDIO = '1';
process.env.ECOS_MCP_CACHE_DIR = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'ecos-cache-'));
const assert = require('assert');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const S = require('../server/index.js');

const KEY = 'TESTKEY1234567890';
const seen = [];
const VAL = { '010200000': '3.70', '010210000': '3.95', '010300000': '4.30', '010320000': '10.4', '010502000': '3.1' };
const srv = http.createServer((req, res) => {
  seen.push(req.url);
  const p = req.url.split('/');
  // /api/{svc}/{key}/json/kr/{s}/{e}/...
  const [, , svc, key, fmt, lang] = p;
  const send = (o) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); };
  if (key !== KEY) return send({ RESULT: { CODE: 'INFO-100', MESSAGE: '인증키가 유효하지 않습니다.' } });
  assert.strictEqual(fmt, 'json'); assert.strictEqual(lang, 'kr');
  if (svc === 'StatisticSearch') {
    const [stat, cyc, st, en, item] = p.slice(8);
    if (cyc === 'D' && !/^\d{8}$/.test(st)) return send({ RESULT: { CODE: 'ERROR-101', MESSAGE: '주기와 다른 형식의 날짜 형식입니다.' } });
    if (stat === 'EMPTY') return send({ RESULT: { CODE: 'INFO-200', MESSAGE: '해당하는 데이터가 없습니다.' } });
    const rows = ['20261105', '20261106', '20261109'].map((t) => ({ WGT: stat === 'WGT' ? '7.1' : null, STAT_CODE: stat, STAT_NAME: '1.3.2.1. 시장금리(일별)', ITEM_CODE1: item, ITEM_NAME1: '항목' + item,
      UNIT_NAME: '연%', TIME: t, DATA_VALUE: t === '20261109' && item === '010320000' ? '' : (VAL[item] || '1.0') }));
    return send({ StatisticSearch: { list_total_count: rows.length, row: rows } });
  }
  if (svc === 'StatisticItemList') return send({ StatisticItemList: { list_total_count: 1, row: [{ STAT_CODE: p[8], STAT_NAME: '물가', GRP_CODE: 'Group1', GRP_NAME: '품목', ITEM_CODE: 'A', ITEM_NAME: '쌀', P_ITEM_CODE: 'P', P_ITEM_NAME: '식료품', CYCLE: 'M', START_TIME: '2000', END_TIME: '202610', DATA_CNT: 3, UNIT_NAME: '2020=100', WEIGHT: '3.5' }] } });
  if (svc === 'StatisticTableList') return send({ StatisticTableList: { list_total_count: 3, row: [
    { P_STAT_CODE: '*', STAT_CODE: '0000000001', STAT_NAME: '1. 통화/금융', CYCLE: null, SRCH_YN: 'N', ORG_NAME: null },
    { P_STAT_CODE: '0000000001', STAT_CODE: '722Y001', STAT_NAME: '1.3.1. 한국은행 기준금리', CYCLE: 'D', SRCH_YN: 'Y', ORG_NAME: '한국은행' },
    { P_STAT_CODE: '0000000009', STAT_CODE: '901Y056', STAT_NAME: '1.5.1.4. 증시주변자금동향', CYCLE: 'M', SRCH_YN: 'Y', ORG_NAME: '금융투자협회' }] } });
  if (svc === 'StatisticWord') return send({ StatisticWord: { list_total_count: 1, row: [{ WORD: decodeURIComponent(p[8]), CONTENT: ' 뜻 ' }] } });
  return send({ RESULT: { CODE: 'ERROR-500', MESSAGE: '서버 오류' } });
});

(async () => {
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  S._setKey(KEY); S._setHost(srv.address().port);
  const tool = (n) => S.TOOLS.find((t) => t.name === n);

  // 1) 날짜 형식 검사
  S.checkDate('D', '20261109', 'x'); S.checkDate('Q', '2026Q3', 'x'); S.checkDate('SM', '202610S1', 'x');
  assert.throws(() => S.checkDate('D', '2026', 'start'), /맞지 않음/);
  assert.throws(() => S.checkDate('W', '2026', 'start'), /cycle/);
  assert.strictEqual(S.bp(4.3, 3.7), 60); assert.strictEqual(S.bp(null, 3.7), null);

  // 2) 시장금리 묶음: 날짜별 표 + 스프레드
  const mr = await tool('ecos_market_rates').run({ start: '20261101', end: '20261109', items: ['ktb3y', 'ktb10y', 'corpAA', 'corpBBB'] });
  assert.strictEqual(mr.count, 3);
  const last = mr.rows[2];
  assert.strictEqual(last.date, '20261109');
  assert.strictEqual(last['국고채(3년)'], 3.7);
  assert.strictEqual(last['신용 스프레드(회사채AA−국고3년, bp)'], 60);
  assert.strictEqual(last['국고 10년−3년(bp)'], 25);
  assert.strictEqual(last['회사채(3년, BBB-)'], null, '빈 값은 null');
  assert.ok(seen.some((u) => u.includes('/StatisticSearch/' + KEY + '/json/kr/1/1000/817Y002/D/20261101/20261109/010300000')), seen.join('\n'));

  // 3) 일반 조회: 중간 빈 항목은 %3F, 끝의 빈 항목은 생략
  await tool('ecos_search').run({ stat_code: '901Y009', cycle: 'D', start: '20261101', end: '20261109', item2: 'B' });
  assert.ok(seen[seen.length - 1].endsWith('/901Y009/D/20261101/20261109/%3F/B'), seen[seen.length - 1]);
  await tool('ecos_search').run({ stat_code: '901Y009', cycle: 'D', start: '20261101', end: '20261109' });
  assert.ok(seen[seen.length - 1].endsWith('/901Y009/D/20261101/20261109'), seen[seen.length - 1]);

  // 4) 자료 없음(INFO-200)은 빈 결과, 오류는 메시지 + 키 가림
  const empty = await tool('ecos_search').run({ stat_code: 'EMPTY', cycle: 'D', start: '20261101', end: '20261109' });
  assert.strictEqual(empty.shown, 0);
  S._setKey('WRONGKEY99');
  await assert.rejects(() => tool('ecos_word').run({ word: '경상수지' }), (e) => /INFO-100/.test(e.message) && !e.message.includes('WRONGKEY99'));
  S._setKey(KEY);
  assert.strictEqual(S.mask('주소 /api/x/' + KEY + '/json'), '주소 /api/x/***/json');

  // 5) 한글 인자 인코딩
  const w = await tool('ecos_word').run({ word: '경상수지' });
  assert.strictEqual(w.rows[0].word, '경상수지'); assert.strictEqual(w.rows[0].content, '뜻');


  // 7) 시장금리 27개 항목이 2026-11-09 공식 목록(StatisticItemList 817Y002)과 같은지
  const OFFICIAL_817Y002 = '010101000 010102000 010200001 010260000 010150000 010151000 010152000 010190000 010210000 010220000 010230000 010195000 010200000 010300000 010310000 010320000 010400002 010501000 010502000 010503000 010503500 010504000 010400000 010103000 010400001 010240000 010901000'.split(' ');
  const mine = Object.values(S.RATE_ITEMS).map((v) => v[0]);
  assert.strictEqual(new Set(mine).size, 27, '중복 없이 27개');
  assert.deepStrictEqual([...mine].sort(), [...OFFICIAL_817Y002].sort(), '공식 27개와 일치');

  // 8) 가중치·상위 코드 보존
  const it = await tool('ecos_items').run({ stat_code: '901Y009' });
  assert.strictEqual(it.rows[0].weight, '3.5'); assert.strictEqual(it.rows[0].parent_code, 'P'); assert.strictEqual(it.rows[0].group_code, 'Group1');
  const wg = await tool('ecos_search').run({ stat_code: 'WGT', cycle: 'D', start: '20261101', end: '20261109' });
  assert.strictEqual(wg.rows[0].weight, '7.1');
  const nw = await tool('ecos_search').run({ stat_code: '817Y002', cycle: 'D', start: '20261101', end: '20261109' });
  assert.ok(!('weight' in nw.rows[0]) || nw.rows[0].weight === undefined, '가중치 없으면 생략');

  // 9) 분류 트리: parent_code로 하위 통계표 찾기 (캐시는 시험용 HOME에)
  const tr = await tool('ecos_find_table').run({ parent_code: '0000000001' });
  assert.deepStrictEqual(tr.results.map((x) => x.stat_code), ['722Y001']);
  const tq = await tool('ecos_find_table').run({ query: '증시주변' });
  assert.strictEqual(tq.results[0].parent_code, '0000000009');
  assert.ok(fs.existsSync(path.join(process.env.ECOS_MCP_CACHE_DIR, 'tables.json')), '시험 캐시는 임시 폴더에');

  // 6) Desktop처럼 다른 스크립트에서 불러온 상태로 MCP 통신 (키 없음 안내 포함)
  const wrap = path.join(os.tmpdir(), 'ecos-wrap-' + process.pid + '.js');
  fs.writeFileSync(wrap, `require(${JSON.stringify(path.join(__dirname, '../server/index.js'))});`);
  const p = spawn(process.execPath, [wrap], { env: { ...process.env, ECOS_MCP_NO_STDIO: '0', ECOS_API_KEY: '${user_config.api_key}', HOME: '/tmp/ecos-mcp-test-home' } });
  let out = '';
  p.stdout.on('data', (d) => (out += d));
  for (const m of [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'ecos_word', arguments: { word: '경상수지' } } },
  ]) p.stdin.write(JSON.stringify(m) + '\n');
  await new Promise((r) => setTimeout(r, 800));
  p.stdin.end();
  await new Promise((r) => p.on('close', r));
  fs.unlinkSync(wrap);
  const res = out.trim().split('\n').map((l) => JSON.parse(l)).sort((a, b) => a.id - b.id);
  assert.strictEqual(res.length, 3, '알림에는 응답하지 않음: ' + out);
  assert.strictEqual(res[0].result.serverInfo.name, 'ecos-readonly');
  assert.strictEqual(res[1].result.tools.length, 7);
  assert.ok(res[2].result.isError && /키가 없습니다/.test(res[2].result.content[0].text));

  srv.close();
  console.log('통과: 날짜 형식, 시장금리 표·스프레드 계산, 빈 값 처리, 주소 형식(%3F·생략), 자료 없음, 오류·키 가림, 한글 인코딩, 래퍼 실행 MCP 통신(7개 도구), 키 없음 안내, 시장금리 27개 공식 목록 대조, 가중치·상위 코드 보존, 분류 트리 찾기');
})().catch((e) => { console.error('실패:', e); srv.close(); process.exit(1); });
