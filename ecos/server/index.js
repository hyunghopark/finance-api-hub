#!/usr/bin/env node
// 한국은행 ECOS(경제통계시스템) Open API 조회 전용 MCP 서버
// - 외부 패키지 없음 (Node 18+ 내장 모듈만 사용)
// - 호출 주소 ecos.bok.or.kr 고정, GET만 사용
// - 키: 환경변수 ECOS_API_KEY → 없으면 맥 키체인(서비스 ecos-api, 계정 ecos)
// - 명세 확인: 2026-11-09 공식 개발명세서(ecos.bok.or.kr/api) + 샘플 키 실제 호출
'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const VERSION = '0.1.1';
const HOST = 'ecos.bok.or.kr';
let testHost = null; // 시험 전용: 로컬 가짜 서버 (ECOS_MCP_NO_STDIO=1일 때만 설정 가능)
// 시험(ECOS_MCP_NO_STDIO=1)에서만 캐시 위치를 바꿀 수 있음 — 실제 캐시를 덮지 않도록
const CACHE_DIR = (process.env.ECOS_MCP_NO_STDIO === '1' && process.env.ECOS_MCP_CACHE_DIR) || path.join(os.homedir(), '.ecos-mcp');
const TABLE_CACHE = path.join(CACHE_DIR, 'tables.json');
const TABLE_TTL_MS = 7 * 24 * 3600 * 1000;
const KEYCHAIN_SERVICE = 'ecos-api';
const KEYCHAIN_ACCOUNT = 'ecos';
const MAX_OUTPUT_CHARS = 60000;

const log = (...a) => process.stderr.write('[ecos-mcp] ' + a.join(' ') + '\n');

// ───────────────────────── 키 ─────────────────────────
let cachedKey = null;
function getKey() {
  if (cachedKey) return cachedKey;
  const env = (process.env.ECOS_API_KEY || '').trim();
  if (env && !env.includes('${')) return (cachedKey = env);
  if (process.platform === 'darwin') {
    try {
      const k = execFileSync('security',
        ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', KEYCHAIN_ACCOUNT, '-w'],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      if (k) return (cachedKey = k);
    } catch (_) { /* 없음 */ }
  }
  throw new Error('ECOS API 키가 없습니다. 터미널에서 `security add-generic-password -s ecos-api -a ecos -w` 로 키체인에 넣거나, 확장 설정에 키를 입력하세요.');
}
// ECOS는 키가 주소 경로에 들어가므로 메시지에서 키 문자열을 지움
function mask(s) {
  let t = String(s);
  if (cachedKey) t = t.split(cachedKey).join('***');
  return t;
}

// ───────────────────────── HTTP ─────────────────────────
const SERVICES = ['StatisticTableList', 'StatisticWord', 'StatisticItemList', 'StatisticSearch', 'KeyStatisticList', 'StatisticMeta'];

// 주소: /api/{서비스}/{키}/json/kr/{시작}/{끝}/{추가 인자...}
function ecosGet(service, start, end, args = []) {
  if (!SERVICES.includes(service)) throw new Error('허용되지 않은 서비스: ' + service);
  const segs = [service, getKey(), 'json', 'kr', String(start), String(end)];
  // 뒤쪽의 빈 인자는 빼고, 중간 빈 인자는 '?'(전체)로 채움
  const a = [...args];
  while (a.length && (a[a.length - 1] === undefined || a[a.length - 1] === null || a[a.length - 1] === '')) a.pop();
  for (const v of a) segs.push(v === undefined || v === null || v === '' ? '?' : String(v));
  // '?'는 그대로 두면 쿼리 문자열로 해석되므로 %3F로 보냄 (2026-11-09 실제 호출로 '전체' 동작 확인)
  const reqPath = '/api/' + segs.map((s) => (s === '?' ? '%3F' : encodeURIComponent(s))).join('/');
  return new Promise((resolve, reject) => {
    const lib = testHost ? require('http') : https;
    const req = lib.request({ hostname: testHost ? '127.0.0.1' : HOST, port: testHost || 443, path: reqPath, method: 'GET',
      headers: { 'User-Agent': 'ecos-readonly-mcp/' + VERSION, Accept: 'application/json' }, timeout: 65000 }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode !== 200) return reject(new Error(mask(`HTTP ${res.statusCode} (${service}): ${body.slice(0, 300)}`)));
        let j;
        try { j = JSON.parse(body); } catch (_) { return reject(new Error(mask('JSON 해석 실패: ' + body.slice(0, 200)))); }
        if (j.RESULT) {
          const code = j.RESULT.CODE || '';
          if (/INFO-200/.test(code)) return resolve({ total: 0, rows: [] });
          return reject(new Error(mask(`ECOS ${code}: ${(j.RESULT.MESSAGE || '').replace(/\s+/g, ' ').trim()}`)));
        }
        const blk = j[service];
        if (!blk) return reject(new Error(mask('예상과 다른 응답: ' + body.slice(0, 200))));
        resolve({ total: blk.list_total_count, rows: blk.row || [] });
      });
    });
    req.on('timeout', () => req.destroy(new Error('응답 시간 초과(65초): ' + service)));
    req.on('error', (e) => reject(new Error(mask(e.message))));
    req.end();
  });
}

