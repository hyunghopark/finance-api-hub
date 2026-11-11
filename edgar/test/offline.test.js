// 네트워크 없이 확인할 수 있는 부분만 시험: node test/offline.test.js
'use strict';
const assert = require('assert');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'edgar-mcp-test-'));
process.env.HOME = HOME;
process.env.EDGAR_MCP_NO_STDIO = '1';
process.env.SEC_USER_AGENT = 'edgar-test tester@example.com';
const S = require('../server/index.js');
const tool = (n) => S.TOOLS.find((t) => t.name === n);

// ── 가짜 SEC 응답 ──
const f = (start, end, val, fp, form, filed, accn, extra) => Object.assign({ start, end, val, accn, fy: +filed.slice(0, 4), fp, form, filed }, start ? {} : {}, extra || {});
const inst = (end, val, fp, form, filed, accn) => ({ end, val, accn, fy: +filed.slice(0, 4), fp, form, filed });

// 애플형(9월 결산) 순이익: FY2025 값이 FY2026 10-K에 다시 실려 있고, 3분기 10-Q에는 9개월 누적이 섞임, 4분기는 따로 없음
const NET = [
  f('2024-09-29', '2025-09-27', 112010000000, 'FY', '10-K', '2025-10-31', '0000320193-25-000079'),
  f('2024-09-29', '2025-09-27', 112010000000, 'FY', '10-K', '2026-11-03', '0000320193-26-000026'), // 같은 기간 재등장
  f('2025-09-28', '2026-09-26', 132175000000, 'FY', '10-K', '2026-11-03', '0000320193-26-000026'),
  f('2025-09-28', '2025-12-27', 40000000000, 'Q1', '10-Q', '2026-01-30', '0000320193-26-000006'),
  f('2025-12-28', '2026-03-28', 29578000000, 'Q2', '10-Q', '2026-05-01', '0000320193-26-000013'),
  f('2025-09-28', '2026-03-28', 69578000000, 'Q2', '10-Q', '2026-05-01', '0000320193-26-000013'), // 6개월 누적(무시돼야 함)
  f('2026-03-29', '2026-06-27', 29789000000, 'Q3', '10-Q', '2026-07-31', '0000320193-26-000020'),
  f('2025-09-28', '2026-06-27', 101464000000, 'Q3', '10-Q', '2026-07-31', '0000320193-26-000020'), // 9개월 누적
  // 정정: 같은 기간 값이 나중에 바뀜
  f('2023-10-01', '2024-09-28', 93000000000, 'FY', '10-K', '2024-11-01', '0000320193-24-000123'),
  f('2023-10-01', '2024-09-28', 93736000000, 'FY', '10-K/A', '2025-02-01', '0000320193-25-000010'),
];
const REV_A = [f('2023-10-01', '2024-09-28', 391035000000, 'FY', '10-K', '2024-11-01', '0000320193-24-000123')]; // 신 항목 없음 → 구 항목으로 이어 붙이기
const REV_B = [f('2018-09-30', '2019-09-28', 260174000000, 'FY', '10-K', '2019-10-31', '0000320193-19-000119'),
  f('2023-10-01', '2024-09-28', 1, 'FY', '10-K', '2024-11-01', '0000320193-24-000123')]; // 같은 기간은 앞쪽 항목이 이겨야 함
const ASSETS = [
  inst('2025-09-27', 359241000000, 'FY', '10-K', '2025-10-31', '0000320193-25-000079'),
  inst('2025-09-27', 359241000000, 'Q1', '10-Q', '2026-01-30', '0000320193-26-000006'), // 다음 분기 보고서에 비교값으로 재등장
  inst('2026-03-28', 340000000000, 'Q2', '10-Q', '2026-05-01', '0000320193-26-000013'),
  inst('2026-09-26', 370000000000, 'FY', '10-K', '2026-11-03', '0000320193-26-000026'),
];
const concept = (tag, label, units) => ({ cik: 320193, taxonomy: 'us-gaap', tag, label, description: label + ' 설명', entityName: 'Apple Inc.', units });

