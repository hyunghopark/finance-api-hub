#!/usr/bin/env node
// 토스증권 Open API 조회 전용 MCP 서버 (외부 패키지 없음)
// - 아래 READ_ENDPOINTS 에 적힌 GET 주소만 호출합니다. 주문·정정·취소·계좌 API 는 코드에 없습니다.
// - client_id / client_secret 은 환경변수 TOSS_CLIENT_ID / TOSS_CLIENT_SECRET 로만 받습니다 (Claude Desktop 확장은 설정 화면 입력값을 환경변수로 전달).
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');

const BASE_URL = 'https://openapi.tossinvest.com'; // 고정. 다른 주소로 키가 나가지 않게 바꾸지 않습니다.
const SERVER_INFO = { name: 'toss-readonly', version: '0.2.1' };
const TOKEN_DIR = path.join(os.homedir(), '.toss-mcp');

// ---------- 허용된 조회 주소 (GET 전용) ----------
const READ_ENDPOINTS = {
  marketInvestorTrading: (symbol) => `/api/v1/market-indicators/${symbol}/investor-trading`,
  marketIndicatorPrices: () => '/api/v1/market-indicators/prices',
  marketIndicatorCandles: (symbol) => `/api/v1/market-indicators/${symbol}/candles`,
  investorTradingRankings: () => '/api/v1/rankings/investor-trading',
  stockInvestorTrading: (symbol) => `/api/v1/stocks/${symbol}/investor-trading`,
  exchangeRate: () => '/api/v1/exchange-rate',
  krMarketCalendar: () => '/api/v1/market-calendar/KR',
  stockShortSelling: (symbol) => `/api/v1/stocks/${symbol}/short-selling`,
  stockProgramTrades: (symbol) => `/api/v1/stocks/${symbol}/program-trades`,
  sectorRankings: () => '/api/v1/sectors/rankings',
  stockRankings: () => '/api/v1/rankings',
  stockPrices: () => '/api/v1/prices',
  stockCandles: () => '/api/v1/candles',
};

const KR_CODE = /^[A-Za-z0-9]{6}$/;           // KRX 6자리 (예: 005930, 0101N0)
const ANY_SYMBOL = /^[A-Za-z0-9.\-]{1,20}$/; // KRX 코드 또는 미국 티커 (예: AAPL, BRK.B)
function krCode(sym) { if (!KR_CODE.test(String(sym || ''))) throw new UserError('symbol 은 6자리 종목코드여야 합니다 (예: 005930)'); return sym; }
function oneOf(v, list, name, dflt) { const x = v === undefined || v === null || v === '' ? dflt : v; if (!list.includes(x)) throw new UserError(`${name} 은 ${list.join(', ')} 중 하나여야 합니다`); return x; }

const INDICATOR_SYMBOLS = ['KOSPI', 'KOSDAQ', 'KR_BOND_2Y', 'KR_BOND_3Y', 'KR_BOND_5Y', 'KR_BOND_10Y', 'KR_BOND_20Y', 'KR_BOND_30Y'];

// ---------- 실행 로그 (키·토큰은 기록하지 않음) ----------
const LOG_FILE = (process.env.TOSS_MCP_LOG_FILE || '').trim();
function log(...a) {
  const line = `[${new Date().toISOString()}] ` + a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ');
  try { process.stderr.write('[toss-readonly] ' + line + '\n'); } catch (_) {}
  if (LOG_FILE && !LOG_FILE.includes('${')) {
    try { fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true }); fs.appendFileSync(LOG_FILE, line + '\n'); } catch (_) {}
  }
}

// ---------- 토큰 ----------
// 토스는 client 당 유효 토큰이 1개이고 재발급하면 이전 토큰이 바로 무효가 됩니다.
// 그래서 발급한 토큰을 파일(권한 600)에 저장해 두고 만료 전까지 다시 씁니다.
function tokenFile(clientId) {
  const h = crypto.createHash('sha256').update(clientId).digest('hex').slice(0, 16);
  return path.join(TOKEN_DIR, `token-${h}.json`);
}
let memToken = null;

