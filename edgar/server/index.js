#!/usr/bin/env node
// SEC EDGAR 조회 전용 MCP 서버
// - 외부 패키지 없음 (Node 18+ 내장 모듈만 사용)
// - 호출 주소 data.sec.gov / www.sec.gov / efts.sec.gov 고정, GET만 사용
// - 키는 없음. 대신 연락처가 든 User-Agent가 필수: 환경변수 SEC_USER_AGENT → 없으면 맥 키체인(서비스 edgar-mcp, 계정 sec)
// - SEC 공정 접근 정책(초당 10건)을 지키려고 초당 8건 이하로 직렬 호출
'use strict';

const https = require('https');
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const VERSION = '0.1.0';
const ALLOWED_HOSTS = new Set(['data.sec.gov', 'www.sec.gov', 'efts.sec.gov']);
const CACHE_DIR = path.join(os.homedir(), '.edgar-mcp');
const TICKER_CACHE = path.join(CACHE_DIR, 'company_tickers.json');
const TICKER_TTL_MS = 24 * 3600 * 1000;
const RESP_TTL_MS = 5 * 60 * 1000;
const MIN_INTERVAL_MS = 125; // 초당 8건
const MAX_BYTES = 40 * 1024 * 1024;
const MAX_OUTPUT_CHARS = 60000;
const KEYCHAIN_SERVICE = 'edgar-mcp';
const KEYCHAIN_ACCOUNT = 'sec';

const log = (...a) => process.stderr.write('[edgar-mcp] ' + a.join(' ') + '\n');

// ───────────────────────── User-Agent ─────────────────────────
let cachedUA = null;
function getUA() {
  if (cachedUA) return cachedUA;
  const env = (process.env.SEC_USER_AGENT || '').trim();
  if (env && !env.includes('${')) return (cachedUA = checkUA(env));
  if (process.platform === 'darwin') {
    try {
      const k = execFileSync('security',
        ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', KEYCHAIN_ACCOUNT, '-w'],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      if (k) return (cachedUA = checkUA(k));
    } catch (_) { /* 없음 */ }
  }
  throw new Error('SEC는 연락처가 든 User-Agent를 요구합니다(없으면 403). 환경변수 SEC_USER_AGENT="이름 이메일" 로 넣거나, 맥에서는 `security add-generic-password -s edgar-mcp -a sec -w` 로 키체인에 넣으세요.');
}
function checkUA(s) {
  if (!s.includes('@')) throw new Error('User-Agent에 연락처 이메일이 있어야 합니다. 예: SEC_USER_AGENT="홍길동 me@example.com"');
  return s;
}
const mask = (s) => {
  let t = String(s);
  if (cachedUA) t = t.split(cachedUA).join('***');
  return t.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '***@***');
};

// ───────────────────────── HTTP ─────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastCall = 0;
let chain = Promise.resolve();
function throttle() {
  const p = chain.then(async () => {
    const wait = Math.max(0, lastCall + MIN_INTERVAL_MS - Date.now());
    if (wait) await sleep(wait);
    lastCall = Date.now();
  });
  chain = p.catch(() => {});
  return p;
}

function statusError(sc, u) {
  let msg;
  if (sc === 404) msg = `찾을 수 없음(404): ${u.pathname}`;
  else if (sc === 403 || sc === 429) msg = `SEC가 요청을 거절함(${sc}). User-Agent의 연락처와 요청 속도를 확인하세요. 한도 초과 시 약 10분간 차단될 수 있습니다.`;
  else msg = `HTTP ${sc}: ${u.pathname}`;
  const e = new Error(msg);
  e.status = sc;
  return e;
}

async function httpGet(u, attempt = 0, hops = 0) {
  const ua = getUA();
  await throttle();
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname: u.hostname, port: 443, path: u.pathname + u.search, method: 'GET',
      headers: { 'User-Agent': ua, 'Accept-Encoding': 'gzip, deflate', Accept: '*/*' }, timeout: 30000 }, (res) => {
      const chunks = [];
      let size = 0;
      res.on('data', (c) => {
        size += c.length;
        if (size > MAX_BYTES) { req.destroy(new Error('응답이 너무 큼(40MB 초과)')); return; }
        chunks.push(c);
      });
      res.on('end', () => {
        const sc = res.statusCode;
        if (sc >= 300 && sc < 400 && res.headers.location) {
          if (hops >= 3) return reject(new Error('리디렉션이 너무 많음'));
          let nu;
          try { nu = new URL(res.headers.location, u); } catch (_) { return reject(new Error('잘못된 리디렉션')); }
          if (nu.protocol !== 'https:' || !ALLOWED_HOSTS.has(nu.hostname)) return reject(new Error('허용되지 않은 리디렉션: ' + nu.hostname));
          return resolve(httpGet(nu, attempt, hops + 1));
        }
        let body = Buffer.concat(chunks);
        const enc = res.headers['content-encoding'];
        try {
          if (enc === 'gzip') body = zlib.gunzipSync(body);
          else if (enc === 'deflate') body = zlib.inflateSync(body);
        } catch (_) { return reject(new Error('압축 해제 실패')); }
        if (sc === 200) return resolve(body);
        if ([500, 502, 503, 504].includes(sc) && attempt < 1) return setTimeout(() => resolve(httpGet(u, attempt + 1, hops)), 1000);
        reject(statusError(sc, u));
      });
    });
    req.on('timeout', () => req.destroy(new Error('응답 시간 초과(30초): ' + u.pathname)));
    req.on('error', (e) => reject(new Error(mask(e.message))));
    req.end();
  });
}

