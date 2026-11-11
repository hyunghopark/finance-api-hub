// 네트워크 없이 시험: node test/offline.test.js
// 가짜 KRX 서버(로컬)로 주소·헤더·값 변환·거르기·오류 처리를 확인하고,
// Desktop처럼 다른 스크립트에서 불러온 상태로 MCP 통신을 확인함
'use strict';
process.env.KRX_MCP_NO_STDIO = '1';
const assert = require('assert');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const S = require('../server/index.js');

const KEY = 'TESTKEY1234567890ABCDEF';
const seen = [];
const kst = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10).replace(/-/g, '');
const TODAY = kst();
const LAST_OPEN = S.addDays(TODAY, -3); // 가짜 서버에서 "자료가 있는 가장 최근 날"

const STK = [
  { BAS_DD: 'D', ISU_CD: '005930', ISU_NM: '삼성전자', MKT_NM: 'KOSPI', SECT_TP_NM: '-', TDD_CLSPRC: '71,200', CMPPREVDD_PRC: '-800', FLUC_RT: '-1.11', TDD_OPNPRC: '72,000', TDD_HGPRC: '72,300', TDD_LWPRC: '71,000', ACC_TRDVOL: '12,345,678', ACC_TRDVAL: '880,000,000,000', MKTCAP: '425,000,000,000,000', LIST_SHRS: '5,969,782,550' },
  { BAS_DD: 'D', ISU_CD: '000660', ISU_NM: 'SK하이닉스', MKT_NM: 'KOSPI', SECT_TP_NM: '', TDD_CLSPRC: '190,500', CMPPREVDD_PRC: '3,500', FLUC_RT: '1.87', TDD_OPNPRC: '188,000', TDD_HGPRC: '191,000', TDD_LWPRC: '187,500', ACC_TRDVOL: '3,000,000', ACC_TRDVAL: '570,000,000,000', MKTCAP: '138,000,000,000,000', LIST_SHRS: '728,002,365' },
  { BAS_DD: 'D', ISU_CD: '005935', ISU_NM: '삼성전자우', MKT_NM: 'KOSPI', SECT_TP_NM: '', TDD_CLSPRC: '58,000', CMPPREVDD_PRC: '0', FLUC_RT: '0.00', TDD_OPNPRC: '58,000', TDD_HGPRC: '58,200', TDD_LWPRC: '57,900', ACC_TRDVOL: '900,000', ACC_TRDVAL: '52,000,000,000', MKTCAP: '47,000,000,000,000', LIST_SHRS: '822,886,700', NEW_FIELD: '1,000' },
  { BAS_DD: 'D', ISU_CD: '999999', ISU_NM: '거래정지', MKT_NM: 'KOSPI', SECT_TP_NM: '', TDD_CLSPRC: '1,000', CMPPREVDD_PRC: '-', FLUC_RT: '-', TDD_OPNPRC: '', TDD_HGPRC: '', TDD_LWPRC: '', ACC_TRDVOL: '0', ACC_TRDVAL: '0', MKTCAP: '1,000,000', LIST_SHRS: '1,000' },
];

