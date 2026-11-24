#!/usr/bin/env node
// 한국투자증권(KIS) Open API 조회 전용 MCP 서버 (외부 패키지 없음)
// - 아래 READ_ENDPOINTS 에 적힌 GET 주소만 호출합니다. 주문·정정·취소·계좌 API 는 코드에 없습니다.
// - appkey / appsecret 은 환경변수 KIS_APP_KEY / KIS_APP_SECRET 로만 받습니다 (Claude Desktop 확장은 설정 화면 입력값을 환경변수로 전달).
// - 명세 근거: 공식 저장소 koreainvestment/open-trading-api 의 examples_llm (kis_auth.py, 각 API 샘플), 2026-11-24 확인
// - 실제 호출 확인: 2026-11-24 실전 서버에서 도구 10개 조회 (값의 단위·건수·오류 형식은 그때 관찰한 것)
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');

const BASE_URL = 'https://openapi.koreainvestment.com:9443'; // 실전 도메인 고정. 다른 주소로 키가 나가지 않게 바꾸지 않습니다.
const SERVER_INFO = { name: 'kis-readonly', version: '0.1.0' };
const TOKEN_DIR = path.join(os.homedir(), '.kis-mcp');
const TIMEOUT_MS = 15_000;
const MIN_GAP_MS = 110;            // 호출 시작 간격(초당 9건쯤). 60ms 간격으로는 15번째 호출에서 EGW00201 이 났음(2026-11-24)
const ISSUE_COOLDOWN_MS = 60_000;  // 토큰 발급은 1분당 1회 (공식 README)
const RATE_RETRY_WAIT_MS = 1_000;  // 초당 건수 초과(EGW00201) 때 한 번 기다렸다 재시도

// ---------- 허용된 조회 주소 (GET 전용) ----------
// trId 는 KIS 가 API 마다 요구하는 거래 ID 입니다. 조회용만 등록합니다.
const READ_ENDPOINTS = {
  stockPrice: { path: '/uapi/domestic-stock/v1/quotations/inquire-price', trId: 'FHKST01010100' },
  stockDailyChart: { path: '/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice', trId: 'FHKST03010100' },
  stockMinuteChart: { path: '/uapi/domestic-stock/v1/quotations/inquire-time-itemchartprice', trId: 'FHKST03010200' },
  indexPrice: { path: '/uapi/domestic-stock/v1/quotations/inquire-index-price', trId: 'FHPUP02100000' },
  indexDailyChart: { path: '/uapi/domestic-stock/v1/quotations/inquire-daily-indexchartprice', trId: 'FHKUP03500100' },
  marketInvestorDaily: { path: '/uapi/domestic-stock/v1/quotations/inquire-investor-daily-by-market', trId: 'FHPTJ04040000' },
  stockInvestorDaily: { path: '/uapi/domestic-stock/v1/quotations/investor-trade-by-stock-daily', trId: 'FHPTJ04160001' },
  creditBalanceDaily: { path: '/uapi/domestic-stock/v1/quotations/daily-credit-balance', trId: 'FHPST04760000' },
  overseasPrice: { path: '/uapi/overseas-price/v1/quotations/price', trId: 'HHDFS00000300' },
  overseasDailyChart: { path: '/uapi/overseas-price/v1/quotations/inquire-daily-chartprice', trId: 'FHKST03030100' },
};

class UserError extends Error {}