let fetcher = null; // 시험에서만 가짜 응답을 끼워 넣음
const respCache = new Map();
async function secGet(url) {
  let u;
  try { u = new URL(url); } catch (_) { throw new Error('잘못된 주소'); }
  if (u.protocol !== 'https:' || !ALLOWED_HOSTS.has(u.hostname)) throw new Error('허용되지 않은 주소: ' + u.hostname);
  const hit = respCache.get(url);
  if (hit && Date.now() - hit.t < RESP_TTL_MS) return hit.buf;
  const buf = fetcher ? await fetcher(url) : await httpGet(u);
  if (buf.length <= 8 * 1024 * 1024) {
    respCache.set(url, { t: Date.now(), buf });
    if (respCache.size > 40) respCache.delete(respCache.keys().next().value);
  }
  return buf;
}
async function secJson(url) {
  const buf = await secGet(url);
  try { return JSON.parse(buf.toString('utf8')); } catch (_) { throw new Error('JSON 해석 실패: ' + buf.toString('utf8').slice(0, 120)); }
}

// ───────────────────────── 공통 도구 ─────────────────────────
const pad10 = (n) => String(n).replace(/\D/g, '').padStart(10, '0');
const cikInt = (cik) => String(parseInt(cik, 10));
const clamp = (v, lo, hi, d) => { const n = Number.isFinite(+v) && v !== null && v !== '' && v !== undefined ? +v : d; return Math.min(hi, Math.max(lo, Math.floor(n))); };
const dayDiff = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
const addDays = (d, n) => new Date(Date.parse(d) + n * 86400000).toISOString().slice(0, 10);
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s));
function normAccession(s) {
  const m = String(s || '').trim().match(/^(\d{10})-?(\d{2})-?(\d{6})$/);
  if (!m) throw new Error('접수번호(accession)는 0000320193-26-000026 형식(숫자 18자리)');
  return `${m[1]}-${m[2]}-${m[3]}`;
}
const docUrl = (cik, accn, doc) => `https://www.sec.gov/Archives/edgar/data/${cikInt(cik)}/${accn.replace(/-/g, '')}/${doc}`;
const indexUrl = (cik, accn) => `https://www.sec.gov/Archives/edgar/data/${cikInt(cik)}/${accn.replace(/-/g, '')}/${accn}-index.htm`;

// ───────────────────────── 회사 지정 ─────────────────────────
let tickerList = null;
async function loadTickers() {
  if (tickerList) return tickerList;
  try {
    const st = fs.statSync(TICKER_CACHE);
    if (Date.now() - st.mtimeMs < TICKER_TTL_MS) return (tickerList = JSON.parse(fs.readFileSync(TICKER_CACHE, 'utf8')));
  } catch (_) { /* 캐시 없음 */ }
  const j = await secJson('https://www.sec.gov/files/company_tickers.json');
  tickerList = Object.values(j).map((x) => ({ cik: pad10(x.cik_str), ticker: String(x.ticker || '').toUpperCase(), title: x.title || '' }));
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true, mode: 0o700 });
    fs.writeFileSync(TICKER_CACHE, JSON.stringify(tickerList), { mode: 0o600 });
  } catch (_) { /* 캐시 실패는 무시 */ }
  return tickerList;
}

async function resolveCompany(input) {
  const q = String(input || '').trim();
  if (!q) throw new Error('company(티커·회사명·CIK)를 지정하세요.');
  if (/^\d{1,10}$/.test(q)) return { cik: pad10(q) };
  const list = await loadTickers();
  const t = q.toUpperCase().replace(/\./g, '-');
  const byTicker = list.filter((x) => x.ticker === t);
  if (byTicker.length) return { cik: byTicker[0].cik, ticker: byTicker[0].ticker, title: byTicker[0].title };
  const toks = q.toLowerCase().split(/\s+/).filter(Boolean);
  const hits = list.filter((x) => { const tl = x.title.toLowerCase(); return toks.every((w) => tl.includes(w)); });
  const ciks = [...new Set(hits.map((h) => h.cik))];
  if (ciks.length === 1) return { cik: ciks[0], ticker: hits[0].ticker, title: hits[0].title };
  const exact = hits.filter((h) => h.title.toLowerCase() === q.toLowerCase());
  if (exact.length && new Set(exact.map((h) => h.cik)).size === 1) return { cik: exact[0].cik, ticker: exact[0].ticker, title: exact[0].title };
  if (!ciks.length) throw new Error(`회사를 찾지 못함: "${q}". 티커 목록에는 현재 상장된 회사만 있습니다. 상장폐지·비상장 회사는 CIK 숫자로 지정하세요.`);
  throw new Error(`하나로 정하지 못함: "${q}". 후보: ` + hits.slice(0, 8).map((h) => `${h.ticker} ${h.title} (CIK ${h.cik})`).join(' / ') + ' — 티커나 CIK로 다시 지정하세요.');
}