const srv = http.createServer((req, res) => {
  seen.push({ url: req.url, key: req.headers.auth_key, method: req.method });
  const u = new URL(req.url, 'http://x');
  const d = u.searchParams.get('basDd');
  const send = (code, o) => { res.statusCode = code; res.setHeader('Content-Type', 'application/json'); res.end(typeof o === 'string' ? o : JSON.stringify(o)); };
  if (req.headers.auth_key !== KEY) return send(401, { respMsg: 'Unauthorized Key', respCode: '401' });
  if (u.pathname === '/svc/apis/etp/etn_bydd_trd') return send(401, { respMsg: 'Unauthorized API Call', respCode: '401' });
  if (u.pathname === '/svc/apis/gen/oil_bydd_trd') return send(200, '<html>점검 중</html>');
  if (u.pathname === '/svc/apis/gen/gold_bydd_trd') return send(429, {});
  if (u.pathname === '/svc/apis/esg/esg_index_info') return send(200, { OutBlock_9: [{ BAS_DD: d, IDX_NM: 'KRX ESG Leaders 150', CLSPRC_IDX: '2,345.67', PRV_DD_CMPR: '-1.2', UPDN_RATE: '-0.05', TRD_ISU_CNT: '150', ACC_TRDVOL: '10', ACC_TRDVAL: '20' }] });
  if (d > LAST_OPEN) return send(200, { OutBlock_1: [] }); // 휴장·갱신 전
  if (u.pathname === '/svc/apis/sto/stk_bydd_trd') return send(200, { OutBlock_1: STK.map((r) => ({ ...r, BAS_DD: d })) });
  if (u.pathname === '/svc/apis/sto/stk_isu_base_info') return send(200, { OutBlock_1: [{ ISU_CD: 'KR7005930003', ISU_SRT_CD: '005930', ISU_NM: '삼성전자보통주', ISU_ABBRV: '삼성전자', ISU_ENG_NM: 'SamsungElectronics', LIST_DD: '19750611', MKT_TP_NM: 'KOSPI', SECUGRP_NM: '주권', SECT_TP_NM: '', KIND_STKCERT_TP_NM: '보통주', PARVAL: '100', LIST_SHRS: '5969782550' },
    { ISU_CD: 'KR7000001234', ISU_SRT_CD: '000001', ISU_NM: '무액면회사', ISU_ABBRV: '무액면', ISU_ENG_NM: 'NoPar', LIST_DD: '20200102', MKT_TP_NM: 'KOSPI', SECUGRP_NM: '주권', SECT_TP_NM: '', KIND_STKCERT_TP_NM: '보통주', PARVAL: '무액면', LIST_SHRS: '1000' }] });
  if (u.pathname === '/svc/apis/idx/krx_dd_trd') return send(200, { OutBlock_1: [
    { BAS_DD: d, IDX_CLSS: 'KRX', IDX_NM: 'KRX 반도체', CLSPRC_IDX: '4,321.10', CMPPREVDD_IDX: '55.20', FLUC_RT: '1.29', OPNPRC_IDX: '4,270.00', HGPRC_IDX: '4,330.00', LWPRC_IDX: '4,260.00', ACC_TRDVOL: '100', ACC_TRDVAL: '200', MKTCAP: '300' },
    { BAS_DD: d, IDX_CLSS: 'KRX', IDX_NM: 'KRX 은행', CLSPRC_IDX: '987.65', CMPPREVDD_IDX: '-3.10', FLUC_RT: '-0.31', OPNPRC_IDX: '990.00', HGPRC_IDX: '992.00', LWPRC_IDX: '985.00', ACC_TRDVOL: '10', ACC_TRDVAL: '20', MKTCAP: '30' }] });
  return send(200, { OutBlock_1: [] });
});

