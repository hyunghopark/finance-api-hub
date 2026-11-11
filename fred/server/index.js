#!/usr/bin/env node
// FRED(미국 세인트루이스 연준 경제 데이터) API 조회 전용 MCP 서버
// - 외부 패키지 없음 (Node 18+ 내장 모듈만 사용)
// - 호출 주소 api.stlouisfed.org 고정, GET만 사용, v1 경로 31개 허용 목록
// - 키: 환경변수 FRED_API_KEY → 없으면 맥 키체인(서비스 fred-api, 계정 fred)
// - 명세 확인: 2026-11-10 공식 문서 https://fred.stlouisfed.org/docs/api/fred/
// - 요청 한도: 분당 120회(초과 시 429) → 요청 사이 0.55초 간격을 둠
'use strict';

const https = require('https');
const { execFileSync } = require('child_process');

const VERSION = '0.1.1';
const HOST = 'api.stlouisfed.org';
let testHost = null; // 시험 전용 (FRED_MCP_NO_STDIO=1일 때만 설정 가능)
const KEYCHAIN_SERVICE = 'fred-api';
const KEYCHAIN_ACCOUNT = 'fred';
const MAX_OUTPUT_CHARS = 60000;
const MIN_GAP_MS = 550;

const log = (...a) => process.stderr.write('[fred-mcp] ' + a.join(' ') + '\n');