// ───────────────────────── 공시 목록 ─────────────────────────
function rowsFromColumnar(obj) {
  const keys = Object.keys(obj || {});
  const n = keys.length ? (obj[keys[0]] || []).length : 0;
  const rows = [];
  for (let i = 0; i < n; i++) { const r = {}; for (const k of keys) r[k] = obj[k][i]; rows.push(r); }
  return rows;
}
const getSubmissions = (cik) => secJson(`https://data.sec.gov/submissions/CIK${pad10(cik)}.json`);
const shapeFiling = (cik, r) => ({
  form: r.form, filing_date: r.filingDate, report_date: r.reportDate || undefined, accession: r.accessionNumber,
  items: r.items || undefined, primary_document: r.primaryDocument || undefined,
  url: r.primaryDocument ? docUrl(cik, r.accessionNumber, r.primaryDocument) : undefined,
  index_url: indexUrl(cik, r.accessionNumber), xbrl: r.isXBRL ? true : undefined,
});

// ───────────────────────── XBRL 시계열 ─────────────────────────
// fy·fp는 "공시 기준"이라 이전 연도 값도 뒤 공시에 다시 실려 옴 → (start,end)로 묶어 가장 늦게 공시된 값만 씀
function dedupe(facts) {
  const m = new Map();
  for (const f of facts) {
    if (!f || f.end === undefined || f.val === null || f.val === undefined) continue;
    const k = `${f.start || ''}|${f.end}`;
    const o = m.get(k);
    if (!o || String(f.filed) > String(o.filed) || (f.filed === o.filed && String(f.accn) > String(o.accn))) m.set(k, f);
  }
  return [...m.values()];
}
const ANNUAL_FORM = /^(10-K|20-F|40-F)/;
const isAnnualDur = (d) => d >= 340 && d <= 380;
const isQuarterDur = (d) => d >= 80 && d <= 100;
const isNineMonthDur = (d) => d >= 250 && d <= 290;
const shapeFact = (f, extra) => {
  const o = { period_start: f.start, period_end: f.end, value: f.val, filed: f.filed, form: f.form, accession: f.accn };
  return Object.assign(o, extra || {});
};
const byEndDesc = (a, b) => String(b.period_end).localeCompare(String(a.period_end)) || String(b.period_start || '').localeCompare(String(a.period_start || ''));

function buildSeries(facts, kind, period, limit) {
  const items = dedupe(facts);
  let rows = [];
  if (kind === 'instant') {
    const annualEnds = new Set(facts.filter((f) => f.fp === 'FY' && ANNUAL_FORM.test(f.form || '')).map((f) => f.end));
    rows = items.filter((f) => !f.start && (period === 'quarterly' || annualEnds.has(f.end))).map((f) => shapeFact(f));
  } else {
    const dur = items.filter((f) => f.start).map((f) => ({ f, d: dayDiff(f.start, f.end) }));
    if (period === 'annual') {
      rows = dur.filter((x) => isAnnualDur(x.d)).map((x) => shapeFact(x.f));
    } else {
      const quarters = dur.filter((x) => isQuarterDur(x.d));
      rows = quarters.map((x) => shapeFact(x.f));
      // 4분기는 따로 공시되지 않음 → 연간 − 9개월 누적 (같은 시작일)
      for (const a of dur.filter((x) => isAnnualDur(x.d))) {
        if (quarters.some((q) => Math.abs(dayDiff(q.f.end, a.f.end)) <= 3)) continue;
        const y9 = dur.find((x) => isNineMonthDur(x.d) && x.f.start === a.f.start);
        if (!y9) continue;
        rows.push({ period_start: addDays(y9.f.end, 1), period_end: a.f.end, value: a.f.val - y9.f.val,
          filed: String(a.f.filed) > String(y9.f.filed) ? a.f.filed : y9.f.filed, form: a.f.form, accession: a.f.accn, derived: true });
      }
    }
  }
  rows.sort(byEndDesc);
  return rows.slice(0, limit);
}