function readCachedToken(clientId) {
  if (memToken && memToken.expiresAt - 60_000 > Date.now()) return memToken.accessToken;
  try {
    const t = JSON.parse(fs.readFileSync(tokenFile(clientId), 'utf8'));
    if (t.expiresAt - 60_000 > Date.now()) { memToken = t; return t.accessToken; }
  } catch (_) { /* 없음 */ }
  return null;
}

function saveToken(clientId, t) {
  memToken = t;
  try {
    fs.mkdirSync(TOKEN_DIR, { recursive: true, mode: 0o700 });
    fs.writeFileSync(tokenFile(clientId), JSON.stringify(t), { mode: 0o600 });
  } catch (_) { /* 저장 실패해도 메모리 토큰으로 계속 */ }
}

function credentials() {
  const clientId = (process.env.TOSS_CLIENT_ID || '').trim();
  const clientSecret = (process.env.TOSS_CLIENT_SECRET || '').trim();
  if (!clientId || !clientSecret) {
    throw new UserError('client_id / client_secret 이 설정되지 않았습니다. 환경변수 TOSS_CLIENT_ID, TOSS_CLIENT_SECRET을 MCP 설정의 env에 넣으세요. Claude Desktop 확장으로 설치했다면 확장 설정 화면에서 입력합니다.');
  }
  return { clientId, clientSecret };
}

async function issueToken(clientId, clientSecret) {
  const body = new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret });
  const res = await fetch(BASE_URL + '/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body,
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  let j; try { j = JSON.parse(text); } catch (_) { j = null; }
  if (!res.ok || !j || !j.access_token) {
    const code = j && j.error ? j.error : `HTTP ${res.status}`;
    let hint = '';
    if (res.status === 403) hint = ' (허용 IP 목록에 지금 이 PC의 공인 IP가 있는지 확인하세요)';
    if (code === 'invalid_client') hint = ' (client_id / client_secret 값을 다시 확인하세요)';
    throw new UserError(`토큰 발급 실패: ${code}${j && j.error_description ? ' - ' + j.error_description : ''}${hint}`);
  }
  const t = { accessToken: j.access_token, expiresAt: Date.now() + (Number(j.expires_in) || 3600) * 1000 };
  saveToken(clientId, t);
  return t.accessToken;
}

async function getToken(force = false) {
  const { clientId, clientSecret } = credentials();
  if (!force) { const c = readCachedToken(clientId); if (c) return c; }
  return issueToken(clientId, clientSecret);
}

// ---------- 조회 ----------
class UserError extends Error {}

async function apiGet(pathname, query = {}) {
  const url = new URL(BASE_URL + pathname);
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  let retried = false;
  for (;;) {
    const token = await getToken(retried);
    const res = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text();
    let j; try { j = JSON.parse(text); } catch (_) { j = null; }
    if (res.status === 401 && !retried) { retried = true; continue; } // 토큰 무효 → 한 번만 재발급
    if (!res.ok) {
      const e = j && j.error ? j.error : {};
      let hint = '';
      if (res.status === 403) hint = ' (허용 IP 목록 확인 필요)';
      if (res.status === 429) hint = ` (호출 한도 초과. 잠시 뒤 다시 시도. limit=${res.headers.get('x-ratelimit-limit')}, remaining=${res.headers.get('x-ratelimit-remaining')})`;
      throw new UserError(`HTTP ${res.status} ${e.code || ''} ${e.message || ''}${hint} requestId=${e.requestId || res.headers.get('x-request-id') || '-'}`.trim());
    }
    return j && 'result' in j ? j.result : j;
  }
}

// ---------- 계산 도우미 ----------
const EOK = 100_000_000n; // 1억원
function toBig(s) { try { return BigInt(String(s)); } catch (_) { return null; } }
function eok(n) { // 원(BigInt) → 억원(소수 1자리 반올림, Number)
  if (n === null) return null;
  const neg = n < 0n; const a = neg ? -n : n;
  const tenths = (a * 10n + EOK / 2n) / EOK;
  const v = Number(tenths) / 10;
  return neg ? -v : v;
}
function net(x) { if (!x) return null; const b = toBig(x.buyAmount), s = toBig(x.sellAmount); return b === null || s === null ? null : b - s; }