const KR_CODE = /^Q?[A-Za-z0-9]{6}$/; // KRX 6자리 (예: 005930). ETN 은 앞에 Q
const MARKETS = ['J', 'NX', 'UN'];    // J=KRX, NX=넥스트레이드(NXT), UN=통합
const MARKET_NAMES = { J: 'KRX', NX: 'NXT', UN: 'KRX+NXT 통합' };
function krCode(sym) { if (!KR_CODE.test(String(sym || ''))) throw new UserError('symbol 은 6자리 종목코드여야 합니다 (예: 005930)'); return String(sym); }
function indexCode(v, dflt = '0001') { const x = v === undefined || v === null || v === '' ? dflt : String(v); if (!INDEX_CODE.test(x)) throw new UserError('업종코드는 숫자 4자리여야 합니다 (예: 0001 코스피, 1001 코스닥)'); return x; }
function countOf(v, dflt, max) { if (v === undefined || v === null || v === '') return dflt; const n = Number(v); if (!Number.isInteger(n) || n < 1 || n > max) throw new UserError(`count 는 1~${max} 사이의 정수여야 합니다`); return n; }
const head = (rows, n) => (Array.isArray(rows) ? rows.slice(0, n) : rows);
function oneOf(v, list, name, dflt) { const x = v === undefined || v === null || v === '' ? dflt : v; if (!list.includes(x)) throw new UserError(`${name} 은 ${list.join(', ')} 중 하나여야 합니다`); return x; }
const PERIODS = ['D', 'W', 'M', 'Y'];  // 일·주·월·년봉
const DEFAULT_SPAN_DAYS = { D: 60, W: 420, M: 1800, Y: 3650 }; // from 을 비웠을 때 거슬러 올라가는 일수 (한 번에 최대 100건)
const INDEX_CODE = /^\d{4}$/;         // 업종코드 4자리 (0001 코스피, 1001 코스닥, 2001 코스피200)
const OVERSEAS_EXCHANGE = /^[A-Z]{3}$/;           // 예: NAS, NYS, AMS
const OVERSEAS_SYMBOL = /^[A-Za-z0-9.\-]{1,16}$/; // 예: AAPL, BRK.B
const CHART_CODE = /^[A-Za-z0-9.@#$^=\-]{1,20}$/; // 해외지수·환율·국채 코드 (예: .DJI)
const OVERSEAS_KINDS = ['N', 'X', 'I', 'S'];      // N=해외지수, X=환율, I=국채, S=금선물

// 날짜는 YYYY-MM-DD 나 YYYYMMDD 로 받아 KIS 형식(YYYYMMDD)으로 바꿉니다. 비우면 한국 시각 기준으로 채웁니다.
const kstNow = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString(); // 한국 시각을 UTC 자리에 넣은 문자열
const kstToday = () => kstNow().slice(0, 10).replace(/-/g, '');
function addDays(yyyymmdd, n) {
  const d = new Date(Date.UTC(+yyyymmdd.slice(0, 4), +yyyymmdd.slice(4, 6) - 1, +yyyymmdd.slice(6, 8)) + n * 86_400_000);
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}
function ymd(v, name, dflt) {
  if (v === undefined || v === null || v === '') return dflt;
  const m = /^(\d{4})-?(\d{2})-?(\d{2})$/.exec(String(v).trim());
  const out = m ? m[1] + m[2] + m[3] : '';
  if (!m || addDays(out, 0) !== out) throw new UserError(`${name} 은 YYYY-MM-DD 형식의 날짜여야 합니다 (예: 2026-11-24)`);
  return out;
}
function dateRange(a, period) {
  const to = ymd(a.to, 'to', kstToday());
  const from = ymd(a.from, 'from', addDays(to, -DEFAULT_SPAN_DAYS[period]));
  if (from > to) throw new UserError('from 은 to 보다 늦을 수 없습니다');
  return { from, to };
}
function hhmmss(v) {
  if (v === undefined || v === null || v === '') return kstNow().slice(11, 19).replace(/:/g, '');
  const m = /^([01]\d|2[0-3]):?([0-5]\d):?([0-5]\d)?$/.exec(String(v).trim());
  if (!m) throw new UserError('time 은 HH:MM 또는 HHMMSS 형식이어야 합니다 (예: 10:30)');
  return m[1] + m[2] + (m[3] || '00');
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- 실행 로그 (키·토큰은 기록하지 않음) ----------
const LOG_FILE = (process.env.KIS_MCP_LOG_FILE || '').trim();
function log(...a) {
  const line = `[${new Date().toISOString()}] ` + a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ');
  try { process.stderr.write('[kis-readonly] ' + line + '\n'); } catch (_) {}
  if (LOG_FILE && !LOG_FILE.includes('${')) {
    try { fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true }); fs.appendFileSync(LOG_FILE, line + '\n'); } catch (_) {}
  }
}

// ---------- 인증 정보 ----------
function credentials() {
  const appKey = (process.env.KIS_APP_KEY || '').trim();
  const appSecret = (process.env.KIS_APP_SECRET || '').trim();
  if (!appKey || !appSecret || appKey.includes('${') || appSecret.includes('${')) {
    throw new UserError('appkey / appsecret 이 설정되지 않았습니다. 환경변수 KIS_APP_KEY, KIS_APP_SECRET을 MCP 설정의 env에 넣으세요. Claude Desktop 확장으로 설치했다면 확장 설정 화면에서 입력합니다.');
  }
  return { appKey, appSecret };
}

// 오류 문구에 키·토큰이 섞여 나가지 않게 가립니다.
function mask(s) {
  let t = String(s);
  const secrets = [(process.env.KIS_APP_KEY || '').trim(), (process.env.KIS_APP_SECRET || '').trim(), memToken && memToken.accessToken];
  for (const x of secrets) if (x && x.length >= 4) t = t.split(x).join('***');
  return t;
}