// 많은 행은 1000건씩 나눠 받음
async function ecosGetAll(service, args, maxRows) {
  const out = []; let total = 0; let start = 1;
  while (out.length < maxRows) {
    const end = Math.min(start + 999, maxRows);
    const r = await ecosGet(service, start, end, args);
    total = r.total || 0;
    out.push(...r.rows);
    if (!r.rows.length || out.length >= total) break;
    start = end + 1;
  }
  return { total, rows: out };
}

// ───────────────────────── 날짜 ─────────────────────────
const CYCLES = { A: '연', S: '반년', Q: '분기', M: '월', SM: '반월', D: '일' };
function kstNow() { return new Date(Date.now() + 9 * 3600 * 1000); }
function ymd(d) { return d.toISOString().slice(0, 10).replace(/-/g, ''); }
function checkDate(cycle, s, label) {
  const re = { A: /^\d{4}$/, S: /^\d{4}S[12]$/, Q: /^\d{4}Q[1-4]$/, M: /^\d{6}$/, SM: /^\d{6}S[12]$/, D: /^\d{8}$/ }[cycle];
  if (!re) throw new Error('cycle은 A(연), S(반년), Q(분기), M(월), SM(반월), D(일) 중 하나');
  if (!re.test(s)) throw new Error(`${label} 형식이 주기(${cycle})와 맞지 않음. 예: A 2026, S 2026S1, Q 2026Q3, M 202610, SM 202610S1, D 20261109`);
}