const SUB_RECENT = {
  accessionNumber: ['0000320193-26-000026', '0001354457-26-001062', '0000320193-26-000020'],
  filingDate: ['2026-11-03', '2026-11-09', '2026-07-31'],
  reportDate: ['2026-09-26', '', '2026-06-27'],
  acceptanceDateTime: ['2026-11-03T20:00:00.000Z', '2026-11-09T22:00:55.000Z', '2026-07-31T20:00:00.000Z'],
  form: ['10-K', '25-NSE', '10-Q'], items: ['', '', ''], isXBRL: [1, 0, 1],
  primaryDocument: ['aapl-20260926.htm', 'xslF25X02/primary_doc.xml', 'aapl-20260627.htm'],
};
const SUB_OLD = { accessionNumber: ['0000320193-10-000001'], filingDate: ['2010-01-25'], reportDate: ['2009-12-26'], acceptanceDateTime: ['2010-01-25T10:00:00.000Z'], form: ['10-Q'], items: [''], isXBRL: [0], primaryDocument: ['form10q.htm'] };

const DOC = '<html><ix:header><ix:hidden>HIDDENXBRL</ix:hidden></ix:header><body><div>Apple&#8217;s <b>Risk Factors</b></div><table><tr><td>Net sales</td><td>391,035</td></tr></table><p>The Company repurchased shares &amp; paid dividends.</p></body></html>';

const calls = [];
const MOCK = {
  'https://www.sec.gov/files/company_tickers.json': { 0: { cik_str: 320193, ticker: 'AAPL', title: 'Apple Inc.' }, 1: { cik_str: 1067983, ticker: 'BRK-B', title: 'BERKSHIRE HATHAWAY INC' },
    2: { cik_str: 1067983, ticker: 'BRK-A', title: 'BERKSHIRE HATHAWAY INC' }, 3: { cik_str: 789019, ticker: 'MSFT', title: 'MICROSOFT CORP' }, 4: { cik_str: 1, ticker: 'ABCX', title: 'Acme Holdings Inc' }, 5: { cik_str: 2, ticker: 'ABCY', title: 'Acme Industries Corp' } },
  'https://data.sec.gov/api/xbrl/companyconcept/CIK0000320193/us-gaap/NetIncomeLoss.json': concept('NetIncomeLoss', 'Net Income (Loss)', { USD: NET }),
  'https://data.sec.gov/api/xbrl/companyconcept/CIK0000320193/us-gaap/RevenueFromContractWithCustomerExcludingAssessedTax.json': concept('RevenueFromContractWithCustomerExcludingAssessedTax', 'Revenue', { USD: REV_A }),
  'https://data.sec.gov/api/xbrl/companyconcept/CIK0000320193/us-gaap/Revenues.json': concept('Revenues', 'Revenues', { USD: REV_B }),
  'https://data.sec.gov/api/xbrl/companyconcept/CIK0000320193/us-gaap/Assets.json': concept('Assets', 'Assets', { USD: ASSETS }),
  'https://data.sec.gov/api/xbrl/companyconcept/CIK0000320193/us-gaap/EarningsPerShareDiluted.json': concept('EarningsPerShareDiluted', 'EPS', { 'USD/shares': [f('2024-09-29', '2025-09-27', 7.46, 'FY', '10-K', '2025-10-31', 'a')] }),
  'https://data.sec.gov/submissions/CIK0000320193.json': { cik: '0000320193', name: 'Apple Inc.', tickers: ['AAPL'], exchanges: ['Nasdaq'], sic: '3571', sicDescription: 'Electronic Computers', fiscalYearEnd: '0926',
    filings: { recent: SUB_RECENT, files: [{ name: 'CIK0000320193-submissions-001.json', filingCount: 1, filingFrom: '1994-01-26', filingTo: '2015-10-03' }] } },
  'https://data.sec.gov/submissions/CIK0000320193-submissions-001.json': SUB_OLD,
  'https://data.sec.gov/api/xbrl/frames/us-gaap/Revenues/USD/CY2023.json': { taxonomy: 'us-gaap', tag: 'Revenues', ccp: 'CY2023', uom: 'USD', label: 'Revenues', pts: 4,
    data: [{ accn: 'a1', cik: 2098, entityName: 'ACME UNITED CORP', loc: 'US-CT', start: '2023-01-01', end: '2023-12-31', val: 191500947 },
      { accn: 'a2', cik: 2178, entityName: 'ADAMS RESOURCES & ENERGY, INC.', loc: 'US-TX', start: '2023-01-01', end: '2023-12-31', val: 2745293000 },
      { accn: 'a3', cik: 5, entityName: 'BIG CO', loc: 'US-NY', start: '2023-01-01', end: '2023-12-31', val: 9000000000 },
      { accn: 'a4', cik: 6, entityName: 'TINY CO', loc: 'US-NY', start: '2023-01-01', end: '2023-12-31', val: 1000 }] },
  'https://www.sec.gov/Archives/edgar/data/320193/000032019326000026/aapl-20260926.htm': DOC,
};
S._setFetcher(async (url) => {
  calls.push(url);
  if (url.startsWith('https://efts.sec.gov/LATEST/search-index?')) {
    return Buffer.from(JSON.stringify({ hits: { total: { value: 2245, relation: 'eq' }, hits: [
      { _id: '0001193125-26-134921:ck0002032019-ex4_5.htm', _source: { ciks: ['0002032019'], display_names: ['EQT Infrastructure Co LLC  (CIK 0002032019)'], form: '10-K', file_date: '2026-03-31', period_ending: '2025-12-31', adsh: '0001193125-26-134921', file_type: 'EX-4.5', file_description: 'EX-4.5' } }] } }));
  }
  const v = MOCK[url];
  if (v === undefined) { const e = new Error('404 ' + url); e.status = 404; throw e; }
  return Buffer.from(typeof v === 'string' ? v : JSON.stringify(v));
});