function summarizeMarketRecord(r) {
  const groups = { 개인: r.individual, 외국인: r.foreigner, 기관: r.institution, 기타법인: r.otherCorporation };
  const out = { date: r.date, updatedAt: r.updatedAt, 순매수_억원: {}, 기관세부_순매수_억원: {} };
  let sum = 0n; let ok = true;
  for (const [k, v] of Object.entries(groups)) { const n = net(v); out.순매수_억원[k] = eok(n); if (n === null) ok = false; else sum += n; }
  out.네주체합_억원 = ok ? eok(sum) : null; // 시장 전체 매수합 = 매도합이므로 0 이어야 정상
  const names = { financialInvestment: '금융투자', insurance: '보험', trust: '투신', privateEquityFund: '사모펀드', bank: '은행', otherFinancialInstitution: '기타금융', pensionFund: '연기금' };
  const bd = (r.institution && r.institution.breakdown) || {};
  for (const [k, ko] of Object.entries(names)) out.기관세부_순매수_억원[ko] = eok(net(bd[k]));
  return out;
}

// ---------- 도구 ----------
const TOOLS = [
  {
    name: 'toss_market_investor_trading',
    description: '코스피·코스닥 시장 전체의 투자자별(개인·외국인·기관·기타법인) 매매대금. 순매수 억원 요약과 원본을 함께 반환. 당일 기록은 잠정치이며 updatedAt 으로 갱신 시각 확인.',
    inputSchema: { type: 'object', properties: {
      market: { type: 'string', enum: ['KOSPI', 'KOSDAQ'] },
      interval: { type: 'string', enum: ['1d', '1w', '1mo', '1y'], default: '1d' },
      count: { type: 'integer', minimum: 1, maximum: 100, default: 5 },
      until: { type: 'string', description: 'YYYY-MM-DD (포함). 생략하면 최신부터' },
      include_raw: { type: 'boolean', default: false },
    }, required: ['market'] },
    async run(a) {
      if (!['KOSPI', 'KOSDAQ'].includes(a.market)) throw new UserError('market 은 KOSPI 또는 KOSDAQ 이어야 합니다');
      const r = await apiGet(READ_ENDPOINTS.marketInvestorTrading(a.market), { interval: a.interval || '1d', count: a.count || 5, until: a.until });
      const records = (r && r.records) || [];
      const res = { market: a.market, interval: a.interval || '1d', nextUntil: r && r.nextUntil, 요약: records.map(summarizeMarketRecord) };
      if (a.include_raw) res.원본 = records;
      return res;
    },
  },
  {
    name: 'toss_market_indicator_prices',
    description: '국내 지수(KOSPI, KOSDAQ)와 국고채 금리(KR_BOND_2Y·3Y·5Y·10Y·20Y·30Y) 현재가.',
    inputSchema: { type: 'object', properties: {
      symbols: { type: 'array', items: { type: 'string', enum: INDICATOR_SYMBOLS }, default: ['KOSPI', 'KOSDAQ', 'KR_BOND_3Y', 'KR_BOND_10Y'] },
    } },
    async run(a) {
      const syms = (a.symbols && a.symbols.length ? a.symbols : ['KOSPI', 'KOSDAQ', 'KR_BOND_3Y', 'KR_BOND_10Y']).filter((s) => INDICATOR_SYMBOLS.includes(s));
      return apiGet(READ_ENDPOINTS.marketIndicatorPrices(), { symbols: syms.join(',') });
    },
  },
  {
    name: 'toss_market_indicator_candles',
    description: '국내 지수·국고채 금리 캔들(최신순). 분봉(1m)은 KOSPI·KOSDAQ만, 국채는 일봉(1d)만.',
    inputSchema: { type: 'object', properties: {
      symbol: { type: 'string', enum: INDICATOR_SYMBOLS },
      interval: { type: 'string', enum: ['1m', '1d'], default: '1d' },
      count: { type: 'integer', minimum: 1, maximum: 200, default: 20 },
      before: { type: 'string', description: 'ISO 8601 시각(포함). 생략하면 최신부터' },
    }, required: ['symbol'] },
    async run(a) {
      if (!INDICATOR_SYMBOLS.includes(a.symbol)) throw new UserError('symbol 은 ' + INDICATOR_SYMBOLS.join(', ') + ' 중 하나여야 합니다');
      return apiGet(READ_ENDPOINTS.marketIndicatorCandles(a.symbol), { interval: a.interval || '1d', count: a.count || 20, before: a.before });
    },
  },
  {
    name: 'toss_investor_trading_rankings',
    description: '외국인·기관·개인 순매수/순매도 상위 국내 종목(KRX·NXT 통합, 최근 영업일). 개인은 정규장 종료 후 제공, 저녁 20시경까지 바뀔 수 있음. rankedAt 확인.',
    inputSchema: { type: 'object', properties: { count: { type: 'integer', minimum: 1, maximum: 100, default: 10 } } },
    async run(a) { return apiGet(READ_ENDPOINTS.investorTradingRankings(), { count: a.count || 10 }); },
  },
  {
    name: 'toss_stock_investor_trading',
    description: '국내 개별 종목의 일별 투자자별 매매동향(주 수 기준, 금액 없음). 외국인은 등록외국인 기준이라 시장 전체 수급과 기준이 다름. 당일 개인·기관 세부는 저녁 확정 전 null.',
    inputSchema: { type: 'object', properties: {
      symbol: { type: 'string', description: 'KRX 6자리 종목코드 (예: 005930)' },
      count: { type: 'integer', minimum: 1, maximum: 100, default: 5 },
      until: { type: 'string', description: 'YYYY-MM-DD (포함)' },
    }, required: ['symbol'] },
    async run(a) {
      if (!/^[A-Za-z0-9]{6}$/.test(String(a.symbol || ''))) throw new UserError('symbol 은 6자리 종목코드여야 합니다 (예: 005930)');
      return apiGet(READ_ENDPOINTS.stockInvestorTrading(a.symbol), { count: a.count || 5, until: a.until });
    },
  },
  {
    name: 'toss_exchange_rate',
    description: '토스증권 표시 원/달러 환율(1분 갱신 참고용, 매매기준율 midRate 포함). 서울 외환시장 공식 종가가 아님.',
    inputSchema: { type: 'object', properties: { dateTime: { type: 'string', description: 'ISO 8601 시각. 생략하면 현재' } } },
    async run(a) { return apiGet(READ_ENDPOINTS.exchangeRate(), { baseCurrency: 'USD', quoteCurrency: 'KRW', dateTime: a.dateTime }); },
  },
  {
    name: 'toss_kr_market_calendar',
    description: '국내 장 운영 정보(전일·당일·익일 3영업일, KRX+NXT 통합). 휴장일 확인용.',
    inputSchema: { type: 'object', properties: { date: { type: 'string', description: 'YYYY-MM-DD' } } },
    async run(a) { return apiGet(READ_ENDPOINTS.krMarketCalendar(), { date: a.date }); },
  },
  {
    name: 'toss_stock_short_selling',
    description: '국내 종목의 일별 공매도 동향(공매도 거래량·거래대금, 전체 거래 대비 비중). 확정치는 해당 일자 저녁 반영. 비중의 분모는 시간외·애프터마켓 포함 누적 거래.',
    inputSchema: { type: 'object', properties: {
      symbol: { type: 'string', description: 'KRX 6자리 종목코드 (예: 005930)' },
      count: { type: 'integer', minimum: 1, maximum: 100, default: 10 },
      until: { type: 'string', description: 'YYYY-MM-DD (포함)' },
    }, required: ['symbol'] },
    async run(a) { return apiGet(READ_ENDPOINTS.stockShortSelling(krCode(a.symbol)), { count: a.count || 10, until: a.until }); },
  },
  {
    name: 'toss_stock_program_trades',
    description: '국내 종목의 일별 프로그램매매 동향(차익·비차익 매수·매도·순매수 거래량, 주 수). KRX만 집계(NXT 제외). 당일 기록은 장 종료 전까지 갱신.',
    inputSchema: { type: 'object', properties: {
      symbol: { type: 'string', description: 'KRX 6자리 종목코드 (예: 005930)' },
      count: { type: 'integer', minimum: 1, maximum: 100, default: 10 },
      until: { type: 'string', description: 'YYYY-MM-DD (포함)' },
    }, required: ['symbol'] },
    async run(a) { return apiGet(READ_ENDPOINTS.stockProgramTrades(krCode(a.symbol)), { count: a.count || 10, until: a.until }); },
  },
  {
    name: 'toss_sector_rankings',
    description: '섹터 랭킹(대·중분류, 최대 100위). TOP_GAINERS=기간 등락률 상위, MARKET_TRADING_AMOUNT=거래대금 상위. 금액은 원화 환산.',
    inputSchema: { type: 'object', properties: {
      type: { type: 'string', enum: ['TOP_GAINERS', 'MARKET_TRADING_AMOUNT'], default: 'MARKET_TRADING_AMOUNT' },
      marketCountry: { type: 'string', enum: ['KR', 'US'], default: 'KR' },
      duration: { type: 'string', enum: ['1d', '1w', '1mo', '3mo', '6mo', '1y'], default: '1d' },
    } },
    async run(a) {
      return apiGet(READ_ENDPOINTS.sectorRankings(), {
        type: oneOf(a.type, ['TOP_GAINERS', 'MARKET_TRADING_AMOUNT'], 'type', 'MARKET_TRADING_AMOUNT'),
        marketCountry: oneOf(a.marketCountry, ['KR', 'US'], 'marketCountry', 'KR'),
        duration: oneOf(a.duration, ['1d', '1w', '1mo', '3mo', '6mo', '1y'], 'duration', '1d'),
      });
    },
  },
  {
    name: 'toss_stock_rankings',
    description: '주식 랭킹(최대 100위). MARKET_TRADING_AMOUNT·MARKET_TRADING_VOLUME=시장 전체 거래대금·거래량, TOP_GAINERS·TOP_LOSERS=등락률(realtime 불가), TOSS_SECURITIES_*=토스 고객 체결 기준. rankedAt 확인.',
    inputSchema: { type: 'object', properties: {
      type: { type: 'string', enum: ['MARKET_TRADING_AMOUNT', 'MARKET_TRADING_VOLUME', 'TOP_GAINERS', 'TOP_LOSERS', 'TOSS_SECURITIES_TRADING_AMOUNT', 'TOSS_SECURITIES_TRADING_VOLUME'], default: 'MARKET_TRADING_AMOUNT' },
      marketCountry: { type: 'string', enum: ['KR', 'US'], default: 'KR' },
      duration: { type: 'string', enum: ['realtime', '1d', '1w', '1mo', '3mo', '6mo', '1y'], default: '1d' },
      excludeInvestmentCaution: { type: 'boolean', default: false },
      count: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
    } },
    async run(a) {
      const type = oneOf(a.type, ['MARKET_TRADING_AMOUNT', 'MARKET_TRADING_VOLUME', 'TOP_GAINERS', 'TOP_LOSERS', 'TOSS_SECURITIES_TRADING_AMOUNT', 'TOSS_SECURITIES_TRADING_VOLUME'], 'type', 'MARKET_TRADING_AMOUNT');
      const duration = oneOf(a.duration, ['realtime', '1d', '1w', '1mo', '3mo', '6mo', '1y'], 'duration', '1d');
      if ((type === 'TOP_GAINERS' || type === 'TOP_LOSERS') && duration === 'realtime') throw new UserError('TOP_GAINERS·TOP_LOSERS 는 realtime 을 지원하지 않습니다. 1d 등을 쓰세요');
      return apiGet(READ_ENDPOINTS.stockRankings(), { type, duration, marketCountry: oneOf(a.marketCountry, ['KR', 'US'], 'marketCountry', 'KR'),
        excludeInvestmentCaution: a.excludeInvestmentCaution === true ? 'true' : undefined, count: a.count || 20 });
    },
  },
  {
    name: 'toss_stock_prices',
    description: '종목 현재가(최대 200개). 국내는 6자리 코드(005930), 미국은 티커(AAPL, MU, EWY 등). ⚠ 국내 종목은 KRX+NXT 통합 마지막 체결가라 15:30 이후에는 NXT 애프터마켓(~20:00) 가격이 나옴. KRX 정규장 공식 종가로 쓰지 말 것(공식 종가는 메리츠 market_candles_days 또는 거래소 기사). 미국 종목은 한국 낮 시간에 주간거래 가격이 나옴.',
    inputSchema: { type: 'object', properties: {
      symbols: { type: 'array', items: { type: 'string' }, description: '예: ["005930","000660","MU","EWY"]' },
    }, required: ['symbols'] },
    async run(a) {
      const syms = (Array.isArray(a.symbols) ? a.symbols : String(a.symbols || '').split(',')).map((x) => String(x).trim()).filter(Boolean);
      if (!syms.length || syms.length > 200) throw new UserError('symbols 는 1~200개여야 합니다');
      const bad = syms.filter((x) => !ANY_SYMBOL.test(x)); if (bad.length) throw new UserError('허용되지 않는 심볼: ' + bad.join(', '));
      return apiGet(READ_ENDPOINTS.stockPrices(), { symbols: syms.join(',') });
    },
  },
  {
    name: 'toss_stock_candles',
    description: '종목 캔들(최신순, 최대 200개). interval 1m(분봉)·1d(일봉). 기본 수정주가. 국내 6자리 코드 또는 미국 티커. ⚠ 국내 일봉은 KRX+NXT 통합이라 closePrice 가 NXT 애프터마켓 마지막 체결가(20:00)임. KRX 정규장 공식 종가가 아님(예: 삼성전자 11/3 공식 219,500 vs 토스 222,000). 미국 일봉의 직전 거래일 closePrice 는 정규장 종가와 일치(EWY 확인).',
    inputSchema: { type: 'object', properties: {
      symbol: { type: 'string', description: '예: 005930, MU, EWY' },
      interval: { type: 'string', enum: ['1m', '1d'], default: '1d' },
      count: { type: 'integer', minimum: 1, maximum: 200, default: 20 },
      before: { type: 'string', description: 'ISO 8601 시각(포함). 생략하면 최신부터' },
      adjusted: { type: 'boolean', default: true },
    }, required: ['symbol'] },
    async run(a) {
      if (!ANY_SYMBOL.test(String(a.symbol || ''))) throw new UserError('허용되지 않는 심볼: ' + a.symbol);
      return apiGet(READ_ENDPOINTS.stockCandles(), { symbol: a.symbol, interval: oneOf(a.interval, ['1m', '1d'], 'interval', '1d'), count: a.count || 20,
        before: a.before, adjusted: a.adjusted === false ? 'false' : undefined });
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
      instructions: '토스증권 Open API 조회 전용 서버입니다. 주문 기능은 없습니다. 수급 금액은 억원 단위 요약을 우선 쓰세요. 국내 종목 시세·수급은 KRX+NXT 통합 기준이라 KRX 단독 기사 수치·정규장 종가와 다를 수 있습니다. 지수(KOSPI·KOSDAQ)는 공식 값과 같습니다.' };
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
      const text = e instanceof UserError ? e.message : `오류: ${e && e.name === 'TimeoutError' ? '응답 시간 초과(15초)' : (e && e.message) || e}`;
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
    try { const m = JSON.parse(line); log('recv', m.method || '(response)', m.method === 'tools/call' ? (m.params && m.params.name) : ''); } catch (_) {}
    let msg; try { msg = JSON.parse(line); } catch (_) { send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); return; }
    if (msg.id === undefined || msg.id === null) { if (msg.method) handle(msg).catch(() => {}); return; }
    try { const result = await handle(msg); send({ jsonrpc: '2.0', id: msg.id, result }); }
    catch (e) { log('error', msg.method, e.message); send({ jsonrpc: '2.0', id: msg.id, error: { code: e.code || -32603, message: e.message } }); }
  });
  rl.on('close', () => { log('stdin closed, exit'); process.exit(0); });
  log(`started v${SERVER_INFO.version} node=${process.version} 조회 전용 base=${BASE_URL} creds=${process.env.TOSS_CLIENT_ID ? 'set' : 'missing'}`);
}

// Desktop 이 이 파일을 감싸서 실행해도 서버가 켜지도록 항상 시작합니다(테스트에서만 끔).
if (process.env.TOSS_MCP_NO_MAIN !== '1') main();
module.exports = { handle, TOOLS, summarizeMarketRecord, eok, READ_ENDPOINTS };