// ───────────────────────── 통계표 목록(캐시) ─────────────────────────
let tableList = null;
async function loadTables(refresh = false) {
  if (tableList && !refresh) return tableList;
  if (!refresh) {
    try {
      const st = fs.statSync(TABLE_CACHE);
      if (Date.now() - st.mtimeMs < TABLE_TTL_MS) {
        const c = JSON.parse(fs.readFileSync(TABLE_CACHE, 'utf8'));
        if (c.length && 'parent_code' in c[0]) return (tableList = c);
      }
    } catch (_) { /* 캐시 없음 */ }
  }
  log('통계표 목록 내려받는 중');
  const r = await ecosGetAll('StatisticTableList', [], 20000);
  tableList = r.rows.map((x) => ({ stat_code: x.STAT_CODE, parent_code: x.P_STAT_CODE, stat_name: x.STAT_NAME, cycle: x.CYCLE, searchable: x.SRCH_YN === 'Y', org: x.ORG_NAME }));
  fs.mkdirSync(CACHE_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(TABLE_CACHE, JSON.stringify(tableList), { mode: 0o600 });
  return tableList;
}

// ───────────────────────── 시장금리 묶음 (817Y002, 2026-11-09 항목 코드 확인) ─────────────────────────
const RATE_STAT = '817Y002';
const RATE_ITEMS = {
  call: ['010101000', '콜금리(1일, 전체거래)'],
  kofr: ['010901000', 'KOFR(공시RFR)'],
  cd91: ['010502000', 'CD(91일)'],
  cp91: ['010503000', 'CP(91일)'],
  msb1y: ['010400001', '통안증권(1년)'],
  ktb1y: ['010190000', '국고채(1년)'],
  ktb2y: ['010195000', '국고채(2년)'],
  ktb3y: ['010200000', '국고채(3년)'],
  ktb5y: ['010200001', '국고채(5년)'],
  ktb10y: ['010210000', '국고채(10년)'],
  ktb20y: ['010220000', '국고채(20년)'],
  ktb30y: ['010230000', '국고채(30년)'],
  corpAA: ['010300000', '회사채(3년, AA-)'],
  corpAAmp: ['010310000', '회사채(3년, AA-, 민평)'],
  corpBBB: ['010320000', '회사채(3년, BBB-)'],
  callBroker: ['010102000', '콜금리(1일, 중개회사거래)'],
  callBankSec: ['010103000', '콜금리(1일, 은행증권금융차입)'],
  kdb1y: ['010260000', '산금채(1년)'],
  koribor3m: ['010150000', 'KORIBOR(3개월)'],
  koribor6m: ['010151000', 'KORIBOR(6개월)'],
  koribor12m: ['010152000', 'KORIBOR(12개월)'],
  msb91d: ['010400000', '통안증권(91일)'],
  msb2y: ['010400002', '통안증권(2년)'],
  mmf7d: ['010501000', 'MMF(7일)'],
  cma: ['010504000', 'CMA(수시형)'],
  housing5y: ['010503500', '국민주택채권1종(5년)'],
  ktb50y: ['010240000', '국고채(50년)'],
};
const RATE_DEFAULT = ['cd91', 'ktb2y', 'ktb3y', 'ktb5y', 'ktb10y', 'ktb30y', 'corpAA', 'corpBBB'];
const bp = (a, b) => (a == null || b == null ? null : Math.round((a - b) * 1000) / 10);

// ───────────────────────── 도구 ─────────────────────────
const TOOLS = [
  {
    name: 'ecos_market_rates',
    description: '한국 시장금리(일별, 통계표 817Y002, 27개 항목 전부 선택 가능)를 날짜별 표로: 국고채 1~50년, 회사채 3년 AA-·BBB-, CD·CP 91일, 콜·KOFR, KORIBOR, 통안증권 등과 계산값(회사채 AA-−국고채 3년 신용 스프레드, 국고채 10년−3년 금리차, bp). 기본은 최근 14일. 한국은행 집계 값이며 금융투자협회 최종호가와 같은 기준인지는 별도 확인 필요.',
    inputSchema: { type: 'object', properties: {
      start: { type: 'string', description: '시작일 YYYYMMDD (기본: 14일 전)' },
      end: { type: 'string', description: '종료일 YYYYMMDD (기본: 오늘, KST)' },
      items: { type: 'array', items: { type: 'string', enum: Object.keys(RATE_ITEMS) },
        description: '항목 키 (기본: ' + RATE_DEFAULT.join(', ') + '). 전체: ' + Object.entries(RATE_ITEMS).map(([k, v]) => `${k}=${v[1]}`).join(', ') },
    } },
    run: async (a) => {
      const end = a.end || ymd(kstNow());
      let start = a.start;
      if (!start) { const d = new Date(Date.UTC(+end.slice(0, 4), +end.slice(4, 6) - 1, +end.slice(6, 8))); d.setUTCDate(d.getUTCDate() - 14); start = ymd(d); }
      checkDate('D', start, 'start'); checkDate('D', end, 'end');
      const keys = (a.items && a.items.length ? a.items : RATE_DEFAULT).filter((k) => RATE_ITEMS[k]);
      const need = new Set([...keys, 'ktb3y', 'ktb10y', 'corpAA']);
      const byDate = {};
      for (const k of need) {
        const r = await ecosGetAll('StatisticSearch', [RATE_STAT, 'D', start, end, RATE_ITEMS[k][0]], 2000);
        for (const x of r.rows) { (byDate[x.TIME] = byDate[x.TIME] || {})[k] = x.DATA_VALUE === '' || x.DATA_VALUE == null ? null : Number(x.DATA_VALUE); }
      }
      const rows = Object.keys(byDate).sort().map((t) => {
        const v = byDate[t]; const row = { date: t };
        for (const k of keys) row[RATE_ITEMS[k][1]] = v[k] ?? null;
        row['신용 스프레드(회사채AA−국고3년, bp)'] = bp(v.corpAA, v.ktb3y);
        row['국고 10년−3년(bp)'] = bp(v.ktb10y, v.ktb3y);
        return row;
      });
      return { stat: `${RATE_STAT} 시장금리(일별)`, unit: '연%', period: `${start}~${end}`, count: rows.length,
        note: '휴일은 행이 없음. 그날 값이 아직 없으면 그 항목은 null. 민평(민간채권평가사 평균) 회사채는 corpAAmp',
        rows };
    },
  },
  {
    name: 'ecos_search',
    description: 'ECOS 통계 조회(StatisticSearch). 통계표코드와 주기, 기간, 항목코드로 시계열을 받습니다. 코드는 ecos_find_table → ecos_items 순서로 찾습니다. 주기: A 연, S 반년, Q 분기, M 월, SM 반월, D 일. 날짜 형식 예: A 2026, S 2026S1, Q 2026Q3, M 202610, SM 202610S1, D 20261109. 항목코드를 비우면 그 단계 전체.',
    inputSchema: { type: 'object', properties: {
      stat_code: { type: 'string', description: '통계표코드 (예: 817Y002 시장금리 일별, 722Y001 한국은행 기준금리)' },
      cycle: { type: 'string', enum: Object.keys(CYCLES) },
      start: { type: 'string' }, end: { type: 'string' },
      item1: { type: 'string', description: '항목코드1 (비우면 전체)' }, item2: { type: 'string' }, item3: { type: 'string' }, item4: { type: 'string' },
      max_rows: { type: 'integer', default: 500, maximum: 5000 },
    }, required: ['stat_code', 'cycle', 'start', 'end'] },
    run: async (a) => {
      checkDate(a.cycle, a.start, 'start'); checkDate(a.cycle, a.end, 'end');
      const r = await ecosGetAll('StatisticSearch', [a.stat_code, a.cycle, a.start, a.end, a.item1, a.item2, a.item3, a.item4], Math.min(a.max_rows || 500, 5000));
      const rows = r.rows.map((x) => ({ time: x.TIME, value: x.DATA_VALUE,
        item: [x.ITEM_NAME1, x.ITEM_NAME2, x.ITEM_NAME3, x.ITEM_NAME4].filter(Boolean).join(' / '),
        codes: [x.ITEM_CODE1, x.ITEM_CODE2, x.ITEM_CODE3, x.ITEM_CODE4].filter(Boolean).join('/'), unit: x.UNIT_NAME,
        weight: x.WGT == null || x.WGT === '' ? undefined : x.WGT }));
      return { stat_code: a.stat_code, stat_name: r.rows[0] ? r.rows[0].STAT_NAME : null, cycle: CYCLES[a.cycle], total: r.total, shown: rows.length, rows };
    },
  },
  {
    name: 'ecos_items',
    description: '통계표의 세부 항목 목록(StatisticItemList): 항목코드·이름·주기·자료 시작/끝·단위. ecos_search에 넣을 항목코드를 찾을 때 씁니다.',
    inputSchema: { type: 'object', properties: {
      stat_code: { type: 'string' },
      name_contains: { type: 'string', description: '항목 이름에 이 글자가 들어간 것만' },
    }, required: ['stat_code'] },
    run: async (a) => {
      const r = await ecosGetAll('StatisticItemList', [a.stat_code], 5000);
      let rows = r.rows.map((x) => ({ group: x.GRP_NAME, group_code: x.GRP_CODE, item_code: x.ITEM_CODE, item_name: x.ITEM_NAME,
        parent: x.P_ITEM_NAME || undefined, parent_code: x.P_ITEM_CODE || undefined,
        cycle: x.CYCLE, from: x.START_TIME, to: x.END_TIME, count: x.DATA_CNT, unit: x.UNIT_NAME,
        weight: x.WEIGHT == null || x.WEIGHT === '' ? undefined : x.WEIGHT }));
      if (a.name_contains) rows = rows.filter((x) => (x.item_name || '').includes(a.name_contains));
      return { stat_code: a.stat_code, stat_name: r.rows[0] ? r.rows[0].STAT_NAME : null, total: r.total, shown: rows.length, rows };
    },
  },
  {
    name: 'ecos_find_table',
    description: '통계표 이름으로 통계표코드 찾기(StatisticTableList). 전체 844개(조회 가능 617개) 목록은 7일마다 받아 ~/.ecos-mcp 에 캐시. 예: "기준금리", "소비자물가", "경제심리", "증시주변자금". parent_code로 분류 트리를 따라 내려갈 수 있음(query 없이 parent_code만 주면 그 분류의 하위 전체).',
    inputSchema: { type: 'object', properties: {
      query: { type: 'string', description: '통계표 이름 일부 또는 통계표코드' },
      parent_code: { type: 'string', description: '이 상위 통계표코드 바로 아래 것만 (분류 트리 따라가기, 예: 0000000001 통화/금융)' },
      searchable_only: { type: 'boolean', default: true, description: '조회 가능한 통계표만(상위 분류 제외)' },
      limit: { type: 'integer', default: 30, maximum: 200 },
      refresh: { type: 'boolean', default: false },
    } },
    run: async (a) => {
      const list = await loadTables(!!a.refresh);
      const q = String(a.query || '').trim();
      let hits = list.filter((t) => !q || t.stat_name.includes(q) || t.stat_code === q.toUpperCase());
      if (a.parent_code) hits = hits.filter((t) => t.parent_code === a.parent_code);
      if (a.searchable_only !== false) hits = hits.filter((t) => t.searchable);
      return { total: hits.length, results: hits.slice(0, a.limit || 30).map((t) => ({ ...t, cycle_name: CYCLES[t.cycle] || t.cycle })) };
    },
  },
  {
    name: 'ecos_key_stats',
    description: '한국은행 100대 통계지표(KeyStatisticList)의 최신값: 금리·환율·물가·통화·성장·고용·국제수지 등. 분류나 이름으로 거를 수 있음.',
    inputSchema: { type: 'object', properties: {
      contains: { type: 'string', description: '분류명 또는 지표명에 이 글자가 들어간 것만 (예: 금리, 물가, 환율)' },
    } },
    run: async (a) => {
      const r = await ecosGetAll('KeyStatisticList', [], 200);
      let rows = r.rows.map((x) => ({ class: x.CLASS_NAME, name: x.KEYSTAT_NAME, value: x.DATA_VALUE, time: x.CYCLE, unit: x.UNIT_NAME }));
      if (a.contains) rows = rows.filter((x) => (x.class + ' ' + x.name).includes(a.contains));
      return { total: r.total, shown: rows.length, rows };
    },
  },
  {
    name: 'ecos_word',
    description: '한국은행 통계용어사전(StatisticWord)에서 용어 뜻 찾기. 예: 소비자동향지수, 경상수지, 본원통화.',
    inputSchema: { type: 'object', properties: { word: { type: 'string' } }, required: ['word'] },
    run: async (a) => {
      const r = await ecosGet('StatisticWord', 1, 20, [a.word]);
      return { total: r.total, rows: r.rows.map((x) => ({ word: x.WORD, content: (x.CONTENT || '').trim() })) };
    },
  },
  {
    name: 'ecos_meta',
    description: '통계메타DB(StatisticMeta): 통계의 작성 방법·주기·공표 시기 등 설명. 데이터명(통계 이름)으로 조회.',
    inputSchema: { type: 'object', properties: { name: { type: 'string', description: '데이터명 (예: 경제심리지수)' } }, required: ['name'] },
    run: async (a) => {
      const r = await ecosGetAll('StatisticMeta', [a.name], 300);
      return { total: r.total, rows: r.rows.filter((x) => x.META_DATA).map((x) => ({ level: x.LVL, title: x.CONT_NAME, text: String(x.META_DATA).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() })) };
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
        serverInfo: { name: 'ecos-readonly', version: VERSION },
        instructions: '한국은행 ECOS 조회 전용. 시장금리는 ecos_market_rates, 그 밖의 통계는 ecos_find_table → ecos_items → ecos_search 순서.',
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
        if (text.length > MAX_OUTPUT_CHARS) text = text.slice(0, MAX_OUTPUT_CHARS) + `\n…(잘림: 전체 ${text.length}자. 기간이나 항목을 좁히세요)`;
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

// Desktop의 내장 Node는 래퍼를 거쳐 실행하므로 require.main 판정을 쓰지 않고 항상 시작. 시험에서만 ECOS_MCP_NO_STDIO=1로 끔
if (process.env.ECOS_MCP_NO_STDIO !== '1') {
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

module.exports = { TOOLS, RATE_ITEMS, SERVICES, checkDate, bp, mask, ecosGet, _setKey: (k) => { cachedKey = k; }, _setHost: (h) => { if (process.env.ECOS_MCP_NO_STDIO === '1') testHost = h; } };