// ───────────────────────── 키 ─────────────────────────
let cachedKey = null;
function getKey() {
  if (cachedKey) return cachedKey;
  const env = (process.env.FRED_API_KEY || '').trim();
  if (env && !env.includes('${')) return (cachedKey = env);
  if (process.platform === 'darwin') {
    try {
      const k = execFileSync('security',
        ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', KEYCHAIN_ACCOUNT, '-w'],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      if (k) return (cachedKey = k);
    } catch (_) { /* 없음 */ }
  }
  throw new Error('FRED API 키가 없습니다. 확장 설정에 키를 넣고 확장을 껐다 켜거나, 터미널에서 `security add-generic-password -s fred-api -a fred -w` 로 키체인에 넣으세요.');
}
function mask(s) {
  let t = String(s).replace(/api_key=[^&\s"]+/g, 'api_key=***');
  if (cachedKey) t = t.split(cachedKey).join('***');
  return t;
}

// ───────────────────────── HTTP ─────────────────────────
// 공식 문서의 v1 경로 31개 (Categories 6, Releases 9, Series 10, Sources 3, Tags 3)
const ENDPOINTS = {
  'category': '카테고리 정보', 'category/children': '하위 카테고리', 'category/related': '관련 카테고리',
  'category/series': '카테고리의 시리즈', 'category/tags': '카테고리의 태그', 'category/related_tags': '카테고리의 관련 태그',
  'releases': '전체 릴리스(발표 자료) 목록', 'releases/dates': '전체 릴리스 발표일', 'release': '릴리스 정보',
  'release/dates': '릴리스 발표일', 'release/series': '릴리스의 시리즈', 'release/sources': '릴리스의 출처',
  'release/tags': '릴리스의 태그', 'release/related_tags': '릴리스의 관련 태그', 'release/tables': '릴리스 표 구조',
  'series': '시리즈 정보', 'series/categories': '시리즈의 카테고리', 'series/observations': '시리즈 관측값',
  'series/release': '시리즈의 릴리스', 'series/search': '시리즈 검색', 'series/search/tags': '검색어의 태그',
  'series/search/related_tags': '검색어의 관련 태그', 'series/tags': '시리즈의 태그', 'series/updates': '최근 갱신된 시리즈',
  'series/vintagedates': '시리즈 수정 이력 날짜',
  'sources': '전체 출처', 'source': '출처 정보', 'source/releases': '출처의 릴리스',
  'tags': '전체 태그', 'related_tags': '관련 태그', 'tags/series': '태그의 시리즈',
};

// 동시에 여러 요청이 와도 순서대로 간격을 두도록 줄 세움
let minGap = MIN_GAP_MS;
let gate = Promise.resolve();
let lastCall = 0;
function throttle() {
  const next = gate.then(async () => {
    const wait = lastCall + minGap - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCall = Date.now();
  });
  gate = next.catch(() => {});
  return next;
}

async function fredGet(endpoint, params = {}) {
  if (!ENDPOINTS[endpoint]) throw new Error('허용되지 않은 경로: ' + endpoint);
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    if (k === 'api_key' || k === 'file_type') continue;
    qs.set(k, String(v));
  }
  qs.set('file_type', 'json');
  qs.set('api_key', getKey());
  const reqPath = `/fred/${endpoint}?${qs.toString()}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    await throttle();
    const { status, body } = await new Promise((resolve, reject) => {
      const lib = testHost ? require('http') : https;
      const req = lib.request({ hostname: testHost ? '127.0.0.1' : HOST, port: testHost || 443, path: reqPath, method: 'GET',
        headers: { 'User-Agent': 'fred-readonly-mcp/' + VERSION, Accept: 'application/json' }, timeout: 30000 }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
      });
      req.on('timeout', () => req.destroy(new Error('응답 시간 초과(30초): ' + endpoint)));
      req.on('error', (e) => reject(new Error(mask(e.message))));
      req.end();
    });
    let j = null;
    try { j = JSON.parse(body); } catch (_) { /* 아래에서 처리 */ }
    if (status === 429 && attempt === 0) { const w = minGap === MIN_GAP_MS ? 20000 : 10; log(`429 요청 한도, ${w / 1000}초 뒤 한 번 재시도`); await new Promise((r) => setTimeout(r, w)); continue; }
    if (status !== 200 || (j && j.error_code)) {
      const msg = j && j.error_message ? j.error_message : body.slice(0, 200);
      const hint = { 400: '잘못된 요청', 404: '대상 없음', 423: '잠김', 429: '요청 한도 초과(분당 120회)', 500: 'FRED 서버 오류' }[status] || '';
      throw new Error(mask(`FRED 오류 ${j && j.error_code ? j.error_code : status} ${hint}: ${msg}`));
    }
    if (!j) throw new Error('JSON 해석 실패: ' + mask(body.slice(0, 200)));
    return j;
  }
  throw new Error('FRED 요청 한도 초과(429)가 계속됨. 잠시 뒤 다시 시도하세요.');
}

// ───────────────────────── 공통 ─────────────────────────
const UNITS = { lin: '수준값', chg: '변화량', ch1: '전년 대비 변화량', pch: '변화율(%)', pc1: '전년 대비 변화율(%)', pca: '연율 복리 변화율(%)', cch: '연속복리 변화율(%)', cca: '연속복리 연율 변화율(%)', log: '자연로그' };
const FREQS = ['d', 'w', 'bw', 'm', 'q', 'sa', 'a', 'wef', 'weth', 'wew', 'wetu', 'wem', 'wesu', 'wesa', 'bwew', 'bwem'];
const num = (v) => (v === undefined || v === null || v === '.' || v === '' ? null : Number(v));
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s);
function checkDate(s, label) { if (s && !isDate(s)) throw new Error(`${label}은 YYYY-MM-DD 형식`); }
function daysAgo(n) { const d = new Date(Date.now() - n * 86400000); return d.toISOString().slice(0, 10); }
const round = (x, d = 4) => (x == null ? null : Math.round(x * 10 ** d) / 10 ** d);

const metaCache = new Map();
async function seriesMeta(id) {
  if (metaCache.has(id)) return metaCache.get(id);
  const j = await fredGet('series', { series_id: id });
  const s = (j.seriess || [])[0];
  if (!s) throw new Error('시리즈 없음: ' + id);
  const m = { id: s.id, title: s.title, frequency: s.frequency_short, units: s.units, units_short: s.units_short,
    seasonal_adjustment: s.seasonal_adjustment_short, observation_start: s.observation_start, observation_end: s.observation_end,
    last_updated: s.last_updated, notes: s.notes };
  metaCache.set(id, m);
  return m;
}

async function observations(id, opt = {}) {
  const j = await fredGet('series/observations', { series_id: id, observation_start: opt.start, observation_end: opt.end,
    units: opt.units, frequency: opt.frequency, aggregation_method: opt.frequency ? opt.aggregation : undefined,
    sort_order: opt.sort_order, limit: opt.limit });
  return (j.observations || []).map((o) => ({ date: o.date, value: num(o.value) }));
}

// 단위 문자열에서 백만 달러 기준 배율 (유동성 계산용)
function toMillions(units) {
  const u = String(units || '').toLowerCase();
  if (u.startsWith('trillions')) return 1e6;
  if (u.startsWith('billions')) return 1e3;
  if (u.startsWith('millions')) return 1;
  return null;
}

// ───────────────────────── 브리핑 묶음 (시리즈 코드 2026-11-10 공개 페이지로 존재 확인) ─────────────────────────
const BUNDLES = {
  rates: { title: '미국 금리 곡선·분해', items: [
    ['DGS3MO', '3개월'], ['DGS2', '2년'], ['DGS5', '5년'], ['DGS10', '10년'], ['DGS30', '30년'],
    ['T10Y2Y', '10년−2년'], ['T10Y3M', '10년−3개월'], ['T10YIE', '10년 기대인플레(BEI)'], ['DFII10', '10년 실질금리(TIPS)'],
    ['T5YIFR', '5년 후 5년 기대인플레'], ['DFEDTARU', '연방기금 목표 상단'], ['EFFR', '실효 연방기금금리'] ] },
  credit: { title: '신용·금융 스트레스', items: [
    ['BAMLH0A0HYM2', '하이일드 스프레드(OAS)'], ['BAMLC0A4CBBB', 'BBB 스프레드(OAS)'], ['BAMLC0A0CM', '투자등급 스프레드(OAS)'],
    ['BAMLH0A0HYM2EY', '하이일드 실효수익률'], ['VIXCLS', 'VIX'], ['STLFSI4', '세인트루이스 연준 금융스트레스(주간)'],
    ['NFCI', '시카고 연준 금융여건(주간)'] ] },
  liquidity: { title: '연준·달러 유동성', items: [
    ['WALCL', '연준 총자산(주간, 수요일)'], ['WTREGEN', '재무부 일반계정 TGA(주간)'], ['RRPONTSYD', '역레포(일간)'],
    ['WRESBAL', '지급준비금(주간)'], ['SOFR', 'SOFR'], ['EFFR', '실효 연방기금금리'] ] },
  macro: { title: '미국 경기·물가', items: [
    ['CPIAUCSL', 'CPI 전년비(%)', 'pc1'], ['CPILFESL', '근원 CPI 전년비(%)', 'pc1'], ['PCEPI', 'PCE 물가 전년비(%)', 'pc1'],
    ['PCEPILFE', '근원 PCE 전년비(%)', 'pc1'], ['PAYEMS', '비농업 고용 전월비(천 명)', 'chg'], ['UNRATE', '실업률(%)'],
    ['ICSA', '신규 실업수당 청구(주간)'], ['CCSA', '계속 실업수당 청구(주간)'], ['UMCSENT', '미시간대 소비자심리'],
    ['INDPRO', '산업생산 전년비(%)', 'pc1'], ['IPG3344S', '반도체·전자부품 산업생산 전년비(%)', 'pc1'] ] },
};
const BUNDLE_SERIES = [...new Set(Object.values(BUNDLES).flatMap((b) => b.items.map((x) => x[0])))];

async function bundleRows(name) {
  const b = BUNDLES[name];
  const rows = [];
  for (const [id, label, units] of b.items) {
    try {
      // 최근 60개 관측(일간이면 약 3개월, 월간이면 5년)에서 최신·직전·1주 전 값을 찾음
      const obs = await observations(id, { start: daysAgo(2000), units, sort_order: 'desc', limit: 60 });
      const valid = obs.filter((o) => o.value != null);
      const last = valid[0] || null; const prev = valid[1] || null;
      const meta = await seriesMeta(id);
      const weekAgo = last ? valid.find((o) => o.date <= new Date(Date.parse(last.date) - 7 * 86400000).toISOString().slice(0, 10)) : null;
      // 가장 최근 관측이 결측(".")이면 숨기지 않고 알림. 변환값이면 원래 수준값도 함께
      let missing_latest;
      if (obs[0] && obs[0].value == null) {
        missing_latest = { date: obs[0].date, note: units && units !== 'lin' ? '이 날짜의 변환값이 결측(기준이 되는 과거 값이 비어 있을 수 있음). 아래 value는 그 전 날짜 값' : '이 날짜 값이 결측(휴장 등)' };
        if (units && units !== 'lin') {
          const lvl = (await observations(id, { start: obs[0].date, end: obs[0].date }))[0];
          if (lvl && lvl.value != null) missing_latest.level_value = lvl.value;
        }
      }
      rows.push({ id, label, date: last ? last.date : null, value: last ? last.value : null, missing_latest,
        prev_date: prev ? prev.date : null, change: last && prev ? round(last.value - prev.value) : null,
        change_1w: last && weekAgo && meta.frequency === 'D' ? round(last.value - weekAgo.value) : undefined,
        units: units && units !== 'lin' ? UNITS[units] : meta.units_short, frequency: meta.frequency, last_updated: meta.last_updated });
    } catch (e) { rows.push({ id, label, error: mask(e.message) }); }
  }
  return rows;
}

// 순유동성 어림값 = 연준 총자산 − TGA − 역레포 (같은 수요일 기준, 역레포는 그날 또는 직전 값)
async function netLiquidity(weeks) {
  const start = daysAgo(weeks * 7 + 14);
  const [walcl, tga, rrp] = await Promise.all([
    observations('WALCL', { start }), observations('WTREGEN', { start }), observations('RRPONTSYD', { start })]);
  const [mW, mT, mR] = [await seriesMeta('WALCL'), await seriesMeta('WTREGEN'), await seriesMeta('RRPONTSYD')];
  const fW = toMillions(mW.units), fT = toMillions(mT.units), fR = toMillions(mR.units);
  if (fW == null || fT == null || fR == null) throw new Error(`단위 해석 실패: ${mW.units} / ${mT.units} / ${mR.units}`);
  const tgaBy = new Map(tga.map((o) => [o.date, o.value]));
  const rrpSorted = rrp.filter((o) => o.value != null);
  const rows = [];
  for (const w of walcl) {
    if (w.value == null) continue;
    const t = tgaBy.get(w.date);
    const r = [...rrpSorted].reverse().find((o) => o.date <= w.date);
    if (t == null || !r) continue;
    const net = w.value * fW - t * fT - r.value * fR;
    rows.push({ date: w.date, fed_assets_bil: round(w.value * fW / 1000, 1), tga_bil: round(t * fT / 1000, 1),
      rrp_bil: round(r.value * fR / 1000, 1), rrp_date: r.date, net_liquidity_bil: round(net / 1000, 1) });
  }
  return { units_used: { WALCL: mW.units, WTREGEN: mT.units, RRPONTSYD: mR.units }, rows: rows.slice(-weeks) };
}

// ───────────────────────── 도구 ─────────────────────────
const TOOLS = [
  {
    name: 'fred_bundle',
    description: '브리핑용 묶음 조회. rates(미국 금리 곡선 3개월~30년, 10년−2년·10년−3개월, 기대인플레 BEI, 실질금리 TIPS, 연방기금), credit(하이일드·BBB·투자등급 스프레드, VIX, 금융스트레스·금융여건 지수), liquidity(연준 총자산·TGA·역레포·지준·SOFR + 순유동성 어림값), macro(CPI·근원CPI·PCE·근원PCE 전년비, 고용 전월비, 실업률, 실업수당 청구, 소비자심리, 산업생산·반도체 산업생산 전년비). 항목마다 최신값·직전값 대비 변화·관측일·FRED 갱신 시각.',
    inputSchema: { type: 'object', properties: {
      bundle: { type: 'string', enum: Object.keys(BUNDLES) },
      net_liquidity_weeks: { type: 'integer', default: 8, description: 'liquidity에서 순유동성 표 주 수' },
    }, required: ['bundle'] },
    run: async (a) => {
      if (!BUNDLES[a.bundle]) throw new Error('bundle은 ' + Object.keys(BUNDLES).join(', ') + ' 중 하나');
      const out = { bundle: a.bundle, title: BUNDLES[a.bundle].title, note: 'date는 관측일(미국 기준). 일간 금리·스프레드는 하루 늦게 올라오는 경우가 있으니 date를 꼭 확인. change는 직전 관측값 대비, change_1w는 일간 시리즈의 1주 전 대비.',
        rows: await bundleRows(a.bundle) };
      if (a.bundle === 'liquidity') {
        try { out.net_liquidity = await netLiquidity(Math.min(a.net_liquidity_weeks || 8, 104)); out.net_liquidity.note = '순유동성 = 연준 총자산 − TGA − 역레포 (시장에서 쓰는 어림식, 공식 지표 아님). 단위 십억 달러'; }
        catch (e) { out.net_liquidity = { error: mask(e.message) }; }
      }
      return out;
    },
  },
  {
    name: 'fred_observations',
    description: '시리즈 관측값(series/observations). 여러 시리즈(최대 10개)를 날짜별 표로 합칩니다. units로 변환(chg 변화량, ch1 전년 대비 변화량, pch 변화율, pc1 전년 대비 %, pca 연율, cch·cca 연속복리, log), frequency로 낮은 주기 집계(d,w,bw,m,q,sa,a 및 wef 등 요일 지정 주간), aggregation(avg,sum,eop). 결측(".")은 null.',
    inputSchema: { type: 'object', properties: {
      series_ids: { type: 'array', items: { type: 'string' }, description: '예: ["DGS2","DGS10"]' },
      start: { type: 'string', description: 'YYYY-MM-DD (기본: 90일 전)' }, end: { type: 'string', description: 'YYYY-MM-DD' },
      units: { type: 'string', enum: Object.keys(UNITS) }, frequency: { type: 'string', enum: FREQS },
      aggregation: { type: 'string', enum: ['avg', 'sum', 'eop'] },
      limit: { type: 'integer', default: 1000, maximum: 100000, description: '시리즈당 최대 관측 수 (최근부터 셈)' },
    }, required: ['series_ids'] },
    run: async (a) => {
      const ids = [...new Set((a.series_ids || []).map((s) => String(s).trim().toUpperCase()).filter(Boolean))];
      if (!ids.length || ids.length > 10) throw new Error('series_ids는 1~10개');
      checkDate(a.start, 'start'); checkDate(a.end, 'end');
      const start = a.start || daysAgo(90);
      const by = {}; const metas = [];
      for (const id of ids) {
        metas.push(await seriesMeta(id));
        const obs = await observations(id, { start, end: a.end, units: a.units, frequency: a.frequency, aggregation: a.aggregation, sort_order: 'desc', limit: Math.min(a.limit || 1000, 100000) });
        for (const o of obs) (by[o.date] = by[o.date] || {})[id] = o.value;
      }
      const rows = Object.keys(by).sort().map((d) => ({ date: d, ...Object.fromEntries(ids.map((id) => [id, by[d][id] ?? null])) }));
      return { series: metas.map((m) => ({ id: m.id, title: m.title, frequency: m.frequency, units: a.units ? UNITS[a.units] + ' (원 단위: ' + m.units + ')' : m.units, seasonal_adjustment: m.seasonal_adjustment, last_updated: m.last_updated })),
        transform: a.units || 'lin', frequency: a.frequency || '원 주기', count: rows.length, rows };
    },
  },
  {
    name: 'fred_search',
    description: '시리즈 검색(series/search). 제목·단위·주기·태그 전문 검색 또는 시리즈 ID 패턴(search_type=series_id, *와일드카드). 인기순 정렬 기본.',
    inputSchema: { type: 'object', properties: {
      text: { type: 'string', description: '검색어 (예: "korea exchange rate", "breakeven inflation")' },
      search_type: { type: 'string', enum: ['full_text', 'series_id'], default: 'full_text' },
      frequency: { type: 'string', description: '주기로 거르기 (예: Daily, Weekly, Monthly)' },
      tag_names: { type: 'string', description: '세미콜론 구분 태그 (예: usa;nsa)' },
      limit: { type: 'integer', default: 20, maximum: 1000 },
      order_by: { type: 'string', enum: ['search_rank', 'popularity', 'last_updated', 'observation_end', 'series_id', 'title'], default: 'popularity' },
    }, required: ['text'] },
    run: async (a) => {
      const order = a.order_by || 'popularity';
      const j = await fredGet('series/search', { search_text: a.text, search_type: a.search_type, limit: Math.min(a.limit || 20, 1000),
        order_by: order, sort_order: ['search_rank', 'popularity', 'last_updated', 'observation_end'].includes(order) ? 'desc' : 'asc',
        filter_variable: a.frequency ? 'frequency' : undefined, filter_value: a.frequency, tag_names: a.tag_names });
      return { count: j.count, shown: (j.seriess || []).length, results: (j.seriess || []).map((s) => ({ id: s.id, title: s.title, frequency: s.frequency_short,
        units: s.units_short, sa: s.seasonal_adjustment_short, from: s.observation_start, to: s.observation_end, last_updated: s.last_updated, popularity: s.popularity })) };
    },
  },
  {
    name: 'fred_series_info',
    description: '시리즈 정보(series + series/release): 제목·주기·단위·계절조정·관측 기간·FRED 갱신 시각·설명, 소속 릴리스(발표 자료)와 그 다음 발표일.',
    inputSchema: { type: 'object', properties: { series_id: { type: 'string' } }, required: ['series_id'] },
    run: async (a) => {
      const id = String(a.series_id).trim().toUpperCase();
      metaCache.delete(id);
      const m = await seriesMeta(id);
      let release = null; let next_dates = [];
      try {
        const r = await fredGet('series/release', { series_id: id });
        release = (r.releases || [])[0] || null;
        if (release) {
          const today = new Date().toISOString().slice(0, 10);
          const d = await fredGet('release/dates', { release_id: release.id, include_release_dates_with_no_data: 'true', sort_order: 'desc', limit: 30 });
          next_dates = (d.release_dates || []).map((x) => x.date).filter((x) => x >= today).sort().slice(0, 5);
        }
      } catch (e) { release = { error: mask(e.message) }; }
      return { ...m, notes: m.notes ? String(m.notes).slice(0, 1500) : undefined,
        release: release && release.id ? { id: release.id, name: release.name, link: release.link } : release, upcoming_release_dates: next_dates,
        caution: '발표일은 원 기관 기준이며 FRED에 실제로 올라오는 시각과 다를 수 있음(공식 문서)' };
    },
  },
  {
    name: 'fred_release_calendar',
    description: '경제지표 발표 일정(releases/dates, 미래 일정 포함). 기간과 이름 글자로 거름. 예: 다음 주 CPI·고용·GDP·PCE 발표일. 발표 "시각"과 예상치는 없음.',
    inputSchema: { type: 'object', properties: {
      start: { type: 'string', description: 'YYYY-MM-DD (기본: 오늘)' }, end: { type: 'string', description: 'YYYY-MM-DD (기본: 14일 뒤)' },
      name_contains: { type: 'array', items: { type: 'string' }, description: '릴리스 이름에 들어간 글자(영문, 대소문자 무시). 예: ["Consumer Price","Employment Situation","Gross Domestic","Personal Income"]' },
    } },
    run: async (a) => {
      checkDate(a.start, 'start'); checkDate(a.end, 'end');
      const start = a.start || new Date().toISOString().slice(0, 10);
      const end = a.end || new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
      const rows = [];
      for (let offset = 0; offset < 5000; offset += 1000) {
        const j = await fredGet('releases/dates', { realtime_start: start, realtime_end: '9999-12-31', include_release_dates_with_no_data: 'true', order_by: 'release_date', sort_order: 'asc', limit: 1000, offset });
        const list = j.release_dates || [];
        rows.push(...list);
        if (list.length < 1000 || (list.length && list[list.length - 1].date > end)) break;
      }
      const keys = (a.name_contains || []).map((s) => s.toLowerCase());
      const hits = rows.filter((x) => x.date >= start && x.date <= end && (!keys.length || keys.some((k) => String(x.release_name).toLowerCase().includes(k))));
      return { period: `${start}~${end}`, count: hits.length, note: '날짜는 미국 기준. 발표 시각·예상치는 FRED에 없음',
        rows: hits.map((x) => ({ date: x.date, release_id: x.release_id, release: x.release_name })) };
    },
  },
  {
    name: 'fred_get',
    description: 'FRED v1 API 아무 경로나 조회(허용 목록 31개, 조회 전용): ' + Object.entries(ENDPOINTS).map(([k, v]) => `${k}(${v})`).join(', ') + '. params에 공식 문서의 인자를 그대로 넣음 (api_key·file_type은 자동).',
    inputSchema: { type: 'object', properties: {
      endpoint: { type: 'string', enum: Object.keys(ENDPOINTS) },
      params: { type: 'object', description: '예: {"category_id":32991} 또는 {"release_id":10,"element_id":34483}' },
    }, required: ['endpoint'] },
    run: async (a) => {
      const p = {};
      for (const [k, v] of Object.entries(a.params || {})) {
        if (!/^[a-z_]+$/.test(k)) throw new Error('인자 이름 형식 오류: ' + k);
        if (typeof v === 'object' && v !== null) throw new Error('인자 값은 문자·숫자만: ' + k);
        p[k] = v;
      }
      return fredGet(a.endpoint, p);
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
        serverInfo: { name: 'fred-readonly', version: VERSION },
        instructions: 'FRED 조회 전용. 브리핑용은 fred_bundle(rates/credit/liquidity/macro), 그 밖은 fred_search → fred_observations. 관측일(date)은 미국 기준이며 일간 지표가 하루 늦게 올라올 수 있음.',
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
        if (text.length > MAX_OUTPUT_CHARS) text = text.slice(0, MAX_OUTPUT_CHARS) + `\n…(잘림: 전체 ${text.length}자. 기간이나 시리즈 수를 줄이세요)`;
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

// Desktop의 내장 Node는 래퍼를 거쳐 실행하므로 require.main 판정을 쓰지 않고 항상 시작. 시험에서만 FRED_MCP_NO_STDIO=1로 끔
if (process.env.FRED_MCP_NO_STDIO !== '1') {
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

module.exports = { TOOLS, ENDPOINTS, BUNDLES, BUNDLE_SERIES, UNITS, FREQS, toMillions, num, mask,
  _setKey: (k) => { cachedKey = k; },
  _setHost: (h) => { if (process.env.FRED_MCP_NO_STDIO === '1') testHost = h; },
  _setGap: (ms) => { if (process.env.FRED_MCP_NO_STDIO === '1') minGap = ms; } };
