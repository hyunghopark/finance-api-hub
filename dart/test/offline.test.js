// 네트워크 없이 확인할 수 있는 부분만 시험: node test/offline.test.js
'use strict';
const assert = require('assert');
const zlib = require('zlib');
const { spawn } = require('child_process');
const path = require('path');
process.env.DART_MCP_NO_STDIO = '1';
const S = require('../server/index.js');

// 1) zip 해석: 압축(8)·무압축(0) 파일 2개를 손으로 만든 zip
function makeZip(files) {
  const locals = [], centrals = []; let off = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const data = f.method === 8 ? zlib.deflateRawSync(f.data) : f.data;
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(0x800, 6); lh.writeUInt16LE(f.method, 8);
    lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(f.data.length, 22); lh.writeUInt16LE(name.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(0x800, 8); ch.writeUInt16LE(f.method, 10);
    ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(f.data.length, 24); ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(off, 42);
    locals.push(lh, name, data); centrals.push(ch, name); off += 30 + name.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const e = Buffer.alloc(22); e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(files.length, 8); e.writeUInt16LE(files.length, 10);
  e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16);
  return Buffer.concat([...locals, cd, e]);
}
const xml = `<?xml version="1.0" encoding="UTF-8"?><result>
<list><corp_code>00126380</corp_code><corp_name>삼성전자</corp_name><stock_code>005930</stock_code><modify_date>20250101</modify_date></list>
<list><corp_code>00600000</corp_code><corp_name>맥쿼리인프라</corp_name><stock_code>088980</stock_code><modify_date>20250101</modify_date></list>
<list><corp_code>99999999</corp_code><corp_name>삼성전자서비스</corp_name><stock_code> </stock_code><modify_date>20250101</modify_date></list>
</result>`;
const z = makeZip([{ name: 'CORPCODE.xml', data: Buffer.from(xml), method: 8 }, { name: '첨부.txt', data: Buffer.from('안녕'), method: 0 }]);
const files = S.unzip(z);
assert.strictEqual(files.length, 2);
assert.strictEqual(files[1].name, '첨부.txt');
assert.strictEqual(files[1].data.toString(), '안녕');
const corps = S.parseCorpXml(S.decodeText(files[0].data));
assert.strictEqual(corps.length, 3);
assert.strictEqual(corps[1].corp_name, '맥쿼리인프라');
assert.strictEqual(corps[2].stock_code, '');

// 2) EUC-KR 디코딩
const euc = Buffer.from([0x3c,0x3f,0x78,0x6d,0x6c,0x20,0x65,0x6e,0x63,0x6f,0x64,0x69,0x6e,0x67,0x3d,0x22,0x65,0x75,0x63,0x2d,0x6b,0x72,0x22,0x3f,0x3e, 0xb9,0xe8,0xb4,0xe7]);
assert.ok(S.decodeText(euc).endsWith('배당'), 'EUC-KR 디코딩');