(async () => {
  // 1) 정정 반영: 같은 기간이면 가장 늦게 공시된 값
  const d = S.dedupe(NET);
  assert.strictEqual(d.find((x) => x.end === '2024-09-28').val, 93736000000, '정정값이 이겨야 함');
  assert.strictEqual(d.filter((x) => x.end === '2025-09-27' && x.start === '2024-09-29').length, 1, '재등장한 같은 기간은 하나로');

  // 2) 연간: fy가 아니라 기간으로 묶임, 누적·분기는 섞이지 않음
  const ann = S.buildSeries(NET, 'duration', 'annual', 10);
  assert.deepStrictEqual(ann.map((r) => r.period_end), ['2026-09-26', '2025-09-27', '2024-09-28']);
  assert.strictEqual(ann[1].accession, '0000320193-26-000026', '가장 늦게 공시된 접수번호');

  // 3) 분기: 6개월·9개월 누적 제외, 4분기는 연간 − 9개월 누적으로 계산
  const q = S.buildSeries(NET, 'duration', 'quarterly', 10);
  const ends = q.map((r) => r.period_end);
  assert.ok(ends.includes('2026-06-27') && ends.includes('2026-03-28') && ends.includes('2025-12-27'));
  assert.ok(!q.some((r) => r.period_end === '2026-03-28' && r.period_start === '2025-09-28'), '6개월 누적이 분기로 들어가면 안 됨');
  const q4 = q.find((r) => r.period_end === '2026-09-26');
  assert.ok(q4 && q4.derived === true, '4분기 계산값');
  assert.strictEqual(q4.value, 132175000000 - 101464000000);
  assert.strictEqual(q4.period_start, '2026-06-28');
  assert.ok(!q.some((r) => r.period_end === '2025-09-27'), '9개월 누적이 없으면 4분기를 만들지 않음');

  // 4) 시점값: 연간은 결산일만
  const a2 = S.buildSeries(ASSETS, 'instant', 'annual', 10);
  assert.deepStrictEqual(a2.map((r) => r.period_end), ['2026-09-26', '2025-09-27']);
  assert.strictEqual(S.buildSeries(ASSETS, 'instant', 'quarterly', 10).length, 3, '분기 모드는 결산일이 아닌 시점도 포함(중복 제거 후 3개)');

  // 5) 회사 지정
  assert.strictEqual((await S.resolveCompany('aapl')).cik, '0000320193');
  assert.strictEqual((await S.resolveCompany('BRK.B')).cik, '0001067983');
  assert.strictEqual((await S.resolveCompany('microsoft')).ticker, 'MSFT');
  assert.strictEqual((await S.resolveCompany('berkshire')).cik, '0001067983', '같은 CIK의 두 티커는 한 회사');
  assert.strictEqual((await S.resolveCompany('320193')).cik, '0000320193');
  await assert.rejects(() => S.resolveCompany('acme'), /하나로 정하지 못함/);
  await assert.rejects(() => S.resolveCompany('zzzznope'), /찾지 못함/);

  // 6) sec_find_company
  const fc = await tool('sec_find_company').run({ query: 'acme' });
  assert.strictEqual(fc.count, 2);

  // 7) sec_financials: 항목 이어 붙이기(앞쪽 우선), 단위, 4분기 계산
  const fin = await tool('sec_financials').run({ company: 'AAPL', metrics: ['revenue', 'net_income', 'eps_diluted', 'total_assets'], limit: 5 });
  const rev = fin.metrics.revenue;
  assert.deepStrictEqual(rev.tags_used, ['RevenueFromContractWithCustomerExcludingAssessedTax', 'Revenues']);
  assert.strictEqual(rev.rows.find((r) => r.period_end === '2024-09-28').value, 391035000000, '같은 기간은 앞쪽 항목이 이김');
  assert.strictEqual(rev.rows.find((r) => r.period_end === '2019-09-28').tag, 'Revenues');
  assert.strictEqual(fin.metrics.eps_diluted.unit, 'USD/shares');
  assert.strictEqual(fin.metrics.total_assets.rows.length, 2);
  const finQ = await tool('sec_financials').run({ company: 'AAPL', metrics: ['net_income'], period: 'quarterly' });
  assert.ok(finQ.metrics.net_income.rows.some((r) => r.derived));
  const none = await tool('sec_financials').run({ company: 'AAPL', metrics: ['capex'] });
  assert.ok(/자료 없음/.test(none.metrics.capex.note));
  await assert.rejects(() => tool('sec_financials').run({ company: 'AAPL', metrics: ['bogus'] }), /없는 항목/);

  // 8) sec_concept
  const cc = await tool('sec_concept').run({ company: 'AAPL', tag: 'NetIncomeLoss', forms: '10-K', limit: 2 });
  assert.strictEqual(cc.rows.length, 2);
  const cAll = await tool('sec_concept').run({ company: 'AAPL', tag: 'NetIncomeLoss', view: 'all' });
  assert.ok(cAll.total > cc.total);
  await assert.rejects(() => tool('sec_concept').run({ company: 'AAPL', tag: 'NoSuchTag' }), /항목이 없습니다/);
  await assert.rejects(() => tool('sec_concept').run({ company: 'AAPL', tag: '../../x' }), /형식이 잘못/);

  // 9) sec_filings: 양식 거르기, 주소, xsl 접두어 유지, 옛 공시
  const fl = await tool('sec_filings').run({ company: 'AAPL', forms: '10-k,10-Q' });
  assert.deepStrictEqual(fl.rows.map((r) => r.form), ['10-K', '10-Q']);
  assert.strictEqual(fl.rows[0].url, 'https://www.sec.gov/Archives/edgar/data/320193/000032019326000026/aapl-20260926.htm');
  assert.strictEqual(fl.rows[0].index_url, 'https://www.sec.gov/Archives/edgar/data/320193/000032019326000026/0000320193-26-000026-index.htm');
  const fl2 = await tool('sec_filings').run({ company: 'AAPL', forms: '25-NSE' });
  assert.ok(fl2.rows[0].url.endsWith('/xslF25X02/primary_doc.xml'));
  assert.ok(fl.older_files_available && !fl.older_files_read);
  const flOld = await tool('sec_filings').run({ company: 'AAPL', from: '2009-01-01' });
  assert.ok(flOld.older_files_read && flOld.rows.some((r) => r.filing_date === '2010-01-25'));
  assert.strictEqual(flOld.rows[0].filing_date, '2026-11-09', '최신순 정렬');
  await assert.rejects(() => tool('sec_filings').run({ company: 'AAPL', from: '2020/01/01' }), /YYYY-MM-DD/);

  // 10) sec_frames: 서버 쪽 정렬·거르기
  const fr = await tool('sec_frames').run({ tag: 'Revenues', period: 'CY2023', top: 2 });
  assert.deepStrictEqual(fr.rows.map((r) => r.name), ['BIG CO', 'ADAMS RESOURCES & ENERGY, INC.']);
  assert.strictEqual(fr.matched, 4);
  assert.strictEqual((await tool('sec_frames').run({ tag: 'Revenues', period: 'CY2023', min_value: 1e6, sort: 'asc', top: 1 })).rows[0].name, 'ACME UNITED CORP');
  assert.strictEqual((await tool('sec_frames').run({ tag: 'Revenues', period: 'CY2023', name_contains: 'tiny' })).rows.length, 1);
  await assert.rejects(() => tool('sec_frames').run({ tag: 'Revenues', period: '2023' }), /period는/);
  await assert.rejects(() => tool('sec_frames').run({ tag: 'Revenues/../x', period: 'CY2023' }), /형식이 잘못/);

  // 11) sec_search: 요청 주소 조립과 결과 주소
  calls.length = 0;
  const se = await tool('sec_search').run({ query: '"share repurchase"', forms: '10-K', from: '2026-01-01', to: '2026-11-10', company: 'AAPL', offset: 100 });
  const sreq = new URL(calls.find((c) => c.includes('efts.sec.gov')));
  assert.strictEqual(sreq.searchParams.get('q'), '"share repurchase"');
  assert.strictEqual(sreq.searchParams.get('forms'), '10-K');
  assert.strictEqual(sreq.searchParams.get('dateRange'), 'custom');
  assert.strictEqual(sreq.searchParams.get('startdt'), '2026-01-01');
  assert.strictEqual(sreq.searchParams.get('ciks'), '0000320193');
  assert.strictEqual(sreq.searchParams.get('from'), '100');
  assert.strictEqual(se.total, 2245);
  assert.strictEqual(se.rows[0].url, 'https://www.sec.gov/Archives/edgar/data/2032019/000119312526134921/ck0002032019-ex4_5.htm');

  // 12) sec_document: 숨은 XBRL 머리말 제거, 숫자 엔터티, 찾기, 나눠 읽기, 주소 제한
  const txt = S.htmlToText(DOC);
  assert.ok(!txt.includes('HIDDENXBRL'), 'ix:header 제거');
  assert.ok(txt.includes('Apple’s Risk Factors'), txt);
  assert.ok(txt.includes('Net sales | 391,035'), txt);
  assert.ok(txt.includes('shares & paid'), txt);
  const byAcc = await tool('sec_document').run({ company: 'AAPL', accession: '000032019326000026', max_chars: 20 });
  assert.strictEqual(byAcc.form, '10-K');
  assert.strictEqual(byAcc.text.length, 20);
  assert.ok(byAcc.next_offset === 20);
  const found = await tool('sec_document').run({ url: 'https://www.sec.gov/Archives/edgar/data/320193/000032019326000026/aapl-20260926.htm', find: 'RISK factors' });
  assert.strictEqual(found.hits.length, 1);
  await assert.rejects(() => tool('sec_document').run({ url: 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany' }), /Archives/);
  await assert.rejects(() => tool('sec_document').run({ url: 'https://evil.example.com/Archives/edgar/data/1/x.htm' }), /Archives/);
  await assert.rejects(() => tool('sec_document').run({ url: 'https://www.sec.gov/Archives/edgar/data/../../etc' }), /Archives/);
  await assert.rejects(() => tool('sec_document').run({ company: 'AAPL', accession: '123' }), /접수번호/);
  await assert.rejects(() => tool('sec_document').run({ company: 'AAPL', accession: '0000320193-26-999999' }), /찾지 못함/);

  // 13) 호출 주소 고정: 허용 호스트 밖은 막힘, 소스에 GET 외 방식·다른 호스트가 없음
  await assert.rejects(() => S.secGet('https://evil.example.com/x'), /허용되지 않은 주소/);
  await assert.rejects(() => S.secGet('http://data.sec.gov/x'), /허용되지 않은 주소/);
  const src = fs.readFileSync(path.join(__dirname, '../server/index.js'), 'utf8');
  const hosts = new Set([...src.matchAll(/https:\/\/([a-z.]+)\//g)].map((m) => m[1]));
  for (const h of hosts) assert.ok(['data.sec.gov', 'www.sec.gov', 'efts.sec.gov'].includes(h), '소스에 허용 밖 호스트: ' + h);
  assert.ok(!/method:\s*'(POST|PUT|DELETE|PATCH)'/i.test(src), 'GET 외 방식 금지');
  assert.strictEqual(S.TOOLS.length, 7);

  // 14) 접수번호·오류 가림
  assert.strictEqual(S.normAccession('000032019326000026'), '0000320193-26-000026');
  assert.strictEqual(S.mask('failed for tester@example.com here'), 'failed for ***@*** here');

  // 15) MCP 프로토콜 + User-Agent 없음 안내
  const p = spawn(process.execPath, [path.join(__dirname, '../server/index.js')], { env: { ...process.env, EDGAR_MCP_NO_STDIO: '0', SEC_USER_AGENT: '${user_config.user_agent}', HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'edgar-mcp-empty-')) } });
  let out = '';
  p.stdout.on('data', (c) => { out += c; });
  const reqs = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'sec_find_company', arguments: { query: 'AAPL' } } },
    { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'nope', arguments: {} } },
  ];
  for (const r of reqs) p.stdin.write(JSON.stringify(r) + '\n');
  await new Promise((resolve) => { const t = setInterval(() => { if (out.split('\n').filter(Boolean).length >= 4) { clearInterval(t); resolve(); } }, 50); setTimeout(() => { clearInterval(t); resolve(); }, 8000); });
  p.stdin.end();
  const msgs = out.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const byId = (i) => msgs.find((m) => m.id === i);
  assert.strictEqual(byId(1).result.serverInfo.name, 'edgar-readonly');
  assert.strictEqual(byId(2).result.tools.length, 7);
  assert.ok(byId(2).result.tools.every((t) => t.annotations.readOnlyHint === true));
  assert.ok(byId(3).result.isError && /User-Agent/.test(byId(3).result.content[0].text), JSON.stringify(byId(3)));
  assert.strictEqual(byId(4).error.code, -32602);

  console.log('통과: 정정값 우선, 연간/분기/4분기 계산, 시점값, 회사 지정, 항목 이어 붙이기, 공시 목록(옛 공시·xsl), frames 정렬, 전문검색 주소, 원문 변환·찾기·주소 제한, 허용 호스트·GET 고정, MCP 프로토콜(7개 도구), User-Agent 없음 안내');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