// ---------- 토큰 ----------
// KIS 토큰은 유효 1일이고, 발급할 때마다 알림톡이 가며 1분당 1회만 발급됩니다.
// 그래서 발급한 토큰을 파일(권한 600)에 저장해 두고 만료 전까지 다시 씁니다.
function tokenFile(appKey) {
  const h = crypto.createHash('sha256').update(appKey).digest('hex').slice(0, 16);
  return path.join(TOKEN_DIR, `token-${h}.json`);
}
let memToken = null;   // { accessToken, expiresAt, issuedAt }
let issuing = null;    // 동시에 여러 번 발급하지 않도록 진행 중인 발급을 공유

function loadToken(appKey) {
  if (memToken) return memToken;
  try {
    const t = JSON.parse(fs.readFileSync(tokenFile(appKey), 'utf8'));
    if (t && typeof t.accessToken === 'string' && Number.isFinite(t.expiresAt)) { memToken = t; return t; }
  } catch (_) { /* 없음 */ }
  return null;
}

function saveToken(appKey, t) {
  memToken = t;
  try {
    fs.mkdirSync(TOKEN_DIR, { recursive: true, mode: 0o700 });
    fs.writeFileSync(tokenFile(appKey), JSON.stringify(t), { mode: 0o600 });
  } catch (_) { /* 저장 실패해도 메모리 토큰으로 계속 */ }
}

// 응답의 access_token_token_expired 는 한국 시각 "YYYY-MM-DD HH:MM:SS" 입니다.
function expiryOf(j, now) {
  const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})$/.exec(String(j.access_token_token_expired || ''));
  if (m) { const ms = Date.parse(`${m[1]}T${m[2]}+09:00`); if (Number.isFinite(ms) && ms > now) return ms; }
  const sec = Number(j.expires_in);
  return now + (Number.isFinite(sec) && sec > 0 ? sec : 86_400) * 1000;
}