(async () => {
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  S._setKey(KEY); S._setHost(srv.address().port);
  const tool = (n) => S.TOOLS.find((t) => t.name === n);

  // 1) 명세: 공식 31개, 경로·(도구,type) 중복 없음, 분야별 개수(지수5 주식8 증권상품3 채권3 파생6 일반상품3 ESG3)
  assert.strictEqual(S.APIS.length, 31);
  assert.strictEqual(new Set(S.APIS.map((a) => a.path)).size, 31);
  assert.strictEqual(new Set(S.APIS.map((a) => a.tool + '/' + a.type)).size, 31);
  const cnt = {}; for (const a of S.APIS) cnt[a.tool] = (cnt[a.tool] || 0) + 1;
  assert.deepStrictEqual(cnt, { krx_index: 5, krx_stock: 8, krx_etp: 3, krx_bond: 3, krx_derivative: 6, krx_commodity: 3, krx_esg: 3 });
  assert.strictEqual(S.TOOLS.length, 7);
  for (const a of S.APIS) {
    assert.ok(/^(idx|sto|etp|bon|drv|gen|esg)\/[a-z_]+$/.test(a.path), a.path);
    assert.ok(/^\d{8}$/.test(a.from), a.name);
    const labels = a.fields.map((f) => f[0]); const codes = a.fields.map((f) => f[1]);
    assert.strictEqual(new Set(labels).size, labels.length, '항목명 중복: ' + a.name);
    assert.strictEqual(new Set(codes).size, codes.length, '출력명 중복: ' + a.name);
    assert.ok(codes.every((c) => /^[A-Z0-9_]+$/.test(c)), a.name);
  }
  // 공식 화면의 항목 수와 대조 (2026-11-10 수집)
  const N = { 'idx/krx_dd_trd': 12, 'idx/bon_dd_trd': 15, 'idx/drvprod_dd_trd': 9, 'sto/stk_bydd_trd': 15, 'sto/sw_bydd_trd': 20, 'sto/sr_bydd_trd': 19, 'sto/stk_isu_base_info': 12, 'etp/etf_bydd_trd': 19, 'etp/etn_bydd_trd': 19, 'etp/elw_bydd_trd': 16, 'bon/kts_bydd_trd': 17, 'bon/bnd_bydd_trd': 15, 'drv/fut_bydd_trd': 15, 'drv/opt_bydd_trd': 15, 'gen/oil_bydd_trd': 6, 'gen/gold_bydd_trd': 11, 'esg/esg_etp_info': 8, 'esg/sri_bond_info': 12, 'esg/esg_index_info': 8 };
  for (const [p, n] of Object.entries(N)) assert.strictEqual(S.APIS.find((a) => a.path === p).fields.length, n, p);

  // 2) 값 변환: 쉼표·음수·소수는 숫자, 빈 값과 '-'는 null, 코드·이름·날짜는 글자 그대로
  assert.strictEqual(S.conv('TDD_CLSPRC', '71,200'), 71200);
  assert.strictEqual(S.conv('FLUC_RT', '-1.11'), -1.11);
  assert.strictEqual(S.conv('FLUC_RT', '-'), null);
  assert.strictEqual(S.conv('TDD_OPNPRC', ''), null);
  assert.strictEqual(S.conv('ISU_CD', '005930'), '005930');
  assert.strictEqual(S.conv('BAS_DD', '20261109'), '20261109');
  assert.strictEqual(S.conv('LIST_DD', '19750611'), '19750611');
  assert.strictEqual(S.conv('TARSTK_ISU_SRT_CD', '000660'), '000660');
  assert.strictEqual(S.conv('TOT_EARNG_IDX_CMPPREVDD', '-0.12'), -0.12, '_CMPPREVDD는 날짜가 아님');
  assert.strictEqual(S.conv('PARVAL', '무액면'), '무액면');
  assert.strictEqual(S.conv('PARVAL', '100'), 100);

  // 3) 날짜 지정 조회: 주소·헤더·GET, 숫자 변환, 시장 요약, 정렬·개수 제한
  const D = S.addDays(TODAY, -5);
  const r1 = await tool('krx_stock').run({ type: 'kospi', date: D, sort_by: '거래대금', limit: 2 });
  const last = seen[seen.length - 1];
  assert.strictEqual(last.url, '/svc/apis/sto/stk_bydd_trd?basDd=' + D);
  assert.strictEqual(last.key, KEY); assert.strictEqual(last.method, 'GET');
  assert.strictEqual(r1.total, 4); assert.strictEqual(r1.matched, 4); assert.strictEqual(r1.shown, 2);
  assert.deepStrictEqual(r1.rows.map((x) => x['종목명']), ['삼성전자', 'SK하이닉스']);
  assert.strictEqual(r1.rows[0]['종가'], 71200); assert.strictEqual(r1.rows[0]['종목코드'], '005930');
  assert.strictEqual(r1.rows[0]['소속부'], null);
  assert.deepStrictEqual(r1.market_summary, { 상승: 1, 하락: 1, 보합: 1, 거래대금_합계: 880e9 + 570e9 + 52e9, 시가총액_합계: 425e12 + 138e12 + 47e12 + 1e6 });
  assert.ok(/4건 중 2건/.test(r1.note));

  // 4) 같은 날 같은 API는 다시 부르지 않음(캐시) + 거르기·항목 고르기·오름차순·빈 값은 뒤로
  const before = seen.length;
  const r2 = await tool('krx_stock').run({ type: 'kospi', date: D, name_contains: '삼성', fields: ['종목명', '등락률'], sort_by: '등락률', ascending: true });
  assert.strictEqual(seen.length, before, '캐시 사용');
  assert.deepStrictEqual(r2.rows, [{ 종목명: '삼성전자', 등락률: -1.11 }, { 종목명: '삼성전자우', 등락률: 0 }]);
  const r3 = await tool('krx_stock').run({ type: 'kospi', date: D, sort_by: '등락률', ascending: true });
  assert.strictEqual(r3.rows[3]['종목명'], '거래정지', '빈 값은 오름차순에서도 맨 뒤');
  const r4 = await tool('krx_stock').run({ type: 'kospi', date: D, code: '000660' });
  assert.strictEqual(r4.matched, 1); assert.strictEqual(r4.rows[0]['종목명'], 'SK하이닉스');
  const r5 = await tool('krx_stock').run({ type: 'kospi', date: D, code: '005935' });
  assert.strictEqual(r5.rows[0].NEW_FIELD, 1000, '명세에 없는 새 항목도 보존');

  // 5) 날짜를 비우면 어제부터 거슬러 자료 있는 날을 찾음
  S._clearCache(); const b2 = seen.length;
  const r6 = await tool('krx_index').run({ type: 'krx', name_contains: '반도체' });
  assert.strictEqual(r6.date, LAST_OPEN);
  assert.strictEqual(seen.length - b2, 3, '어제·그제는 비어 있고 3일 전에 자료');
  assert.strictEqual(r6.rows[0]['종가'], 4321.1); assert.strictEqual(r6.rows[0]['계열구분'], 'KRX');
  assert.ok(!('market_summary' in r6));

  // 6) 종목기본정보: 표준코드·단축코드 어느 쪽으로도 찾기
  const r7 = await tool('krx_stock').run({ type: 'kospi_info', date: D, code: '005930' });
  assert.strictEqual(r7.rows[0]['표준코드'], 'KR7005930003'); assert.strictEqual(r7.rows[0]['상장일'], '19750611'); assert.strictEqual(r7.rows[0]['상장주식수'], 5969782550);
  const r8 = await tool('krx_stock').run({ type: 'kospi_info', date: D, code: 'kr7000001234' });
  assert.strictEqual(r8.rows[0]['액면가'], '무액면');

  // 7) 자료 없는 날, 인자 오류(호출 전에 걸러짐)
  const e1 = await tool('krx_stock').run({ type: 'kospi', date: S.addDays(TODAY, -1) });
  assert.strictEqual(e1.total, 0); assert.ok(/자료가 없습니다/.test(e1.note));
  const b3 = seen.length;
  await assert.rejects(() => tool('krx_stock').run({ type: 'nasdaq' }), /type은 kospi, kosdaq/);
  await assert.rejects(() => tool('krx_stock').run({ type: 'kospi', date: '2026119' }), /YYYYMMDD/);
  await assert.rejects(() => tool('krx_stock').run({ type: 'kospi', date: '20260230' }), /실제 날짜/);
  await assert.rejects(() => tool('krx_stock').run({ type: 'konex', date: '20130628' }), /20130701부터/);
  await assert.rejects(() => tool('krx_stock').run({ type: 'kospi', date: S.addDays(TODAY, 2) }), /미래/);
  await assert.rejects(() => tool('krx_stock').run({ type: 'kospi', date: D, sort_by: '거래 대금' }), /sort_by는/);
  await assert.rejects(() => tool('krx_stock').run({ type: 'kospi', date: D, fields: ['종가', 'PER'] }), /fields에 없는 항목: PER/);
  assert.strictEqual(seen.length, b3, '인자 오류는 KRX를 부르지 않음');
  const dash = await tool('krx_index').run({ type: 'krx', date: D.slice(0, 4) + '-' + D.slice(4, 6) + '-' + D.slice(6) });
  assert.strictEqual(dash.date, D, 'YYYY-MM-DD도 받음');

  // 8) 오류: 미승인 API 안내, 틀린 키(키 문자열은 메시지에 없음), JSON 아님, 한도 초과, 다른 블록 이름
  await assert.rejects(() => tool('krx_etp').run({ type: 'etn', date: D }), (e) => /활용 신청이 승인되지/.test(e.message) && /증권상품/.test(e.message) && /ETN 일별매매정보/.test(e.message) && /Unauthorized API Call/.test(e.message));
  await assert.rejects(() => tool('krx_commodity').run({ type: 'oil', date: D }), /JSON 해석 실패/);
  await assert.rejects(() => tool('krx_commodity').run({ type: 'gold', date: D }), /한도/);
  const esg = await tool('krx_esg').run({ type: 'index', date: D });
  assert.strictEqual(esg.rows[0]['현재가'], 2345.67, 'OutBlock_1이 아니어도 배열을 찾음');
  S._setKey('WRONGKEY9999'); S._clearCache();
  await assert.rejects(() => tool('krx_stock').run({ type: 'kospi', date: D }), (e) => /거절/.test(e.message) && !e.message.includes('WRONGKEY9999'));
  assert.strictEqual(S.mask('키 WRONGKEY9999 노출'), '키 *** 노출');
  S._setKey(KEY);

  // 9) 도구 설명에 type과 출력 항목이 들어 있음
  const dsc = tool('krx_etp').description;
  assert.ok(dsc.includes('etf(ETF 일별매매정보') && dsc.includes('순자산가치(NAV)') && dsc.includes('활용 신청'));
  assert.deepStrictEqual(tool('krx_derivative').inputSchema.properties.type.enum, ['futures', 'stock_futures_kospi', 'stock_futures_kosdaq', 'options', 'stock_options_kospi', 'stock_options_kosdaq']);

  // 10) Desktop처럼 다른 스크립트에서 불러온 상태로 MCP 통신 (키 없음 안내 포함)
  const wrap = path.join(os.tmpdir(), 'krx-wrap-' + process.pid + '.js');
  fs.writeFileSync(wrap, `require(${JSON.stringify(path.join(__dirname, '../server/index.js'))});`);
  const p = spawn(process.execPath, [wrap], { env: { ...process.env, KRX_MCP_NO_STDIO: '0', KRX_API_KEY: '${user_config.api_key}', HOME: '/tmp/krx-mcp-test-home' } });
  let out = '';
  p.stdout.on('data', (d) => (out += d));
  for (const m of [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'krx_stock', arguments: { type: 'kospi', date: D } } },
    { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'krx_nope', arguments: {} } },
  ]) p.stdin.write(JSON.stringify(m) + '\n');
  await new Promise((r) => setTimeout(r, 1500));
  p.stdin.end();
  await new Promise((r) => p.on('close', r));
  fs.unlinkSync(wrap);
  const res = out.trim().split('\n').map((l) => JSON.parse(l)).sort((a, b) => a.id - b.id);
  assert.strictEqual(res.length, 4, '알림에는 응답하지 않음: ' + out);
  assert.strictEqual(res[0].result.serverInfo.name, 'krx-readonly');
  assert.strictEqual(res[1].result.tools.length, 7);
  assert.ok(res[1].result.tools.every((t) => t.annotations.readOnlyHint === true));
  // 맥에서는 키체인에 실제 키가 있을 수 있으므로, 키가 없을 때만 안내 문구를 확인
  const r = res[2].result;
  assert.ok(r.isError ? /키가 없습니다|거절|ENOTFOUND|EAI_AGAIN|ECONN|시간 초과|proxy|HTTP/i.test(r.content[0].text) : true, r.content[0].text);
  assert.strictEqual(res[3].error.code, -32602);

  srv.close();
  console.log('통과: 공식 31개 명세(경로·항목 수) 대조, 값 변환, 주소·AUTH_KEY 헤더·GET, 시장 요약, 정렬·거르기·항목 고르기, 하루 캐시, 최근 영업일 찾기, 종목기본정보 코드 찾기, 자료 없는 날, 인자 오류 사전 차단, 미승인 API 안내·키 가림·JSON 아님·한도 초과, 래퍼 실행 MCP 통신(7개 도구)');
})().catch((e) => { console.error('실패:', e); srv.close(); process.exit(1); });