// 3) 회사 지정
(async () => {
  S._setCorpList(corps);
  assert.strictEqual((await S.resolveCorp('088980')).corp_code, '00600000');
  assert.strictEqual((await S.resolveCorp('삼성전자')).corp_code, '00126380');
  assert.strictEqual((await S.resolveCorp('00126380')).corp_code, '00126380');
  await assert.rejects(() => S.resolveCorp('삼성'), /하나로 정하지 못함/);
  assert.strictEqual(S.reportCode('q3'), '11014');
  assert.throws(() => S.reportCode('q2'));

  // 4) 원문 텍스트 변환
  const t = S.htmlToText('<TITLE>현금ㆍ현물배당 결정</TITLE><TABLE><TR><TD>1주당 배당금</TD><TD>380</TD></TR></TABLE>&amp;끝');
  assert.ok(t.includes('1주당 배당금 | 380'), t);


  // 6) 공식 개발가이드(2026-11-09 확인) 대조: 요청 주소 이름과 요청 방식
  const OFFICIAL = {
    periodic: 'stockTotqySttus tesstkAcqsDspsSttus alotMatter irdsSttus detScritsIsuAcmslt entrprsBilScritsNrdmpBlce srtpdPsndbtNrdmpBlce cprndNrdmpBlce newCaplScritsNrdmpBlce cndlCaplScritsNrdmpBlce pssrpCptalUseDtls prvsrpCptalUseDtls accnutAdtorNmNdAdtOpinion adtServcCnclsSttus accnutAdtorNonAdtServcCnclsSttus outcmpnyDrctrNdChangeSttus hyslrSttus hyslrChgSttus mrhlSttus exctvSttus empSttus unrstExctvMendngSttus drctrAdtAllMendngSttusGmtsckConfmAmount hmvAuditAllSttus drctrAdtAllMendngSttusMendngPymntamtTyCl hmvAuditIndvdlBySttus hmvAuditIndvdlBySttusV2 indvdlByPay indvdlByPayV2 otrCprInvstmntSttus',
    equity: 'majorstock elestock',
    major: 'astInhtrfEtcPtbkOpt dfOcr bsnSp ctrcvsBgrq dsRsOcr piicDecsn fricDecsn pifricDecsn crDecsn bnkMngtPcbg lwstLg ovLstDecsn ovDlstDecsn ovLst ovDlst cvbdIsDecsn bdwtIsDecsn exbdIsDecsn bnkMngtPcsp wdCocobdIsDecsn tsstkAqDecsn tsstkDpDecsn tsstkAqTrctrCnsDecsn tsstkAqTrctrCcDecsn bsnInhDecsn bsnTrfDecsn tgastInhDecsn tgastTrfDecsn otcprStkInvscrInhDecsn otcprStkInvscrTrfDecsn stkrtbdInhDecsn stkrtbdTrfDecsn cmpMgDecsn cmpDvDecsn cmpDvmgDecsn stkExtrDecsn',
  };
  const kindOf = {}; for (const [k, v] of Object.entries(OFFICIAL)) for (const n of v.split(' ')) kindOf[n] = k;
  const eps = Object.keys(S.REPORT_ENDPOINTS);
  for (const ep of eps) {
    assert.ok(kindOf[ep], '공식 목록에 없는 endpoint: ' + ep);
    assert.strictEqual(S.KIND(ep), kindOf[ep], ep + ' 요청 방식 불일치');
  }
  assert.strictEqual(eps.length, 48, 'dart_report 허용 목록 개수');
  const src = require('fs').readFileSync(path.join(__dirname, '../server/index.js'), 'utf8');
  for (const ep of ['list.json','company.json','document.xml','corpCode.xml','fnlttSinglAcnt.json','fnlttSinglAcntAll.json','fnlttMultiAcnt.json','fnlttSinglIndx.json','fnlttCmpnyIndx.json','alotMatter.json'])
    assert.ok(src.includes("'" + ep + "'"), ep + ' 사용 확인');

  // 7) 여러 회사 지정
  const many = await S.resolveCorps('005930, 088980');
  assert.deepStrictEqual(many.map((c) => c.corp_code), ['00126380', '00600000']);

  // 5) MCP 프로토콜 (키 없는 상태에서 도구 호출 시 isError로 안내)
  const p = spawn(process.execPath, [path.join(__dirname, '../server/index.js')], { env: { ...process.env, DART_MCP_NO_STDIO: '0', DART_API_KEY: '${user_config.api_key}', HOME: '/tmp/dart-mcp-test-home' } });
  let out = '';
  p.stdout.on('data', (d) => (out += d));
  const msgs = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'dart_company', arguments: { corp: '00126380' } } },
    { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'dart_report', arguments: { corp: '00126380', endpoint: 'evil' } } },
  ];
  for (const m of msgs) p.stdin.write(JSON.stringify(m) + '\n');
  await new Promise((r) => setTimeout(r, 800));
  p.stdin.end();
  await new Promise((r) => p.on('close', r));
  const res = out.trim().split('\n').map((l) => JSON.parse(l)).sort((a, b) => a.id - b.id);
  assert.strictEqual(res.length, 4, '알림에는 응답하지 않음');
  assert.strictEqual(res[0].result.serverInfo.name, 'dart-readonly');
  assert.strictEqual(res[1].result.tools.length, 8);
  assert.ok(res[2].result.isError && /키가 없습니다/.test(res[2].result.content[0].text), JSON.stringify(res[2]));
  assert.ok(res[3].result.isError && /허용 목록/.test(res[3].result.content[0].text));
  console.log('통과: zip, 고유번호 해석, EUC-KR, 회사 지정, 원문 변환, MCP 프로토콜(8개 도구), 키 없음 안내, 허용 목록 차단, 공식 목록 대조(허용 48개+재무 API), 여러 회사 지정');
})().catch((e) => { console.error('실패:', e); process.exit(1); });