const METRICS = {
  revenue: { label: '매출액', kind: 'duration', unit: 'USD', tags: ['RevenueFromContractWithCustomerExcludingAssessedTax', 'Revenues', 'SalesRevenueNet', 'RevenueFromContractWithCustomerIncludingAssessedTax'] },
  gross_profit: { label: '매출총이익', kind: 'duration', unit: 'USD', tags: ['GrossProfit'] },
  operating_income: { label: '영업이익', kind: 'duration', unit: 'USD', tags: ['OperatingIncomeLoss'] },
  net_income: { label: '순이익(지배주주)', kind: 'duration', unit: 'USD', tags: ['NetIncomeLoss', 'ProfitLoss'] },
  eps_diluted: { label: '희석 주당순이익(EPS)', kind: 'duration', unit: 'USD/shares', tags: ['EarningsPerShareDiluted'] },
  eps_basic: { label: '기본 주당순이익(EPS)', kind: 'duration', unit: 'USD/shares', tags: ['EarningsPerShareBasic'] },
  operating_cash_flow: { label: '영업활동현금흐름', kind: 'duration', unit: 'USD', tags: ['NetCashProvidedByUsedInOperatingActivities'] },
  capex: { label: '유형자산 취득(CAPEX)', kind: 'duration', unit: 'USD', tags: ['PaymentsToAcquirePropertyPlantAndEquipment'] },
  total_assets: { label: '자산총계', kind: 'instant', unit: 'USD', tags: ['Assets'] },
  total_liabilities: { label: '부채총계', kind: 'instant', unit: 'USD', tags: ['Liabilities'] },
  equity: { label: '자본총계(주주지분)', kind: 'instant', unit: 'USD', tags: ['StockholdersEquity', 'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest'] },
  cash: { label: '현금및현금성자산', kind: 'instant', unit: 'USD', tags: ['CashAndCashEquivalentsAtCarryingValue'] },
  long_term_debt: { label: '장기부채', kind: 'instant', unit: 'USD', tags: ['LongTermDebtNoncurrent', 'LongTermDebt'] },
};
const DEFAULT_METRICS = ['revenue', 'operating_income', 'net_income', 'eps_diluted', 'total_assets', 'total_liabilities', 'equity', 'operating_cash_flow'];

const TAG_RE = /^[A-Za-z][A-Za-z0-9_]*$/;
const TAXONOMY_RE = /^[A-Za-z][A-Za-z0-9-]*$/;
const UNIT_RE = /^[A-Za-z0-9_-]+(\/[A-Za-z0-9_-]+)?$/;

async function getConcept(cik, taxonomy, tag) {
  if (!TAXONOMY_RE.test(taxonomy) || !TAG_RE.test(tag)) throw new Error('taxonomy·tag 형식이 잘못됨');
  try { return await secJson(`https://data.sec.gov/api/xbrl/companyconcept/CIK${pad10(cik)}/${taxonomy}/${tag}.json`); }
  catch (e) { if (e.status === 404) return null; throw e; }
}
function pickUnit(units, want) {
  const keys = Object.keys(units || {});
  if (!keys.length) return { unit: null, facts: null };
  const u = keys.includes(want) ? want : keys[0];
  return { unit: u, facts: units[u], fallback: u !== want };
}

// ───────────────────────── 원문 텍스트 ─────────────────────────
function decodeText(buf) {
  const tryDec = (e) => { try { return new TextDecoder(e, { fatal: true }).decode(buf); } catch (_) { return null; } };
  return tryDec('utf-8') ?? buf.toString('latin1');
}
function htmlToText(s) {
  return s
    .replace(/<ix:header[\s\S]*?<\/ix:header>/gi, ' ')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|tr|table|title|div|br|h\d|li)>/gi, '\n')
    .replace(/<(br|p|tr)\b[^>]*\/?>/gi, '\n')
    .replace(/<\/(td|th)>/gi, ' | ')
    .replace(/<[^>]+>/g, '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n')
    .trim();
}
const textCache = new Map();
async function fetchDocText(url) {
  if (textCache.has(url)) return textCache.get(url);
  const buf = await secGet(url);
  if (buf.length > 4 && buf.subarray(0, 4).toString('latin1') === '%PDF') throw new Error('PDF는 텍스트로 바꾸지 못합니다. url로 직접 여세요.');
  const text = htmlToText(decodeText(buf));
  textCache.set(url, text);
  if (textCache.size > 3) textCache.delete(textCache.keys().next().value);
  return text;
}
function validArchiveUrl(url) {
  let u;
  try { u = new URL(url); } catch (_) { throw new Error('잘못된 url'); }
  if (u.protocol !== 'https:' || u.hostname !== 'www.sec.gov' || !u.pathname.startsWith('/Archives/edgar/data/') || u.pathname.includes('..')) {
    throw new Error('https://www.sec.gov/Archives/edgar/data/ 아래 주소만 읽을 수 있습니다.');
  }
  return u.toString();
}

// ───────────────────────── 도구 ─────────────────────────
const COMPANY_ARG = { type: 'string', description: '티커(AAPL, BRK.B), 회사명 일부, 또는 CIK 숫자' };

