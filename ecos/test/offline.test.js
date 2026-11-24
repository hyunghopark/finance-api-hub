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
let manyTables = false; // true면 통계표 목록을 250개로 돌려줌 (limit 상한 시험)
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
  if (svc === 'StatisticTableList' && manyTables) return send({ StatisticTableList: { list_total_count: 250, row: Array.from({ length: 250 }, (_, i) => ({ P_STAT_CODE: '0000000001', STAT_CODE: 'T' + String(i).padStart(3, '0'), STAT_NAME: '표 ' + i, CYCLE: 'M', SRCH_YN: 'Y', ORG_NAME: null })) } });
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

  // 10) 출력 한도: 넘으면 글자가 아니라 행 수를 줄여 유효한 JSON으로, 한도 이하는 그대로
  const MAX = S.MAX_OUTPUT_CHARS;
  assert.strictEqual(MAX, 60000);
  const small = await tool('ecos_search').run({ stat_code: '817Y002', cycle: 'D', start: '20261101', end: '20261109' });
  assert.strictEqual(S.fitOutput(small, tool('ecos_search').narrow), JSON.stringify(small, null, 1), '한도 이하는 한 글자도 바뀌지 않음');
  const mkRows = (n) => Array.from({ length: n }, (_, i) => ({ time: String(20260101 + i), value: '3.' + i, item: '국고채(3년)', codes: '010200000', unit: '연%' }));
  const bigSearch = { stat_code: '817Y002', stat_name: '시장금리(일별)', cycle: '일', total: 5906, shown: 2500, rows: mkRows(2500) };
  assert.ok(JSON.stringify(bigSearch, null, 1).length > MAX);
  const ft = S.fitOutput(bigSearch, tool('ecos_search').narrow);
  assert.ok(ft.length <= MAX, '길이 한도 이하');
  const fj = JSON.parse(ft);
  assert.strictEqual(fj.truncated, true);
  assert.strictEqual(fj.shown, fj.rows.length, 'shown은 실제 행 수');
  assert.ok(fj.rows.length > 0 && fj.rows.length < 2500);
  assert.strictEqual(fj.total, 5906, '전체 건수는 그대로');
  assert.deepStrictEqual(fj.rows[0], bigSearch.rows[0], '앞쪽(max_rows가 남기는 쪽)을 남김');
  assert.ok(new RegExp(`2500건 중 ${fj.rows.length}건만 표시`).test(fj.note) && /start, end/.test(fj.note), fj.note);
  assert.strictEqual(bigSearch.shown, 2500, '원본 객체는 건드리지 않음');
  // 한 건만 더 넣으면 한도를 넘는 지점까지 채웠는지
  assert.ok(JSON.stringify({ ...fj, shown: fj.shown + 1, rows: bigSearch.rows.slice(0, fj.shown + 1) }, null, 1).length > MAX, '들어가는 만큼 채움');
  // results 배열(ecos_find_table), shown이 없던 도구에는 shown을 추가
  const bigFind = { total: 844, results: Array.from({ length: 500 }, (_, i) => ({ stat_code: 'T' + i, parent_code: '0000000001', stat_name: '통계표 이름 '.repeat(8) + i, cycle: 'M', searchable: true, org: null, cycle_name: '월' })) };
  const gj = JSON.parse(S.fitOutput(bigFind, tool('ecos_find_table').narrow));
  assert.ok(gj.truncated && gj.shown === gj.results.length && gj.total === 844 && /limit/.test(gj.note));
  // 기존 note가 있으면(ecos_market_rates) 뒤에 덧붙임
  const bigRates = { stat: '817Y002 시장금리(일별)', unit: '연%', period: 'x', count: 3000, note: '휴일은 행이 없음.', rows: mkRows(3000) };
  const rj = JSON.parse(S.fitOutput(bigRates, tool('ecos_market_rates').narrow));
  assert.ok(rj.note.startsWith('휴일은 행이 없음. 출력 한도') && rj.count === 3000 && rj.shown === rj.rows.length && rj.truncated === true);
  // rows·results가 아니면 가장 큰 배열을 줄임
  const odd = { a: [1, 2, 3], list: mkRows(2000) };
  const oj = JSON.parse(S.fitOutput(odd));
  assert.ok(oj.truncated && oj.a.length === 3 && oj.shown === oj.list.length && oj.list.length < 2000);
  // 줄일 배열이 없으면 미리보기 형태의 유효한 JSON
  const blob = S.fitOutput({ text: '가"\n'.repeat(40000) });
  const bj = JSON.parse(blob);
  assert.ok(blob.length <= MAX && bj.truncated === true && bj.total_chars > MAX && typeof bj.preview === 'string' && bj.preview.length > 0 && /앞부분만/.test(bj.note));
  for (const t of S.TOOLS) assert.ok(t.narrow && /truncated/.test(t.description), t.name + ': 좁히는 방법과 설명');

  // 11) start가 end보다 늦으면 제공처를 부르기 전에 거절 (주기 6종 모두), 같으면 정상
  S.checkRange('20261109', '20261109');
  for (const [cyc, early, late] of [['A', '2025', '2026'], ['S', '2026S1', '2026S2'], ['S', '2025S2', '2026S1'], ['Q', '2025Q4', '2026Q1'], ['Q', '2026Q2', '2026Q3'],
    ['M', '202512', '202601'], ['M', '202609', '202610'], ['SM', '202610S1', '202610S2'], ['SM', '202609S2', '202610S1'], ['D', '20261031', '20261101'], ['D', '20251231', '20260101']]) {
    const n = seen.length;
    await assert.rejects(() => tool('ecos_search').run({ stat_code: '817Y002', cycle: cyc, start: late, end: early }), (e) => /보다 늦음/.test(e.message) && e.message.includes(late) && e.message.includes(early), cyc + ' 역순 거절');
    assert.strictEqual(seen.length, n, cyc + ': 거절은 제공처 호출 전');
    for (const [a, b] of [[early, late], [early, early]]) {
      await tool('ecos_search').run({ stat_code: '817Y002', cycle: cyc, start: a, end: b });
      assert.ok(seen[seen.length - 1].endsWith(`/817Y002/${cyc}/${a}/${b}`), cyc + ' 정상 순서·같은 시점은 통과: ' + seen[seen.length - 1]);
    }
  }
  { const n = seen.length;
    await assert.rejects(() => tool('ecos_market_rates').run({ start: '20261109', end: '20261101', items: ['ktb3y'] }), /start\(20261109\)가 end\(20261101\)보다 늦음/);
    await assert.rejects(() => tool('ecos_market_rates').run({ start: '20991231' }), /보다 늦음/, 'end 기본값(오늘)보다 늦은 start');
    assert.strictEqual(seen.length, n);
    const same = await tool('ecos_market_rates').run({ start: '20261109', end: '20261109', items: ['ktb3y'] });
    assert.strictEqual(same.period, '20261109~20261109'); }

  // 12) 시장금리 items: 모르는 키가 하나라도 있으면 틀린 키와 쓸 수 있는 키 목록으로 거절, 올바른 키와 기본값은 그대로
  { const n = seen.length;
    await assert.rejects(() => tool('ecos_market_rates').run({ start: '20261101', end: '20261109', items: ['ktb3y', 'bogus', 'KTB10Y'] }),
      (e) => /모르는 키: bogus, KTB10Y\./.test(e.message) && Object.keys(S.RATE_ITEMS).every((k) => e.message.includes(k)));
    await assert.rejects(() => tool('ecos_market_rates').run({ start: '20261101', end: '20261109', items: ['toString'] }), /모르는 키: toString/);
    assert.strictEqual(seen.length, n, '거절은 제공처 호출 전');
    const ok = await tool('ecos_market_rates').run({ start: '20261101', end: '20261109', items: ['ktb3y', 'ktb10y', 'corpAA', 'corpBBB'] });
    assert.deepStrictEqual(ok, mr, '올바른 키만 준 호출은 그대로');
    const def = await tool('ecos_market_rates').run({ start: '20261101', end: '20261109' });
    assert.deepStrictEqual(Object.keys(def.rows[0]), ['date', 'CD(91일)', '국고채(2년)', '국고채(3년)', '국고채(5년)', '국고채(10년)', '국고채(30년)', '회사채(3년, AA-)', '회사채(3년, BBB-)', '신용 스프레드(회사채AA−국고3년, bp)', '국고 10년−3년(bp)']);
    assert.deepStrictEqual(await tool('ecos_market_rates').run({ start: '20261101', end: '20261109', items: [] }), def, '빈 배열은 기본값'); }

  // 13) ecos_find_table limit: 1~200으로 맞춤 (max_rows처럼 오류 없이), 기본 30
  manyTables = true;
  const cnt = async (limit) => (await tool('ecos_find_table').run({ refresh: limit === 'first', ...(typeof limit === 'number' ? { limit } : {}) })).results.length;
  assert.strictEqual(await cnt('first'), 30, '기본 30');
  assert.strictEqual(await cnt(500), 200, '200 초과는 200');
  assert.strictEqual(await cnt(200), 200); assert.strictEqual(await cnt(201), 200); assert.strictEqual(await cnt(7), 7); assert.strictEqual(await cnt(1), 1);
  assert.strictEqual(await cnt(-5), 1, '1 미만은 1'); assert.strictEqual(await cnt(0), 30, '0은 기본값'); assert.strictEqual(await cnt(2.9), 2);
  assert.strictEqual((await tool('ecos_find_table').run({ limit: 500 })).total, 250, 'total은 전체 건수');
  manyTables = false;

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
  console.log('통과: 날짜 형식, 시장금리 표·스프레드 계산, 빈 값 처리, 주소 형식(%3F·생략), 자료 없음, 오류·키 가림, 한글 인코딩, 래퍼 실행 MCP 통신(7개 도구), 키 없음 안내, 시장금리 27개 공식 목록 대조, 가중치·상위 코드 보존, 분류 트리 찾기, 출력 한도(행 수 줄임·유효한 JSON), 기간 역순 거절(주기 6종), 모르는 items 키 거절, limit 상한');
})().catch((e) => { console.error('실패:', e); srv.close(); process.exit(1); });