async function issueToken(appKey, appSecret) {
  const res = await fetch(BASE_URL + '/oauth2/tokenP', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/plain', charset: 'UTF-8' },
    body: JSON.stringify({ grant_type: 'client_credentials', appkey: appKey, appsecret: appSecret }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await res.text();
  let j; try { j = JSON.parse(text); } catch (_) { j = null; }
  if (!res.ok || !j || !j.access_token) {
    const code = (j && (j.error_code || j.msg_cd)) || `HTTP ${res.status}`;
    const desc = (j && (j.error_description || j.msg1)) || '';
    throw new UserError(mask(`토큰 발급 실패: ${code}${desc ? ' - ' + desc : ''} (KIS_APP_KEY / KIS_APP_SECRET 값이 실전투자용인지, 1분 안에 다시 발급을 요청하지 않았는지 확인하세요)`));
  }
  const now = Date.now();
  const t = { accessToken: j.access_token, expiresAt: expiryOf(j, now), issuedAt: now };
  saveToken(appKey, t);
  log('token issued, expiresAt', new Date(t.expiresAt).toISOString());
  return t.accessToken;
}

async function getToken(force = false) {
  const { appKey, appSecret } = credentials();
  const cached = loadToken(appKey);
  if (!force && cached && cached.expiresAt - 60_000 > Date.now()) return cached.accessToken;
  if (issuing) return issuing;
  if (cached && Date.now() - (cached.issuedAt || 0) < ISSUE_COOLDOWN_MS) {
    throw new UserError('방금 발급한 접근토큰이 거부되었습니다. KIS는 토큰을 1분당 1회만 발급하므로 1분 뒤 다시 시도하세요.');
  }
  issuing = issueToken(appKey, appSecret).finally(() => { issuing = null; });
  return issuing;
}

// ---------- 호출 간격 ----------
let gate = Promise.resolve();
let lastStart = 0;
function takeTurn() {
  const p = gate.then(async () => {
    const wait = lastStart + MIN_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastStart = Date.now();
  });
  gate = p.catch(() => {});
  return p;
}

// ---------- 조회 ----------
// KIS 는 HTTP 200 이어도 본문의 rt_cd 가 "0" 이 아니면 실패입니다 (예: 잘못된 거래소코드 → 200 + OPSQ2001).
// 초당 건수 초과는 HTTP 500 + msg_cd EGW00201 로 옵니다.
async function apiGet(endpoint, query = {}, trCont = '') {
  if (!Object.values(READ_ENDPOINTS).includes(endpoint)) throw new Error('허용되지 않은 주소');
  const { appKey, appSecret } = credentials();
  const url = new URL(BASE_URL + endpoint.path);
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  let reissued = false; let waited = false;
  for (;;) {
    const token = await getToken(reissued);
    await takeTurn();
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json', Accept: 'text/plain', charset: 'UTF-8',
        authorization: `Bearer ${token}`, appkey: appKey, appsecret: appSecret,
        tr_id: endpoint.trId, custtype: 'P', tr_cont: trCont,
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await res.text();
    let j; try { j = JSON.parse(text); } catch (_) { j = null; }
    const code = (j && (j.msg_cd || j.error_code)) || '';
    if ((res.status === 401 || code === 'EGW00123') && !reissued) { reissued = true; continue; } // 토큰 만료 → 한 번만 재발급
    if (code === 'EGW00201' && !waited) { waited = true; await sleep(RATE_RETRY_WAIT_MS); continue; } // 초당 건수 초과 → 한 번만 재시도
    if (!res.ok || !j || String(j.rt_cd) !== '0') {
      const msg = (j && (j.msg1 || j.error_description)) || (j ? '' : text.slice(0, 200));
      let hint = '';
      if (code === 'EGW00201') hint = ' (초당 호출 한도 초과. 잠시 뒤 다시 시도)';
      if (code === 'EGW00123') hint = ' (접근토큰 만료. 1분 뒤 다시 시도)';
      throw new UserError(mask(`KIS 오류: HTTP ${res.status} ${code} ${String(msg).trim()}${hint} tr_id=${endpoint.trId}`.replace(/\s+/g, ' ').trim()));
    }
    return { body: j, trCont: (res.headers.get('tr_cont') || '').trim() };
  }
}

// ---------- 도구 ----------
const TOOLS = [
  {
    name: 'kis_stock_price',
    description: '국내 종목(ETF 포함) 현재가 시세. market 으로 거래소를 고름: J=KRX(기본), NX=넥스트레이드(NXT), UN=KRX+NXT 통합. 실시간 체결 스트림이 아니라 조회 시점 값. ⚠ J 도 15:30 이후에는 현재가가 계속 바뀌므로(시간외 반영) 장 마감 뒤의 stck_prpr 을 KRX 정규장 공식 종가로 쓰지 말 것. 전일 공식 종가는 stck_sdpr(기준가). 거래량·거래대금은 고른 거래소 것만 집계. 주요 항목: stck_prpr 현재가, prdy_vrss 전일대비, prdy_ctrt 등락률(%), stck_oprc·stck_hgpr·stck_lwpr 시가·고가·저가, acml_vol 누적거래량, acml_tr_pbmn 누적거래대금(원). 값은 KIS 원본 그대로 반환.',
    inputSchema: { type: 'object', properties: {
      symbol: { type: 'string', description: 'KRX 6자리 종목코드 (예: 005930). ETN 은 앞에 Q' },
      market: { type: 'string', enum: MARKETS, default: 'J', description: 'J=KRX, NX=NXT, UN=통합' },
    }, required: ['symbol'] },
    async run(a) {
      const symbol = krCode(a.symbol);
      const market = oneOf(a.market, MARKETS, 'market', 'J');
      const r = await apiGet(READ_ENDPOINTS.stockPrice, { FID_COND_MRKT_DIV_CODE: market, FID_INPUT_ISCD: symbol });
      const o = r.body.output || {};
      if (String(o.stck_prpr) === '0' && String(o.lstn_stcn) === '0') throw new UserError(`종목코드 ${symbol} 의 시세가 없습니다. 코드를 확인하세요 (KIS 는 없는 종목에도 0 으로 채운 정상 응답을 줌)`);
      return { symbol, market, 거래소: MARKET_NAMES[market], output: r.body.output };
    },
  },
  {
    name: 'kis_stock_daily_chart',
    description: '국내 종목 기간별 시세(일·주·월·년봉, 최신순). 한 번에 최대 100건이며 기간이 더 길면 to 쪽 최근 100건만 오므로 from·to 를 나눠 조회. market J=KRX(기본)의 지난 영업일 종가는 KRX 정규장 공식 종가, NX·UN 의 종가는 NXT 애프터마켓 마지막 체결가(2026-11-24 확인). ⚠ 당일 행은 J 도 15:30 이후 값이 바뀌므로 당일 공식 종가로 쓰지 말 것. output1 은 종목 현재 요약, output2 가 봉 목록(stck_bsop_date 영업일, stck_oprc·stck_hgpr·stck_lwpr·stck_clpr 시가·고가·저가·종가, acml_vol 거래량, acml_tr_pbmn 거래대금).',
    inputSchema: { type: 'object', properties: {
      symbol: { type: 'string', description: 'KRX 6자리 종목코드 (예: 005930)' },
      market: { type: 'string', enum: MARKETS, default: 'J', description: 'J=KRX, NX=NXT, UN=통합' },
      period: { type: 'string', enum: PERIODS, default: 'D', description: 'D=일봉, W=주봉, M=월봉, Y=년봉' },
      from: { type: 'string', description: '시작일 YYYY-MM-DD. 생략하면 to 에서 기간에 맞춰 거슬러 올라감(일봉 60일)' },
      to: { type: 'string', description: '종료일 YYYY-MM-DD. 생략하면 오늘(한국 시각)' },
      adjusted: { type: 'boolean', default: true, description: 'true=수정주가, false=원주가' },
    }, required: ['symbol'] },
    async run(a) {
      const symbol = krCode(a.symbol);
      const market = oneOf(a.market, MARKETS, 'market', 'J');
      const period = oneOf(a.period, PERIODS, 'period', 'D');
      const { from, to } = dateRange(a, period);
      const r = await apiGet(READ_ENDPOINTS.stockDailyChart, { FID_COND_MRKT_DIV_CODE: market, FID_INPUT_ISCD: symbol,
        FID_INPUT_DATE_1: from, FID_INPUT_DATE_2: to, FID_PERIOD_DIV_CODE: period, FID_ORG_ADJ_PRC: a.adjusted === false ? '1' : '0' });
      return { symbol, market, 거래소: MARKET_NAMES[market], period, from, to, 수정주가: a.adjusted !== false, output1: r.body.output1, output2: r.body.output2 };
    },
  },
  {
    name: 'kis_stock_minute_chart',
    description: '국내 종목 당일 분봉(최신순). time 시각부터 과거 방향으로 한 번에 최대 30건이며, 더 과거는 time 을 옮겨 다시 조회. J 의 15:30 봉 stck_prpr 이 정규장 종가 동시호가 체결가. J 도 15:30 이후 봉이 계속 나옴. 당일 자료만 제공(전일 분봉 없음). time 에 미래 시각을 넣으면 현재가 기준으로 조회됨. output2 첫 행의 체결량(cntg_vol)은 그 분의 첫 체결 전까지 직전 분 값이 표시됨.',
    inputSchema: { type: 'object', properties: {
      symbol: { type: 'string', description: 'KRX 6자리 종목코드 (예: 005930)' },
      market: { type: 'string', enum: MARKETS, default: 'J', description: 'J=KRX, NX=NXT, UN=통합' },
      time: { type: 'string', description: '기준 시각 HH:MM 또는 HHMMSS (한국 시각). 생략하면 현재' },
      include_past: { type: 'boolean', default: true, description: 'KIS 의 "과거 데이터 포함 여부" 값. 장 마감 후 조회에서는 true·false 결과가 같았음' },
    }, required: ['symbol'] },
    async run(a) {
      const symbol = krCode(a.symbol);
      const market = oneOf(a.market, MARKETS, 'market', 'J');
      const time = hhmmss(a.time);
      const r = await apiGet(READ_ENDPOINTS.stockMinuteChart, { FID_COND_MRKT_DIV_CODE: market, FID_INPUT_ISCD: symbol,
        FID_INPUT_HOUR_1: time, FID_PW_DATA_INCU_YN: a.include_past === false ? 'N' : 'Y', FID_ETC_CLS_CODE: '' });
      return { symbol, market, 거래소: MARKET_NAMES[market], time, output1: r.body.output1, output2: r.body.output2 };
    },
  },
  {
    name: 'kis_index_price',
    description: '국내 업종지수 현재값(조회 시점 값). 거래량 acml_vol 은 천주, 거래대금 acml_tr_pbmn 은 백만원 단위. 상승·하락 종목 수(ascn_issu_cnt·down_issu_cnt) 포함. index 는 업종코드 4자리: 0001 코스피, 1001 코스닥, 2001 코스피200. 그 밖의 업종코드는 KIS 포털의 종목정보 파일(업종코드) 참조.',
    inputSchema: { type: 'object', properties: {
      index: { type: 'string', default: '0001', description: '업종코드 4자리 (0001 코스피, 1001 코스닥, 2001 코스피200)' },
    } },
    async run(a) {
      const index = indexCode(a.index);
      const r = await apiGet(READ_ENDPOINTS.indexPrice, { FID_COND_MRKT_DIV_CODE: 'U', FID_INPUT_ISCD: index });
      return { index, output: r.body.output };
    },
  },
  {
    name: 'kis_index_daily_chart',
    description: '국내 업종지수 기간별 시세(일·주·월·년봉, 최신순). 한 번에 최대 50건이며 기간이 더 길면 to 쪽 최근 50건만 옴. index 는 업종코드 4자리(0001 코스피, 1001 코스닥, 2001 코스피200). output1 은 지수 현재 요약, output2 가 봉 목록.',
    inputSchema: { type: 'object', properties: {
      index: { type: 'string', default: '0001', description: '업종코드 4자리' },
      period: { type: 'string', enum: PERIODS, default: 'D', description: 'D=일봉, W=주봉, M=월봉, Y=년봉' },
      from: { type: 'string', description: '시작일 YYYY-MM-DD. 생략하면 to 에서 기간에 맞춰 거슬러 올라감(일봉 60일)' },
      to: { type: 'string', description: '종료일 YYYY-MM-DD. 생략하면 오늘(한국 시각)' },
    } },
    async run(a) {
      const index = indexCode(a.index);
      const period = oneOf(a.period, PERIODS, 'period', 'D');
      const { from, to } = dateRange(a, period);
      const r = await apiGet(READ_ENDPOINTS.indexDailyChart, { FID_COND_MRKT_DIV_CODE: 'U', FID_INPUT_ISCD: index,
        FID_INPUT_DATE_1: from, FID_INPUT_DATE_2: to, FID_PERIOD_DIV_CODE: period });
      return { index, period, from, to, output1: r.body.output1, output2: r.body.output2 };
    },
  },
  {
    name: 'kis_market_investor_daily',
    description: '코스피·코스닥 시장(또는 그 안의 업종)의 일별 투자자별 순매수(최신순). 한국투자 HTS [0404] 시장별 일별동향과 같은 자료. 이 API 는 거래소(KRX·NXT) 구분 인자가 없어 한 가지 기준으로만 나오며, 값은 KRX+NXT 통합 기준인 토스보다 작음(KRX 단독으로 추정, 공식 확인 아님). date 부터 과거 방향으로 count 건(휴장일이면 직전 영업일부터). 단위: *_ntby_qty 수량은 천주, *_tr_pbmn·*_pbmn 금액은 백만원(÷100 = 억원). 주체: frgn 외국인, prsn 개인, orgn 기관계, scrt 금융투자, ivtr 투신, pe_fund 사모, bank 은행, insu 보험, mrbn 종금, fund 기금, etc 기타(etc_corp 기타법인). 당일 행은 장중 잠정치. sector 를 주면 해당 업종만.',
    inputSchema: { type: 'object', properties: {
      market: { type: 'string', enum: ['KOSPI', 'KOSDAQ'] },
      date: { type: 'string', description: '기준일 YYYY-MM-DD. 생략하면 오늘(한국 시각)' },
      sector: { type: 'string', description: '업종코드 4자리. 생략하면 시장 전체(코스피 0001, 코스닥 1001)' },
      count: { type: 'integer', minimum: 1, maximum: 300, default: 5, description: '돌려줄 일수 (KIS 는 한 번에 300일치를 줌)' },
    }, required: ['market'] },
    async run(a) {
      const market = oneOf(a.market, ['KOSPI', 'KOSDAQ'], 'market');
      const date = ymd(a.date, 'date', kstToday());
      const sector = indexCode(a.sector, market === 'KOSPI' ? '0001' : '1001');
      const count = countOf(a.count, 5, 300);
      const r = await apiGet(READ_ENDPOINTS.marketInvestorDaily, { FID_COND_MRKT_DIV_CODE: 'U', FID_INPUT_ISCD: sector, FID_INPUT_DATE_1: date,
        FID_INPUT_ISCD_1: market === 'KOSPI' ? 'KSP' : 'KSQ', FID_INPUT_DATE_2: date, FID_INPUT_ISCD_2: sector });
      return { market, sector, date, 단위: { 수량: '천주', 금액: '백만원' }, output: head(r.body.output, count) };
    },
  },
  {
    name: 'kis_stock_investor_daily',
    description: '국내 종목의 일별 투자자별 매매동향(최신순). market 으로 거래소별 수급을 나눠 볼 수 있음: J(KRX)와 NX(NXT)의 수량·금액을 더하면 UN(통합)과 정확히 일치(2026-11-24 확인). date 부터 과거 방향으로 count 건(KIS 는 한 번에 30건). 단위: *_qty·*_vol 수량은 주, *_pbmn 금액은 백만원. 주체 약어는 kis_market_investor_daily 와 같음(frgn 외국인, prsn 개인, orgn 기관계 …). 순매수 외에 주체별 매도·매수(seln·shnu)도 포함. output1 은 종목 요약, output2 가 일별 목록.',
    inputSchema: { type: 'object', properties: {
      symbol: { type: 'string', description: 'KRX 6자리 종목코드 (예: 005930)' },
      market: { type: 'string', enum: MARKETS, default: 'J', description: 'J=KRX, NX=NXT, UN=통합' },
      date: { type: 'string', description: '기준일 YYYY-MM-DD. 생략하면 오늘(한국 시각)' },
      count: { type: 'integer', minimum: 1, maximum: 30, default: 5 },
    }, required: ['symbol'] },
    async run(a) {
      const symbol = krCode(a.symbol);
      const market = oneOf(a.market, MARKETS, 'market', 'J');
      const date = ymd(a.date, 'date', kstToday());
      const count = countOf(a.count, 5, 30);
      const r = await apiGet(READ_ENDPOINTS.stockInvestorDaily, { FID_COND_MRKT_DIV_CODE: market, FID_INPUT_ISCD: symbol,
        FID_INPUT_DATE_1: date, FID_ORG_ADJ_PRC: '', FID_ETC_CLS_CODE: '' });
      return { symbol, market, 거래소: MARKET_NAMES[market], date, 단위: { 수량: '주', 금액: '백만원' }, output1: r.body.output1, output2: head(r.body.output2, count) };
    },
  },
  {
    name: 'kis_credit_balance_daily',
    description: '국내 종목 신용잔고 일별 추이(최신순). date(결제일자)부터 과거 방향으로 count 건(KIS 는 한 번에 30건)이며, 더 과거는 date 를 옮겨 다시 조회. 결제 기준이라 최신 행은 2영업일 전 매매분(deal_date 매매일, stlm_date 결제일). whol_loan_* 융자, whol_stln_* 대주, rmnd 잔고, new 신규, rdmp 상환(매도상환+현금상환).',
    inputSchema: { type: 'object', properties: {
      symbol: { type: 'string', description: 'KRX 6자리 종목코드 (예: 005930)' },
      date: { type: 'string', description: '결제일자 YYYY-MM-DD. 생략하면 오늘(한국 시각)' },
      count: { type: 'integer', minimum: 1, maximum: 30, default: 10 },
    }, required: ['symbol'] },
    async run(a) {
      const symbol = krCode(a.symbol);
      const date = ymd(a.date, 'date', kstToday());
      const count = countOf(a.count, 10, 30);
      const r = await apiGet(READ_ENDPOINTS.creditBalanceDaily, { FID_COND_MRKT_DIV_CODE: 'J', FID_COND_SCR_DIV_CODE: '20476', FID_INPUT_ISCD: symbol, FID_INPUT_DATE_1: date });
      return { symbol, date, output: head(r.body.output, count) };
    },
  },
  {
    name: 'kis_overseas_price',
    description: '해외 종목 현재체결가. exchange 는 KIS 거래소코드 3자리(NAS 나스닥, NYS 뉴욕, AMS 아멕스 확인. 예: AAPL=NAS, KO=NYS, EWY=AMS), symbol 은 현지 티커. 거래소코드가 틀리면 오류. 주요 항목: last 현재가, base 전일종가, diff·rate 대비·등락률, tvol 거래량, pvol 전일거래량.',
    inputSchema: { type: 'object', properties: {
      exchange: { type: 'string', description: '거래소코드 3자리 (예: NAS, NYS, AMS)' },
      symbol: { type: 'string', description: '티커 (예: AAPL)' },
    }, required: ['exchange', 'symbol'] },
    async run(a) {
      const exchange = String(a.exchange || '').trim().toUpperCase();
      if (!OVERSEAS_EXCHANGE.test(exchange)) throw new UserError('exchange 는 거래소코드 3자리여야 합니다 (예: NAS, NYS, AMS)');
      const symbol = String(a.symbol || '').trim().toUpperCase();
      if (!OVERSEAS_SYMBOL.test(symbol)) throw new UserError('허용되지 않는 심볼: ' + a.symbol);
      const r = await apiGet(READ_ENDPOINTS.overseasPrice, { AUTH: '', EXCD: exchange, SYMB: symbol });
      return { exchange, symbol, output: r.body.output };
    },
  },
  {
    name: 'kis_overseas_daily_chart',
    description: '해외지수·환율·국채·금선물 기간별 시세(일·주·월·년봉). kind N=해외지수, X=환율, I=국채, S=금선물. code 는 KIS 해외 마스터 코드(확인된 예: 다우 N + .DJI, 원/달러 X + FX@KRW)이며 그 밖의 코드는 KIS 포털의 종목정보 파일(해외지수)에서 확인. 최신순이며 output1 현재 요약은 0 으로 올 때가 있음. 미국 개별 주식은 다우30·나스닥100·S&P500 종목만 조회됨. output1 은 현재 요약, output2 가 봉 목록.',
    inputSchema: { type: 'object', properties: {
      kind: { type: 'string', enum: OVERSEAS_KINDS, description: 'N=해외지수, X=환율, I=국채, S=금선물' },
      code: { type: 'string', description: 'KIS 해외 마스터 코드 (예: .DJI, FX@KRW)' },
      period: { type: 'string', enum: PERIODS, default: 'D', description: 'D=일, W=주, M=월, Y=년' },
      from: { type: 'string', description: '시작일 YYYY-MM-DD. 생략하면 to 에서 기간에 맞춰 거슬러 올라감(일봉 60일)' },
      to: { type: 'string', description: '종료일 YYYY-MM-DD. 생략하면 오늘(한국 시각)' },
    }, required: ['kind', 'code'] },
    async run(a) {
      const kind = oneOf(a.kind, OVERSEAS_KINDS, 'kind');
      const code = String(a.code || '').trim();
      if (!CHART_CODE.test(code)) throw new UserError('허용되지 않는 코드: ' + a.code);
      const period = oneOf(a.period, PERIODS, 'period', 'D');
      const { from, to } = dateRange(a, period);
      const r = await apiGet(READ_ENDPOINTS.overseasDailyChart, { FID_COND_MRKT_DIV_CODE: kind, FID_INPUT_ISCD: code,
        FID_INPUT_DATE_1: from, FID_INPUT_DATE_2: to, FID_PERIOD_DIV_CODE: period });
      return { kind, code, period, from, to, output1: r.body.output1, output2: r.body.output2 };
    },
  },
];

// ---------- MCP (stdio, JSON-RPC 2.0) ----------
const SUPPORTED_PROTOCOLS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

async function handle(msg) {
  const { id, method, params } = msg;
  if (method === 'initialize') {
    const req = params && params.protocolVersion;
    return { protocolVersion: SUPPORTED_PROTOCOLS.includes(req) ? req : SUPPORTED_PROTOCOLS[0], capabilities: { tools: {} }, serverInfo: SERVER_INFO,
      instructions: '한국투자증권 Open API 조회 전용 서버입니다. 주문·계좌 기능은 없습니다. 국내 종목은 market 으로 거래소를 고릅니다(J=KRX 단독, NX=NXT, UN=통합). 지난 영업일의 KRX 정규장 공식 종가는 kis_stock_daily_chart 의 J 를 쓰세요. 당일 값은 J 도 15:30 이후 바뀝니다. 응답 값은 KIS 원본 항목명 그대로이고 숫자는 문자열입니다.' };
  }
  if (method === 'ping') return {};
  if (method === 'tools/list') return { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema, annotations: { readOnlyHint: true, openWorldHint: true } })) };
  if (method === 'tools/call') {
    const tool = TOOLS.find((t) => t.name === (params && params.name));
    if (!tool) return { content: [{ type: 'text', text: `알 수 없는 도구: ${params && params.name}` }], isError: true };
    try {
      const out = await tool.run((params && params.arguments) || {});
      return { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] };
    } catch (e) {
      const text = e instanceof UserError ? e.message : mask(`오류: ${e && e.name === 'TimeoutError' ? '응답 시간 초과(15초)' : (e && e.message) || e}`);
      log('tool error', tool.name, text);
      return { content: [{ type: 'text', text }], isError: true };
    }
  }
  if (id === undefined) return undefined; // 알림
  const err = new Error(`Method not found: ${method}`); err.code = -32601; throw err;
}