const TOOLS = [
  {
    name: 'sec_find_company',
    description: 'SEC 상장사 목록에서 티커·회사명·CIK로 회사를 찾습니다. CIK는 SEC가 회사마다 붙인 10자리 번호로, 다른 도구의 company 인자에 티커 대신 써도 됩니다. 현재 상장된 회사만 나옵니다.',
    inputSchema: { type: 'object', properties: { query: { type: 'string', description: '티커·회사명 일부·CIK' }, limit: { type: 'integer', default: 10, maximum: 30 } }, required: ['query'] },
    run: async (a) => {
      const q = String(a.query || '').trim();
      if (!q) throw new Error('query가 비었습니다.');
      const limit = clamp(a.limit, 1, 30, 10);
      const list = await loadTickers();
      const up = q.toUpperCase().replace(/\./g, '-');
      const toks = q.toLowerCase().split(/\s+/).filter(Boolean);
      const digits = /^\d{1,10}$/.test(q) ? pad10(q) : null;
      const rank = (x) => (x.ticker === up ? 0 : digits && x.cik === digits ? 0 : x.ticker.startsWith(up) ? 1 : 2);
      const hits = list.filter((x) => x.ticker === up || (digits && x.cik === digits) || toks.every((w) => x.title.toLowerCase().includes(w)))
        .sort((x, y) => rank(x) - rank(y) || x.title.localeCompare(y.title));
      return { query: q, count: hits.length, rows: hits.slice(0, limit), note: hits.length ? undefined : '결과 없음. 상장폐지·비상장 회사는 티커 목록에 없으니 CIK를 알면 바로 다른 도구에 넣으세요.' };
    },
  },
  {
    name: 'sec_filings',
    description: '회사의 공시 목록(10-K 연간, 10-Q 분기, 8-K 수시, 4 내부자거래, 13F 등). 양식·기간으로 거를 수 있고 원문 주소가 함께 나옵니다. 기본은 최근 공시(보통 1,000건 안팎)만 보고, 더 오래된 것은 from을 옛날로 주거나 include_older=true.',
    inputSchema: { type: 'object', properties: {
      company: COMPANY_ARG,
      forms: { type: 'string', description: '쉼표 구분 양식 예: "10-K,10-Q" (정정은 "10-K/A"를 따로 적기)' },
      from: { type: 'string', description: 'YYYY-MM-DD 이후 공시' }, to: { type: 'string', description: 'YYYY-MM-DD 이전 공시' },
      limit: { type: 'integer', default: 20, maximum: 200 },
      include_older: { type: 'boolean', default: false, description: '최근 목록 밖의 옛 공시 파일도 읽기(호출이 늘어남)' },
    }, required: ['company'] },
    run: async (a) => {
      const c = await resolveCompany(a.company);
      if (a.from && !isDate(a.from)) throw new Error('from은 YYYY-MM-DD');
      if (a.to && !isDate(a.to)) throw new Error('to는 YYYY-MM-DD');
      const sub = await getSubmissions(c.cik);
      const forms = a.forms ? String(a.forms).split(',').map((s) => s.trim().toUpperCase()).filter(Boolean) : null;
      const limit = clamp(a.limit, 1, 200, 20);
      let rows = rowsFromColumnar(sub.filings && sub.filings.recent);
      const oldest = rows.reduce((m, r) => (r.filingDate < m ? r.filingDate : m), '9999-12-31');
      const files = (sub.filings && sub.filings.files) || [];
      const wantOlder = a.include_older || (a.from && a.from < oldest);
      const fetchedFiles = [];
      if (wantOlder) {
        const cand = files.filter((f) => (!a.from || f.filingTo >= a.from) && (!a.to || f.filingFrom <= a.to)).slice(0, 5);
        for (const f of cand) {
          rows = rows.concat(rowsFromColumnar(await secJson(`https://data.sec.gov/submissions/${f.name}`)));
          fetchedFiles.push(f.name);
        }
      }
      rows = rows.filter((r) => (!forms || forms.includes(String(r.form).toUpperCase())) && (!a.from || r.filingDate >= a.from) && (!a.to || r.filingDate <= a.to));
      rows.sort((x, y) => String(y.filingDate).localeCompare(String(x.filingDate)) || String(y.acceptanceDateTime).localeCompare(String(x.acceptanceDateTime)));
      return {
        company: { cik: c.cik, name: sub.name, tickers: sub.tickers, exchanges: sub.exchanges, sic: sub.sic, sic_description: sub.sicDescription, fiscal_year_end: sub.fiscalYearEnd },
        total_matched: rows.length, shown: Math.min(limit, rows.length), older_files_read: fetchedFiles.length ? fetchedFiles : undefined,
        older_files_available: !wantOlder && files.length ? files.map((f) => `${f.filingFrom}~${f.filingTo}`) : undefined,
        rows: rows.slice(0, limit).map((r) => shapeFiling(c.cik, r)),
      };
    },
  },
  {
    name: 'sec_financials',
    description: '핵심 재무 항목을 연간 또는 분기별로 정리합니다(XBRL 기준, 금액은 달러). 정정·재공시가 있으면 가장 늦게 공시된 값을 쓰고, 분기 모드에서 4분기는 "연간 − 9개월 누적"으로 계산해 derived=true로 표시합니다. metrics: ' +
      Object.entries(METRICS).map(([k, v]) => `${k}(${v.label})`).join(', ') + '. 미국 GAAP 공시 회사용이며 IFRS(20-F) 회사는 sec_concept에서 taxonomy=ifrs-full로 조회하세요.',
    inputSchema: { type: 'object', properties: {
      company: COMPANY_ARG,
      period: { type: 'string', enum: ['annual', 'quarterly'], default: 'annual' },
      metrics: { type: 'array', items: { type: 'string', enum: Object.keys(METRICS) }, description: '비우면 ' + DEFAULT_METRICS.join(', ') },
      limit: { type: 'integer', description: '항목별 기간 수 (기본 연간 5, 분기 8)', maximum: 40 },
    }, required: ['company'] },
    run: async (a) => {
      const c = await resolveCompany(a.company);
      const period = a.period === 'quarterly' ? 'quarterly' : 'annual';
      const limit = clamp(a.limit, 1, 40, period === 'annual' ? 5 : 8);
      const keys = Array.isArray(a.metrics) && a.metrics.length ? a.metrics : DEFAULT_METRICS;
      for (const k of keys) if (!METRICS[k]) throw new Error('metrics에 없는 항목: ' + k);
      const out = {};
      let entityName;
      for (const key of keys) {
        const m = METRICS[key];
        const merged = new Map();
        const used = [];
        let unit = m.unit;
        for (const tag of m.tags) {
          const j = await getConcept(c.cik, 'us-gaap', tag);
          if (!j) continue;
          entityName = entityName || j.entityName;
          const pu = pickUnit(j.units, m.unit);
          if (!pu.facts) continue;
          const rows = buildSeries(pu.facts, m.kind, period, 1000);
          if (!rows.length) continue;
          used.push(tag);
          unit = pu.unit;
          for (const r of rows) { const k = `${r.period_start || ''}|${r.period_end}`; if (!merged.has(k)) merged.set(k, Object.assign({}, r, { tag })); }
        }
        const rows = [...merged.values()].sort(byEndDesc).slice(0, limit);
        const notes = [];
        if (!rows.length) notes.push('자료 없음. 이 회사가 해당 us-gaap 항목을 쓰지 않거나(회사 고유 항목·IFRS), 해당 기간 공시가 없을 수 있음');
        if (rows.some((r) => r.derived) && /^eps_/.test(key)) notes.push('derived EPS는 (연간 − 9개월 누적)이라 주식수 변화로 근사값');
        if (used.length > 1) notes.push('여러 항목명을 이어 붙임(앞쪽 항목 우선): ' + used.join(', '));
        out[key] = { label: m.label, unit, tags_used: used, rows, note: notes.length ? notes.join(' / ') : undefined };
      }
      return { company: { cik: c.cik, name: entityName || c.title, ticker: c.ticker }, period, metrics: out };
    },
  },
  {
    name: 'sec_concept',
    description: '임의의 XBRL 항목 하나의 시계열(회사·항목 지정). 항목 이름은 sec_financials에 없는 것을 볼 때 씁니다(예: us-gaap의 InventoryNet, ResearchAndDevelopmentExpense, dei의 EntityCommonStockSharesOutstanding). view=latest는 기간마다 최신 공시값만, view=all은 정정 이력까지 전부.',
    inputSchema: { type: 'object', properties: {
      company: COMPANY_ARG, tag: { type: 'string', description: 'XBRL 항목명 예: InventoryNet' },
      taxonomy: { type: 'string', default: 'us-gaap', description: 'us-gaap · ifrs-full · dei · srt' },
      unit: { type: 'string', description: '단위 예: USD, shares, USD/shares (비우면 USD 우선)' },
      view: { type: 'string', enum: ['latest', 'all'], default: 'latest' },
      forms: { type: 'string', description: '쉼표 구분 양식 필터 예: "10-K"' },
      from: { type: 'string', description: '종료일(end)이 이 날짜 이후 YYYY-MM-DD' },
      limit: { type: 'integer', default: 40, maximum: 200 },
    }, required: ['company', 'tag'] },
    run: async (a) => {
      const c = await resolveCompany(a.company);
      const taxonomy = a.taxonomy || 'us-gaap';
      const j = await getConcept(c.cik, taxonomy, String(a.tag || ''));
      if (!j) throw new Error(`이 회사에는 ${taxonomy}:${a.tag} 항목이 없습니다. 항목명은 대소문자를 구분합니다.`);
      if (a.unit && !UNIT_RE.test(a.unit)) throw new Error('unit 형식이 잘못됨');
      const units = Object.keys(j.units || {});
      const unit = a.unit && units.includes(a.unit) ? a.unit : (units.includes('USD') ? 'USD' : units[0]);
      if (a.unit && unit !== a.unit) throw new Error(`단위 ${a.unit}가 없음. 사용 가능: ${units.join(', ')}`);
      let facts = j.units[unit] || [];
      const forms = a.forms ? String(a.forms).split(',').map((s) => s.trim().toUpperCase()) : null;
      if (a.from && !isDate(a.from)) throw new Error('from은 YYYY-MM-DD');
      if (a.view === 'all') facts = facts.slice(); else facts = dedupe(facts);
      facts = facts.filter((f) => (!forms || forms.includes(String(f.form).toUpperCase())) && (!a.from || f.end >= a.from));
      facts.sort((x, y) => byEndDesc({ period_end: x.end, period_start: x.start }, { period_end: y.end, period_start: y.start }) || String(y.filed).localeCompare(String(x.filed)));
      const limit = clamp(a.limit, 1, 200, 40);
      return { company: { cik: c.cik, name: j.entityName, ticker: c.ticker }, taxonomy, tag: j.tag, label: j.label, description: j.description, unit, available_units: units, total: facts.length,
        rows: facts.slice(0, limit).map((f) => shapeFact(f, { fy: f.fy, fp: f.fp, frame: f.frame })) };
    },
  },
  {
    name: 'sec_frames',
    description: '한 기간 안에서 한 XBRL 항목을 공시한 모든 회사를 한 번에(예: 2023년 매출 상위 25개). 서버에서 정렬해 상위만 돌려줍니다. period: 연간 CY2023, 분기 CY2023Q1, 시점값(자산 등) CY2023Q4I. 회사마다 결산월이 달라 달력 기준에 가장 가까운 기간으로 맞춘 값입니다.',
    inputSchema: { type: 'object', properties: {
      tag: { type: 'string', description: 'XBRL 항목명 예: Revenues, NetIncomeLoss, Assets' },
      period: { type: 'string', description: 'CY2023 · CY2023Q1 · CY2023Q4I' },
      taxonomy: { type: 'string', default: 'us-gaap' },
      unit: { type: 'string', default: 'USD', description: 'USD · shares · USD-per-shares' },
      sort: { type: 'string', enum: ['desc', 'asc'], default: 'desc' },
      top: { type: 'integer', default: 25, maximum: 200 },
      min_value: { type: 'number' }, max_value: { type: 'number' },
      name_contains: { type: 'string', description: '회사명에 이 글자가 든 것만' },
    }, required: ['tag', 'period'] },
    run: async (a) => {
      const taxonomy = a.taxonomy || 'us-gaap';
      const unit = a.unit || 'USD';
      if (!TAXONOMY_RE.test(taxonomy) || !TAG_RE.test(String(a.tag || ''))) throw new Error('taxonomy·tag 형식이 잘못됨');
      if (!/^CY\d{4}(Q[1-4]I?)?$/.test(String(a.period || ''))) throw new Error('period는 CY2023, CY2023Q1, CY2023Q4I 형식');
      if (!/^[A-Za-z0-9_-]+$/.test(unit)) throw new Error('unit 형식이 잘못됨(분수는 USD-per-shares)');
      const j = await secJson(`https://data.sec.gov/api/xbrl/frames/${taxonomy}/${a.tag}/${unit}/${a.period}.json`);
      let rows = (j.data || []).filter((r) => (a.min_value === undefined || r.val >= a.min_value) && (a.max_value === undefined || r.val <= a.max_value) &&
        (!a.name_contains || String(r.entityName).toLowerCase().includes(String(a.name_contains).toLowerCase())));
      rows.sort((x, y) => (a.sort === 'asc' ? x.val - y.val : y.val - x.val));
      const top = clamp(a.top, 1, 200, 25);
      return { taxonomy, tag: j.tag, label: j.label, period: j.ccp, unit: j.uom, reporting_companies: j.pts, matched: rows.length,
        rows: rows.slice(0, top).map((r) => ({ cik: pad10(r.cik), name: r.entityName, location: r.loc, period_start: r.start, period_end: r.end, value: r.val, accession: r.accn })) };
    },
  },
  {
    name: 'sec_search',
    description: '공시 전문(全文) 검색. ※ SEC 웹사이트 검색이 쓰는 efts 엔드포인트로, 공식 API 문서 페이지에는 올라 있지 않으니 형식이 바뀔 수 있습니다. 따옴표로 구절 검색 가능. 최대 1만 건까지만 잡히므로 forms·기간·회사로 좁히세요.',
    inputSchema: { type: 'object', properties: {
      query: { type: 'string', description: '검색어 (구절은 큰따옴표)' },
      forms: { type: 'string', description: '쉼표 구분 양식 예: "10-K,10-Q"' },
      from: { type: 'string', description: 'YYYY-MM-DD' }, to: { type: 'string', description: 'YYYY-MM-DD' },
      company: { type: 'string', description: '특정 회사로 한정(티커·CIK, 쉼표로 여러 개)' },
      offset: { type: 'integer', default: 0 }, size: { type: 'integer', default: 20, maximum: 100 },
    }, required: ['query'] },
    run: async (a) => {
      const q = String(a.query || '').trim();
      if (!q) throw new Error('query가 비었습니다.');
      const qs = new URLSearchParams({ q });
      if (a.forms) qs.set('forms', String(a.forms).split(',').map((s) => s.trim()).filter(Boolean).join(','));
      if (a.from || a.to) {
        if ((a.from && !isDate(a.from)) || (a.to && !isDate(a.to))) throw new Error('from·to는 YYYY-MM-DD');
        qs.set('dateRange', 'custom');
        qs.set('startdt', a.from || '2001-01-01');
        qs.set('enddt', a.to || new Date().toISOString().slice(0, 10));
      }
      if (a.company) {
        const ciks = [];
        for (const x of String(a.company).split(',').map((s) => s.trim()).filter(Boolean)) ciks.push((await resolveCompany(x)).cik);
        qs.set('ciks', ciks.join(','));
      }
      const off = clamp(a.offset, 0, 9900, 0);
      if (off) qs.set('from', String(off));
      const j = await secJson('https://efts.sec.gov/LATEST/search-index?' + qs.toString());
      const hits = (j.hits && j.hits.hits) || [];
      const size = clamp(a.size, 1, 100, 20);
      return { query: q, total: j.hits && j.hits.total && j.hits.total.value, offset: off, shown: Math.min(size, hits.length),
        next_offset: off + size < ((j.hits && j.hits.total && j.hits.total.value) || 0) && off + size < 10000 ? off + size : null,
        rows: hits.slice(0, size).map((h) => {
          const s = h._source || {};
          const [adsh, fname] = String(h._id || '').split(':');
          const cik0 = (s.ciks || [])[0];
          return { company: (s.display_names || []).join('; '), form: s.form, file_date: s.file_date, period_ending: s.period_ending, accession: adsh || s.adsh,
            file_type: s.file_type, file_description: s.file_description || undefined,
            url: cik0 && adsh && fname ? docUrl(cik0, adsh, fname) : undefined };
        }) };
    },
  },
  {
    name: 'sec_document',
    description: '공시 원문(10-K·10-Q·8-K 본문 등)을 태그를 지운 텍스트로 돌려줍니다. sec_filings 결과의 url을 그대로 주거나, company+accession(+document)으로 지정합니다. 길면 offset·max_chars로 나눠 읽고, find를 주면 그 단어 주변만 보여줍니다(예: "Risk Factors", "repurchase").',
    inputSchema: { type: 'object', properties: {
      url: { type: 'string', description: 'https://www.sec.gov/Archives/edgar/data/ 아래 주소 (sec_filings·sec_search 결과)' },
      company: COMPANY_ARG,
      accession: { type: 'string', description: '접수번호 0000320193-26-000026' },
      document: { type: 'string', description: '파일명(비우면 그 공시의 주 문서)' },
      offset: { type: 'integer', default: 0 },
      max_chars: { type: 'integer', default: 15000, maximum: 50000 },
      find: { type: 'string', description: '이 단어가 나오는 부분 주변(앞뒤 400자)만 최대 15곳' },
    } },
    run: async (a) => {
      let url, meta = {};
      if (a.url) url = validArchiveUrl(a.url);
      else {
        if (!a.company || !a.accession) throw new Error('url, 또는 company와 accession이 필요합니다.');
        const c = await resolveCompany(a.company);
        const accn = normAccession(a.accession);
        let doc = a.document;
        if (doc && !/^[\w.\-]+(\/[\w.\-]+)?$/.test(doc)) throw new Error('document 파일명이 잘못됨');
        if (!doc) {
          const sub = await getSubmissions(c.cik);
          let rows = rowsFromColumnar(sub.filings && sub.filings.recent);
          let hit = rows.find((r) => r.accessionNumber === accn);
          for (const f of ((sub.filings && sub.filings.files) || [])) {
            if (hit) break;
            hit = rowsFromColumnar(await secJson(`https://data.sec.gov/submissions/${f.name}`)).find((r) => r.accessionNumber === accn);
          }
          if (!hit) throw new Error('이 회사의 공시 목록에서 접수번호를 찾지 못함: ' + accn);
          if (!hit.primaryDocument) throw new Error('주 문서가 없는 공시입니다. document로 파일명을 지정하세요.');
          doc = hit.primaryDocument;
          meta = { form: hit.form, filing_date: hit.filingDate };
        }
        url = docUrl(c.cik, accn, doc);
      }
      const text = await fetchDocText(url);
      const base = Object.assign({ url, total_chars: text.length }, meta);
      if (a.find) {
        const hits = [];
        let from = 0;
        const hay = text.toLowerCase(), needle = String(a.find).toLowerCase();
        while (hits.length < 15) {
          const i = hay.indexOf(needle, from);
          if (i < 0) break;
          hits.push({ at: i, text: text.slice(Math.max(0, i - 400), i + 400) });
          from = i + needle.length;
        }
        return Object.assign(base, { find: a.find, hits });
      }
      const off = clamp(a.offset, 0, 1e9, 0), max = clamp(a.max_chars, 1, 50000, 15000);
      return Object.assign(base, { offset: off, next_offset: off + max < text.length ? off + max : null, text: text.slice(off, off + max) });
    },
  },
];

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
        serverInfo: { name: 'edgar-readonly', version: VERSION },
        instructions: 'SEC EDGAR 조회 전용(미국 상장사 공시·XBRL 재무). 회사는 티커·회사명·CIK 어느 것이나 가능. 금액은 달러. 재무는 sec_financials, 공시 목록은 sec_filings, 원문은 sec_filings → sec_document 순서. SEC 한도는 초당 10건이라 호출을 몰아서 하지 말 것.',
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
        if (text.length > MAX_OUTPUT_CHARS) text = text.slice(0, MAX_OUTPUT_CHARS) + `\n…(잘림: 전체 ${text.length}자. limit·top을 줄이거나 기간을 좁히세요)`;
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

// Desktop의 내장 Node는 래퍼를 거쳐 실행해 require.main 판정이 맞지 않으므로 항상 시작. 시험에서만 EDGAR_MCP_NO_STDIO=1로 끔
if (process.env.EDGAR_MCP_NO_STDIO !== '1') {
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

module.exports = {
  TOOLS, METRICS, dedupe, buildSeries, rowsFromColumnar, htmlToText, normAccession, docUrl, resolveCompany, validArchiveUrl, secGet, mask,
  _setFetcher: (f) => { fetcher = f; respCache.clear(); textCache.clear(); },
  _setTickers: (l) => { tickerList = l; },
};
