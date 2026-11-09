#!/usr/bin/env node
// DART(금융감독원 전자공시) 오픈 API 조회 전용 MCP 서버
// - 외부 패키지 없음 (Node 18+ 내장 모듈만 사용)
// - 호출 주소 opendart.fss.or.kr 고정, GET만 사용
// - 키: 환경변수 DART_API_KEY → 없으면 맥 키체인(서비스 dart-api, 계정 opendart)
'use strict';

const https = require('https');
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const VERSION = '0.2.1';
const HOST = 'opendart.fss.or.kr';
const CACHE_DIR = path.join(os.homedir(), '.dart-mcp');
const CORP_CACHE = path.join(CACHE_DIR, 'corpcode.json');
const CORP_TTL_MS = 7 * 24 * 3600 * 1000;
const KEYCHAIN_SERVICE = 'dart-api';
const KEYCHAIN_ACCOUNT = 'opendart';
const MAX_OUTPUT_CHARS = 60000;

const log = (...a) => process.stderr.write('[dart-mcp] ' + a.join(' ') + '\n');

// ───────────────────────── 키 ─────────────────────────
let cachedKey = null;
function getKey() {
  if (cachedKey) return cachedKey;
  const env = (process.env.DART_API_KEY || '').trim();
  if (env && !env.includes('${')) return (cachedKey = env);
  if (process.platform === 'darwin') {
    try {
      const k = execFileSync('security',
        ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', KEYCHAIN_ACCOUNT, '-w'],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      if (k) return (cachedKey = k);
    } catch (_) { /* 없음 */ }
  }
  throw new Error('DART API 키가 없습니다. 터미널에서 `security add-generic-password -s dart-api -a opendart -w` 로 키체인에 넣거나, 확장 설정에 키를 입력하세요.');
}
const mask = (s) => String(s).replace(/crtfc_key=[^&\s]+/g, 'crtfc_key=***');

// ───────────────────────── HTTP ─────────────────────────
function dartGet(endpoint, params = {}) {
  if (!/^[A-Za-z]+\.(json|xml)$/.test(endpoint)) throw new Error('허용되지 않은 엔드포인트: ' + endpoint);
  const qs = new URLSearchParams({ crtfc_key: getKey() });
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    if (k === 'crtfc_key') continue;
    qs.set(k, String(v));
  }
  const reqPath = `/api/${endpoint}?${qs.toString()}`;
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname: HOST, port: 443, path: reqPath, method: 'GET',
      headers: { 'User-Agent': 'dart-readonly-mcp/' + VERSION, Accept: '*/*' }, timeout: 30000 }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks);
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} (${endpoint}): ${mask(body.toString('utf8').slice(0, 300))}`));
        resolve(body);
      });
    });
    req.on('timeout', () => req.destroy(new Error('응답 시간 초과(30초): ' + endpoint)));
    req.on('error', (e) => reject(new Error(mask(e.message))));
    req.end();
  });
}

const STATUS = {
  '000': '정상', '010': '등록되지 않은 키', '011': '사용할 수 없는 키', '012': '접근할 수 없는 IP',
  '013': '조회된 데이터 없음', '014': '파일이 존재하지 않음', '020': '요청 제한 초과(하루 2만 건)',
  '021': '조회 가능한 회사 개수 초과', '100': '필드의 부적절한 값', '101': '부적절한 접근',
  '800': '시스템 점검 중', '900': '정의되지 않은 오류', '901': '개인정보 보유기간 만료 키',
};

async function dartJson(endpoint, params) {
  const buf = await dartGet(endpoint, params);
  let j;
  try { j = JSON.parse(buf.toString('utf8')); } catch (e) { throw new Error('JSON 해석 실패: ' + buf.toString('utf8').slice(0, 200)); }
  if (j.status === '013') return { status: '013', message: STATUS['013'], list: [] };
  if (j.status && j.status !== '000') throw new Error(`DART 오류 ${j.status} ${STATUS[j.status] || ''}: ${j.message || ''}`);
  return j;
}

// 응답이 zip이 아니면(오류 XML/JSON) 메시지를 꺼냄
function assertZip(buf, what) {
  if (buf.length >= 4 && buf.readUInt32LE(0) === 0x04034b50) return;
  const t = buf.toString('utf8');
  const st = (t.match(/<status>(\d+)<\/status>/) || t.match(/"status"\s*:\s*"(\d+)"/) || [])[1];
  const msg = (t.match(/<message>([^<]*)<\/message>/) || t.match(/"message"\s*:\s*"([^"]*)"/) || [])[1];
  throw new Error(`${what}: DART 오류 ${st || '?'} ${STATUS[st] || ''} ${msg || t.slice(0, 200)}`);
}

// ───────────────────────── zip (외부 패키지 없이) ─────────────────────────
function unzip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('zip 끝 레코드를 찾지 못함');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = [];
  for (let k = 0; k < count; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('zip 디렉터리 손상');
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28), elen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    const loff = buf.readUInt32LE(p + 42);
    const rawName = buf.subarray(p + 46, p + 46 + nlen);
    const name = (flags & 0x800) ? rawName.toString('utf8') : decodeText(rawName);
    const lnlen = buf.readUInt16LE(loff + 26), lelen = buf.readUInt16LE(loff + 28);
    const start = loff + 30 + lnlen + lelen;
    const comp = buf.subarray(start, start + csize);
    let data = null;
    if (method === 0) data = Buffer.from(comp);
    else if (method === 8) data = zlib.inflateRawSync(comp);
    out.push({ name, data, method });
    p += 46 + nlen + elen + clen;
  }
  return out;
}

function decodeText(buf) {
  const head = buf.subarray(0, 200).toString('latin1');
  const enc = (head.match(/encoding=["']([\w-]+)["']/i) || [])[1];
  const tryDec = (e) => { try { return new TextDecoder(e, { fatal: true }).decode(buf); } catch (_) { return null; } };
  if (enc && !/utf-?8/i.test(enc)) { const r = tryDec(enc.toLowerCase()); if (r !== null) return r; }
  return tryDec('utf-8') ?? tryDec('euc-kr') ?? buf.toString('utf8');
}

// ───────────────────────── 고유번호(corp_code) ─────────────────────────
let corpList = null;
function parseCorpXml(xml) {
  const list = [];
  const re = /<list>([\s\S]*?)<\/list>/g;
  const pick = (blk, tag) => { const m = blk.match(new RegExp(`<${tag}>([^<]*)</${tag}>`)); return m ? m[1].trim() : ''; };
  let m;
  while ((m = re.exec(xml))) {
    const b = m[1];
    list.push({ corp_code: pick(b, 'corp_code'), corp_name: pick(b, 'corp_name'), stock_code: pick(b, 'stock_code'), modify_date: pick(b, 'modify_date') });
  }
  return list;
}

async function loadCorpList(forceRefresh = false) {
  if (corpList && !forceRefresh) return corpList;
  if (!forceRefresh) {
    try {
      const st = fs.statSync(CORP_CACHE);
      if (Date.now() - st.mtimeMs < CORP_TTL_MS) {
        corpList = JSON.parse(fs.readFileSync(CORP_CACHE, 'utf8'));
        return corpList;
      }
    } catch (_) { /* 캐시 없음 */ }
  }
  log('고유번호 파일 내려받는 중');
  const buf = await dartGet('corpCode.xml');
  assertZip(buf, '고유번호 파일');
  const files = unzip(buf);
  const xmlFile = files.find((f) => /\.xml$/i.test(f.name)) || files[0];
  corpList = parseCorpXml(decodeText(xmlFile.data));
  if (!corpList.length) throw new Error('고유번호 파일에서 회사를 찾지 못함');
  fs.mkdirSync(CACHE_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(CORP_CACHE, JSON.stringify(corpList), { mode: 0o600 });
  return corpList;
}

// corp: 8자리 숫자 = 고유번호, 6자리 = 종목코드, 그 밖 = 회사명(정확히 일치)
async function resolveCorp(corp) {
  const q = String(corp || '').trim();
  if (!q) throw new Error('corp(종목코드 6자리, 고유번호 8자리, 또는 회사명)가 필요합니다.');
  if (/^\d{8}$/.test(q)) return { corp_code: q };
  const list = await loadCorpList();
  if (/^[0-9A-Z]{6}$/i.test(q)) {
    const hit = list.find((c) => c.stock_code.toUpperCase() === q.toUpperCase());
    if (hit) return hit;
    if (/^\d{6}$/.test(q)) throw new Error(`종목코드 ${q}를 고유번호 목록에서 찾지 못함 (dart_find_corp로 확인)`);
  }
  const exact = list.filter((c) => c.corp_name === q);
  const listed = exact.filter((c) => c.stock_code);
  if (listed.length === 1) return listed[0];
  if (exact.length === 1) return exact[0];
  const cands = (exact.length ? exact : list.filter((c) => c.corp_name.includes(q)))
    .sort((a, b) => (b.stock_code ? 1 : 0) - (a.stock_code ? 1 : 0)).slice(0, 10);
  throw new Error(`회사를 하나로 정하지 못함: "${q}". 후보: ` +
    (cands.map((c) => `${c.corp_name}(${c.stock_code || '비상장'}, ${c.corp_code})`).join(', ') || '없음'));
}

// ───────────────────────── 공통 ─────────────────────────
const REPORT_CODES = { annual: '11011', half: '11012', q1: '11013', q3: '11014', '11011': '11011', '11012': '11012', '11013': '11013', '11014': '11014' };
const REPORT_NAMES = { '11011': '사업보고서(연간)', '11012': '반기보고서', '11013': '1분기보고서', '11014': '3분기보고서' };
function reportCode(r) {
  const c = REPORT_CODES[String(r || 'annual').toLowerCase()];
  if (!c) throw new Error('report는 annual, half, q1, q3 (또는 11011~11014) 중 하나');
  return c;
}
function ymd(d) { return d.toISOString().slice(0, 10).replace(/-/g, ''); }
function todayKst() { return new Date(Date.now() + 9 * 3600 * 1000); }
function viewerUrl(rcept_no) { return `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${rcept_no}`; }
function corpInfo(c) { return { corp_code: c.corp_code, corp_name: c.corp_name, stock_code: c.stock_code }; }

// 정기보고서 주요정보·지분공시·주요사항보고서 (조회 전용, 허용 목록)
const REPORT_ENDPOINTS = {
  // 정기보고서 주요정보 (corp + year + report)
  hyslrSttus: '최대주주 현황', hyslrChgSttus: '최대주주 변동현황', mrhlSttus: '소액주주 현황',
  exctvSttus: '임원 현황', empSttus: '직원 현황', tesstkAcqsDspsSttus: '자기주식 취득 및 처분 현황',
  irdsSttus: '증자(감자) 현황', stockTotqySttus: '주식의 총수 현황', otrCprInvstmntSttus: '타법인 출자현황',
  cprndNrdmpBlce: '회사채 미상환 잔액', srtpdPsndbtNrdmpBlce: '단기사채 미상환 잔액', entrprsBilScritsNrdmpBlce: '기업어음 미상환 잔액',
  detScritsIsuAcmslt: '채무증권 발행실적', accnutAdtorNmNdAdtOpinion: '회계감사인 명칭 및 감사의견',
  newCaplScritsNrdmpBlce: '신종자본증권 미상환 잔액', cndlCaplScritsNrdmpBlce: '조건부 자본증권 미상환 잔액',
};
const EQUITY_ENDPOINTS = {
  // 지분공시 (corp만)
  majorstock: '대량보유 상황보고(5%)', elestock: '임원·주요주주 소유보고',
};
const MAJOR_ENDPOINTS = {
  // 주요사항보고서 (corp + bgn_de + end_de)
  // 주식 수·주주환원
  tsstkAqDecsn: '자기주식 취득 결정', tsstkDpDecsn: '자기주식 처분 결정',
  tsstkAqTrctrCnsDecsn: '자기주식취득 신탁계약 체결 결정', tsstkAqTrctrCcDecsn: '자기주식취득 신탁계약 해지 결정',
  piicDecsn: '유상증자 결정', fricDecsn: '무상증자 결정', pifricDecsn: '유무상증자 결정', crDecsn: '감자 결정',
  cvbdIsDecsn: '전환사채권 발행결정', bdwtIsDecsn: '신주인수권부사채권 발행결정', exbdIsDecsn: '교환사채권 발행결정',
  // 기업 구조 변화
  cmpMgDecsn: '회사합병 결정', cmpDvDecsn: '회사분할 결정', cmpDvmgDecsn: '회사분할합병 결정', stkExtrDecsn: '주식교환·이전 결정',
  bsnInhDecsn: '영업양수 결정', bsnTrfDecsn: '영업양도 결정', tgastInhDecsn: '유형자산 양수 결정', tgastTrfDecsn: '유형자산 양도 결정',
  otcprStkInvscrInhDecsn: '타법인 주식 및 출자증권 양수결정', otcprStkInvscrTrfDecsn: '타법인 주식 및 출자증권 양도결정',
  stkrtbdInhDecsn: '주권 관련 사채권 양수 결정', stkrtbdTrfDecsn: '주권 관련 사채권 양도 결정',
  // 하방 리스크
  dfOcr: '부도발생', bsnSp: '영업정지', ctrcvsBgrq: '회생절차 개시신청', dsRsOcr: '해산사유 발생', lwstLg: '소송 등의 제기',
  bnkMngtPcbg: '채권은행 등의 관리절차 개시', bnkMngtPcsp: '채권은행 등의 관리절차 중단',
};
Object.assign(REPORT_ENDPOINTS, EQUITY_ENDPOINTS, MAJOR_ENDPOINTS);
const KIND = (ep) => (EQUITY_ENDPOINTS[ep] ? 'equity' : MAJOR_ENDPOINTS[ep] ? 'major' : 'periodic');

// 여러 회사: 배열 또는 쉼표로 구분한 문자열
async function resolveCorps(input) {
  const parts = (Array.isArray(input) ? input : String(input || '').split(',')).map((s) => String(s).trim()).filter(Boolean);
  if (!parts.length) throw new Error('회사를 하나 이상 지정하세요.');
  const out = [];
  for (const p of parts) out.push(await resolveCorp(p));
  return out;
}
function nameOf(corp_code, corps) {
  const c = corps.find((x) => x.corp_code === corp_code) || (corpList || []).find((x) => x.corp_code === corp_code);
  return c && c.corp_name ? c.corp_name : corp_code;
}
const IDX_CODES = { profitability: 'M210000', stability: 'M220000', growth: 'M230000', activity: 'M240000' };

// ───────────────────────── 도구 ─────────────────────────
const CORP_ARG = { type: 'string', description: '종목코드 6자리(088980), DART 고유번호 8자리, 또는 정확한 회사명' };
const REPORT_ARG = { type: 'string', enum: ['annual', 'half', 'q1', 'q3'], description: 'annual=사업보고서, half=반기, q1=1분기, q3=3분기 (기본 annual)' };

const TOOLS = [
  {
    name: 'dart_find_corp',
    description: '회사명 일부나 종목코드로 DART 고유번호(corp_code)를 찾습니다. 고유번호 목록은 7일마다 새로 받아 ~/.dart-mcp 에 캐시합니다.',
    inputSchema: { type: 'object', properties: {
      query: { type: 'string', description: '회사명 일부 또는 종목코드' },
      listed_only: { type: 'boolean', default: true, description: '상장사만 (기본 true)' },
      limit: { type: 'integer', default: 20, minimum: 1, maximum: 100 },
      refresh: { type: 'boolean', default: false, description: '고유번호 목록을 지금 다시 받기' },
    }, required: ['query'] },
    run: async ({ query, listed_only = true, limit = 20, refresh = false }) => {
      const list = await loadCorpList(!!refresh);
      const q = String(query).trim().toUpperCase();
      let hits = list.filter((c) => c.stock_code.toUpperCase() === q || c.corp_name.toUpperCase().includes(q));
      if (listed_only) hits = hits.filter((c) => c.stock_code);
      hits.sort((a, b) => (a.corp_name.toUpperCase() === q ? -1 : 0) - (b.corp_name.toUpperCase() === q ? -1 : 0) || a.corp_name.length - b.corp_name.length);
      return { total: hits.length, results: hits.slice(0, limit) };
    },
  },
  {
    name: 'dart_company',
    description: '기업 개황: 정식 명칭, 대표자, 법인 구분, 업종코드, 설립일, 결산월, 홈페이지, IR 주소 등.',
    inputSchema: { type: 'object', properties: { corp: CORP_ARG }, required: ['corp'] },
    run: async ({ corp }) => {
      const c = await resolveCorp(corp);
      const j = await dartJson('company.json', { corp_code: c.corp_code });
      delete j.status; delete j.message;
      return j;
    },
  },
  {
    name: 'dart_disclosures',
    description: '공시 목록 검색. corp를 빼면 전체 회사 대상(이때 기간은 최대 3개월). 기본 기간은 최근 30일. 결과마다 DART 원문 보기 주소(url)와 접수번호(rcept_no)를 줍니다. 원문 텍스트는 dart_document로.',
    inputSchema: { type: 'object', properties: {
      corp: CORP_ARG,
      bgn_de: { type: 'string', description: '시작일 YYYYMMDD (기본: 종료일 30일 전)' },
      end_de: { type: 'string', description: '종료일 YYYYMMDD (기본: 오늘, KST)' },
      pblntf_ty: { type: 'string', description: 'A 정기공시, B 주요사항보고, C 발행공시, D 지분공시, E 기타공시, F 외부감사관련, G 펀드공시, H 자산유동화, I 거래소공시, J 공정위공시' },
      pblntf_detail_ty: { type: 'string', description: '상세 유형 코드 (예: A001 사업보고서, A002 반기, A003 분기, I001 수시공시, I002 공정공시)' },
      last_reprt_at: { type: 'boolean', default: true, description: '정정 전 원보고서 제외(최종보고서만)' },
      title_contains: { type: 'string', description: '보고서명에 이 글자가 들어간 것만 (예: 배당, 분배, 실적)' },
      page_no: { type: 'integer', default: 1 },
      page_count: { type: 'integer', default: 50, maximum: 100 },
    } },
    run: async (a) => {
      const params = { page_no: a.page_no || 1, page_count: Math.min(a.page_count || 50, 100), last_reprt_at: a.last_reprt_at === false ? 'N' : 'Y' };
      let c = null;
      if (a.corp) { c = await resolveCorp(a.corp); params.corp_code = c.corp_code; }
      const end = a.end_de || ymd(todayKst());
      let bgn = a.bgn_de;
      if (!bgn) { const d = new Date(Date.UTC(+end.slice(0, 4), +end.slice(4, 6) - 1, +end.slice(6, 8))); d.setUTCDate(d.getUTCDate() - 30); bgn = ymd(d); }
      Object.assign(params, { bgn_de: bgn, end_de: end, pblntf_ty: a.pblntf_ty, pblntf_detail_ty: a.pblntf_detail_ty });
      const j = await dartJson('list.json', params);
      let items = (j.list || []).map((x) => ({ rcept_dt: x.rcept_dt, corp_name: x.corp_name, stock_code: x.stock_code, corp_cls: x.corp_cls,
        report_nm: (x.report_nm || '').trim(), rcept_no: x.rcept_no, flr_nm: x.flr_nm, rm: x.rm, url: viewerUrl(x.rcept_no) }));
      if (a.title_contains) items = items.filter((x) => x.report_nm.includes(a.title_contains));
      return { corp: c ? corpInfo(c) : null, period: `${bgn}~${end}`, page_no: j.page_no, total_page: j.total_page, total_count: j.total_count, shown: items.length,
        note: 'rm 표시: 유=유가증권, 코=코스닥, 넥=코넥스, 채=채권상장, 연=연결, 정=정정, 첨=첨부추가, 철=철회',
        list: items };
    },
  },
  {
    name: 'dart_financials',
    description: '정기보고서 재무제표. scope=major는 주요계정(매출·영업이익·순이익·자산·부채·자본, 연결/별도 모두), scope=all은 전체 재무제표(fs_div로 연결 CFS/별도 OFS 선택). major는 corp에 여러 회사를 쉼표로 넣으면 다중회사 주요계정 API로 한 번에 조회. 금액 단위는 원. 2015년 이후 자료.',
    inputSchema: { type: 'object', properties: {
      corp: { type: 'string', description: CORP_ARG.description + '. scope=major에서는 쉼표로 여러 회사 가능 (예: 005930,000660,066570)' },
      year: { type: 'string', description: '사업연도 YYYY' },
      report: REPORT_ARG,
      scope: { type: 'string', enum: ['major', 'all'], default: 'major' },
      fs_div: { type: 'string', enum: ['CFS', 'OFS'], description: '연결(CFS)/별도(OFS). all에서 기본 CFS, major에서는 지정 시 해당 행만' },
      statement: { type: 'string', description: 'all일 때 재무제표 종류만 걸러냄: BS 재무상태표, IS 손익계산서, CIS 포괄손익, CF 현금흐름, SCE 자본변동' },
    }, required: ['corp', 'year'] },
    run: async (a) => {
      const rc = reportCode(a.report);
      const scope = a.scope || 'major';
      const corps = await resolveCorps(a.corp);
      if (corps.length > 1) {
        if (scope !== 'major') throw new Error('여러 회사는 scope=major(주요계정)만 됩니다.');
        const j = await dartJson('fnlttMultiAcnt.json', { corp_code: corps.map((x) => x.corp_code).join(','), bsns_year: a.year, reprt_code: rc });
        const byStock = (s) => (corps.find((x) => x.stock_code && x.stock_code === s) || {}).corp_name || s;
        const rows = (j.list || []).filter((x) => !a.fs_div || x.fs_div === a.fs_div).map((x) => ({
          corp_name: x.corp_code ? nameOf(x.corp_code, corps) : byStock(x.stock_code), stock_code: x.stock_code,
          fs_div: x.fs_div, sj_div: x.sj_div, account_nm: x.account_nm,
          thstrm: `${x.thstrm_nm || ''} ${x.thstrm_dt || ''}`.trim(), thstrm_amount: x.thstrm_amount, thstrm_add_amount: x.thstrm_add_amount,
          frmtrm_amount: x.frmtrm_amount, currency: x.currency }));
        const got = new Set(rows.map((r) => r.corp_name));
        return { corps: corps.map(corpInfo), year: a.year, report: REPORT_NAMES[rc], scope: 'major(다중회사)', count: rows.length,
          missing: corps.map((x) => x.corp_name || x.corp_code).filter((n) => !got.has(n)), rows };
      }
      const c = corps[0];
      let rows;
      if (scope === 'major') {
        const j = await dartJson('fnlttSinglAcnt.json', { corp_code: c.corp_code, bsns_year: a.year, reprt_code: rc });
        rows = (j.list || []).filter((x) => !a.fs_div || x.fs_div === a.fs_div).map((x) => ({
          fs_div: x.fs_div, sj_div: x.sj_div, account_nm: x.account_nm,
          thstrm: `${x.thstrm_nm || ''} ${x.thstrm_dt || ''}`.trim(), thstrm_amount: x.thstrm_amount, thstrm_add_amount: x.thstrm_add_amount,
          frmtrm_amount: x.frmtrm_amount, frmtrm_add_amount: x.frmtrm_add_amount, bfefrmtrm_amount: x.bfefrmtrm_amount, currency: x.currency }));
      } else {
        const fs_div = a.fs_div || 'CFS';
        let j = await dartJson('fnlttSinglAcntAll.json', { corp_code: c.corp_code, bsns_year: a.year, reprt_code: rc, fs_div });
        let used = fs_div;
        if (!(j.list || []).length && !a.fs_div) { j = await dartJson('fnlttSinglAcntAll.json', { corp_code: c.corp_code, bsns_year: a.year, reprt_code: rc, fs_div: 'OFS' }); used = 'OFS(연결 없음)'; }
        rows = (j.list || []).filter((x) => !a.statement || x.sj_div === a.statement).map((x) => ({
          fs_div: used, sj_div: x.sj_div, sj_nm: x.sj_nm, account_id: x.account_id, account_nm: x.account_nm,
          thstrm_amount: x.thstrm_amount, thstrm_add_amount: x.thstrm_add_amount, frmtrm_amount: x.frmtrm_amount, currency: x.currency }));
      }
      return { corp: corpInfo(c), year: a.year, report: REPORT_NAMES[rc], scope, count: rows.length,
        note: rows.length ? undefined : '자료 없음. 일반 기업 재무 양식이 아닌 회사(펀드·금융 등)일 수 있으니 dart_disclosures로 정기보고서 원문을 확인하세요.',
        rows };
    },
  },
  {
    name: 'dart_indicators',
    description: '주요 재무지표(DART가 XBRL 재무제표로 계산한 값): 수익성(영업이익률·ROE 등), 안정성(부채비율 등), 성장성, 활동성. 한 회사는 단일회사, 쉼표로 여러 회사를 넣으면 다중회사 API. 2023년 3분기 보고서부터 제공. 지표값(idx_val)은 DART 원값 그대로.',
    inputSchema: { type: 'object', properties: {
      corp: { type: 'string', description: CORP_ARG.description + '. 쉼표로 여러 회사 가능' },
      year: { type: 'string', description: '사업연도 YYYY (2023 이후)' },
      report: REPORT_ARG,
      category: { type: 'string', enum: ['profitability', 'stability', 'growth', 'activity', 'all'], default: 'all',
        description: 'profitability 수익성(M210000), stability 안정성(M220000), growth 성장성(M230000), activity 활동성(M240000), all 네 가지 모두' },
    }, required: ['corp', 'year'] },
    run: async (a) => {
      const corps = await resolveCorps(a.corp);
      const rc = reportCode(a.report);
      const cat = a.category || 'all';
      const codes = cat === 'all' ? Object.values(IDX_CODES) : [IDX_CODES[cat]];
      if (!codes[0]) throw new Error('category 값이 잘못됨: ' + cat);
      const multi = corps.length > 1;
      const endpoint = multi ? 'fnlttCmpnyIndx.json' : 'fnlttSinglIndx.json';
      const rows = [];
      for (const code of codes) {
        const j = await dartJson(endpoint, { corp_code: corps.map((x) => x.corp_code).join(','), bsns_year: a.year, reprt_code: rc, idx_cl_code: code });
        for (const x of j.list || []) rows.push({ corp_name: nameOf(x.corp_code, corps), stock_code: x.stock_code, stlm_dt: x.stlm_dt,
          idx_cl_nm: x.idx_cl_nm, idx_nm: x.idx_nm, idx_val: x.idx_val });
      }
      return { corps: corps.map(corpInfo), year: a.year, report: REPORT_NAMES[rc], api: multi ? '다중회사 주요 재무지표' : '단일회사 주요 재무지표', count: rows.length,
        note: rows.length ? '지표값 단위(비율·%·회)는 지표마다 다르므로 해석 전 확인' : '자료 없음. 2023년 3분기 이전이거나 XBRL 재무제표가 없는 회사일 수 있음',
        rows };
    },
  },
  {
    name: 'dart_dividends',
    description: '정기보고서의 배당에 관한 사항: 주당 현금배당금, 현금배당수익률, 배당성향, 당기순이익 등(당기·전기·전전기).',
    inputSchema: { type: 'object', properties: { corp: CORP_ARG, year: { type: 'string', description: '사업연도 YYYY' }, report: REPORT_ARG }, required: ['corp', 'year'] },
    run: async (a) => {
      const c = await resolveCorp(a.corp);
      const rc = reportCode(a.report);
      const j = await dartJson('alotMatter.json', { corp_code: c.corp_code, bsns_year: a.year, reprt_code: rc });
      const rows = (j.list || []).map((x) => ({ se: x.se, stock_knd: x.stock_knd, thstrm: x.thstrm, frmtrm: x.frmtrm, lwfr: x.lwfr, stlm_dt: x.stlm_dt }));
      return { corp: corpInfo(c), year: a.year, report: REPORT_NAMES[rc], count: rows.length,
        note: rows.length ? undefined : '자료 없음. 분배금을 따로 공시하는 회사(인프라펀드 등)는 dart_disclosures(title_contains="배당" 또는 "분배")로 찾으세요.',
        rows };
    },
  },
  {
    name: 'dart_report',
    description: '정기보고서 주요정보·지분공시·주요사항보고서 조회(허용 목록만). endpoint 목록: ' +
      Object.entries(REPORT_ENDPOINTS).map(([k, v]) => `${k}(${v})`).join(', ') +
      '. 정기보고서 항목은 year·report, 주요사항보고서는 bgn_de·end_de가 필요, 지분공시(majorstock·elestock)는 corp만.',
    inputSchema: { type: 'object', properties: {
      corp: CORP_ARG,
      endpoint: { type: 'string', enum: Object.keys(REPORT_ENDPOINTS) },
      year: { type: 'string' }, report: REPORT_ARG,
      bgn_de: { type: 'string', description: 'YYYYMMDD (주요사항보고서)' }, end_de: { type: 'string', description: 'YYYYMMDD (주요사항보고서)' },
    }, required: ['corp', 'endpoint'] },
    run: async (a) => {
      if (!REPORT_ENDPOINTS[a.endpoint]) throw new Error('허용 목록에 없는 endpoint: ' + a.endpoint);
      const c = await resolveCorp(a.corp);
      const kind = KIND(a.endpoint);
      const params = { corp_code: c.corp_code };
      if (kind === 'periodic') {
        if (!a.year) throw new Error('이 항목은 year(사업연도)가 필요합니다.');
        Object.assign(params, { bsns_year: a.year, reprt_code: reportCode(a.report) });
      } else if (kind === 'major') {
        if (!a.bgn_de || !a.end_de) throw new Error('주요사항보고서는 bgn_de, end_de가 필요합니다.');
        Object.assign(params, { bgn_de: a.bgn_de, end_de: a.end_de });
      }
      const j = await dartJson(`${a.endpoint}.json`, params);
      const rows = (j.list || []).map((x) => { const y = { ...x }; delete y.corp_code; delete y.corp_name; delete y.corp_cls; return y; });
      return { corp: corpInfo(c), endpoint: a.endpoint, title: REPORT_ENDPOINTS[a.endpoint], count: rows.length, rows };
    },
  },
  {
    name: 'dart_document',
    description: '공시 원문(접수번호 rcept_no)을 내려받아 태그를 지운 텍스트로 돌려줍니다. 길면 offset·max_chars로 나눠 읽습니다. find를 주면 그 단어 주변만 보여줍니다.',
    inputSchema: { type: 'object', properties: {
      rcept_no: { type: 'string', description: '접수번호 14자리 (dart_disclosures 결과)' },
      file_index: { type: 'integer', default: 0, description: '여러 파일이면 몇 번째(0=본문)' },
      offset: { type: 'integer', default: 0 },
      max_chars: { type: 'integer', default: 15000, maximum: 50000 },
      find: { type: 'string', description: '이 단어가 나오는 부분 주변(앞뒤 400자)만 최대 15곳' },
    }, required: ['rcept_no'] },
    run: async (a) => {
      if (!/^\d{14}$/.test(String(a.rcept_no))) throw new Error('rcept_no는 14자리 숫자');
      const buf = await dartGet('document.xml', { rcept_no: a.rcept_no });
      assertZip(buf, '공시 원문');
      const files = unzip(buf).filter((f) => f.data);
      const idx = a.file_index || 0;
      const f = files[idx];
      if (!f) throw new Error(`파일 ${idx}번이 없음 (파일 ${files.length}개)`);
      const text = htmlToText(decodeText(f.data));
      const base = { rcept_no: a.rcept_no, url: viewerUrl(a.rcept_no), files: files.map((x, i) => `${i}: ${x.name} (${x.data.length}바이트)`), file: f.name, total_chars: text.length };
      if (a.find) {
        const hits = []; let from = 0;
        while (hits.length < 15) {
          const i = text.indexOf(a.find, from); if (i < 0) break;
          hits.push({ at: i, text: text.slice(Math.max(0, i - 400), i + 400) }); from = i + a.find.length;
        }
        return { ...base, find: a.find, hits };
      }
      const off = a.offset || 0, max = Math.min(a.max_chars || 15000, 50000);
      return { ...base, offset: off, next_offset: off + max < text.length ? off + max : null, text: text.slice(off, off + max) };
    },
  },
];

function htmlToText(s) {
  return s
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(P|TR|TABLE|TITLE|SECTION-\d|LIBRARY|DIV|BR|H\d|LI)>/gi, '\n')
    .replace(/<(BR|P|TR)\b[^>]*\/?>/gi, '\n')
    .replace(/<\/(TD|TH|TE|TU)>/gi, ' | ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;|&#160;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ───────────────────────── MCP stdio ─────────────────────────
function send(msg) { process.stdout.write(JSON.stringify(msg) + '\n'); }

async function handle(msg) {
  const { id, method, params } = msg;
  const isReq = id !== undefined && id !== null;
  try {
    if (method === 'initialize') {
      return send({ jsonrpc: '2.0', id, result: {
        protocolVersion: (params && params.protocolVersion) || '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'dart-readonly', version: VERSION },
        instructions: 'DART 전자공시 조회 전용. 종목코드 6자리로 회사를 지정할 수 있음. 금액 단위는 원. 공시 원문 확인은 dart_disclosures → dart_document 순서.',
      } });
    }
    if (method === 'ping') return isReq && send({ jsonrpc: '2.0', id, result: {} });
    if (method === 'tools/list') {
      return send({ jsonrpc: '2.0', id, result: { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema, annotations: { readOnlyHint: true, openWorldHint: true } })) } });
    }
    if (method === 'tools/call') {
      const tool = TOOLS.find((t) => t.name === params.name);
      if (!tool) return send({ jsonrpc: '2.0', id, error: { code: -32602, message: '알 수 없는 도구: ' + params.name } });
      try {
        const out = await tool.run(params.arguments || {});
        let text = JSON.stringify(out, null, 1);
        if (text.length > MAX_OUTPUT_CHARS) text = text.slice(0, MAX_OUTPUT_CHARS) + `\n…(잘림: 전체 ${text.length}자. 범위를 좁히거나 page·offset을 쓰세요)`;
        return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text }] } });
      } catch (e) {
        return send({ jsonrpc: '2.0', id, result: { isError: true, content: [{ type: 'text', text: mask(e.message || String(e)) }] } });
      }
    }
    if (isReq) send({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found: ' + method } });
  } catch (e) {
    if (isReq) send({ jsonrpc: '2.0', id, error: { code: -32603, message: mask(e.message || String(e)) } });
  }
}

// Desktop의 내장 Node는 래퍼를 거쳐 실행해 require.main 판정이 맞지 않으므로 항상 시작. 시험에서만 DART_MCP_NO_STDIO=1로 끔
if (process.env.DART_MCP_NO_STDIO !== '1') {
  let buf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line) continue;
      let msg; try { msg = JSON.parse(line); } catch (_) { log('잘못된 JSON 무시'); continue; }
      handle(msg);
    }
  });
  process.stdin.on('end', () => process.exit(0));
  log(`시작 v${VERSION}`);
}

module.exports = { unzip, parseCorpXml, htmlToText, decodeText, resolveCorp, resolveCorps, reportCode, KIND, REPORT_ENDPOINTS, TOOLS, _setCorpList: (l) => { corpList = l; } };