function main() {
  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  const send = (o) => process.stdout.write(JSON.stringify(o) + '\n');
  rl.on('line', async (line) => {
    if (!line.trim()) return;
    let msg; try { msg = JSON.parse(line); } catch (_) { send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); return; }
    log('recv', msg.method || '(response)', msg.method === 'tools/call' ? (msg.params && msg.params.name) : '');
    if (msg.id === undefined || msg.id === null) { if (msg.method) handle(msg).catch(() => {}); return; }
    try { const result = await handle(msg); send({ jsonrpc: '2.0', id: msg.id, result }); }
    catch (e) { log('error', msg.method, e.message); send({ jsonrpc: '2.0', id: msg.id, error: { code: e.code || -32603, message: e.message } }); }
  });
  rl.on('close', () => { log('stdin closed, exit'); process.exit(0); });
  log(`started v${SERVER_INFO.version} node=${process.version} 조회 전용 base=${BASE_URL} creds=${process.env.KIS_APP_KEY ? 'set' : 'missing'}`);
}

// Desktop 이 이 파일을 감싸서 실행해도 서버가 켜지도록 항상 시작합니다(테스트에서만 끔).
if (process.env.KIS_MCP_NO_MAIN !== '1') main();
module.exports = { handle, TOOLS, READ_ENDPOINTS, BASE_URL, expiryOf, mask, ymd, addDays, hhmmss, _forgetMemToken() { memToken = null; } };
