#!/usr/bin/env node
// 한국거래소 KRX Open API 조회 전용 MCP 서버
// - 외부 패키지 없음 (Node 18+ 내장 모듈만 사용)
// - 호출 주소 data-dbg.krx.co.kr 고정, GET만 사용, 인증키는 요청 헤더 AUTH_KEY
// - 키: 환경변수 KRX_API_KEY → 없으면 맥 키체인(서비스 krx-api, 계정 krx)
// - 명세 확인: 2026-11-10 공식 사이트(openapi.krx.co.kr) 서비스 목록 31개의 API ID·출력 항목을 화면에서 수집
'use strict';

const https = require('https');
const { execFileSync } = require('child_process');

const VERSION = '0.1.0';
const HOST = 'data-dbg.krx.co.kr';
const BASE = '/svc/apis/';
let testHost = null; // 시험 전용: 로컬 가짜 서버 (KRX_MCP_NO_STDIO=1일 때만 설정 가능)
const KEYCHAIN_SERVICE = 'krx-api';
const KEYCHAIN_ACCOUNT = 'krx';
const MAX_OUTPUT_CHARS = 60000;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 3000;
const LOOKBACK_DAYS = 10; // 날짜를 비웠을 때 최근 영업일을 찾으려고 거슬러 올라가는 최대 일수

const log = (...a) => process.stderr.write('[krx-mcp] ' + a.join(' ') + '\n');

// ───────────────────────── 키 ─────────────────────────
let cachedKey = null;
function getKey() {
  if (cachedKey) return cachedKey;
  const env = (process.env.KRX_API_KEY || '').trim();
  if (env && !env.includes('${')) return (cachedKey = env);
  if (process.platform === 'darwin') {
    try {
      const k = execFileSync('security',
        ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', KEYCHAIN_ACCOUNT, '-w'],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      if (k) return (cachedKey = k);
    } catch (_) { /* 없음 */ }
  }
  throw new Error('KRX API 키가 없습니다. openapi.krx.co.kr에서 인증키를 발급받아 터미널에서 `security add-generic-password -s krx-api -a krx -w` 로 키체인에 넣거나, 환경변수 KRX_API_KEY(또는 확장 설정)에 입력하세요.');
}
function mask(s) {
  let t = String(s);
  if (cachedKey) t = t.split(cachedKey).join('***');
  return t;
}

// ───────────────────────── 명세 (공식 31개) ─────────────────────────
// 출력 항목: "항목명=출력명" (공식 화면의 순서 그대로)
const F = {
  idx: '기준일자=BAS_DD, 계열구분=IDX_CLSS, 지수명=IDX_NM, 종가=CLSPRC_IDX, 대비=CMPPREVDD_IDX, 등락률=FLUC_RT, 시가=OPNPRC_IDX, 고가=HGPRC_IDX, 저가=LWPRC_IDX, 거래량=ACC_TRDVOL, 거래대금=ACC_TRDVAL, 상장시가총액=MKTCAP',
  bonIdx: '기준일자=BAS_DD, 지수명=BND_IDX_GRP_NM, 총수익지수_종가=TOT_EARNG_IDX, 총수익지수_대비=TOT_EARNG_IDX_CMPPREVDD, 순가격지수_종가=NETPRC_IDX, 순가격지수_대비=NETPRC_IDX_CMPPREVDD, 제로재투자지수_종가=ZERO_REINVST_IDX, 제로재투자지수_대비=ZERO_REINVST_IDX_CMPPREVDD, 콜재투자지수_종가=CALL_REINVST_IDX, 콜재투자지수_대비=CALL_REINVST_IDX_CMPPREVDD, 시장가격지수_종가=MKT_PRC_IDX, 시장가격지수_대비=MKT_PRC_IDX_CMPPREVDD, 듀레이션=AVG_DURATION, 컨벡시티=AVG_CONVEXITY_PRC, YTM=BND_IDX_AVG_YD',
  drvIdx: '기준일자=BAS_DD, 계열구분=IDX_CLSS, 지수명=IDX_NM, 종가=CLSPRC_IDX, 대비=CMPPREVDD_IDX, 등락률=FLUC_RT, 시가=OPNPRC_IDX, 고가=HGPRC_IDX, 저가=LWPRC_IDX',
  stk: '기준일자=BAS_DD, 종목코드=ISU_CD, 종목명=ISU_NM, 시장구분=MKT_NM, 소속부=SECT_TP_NM, 종가=TDD_CLSPRC, 대비=CMPPREVDD_PRC, 등락률=FLUC_RT, 시가=TDD_OPNPRC, 고가=TDD_HGPRC, 저가=TDD_LWPRC, 거래량=ACC_TRDVOL, 거래대금=ACC_TRDVAL, 시가총액=MKTCAP, 상장주식수=LIST_SHRS',
  sw: '기준일자=BAS_DD, 시장구분=MKT_NM, 종목코드=ISU_CD, 종목명=ISU_NM, 종가=TDD_CLSPRC, 대비=CMPPREVDD_PRC, 등락률=FLUC_RT, 시가=TDD_OPNPRC, 고가=TDD_HGPRC, 저가=TDD_LWPRC, 거래량=ACC_TRDVOL, 거래대금=ACC_TRDVAL, 시가총액=MKTCAP, 상장증권수=LIST_SHRS, 행사가격=EXER_PRC, 존속기간_시작일=EXST_STRT_DD, 존속기간_종료일=EXST_END_DD, 목적주권_종목코드=TARSTK_ISU_SRT_CD, 목적주권_종목명=TARSTK_ISU_NM, 목적주권_종가=TARSTK_ISU_PRSNT_PRC',
  sr: '기준일자=BAS_DD, 시장구분=MKT_NM, 종목코드=ISU_CD, 종목명=ISU_NM, 종가=TDD_CLSPRC, 대비=CMPPREVDD_PRC, 등락률=FLUC_RT, 시가=TDD_OPNPRC, 고가=TDD_HGPRC, 저가=TDD_LWPRC, 거래량=ACC_TRDVOL, 거래대금=ACC_TRDVAL, 시가총액=MKTCAP, 상장증서수=LIST_SHRS, 신주발행가=ISU_PRC, 상장폐지일=DELIST_DD, 목적주권_종목코드=TARSTK_ISU_SRT_CD, 목적주권_종목명=TARSTK_ISU_NM, 목적주권_종가=TARSTK_ISU_PRSNT_PRC',
  base: '표준코드=ISU_CD, 단축코드=ISU_SRT_CD, 한글 종목명=ISU_NM, 한글 종목약명=ISU_ABBRV, 영문 종목명=ISU_ENG_NM, 상장일=LIST_DD, 시장구분=MKT_TP_NM, 증권구분=SECUGRP_NM, 소속부=SECT_TP_NM, 주식종류=KIND_STKCERT_TP_NM, 액면가=PARVAL, 상장주식수=LIST_SHRS',
  etf: '기준일자=BAS_DD, 종목코드=ISU_CD, 종목명=ISU_NM, 종가=TDD_CLSPRC, 대비=CMPPREVDD_PRC, 등락률=FLUC_RT, 순자산가치(NAV)=NAV, 시가=TDD_OPNPRC, 고가=TDD_HGPRC, 저가=TDD_LWPRC, 거래량=ACC_TRDVOL, 거래대금=ACC_TRDVAL, 시가총액=MKTCAP, 순자산총액=INVSTASST_NETASST_TOTAMT, 상장좌수=LIST_SHRS, 기초지수_지수명=IDX_IND_NM, 기초지수_종가=OBJ_STKPRC_IDX, 기초지수_대비=CMPPREVDD_IDX, 기초지수_등락률=FLUC_RT_IDX',
  etn: '기준일자=BAS_DD, 종목코드=ISU_CD, 종목명=ISU_NM, 종가=TDD_CLSPRC, 대비=CMPPREVDD_PRC, 등락률=FLUC_RT, 지표가치(IV)=PER1SECU_INDIC_VAL, 시가=TDD_OPNPRC, 고가=TDD_HGPRC, 저가=TDD_LWPRC, 거래량=ACC_TRDVOL, 거래대금=ACC_TRDVAL, 시가총액=MKTCAP, 지표가치총액=INDIC_VAL_AMT, 상장증권수=LIST_SHRS, 기초지수_지수명=IDX_IND_NM, 기초지수_종가=OBJ_STKPRC_IDX, 기초지수_대비=CMPPREVDD_IDX, 기초지수_등락률=FLUC_RT_IDX',
  elw: '기준일자=BAS_DD, 종목코드=ISU_CD, 종목명=ISU_NM, 종가=TDD_CLSPRC, 대비=CMPPREVDD_PRC, 시가=TDD_OPNPRC, 고가=TDD_HGPRC, 저가=TDD_LWPRC, 거래량=ACC_TRDVOL, 거래대금=ACC_TRDVAL, 시가총액=MKTCAP, 상장증권수=LIST_SHRS, 기초자산_자산명=ULY_NM, 기초자산_종가=ULY_PRC, 기초자산_대비=CMPPREVDD_PRC_ULY, 기초자산_등락률=FLUC_RT_ULY',
  kts: '기준일자=BAS_DD, 시장구분=MKT_NM, 종목코드=ISU_CD, 종목명=ISU_NM, 만기년수=BND_EXP_TP_NM, 종목구분=GOVBND_ISU_TP_NM, 종가_가격=CLSPRC, 종가_대비=CMPPREVDD_PRC, 종가_수익률=CLSPRC_YD, 시가_가격=OPNPRC, 시가_수익률=OPNPRC_YD, 고가_가격=HGPRC, 고가_수익률=HGPRC_YD, 저가_가격=LWPRC, 저가_수익률=LWPRC_YD, 거래량=ACC_TRDVOL, 거래대금=ACC_TRDVAL',
  bnd: '기준일자=BAS_DD, 시장구분=MKT_NM, 종목코드=ISU_CD, 종목명=ISU_NM, 종가_가격=CLSPRC, 종가_대비=CMPPREVDD_PRC, 종가_수익률=CLSPRC_YD, 시가_가격=OPNPRC, 시가_수익률=OPNPRC_YD, 고가_가격=HGPRC, 고가_수익률=HGPRC_YD, 저가_가격=LWPRC, 저가_수익률=LWPRC_YD, 거래량=ACC_TRDVOL, 거래대금=ACC_TRDVAL',
  fut: '기준일자=BAS_DD, 상품구분=PROD_NM, 시장구분(정규/야간)=MKT_NM, 종목코드=ISU_CD, 종목명=ISU_NM, 종가=TDD_CLSPRC, 대비=CMPPREVDD_PRC, 시가=TDD_OPNPRC, 고가=TDD_HGPRC, 저가=TDD_LWPRC, 현물가=SPOT_PRC, 정산가=SETL_PRC, 거래량=ACC_TRDVOL, 거래대금=ACC_TRDVAL, 미결제약정=ACC_OPNINT_QTY',
  opt: '기준일자=BAS_DD, 상품구분=PROD_NM, 권리유형(CALL/PUT)=RGHT_TP_NM, 종목코드=ISU_CD, 종목명=ISU_NM, 종가=TDD_CLSPRC, 대비=CMPPREVDD_PRC, 시가=TDD_OPNPRC, 고가=TDD_HGPRC, 저가=TDD_LWPRC, 내재변동성=IMP_VOLT, 익일정산가=NXTDD_BAS_PRC, 거래량=ACC_TRDVOL, 거래대금=ACC_TRDVAL, 미결제약정=ACC_OPNINT_QTY',
  oil: '기준일자=BAS_DD, 유종구분=OIL_NM, 가중평균가격_경쟁=WT_AVG_PRC, 가중평균가격_협의=WT_DIS_AVG_PRC, 거래량=ACC_TRDVOL, 거래대금=ACC_TRDVAL',
  gen: '기준일자=BAS_DD, 종목코드=ISU_CD, 종목명=ISU_NM, 종가=TDD_CLSPRC, 대비=CMPPREVDD_PRC, 등락률=FLUC_RT, 시가=TDD_OPNPRC, 고가=TDD_HGPRC, 저가=TDD_LWPRC, 거래량=ACC_TRDVOL, 거래대금=ACC_TRDVAL',
  esgEtp: '기준일자=BAS_DD, 종목명=ISU_ABBRV, 현재가=TDD_CLSPRC, 전일비=CMPPREVDD_PRC, 등락률=FLUC_RT, 상장좌수=LIST_SHRS, 거래량(좌)=ACC_TRDVOL, 거래대금(원)=ACC_TRDVAL',
  sri: '기준일자=BAS_DD, 발행기관=ISUR_NM, 표준코드=ISU_CD, 채권종류=SRI_BND_TP_NM, 종목명=ISU_NM, 상장일=LIST_DD, 발행일=ISU_DD, 상환일=REDMPT_DD, 표면이자율=ISU_RT, 발행금액=ISU_AMT, 상장금액=LIST_AMT, 채권유형=BND_TP_NM',
  esgIdx: '기준일자=BAS_DD, 지수명=IDX_NM, 현재가=CLSPRC_IDX, 전일비=PRV_DD_CMPR, 등락률=UPDN_RATE, 구성종목수=TRD_ISU_CNT, 거래량(천주)=ACC_TRDVOL, 거래대금(백만원)=ACC_TRDVAL',
};
const parseFields = (s) => s.split(', ').map((x) => { const i = x.lastIndexOf('='); return [x.slice(0, i), x.slice(i + 1)]; });

// [도구, type, 경로, 공식 API 명, 제공 시작일, 출력 항목]
const APIS = [
  ['krx_index', 'krx', 'idx/krx_dd_trd', 'KRX 시리즈 일별시세정보', '20100104', F.idx],
  ['krx_index', 'kospi', 'idx/kospi_dd_trd', 'KOSPI 시리즈 일별시세정보', '20100104', F.idx],
  ['krx_index', 'kosdaq', 'idx/kosdaq_dd_trd', 'KOSDAQ 시리즈 일별시세정보', '20100104', F.idx],
  ['krx_index', 'bond', 'idx/bon_dd_trd', '채권지수 시세정보', '20100104', F.bonIdx],
  ['krx_index', 'derivative', 'idx/drvprod_dd_trd', '파생상품지수 시세정보', '20100104', F.drvIdx],
  ['krx_stock', 'kospi', 'sto/stk_bydd_trd', '유가증권 일별매매정보', '20100104', F.stk],
  ['krx_stock', 'kosdaq', 'sto/ksq_bydd_trd', '코스닥 일별매매정보', '20100104', F.stk],
  ['krx_stock', 'konex', 'sto/knx_bydd_trd', '코넥스 일별매매정보', '20130701', F.stk],
  ['krx_stock', 'warrant', 'sto/sw_bydd_trd', '신주인수권증권 일별매매정보', '20100104', F.sw],
  ['krx_stock', 'right', 'sto/sr_bydd_trd', '신주인수권증서 일별매매정보', '20100212', F.sr],
  ['krx_stock', 'kospi_info', 'sto/stk_isu_base_info', '유가증권 종목기본정보', '20100104', F.base],
  ['krx_stock', 'kosdaq_info', 'sto/ksq_isu_base_info', '코스닥 종목기본정보', '20100104', F.base],
  ['krx_stock', 'konex_info', 'sto/knx_isu_base_info', '코넥스 종목기본정보', '20130701', F.base],
  ['krx_etp', 'etf', 'etp/etf_bydd_trd', 'ETF 일별매매정보', '20100104', F.etf],
  ['krx_etp', 'etn', 'etp/etn_bydd_trd', 'ETN 일별매매정보', '20141117', F.etn],
  ['krx_etp', 'elw', 'etp/elw_bydd_trd', 'ELW 일별매매정보', '20100104', F.elw],
  ['krx_bond', 'kts', 'bon/kts_bydd_trd', '국채전문유통시장 일별매매정보', '20100104', F.kts],
  ['krx_bond', 'general', 'bon/bnd_bydd_trd', '일반채권시장 일별매매정보', '20100104', F.bnd],
  ['krx_bond', 'small', 'bon/smb_bydd_trd', '소액채권시장 일별매매정보', '20100104', F.bnd],
  ['krx_derivative', 'futures', 'drv/fut_bydd_trd', '선물 일별매매정보 (주식선물外)', '20100104', F.fut],
  ['krx_derivative', 'stock_futures_kospi', 'drv/eqsfu_stk_bydd_trd', '주식선물(유가) 일별매매정보', '20100104', F.fut],
  ['krx_derivative', 'stock_futures_kosdaq', 'drv/eqkfu_ksq_bydd_trd', '주식선물(코스닥) 일별매매정보', '20150803', F.fut],
  ['krx_derivative', 'options', 'drv/opt_bydd_trd', '옵션 일별매매정보 (주식옵션外)', '20100104', F.opt],
  ['krx_derivative', 'stock_options_kospi', 'drv/eqsop_bydd_trd', '주식옵션(유가) 일별매매정보', '20100104', F.opt],
  ['krx_derivative', 'stock_options_kosdaq', 'drv/eqkop_bydd_trd', '주식옵션(코스닥) 일별매매정보', '20170626', F.opt],
  ['krx_commodity', 'oil', 'gen/oil_bydd_trd', '석유시장 일별매매정보', '20120330', F.oil],
  ['krx_commodity', 'gold', 'gen/gold_bydd_trd', '금시장 일별매매정보', '20140324', F.gen],
  ['krx_commodity', 'emission', 'gen/ets_bydd_trd', '배출권 시장 일별매매정보', '20150112', F.gen],
  ['krx_esg', 'etp', 'esg/esg_etp_info', 'ESG 증권상품', '20200102', F.esgEtp],
  ['krx_esg', 'sri_bond', 'esg/sri_bond_info', '사회책임투자채권 정보', '20190101', F.sri],
  ['krx_esg', 'index', 'esg/esg_index_info', 'ESG 지수', '20200102', F.esgIdx],
].map(([tool, type, path, name, from, fields]) => ({ tool, type, path, name, from, fields: parseFields(fields) }));

const GROUPS = [
  ['krx_index', '지수', 'KRX·KOSPI·KOSDAQ 시리즈 지수(업종지수 포함), 채권지수, 파생상품지수의 하루치 시세'],
  ['krx_stock', '주식', '유가증권·코스닥·코넥스 전 종목의 하루치 매매정보(종가·등락률·거래대금·시가총액·상장주식수), 신주인수권증권·증서, 종목기본정보(표준코드·단축코드·상장일·액면가). 일별매매(kospi·kosdaq·konex)는 시장 전체 상승·하락 종목 수와 거래대금 합계도 함께 줌'],
  ['krx_etp', '증권상품', 'ETF(순자산가치 NAV·순자산총액·기초지수 포함), ETN(지표가치 IV), ELW의 하루치 매매정보'],
  ['krx_bond', '채권', '국채전문유통시장(만기별 가격·수익률), 일반채권시장, 소액채권시장의 하루치 매매정보'],
  ['krx_derivative', '파생상품', '선물(현물가·정산가·미결제약정, 정규/야간)과 옵션(내재변동성·미결제약정, CALL/PUT)의 하루치 매매정보. 주식선물·주식옵션은 유가/코스닥 기초자산별로 나뉨'],
  ['krx_commodity', '일반상품', 'KRX 석유시장, 금시장, 탄소배출권 시장의 하루치 매매정보'],
  ['krx_esg', 'ESG', 'ESG 증권상품, 사회책임투자(SRI)채권, ESG 지수 정보'],
];

// ───────────────────────── 날짜 ─────────────────────────
function kstNow() { return new Date(Date.now() + 9 * 3600 * 1000); }
function ymd(d) { return d.toISOString().slice(0, 10).replace(/-/g, ''); }
function addDays(s, n) { const d = new Date(Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8))); d.setUTCDate(d.getUTCDate() + n); return ymd(d); }
function checkDate(api, s) {
  if (!/^\d{8}$/.test(s) || addDays(s, 0) !== s) throw new Error('date는 YYYYMMDD 형식의 실제 날짜여야 합니다. 예: 20261109');
  if (s < api.from) throw new Error(`${api.name}은(는) ${api.from}부터 제공됩니다 (요청: ${s})`);
  if (s > ymd(kstNow())) throw new Error(`미래 날짜입니다: ${s}`);
}

// ───────────────────────── HTTP ─────────────────────────
const dayCache = new Map(); // 같은 날 같은 API를 다시 부르지 않음 (하루 호출 한도 절약)
function krxGet(api, basDd) {
  const ck = api.path + '|' + basDd;
  if (dayCache.has(ck)) return Promise.resolve(dayCache.get(ck));
  let key;
  try { key = getKey(); } catch (e) { return Promise.reject(e); }
  const reqPath = BASE + api.path + '?basDd=' + encodeURIComponent(basDd);
  return new Promise((resolve, reject) => {
    const lib = testHost ? require('http') : https;
    const req = lib.request({ hostname: testHost ? '127.0.0.1' : HOST, port: testHost || 443, path: reqPath, method: 'GET',
      headers: { AUTH_KEY: key, 'User-Agent': 'krx-readonly-mcp/' + VERSION, Accept: 'application/json' }, timeout: 30000 }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        let j = null;
        try { j = JSON.parse(body); } catch (_) { /* JSON 아님 */ }
        const msg = j && !Array.isArray(j) && (j.respMsg || j.message || j.error) ? String(j.respMsg || j.message || j.error) : '';
        if (res.statusCode === 401 || res.statusCode === 403 || /unauthorized/i.test(msg)) {
          const cat = GROUPS.find((g) => g[0] === api.tool)[1];
          return reject(new Error(mask(`KRX가 호출을 거절했습니다(${res.statusCode}${msg ? ' ' + msg : ''}). 인증키가 틀렸거나, 이 API의 활용 신청이 승인되지 않았습니다. openapi.krx.co.kr > 서비스 이용 > ${cat} > "${api.name}"에서 "API 이용신청"을 하고 승인을 기다리세요. (API는 하나씩 따로 신청합니다)`)));
        }
        if (res.statusCode === 429) return reject(new Error('KRX 호출 한도를 넘었습니다(429). 잠시 뒤 다시 시도하세요.'));
        if (res.statusCode !== 200) return reject(new Error(mask(`HTTP ${res.statusCode} (${api.path}): ${body.slice(0, 300)}`)));
        if (!j || typeof j !== 'object') return reject(new Error(mask('JSON 해석 실패: ' + body.slice(0, 200))));
        let rows = Array.isArray(j.OutBlock_1) ? j.OutBlock_1 : null;
        if (!rows) { const k = Object.keys(j).find((x) => Array.isArray(j[x])); rows = k ? j[k] : null; }
        if (!rows) return reject(new Error(mask('예상과 다른 응답: ' + body.slice(0, 200))));
        if (dayCache.size >= 30) dayCache.delete(dayCache.keys().next().value);
        dayCache.set(ck, rows);
        resolve(rows);
      });
    });
    req.on('timeout', () => req.destroy(new Error('응답 시간 초과(30초): ' + api.path)));
    req.on('error', (e) => reject(new Error(mask(e.message))));
    req.end();
  });
}

// 날짜를 비우면 어제부터 거슬러 올라가며 자료가 있는 가장 최근 날을 찾음 (KRX는 다음 영업일 아침에 갱신)
async function latest(api) {
  let d = addDays(ymd(kstNow()), -1);
  for (let i = 0; i < LOOKBACK_DAYS && d >= api.from; i++, d = addDays(d, -1)) {
    const rows = await krxGet(api, d);
    if (rows.length) return { date: d, rows };
  }
  return { date: null, rows: [] };
}

// ───────────────────────── 값 변환 ─────────────────────────
// 응답은 전부 문자열. 코드·이름·날짜가 아닌 값은 쉼표를 떼고 숫자로 바꿈. 빈 값과 '-'는 null
const isText = (code) => /(_CD|_NM|_DD)$/.test(code) || code === 'IDX_CLSS' || code === 'ISU_ABBRV';
function conv(code, v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (s === '' || s === '-') return null;
  if (isText(code)) return s;
  return /^[-+]?[\d,]*\.?\d+$/.test(s) ? Number(s.replace(/,/g, '')) : s;
}
function shape(api, raw) {
  const out = {}; const known = new Set();
  for (const [label, code] of api.fields) { known.add(code); if (code in raw) out[label] = conv(code, raw[code]); }
  for (const k of Object.keys(raw)) if (!known.has(k)) out[k] = conv(k, raw[k]); // 명세에 없는 새 항목도 버리지 않음
  return out;
}

// ───────────────────────── 조회 공통 ─────────────────────────
const BREADTH = new Set(['sto/stk_bydd_trd', 'sto/ksq_bydd_trd', 'sto/knx_bydd_trd']);
const CODE_LABELS = ['종목코드', '단축코드', '표준코드', '목적주권_종목코드'];
const sum = (rows, k) => rows.reduce((t, r) => t + (typeof r[k] === 'number' ? r[k] : 0), 0);

async function query(toolName, a) {
  const list = APIS.filter((x) => x.tool === toolName);
  const api = list.find((x) => x.type === a.type);
  if (!api) throw new Error(`type은 ${list.map((x) => x.type).join(', ')} 중 하나여야 합니다`);
  const labels = api.fields.map((f) => f[0]);
  // 인자 오류는 KRX를 부르기 전에 걸러 호출 한도를 아낌
  if (a.sort_by && !labels.includes(a.sort_by)) throw new Error(`sort_by는 다음 중 하나여야 합니다: ${labels.join(', ')}`);
  const pick = Array.isArray(a.fields) && a.fields.length ? a.fields : null;
  if (pick) {
    const bad = pick.filter((f) => !labels.includes(f));
    if (bad.length) throw new Error(`fields에 없는 항목: ${bad.join(', ')}. 가능한 항목: ${labels.join(', ')}`);
  }
  let date = a.date; let raw;
  if (date) { date = String(date).replace(/-/g, ''); checkDate(api, date); raw = await krxGet(api, date); }
  else { const r = await latest(api); date = r.date; raw = r.rows; }
  const all = raw.map((r) => shape(api, r));
  const out = { api: api.path, name: api.name, date, total: all.length };
  if (!all.length) {
    out.note = a.date ? '이 날짜에는 자료가 없습니다(휴장일이거나 아직 갱신 전). KRX는 다음 영업일 아침에 갱신합니다.' : `최근 ${LOOKBACK_DAYS}일 안에 자료가 없습니다.`;
    out.rows = []; return out;
  }
  if (BREADTH.has(api.path)) {
    out.market_summary = {
      상승: all.filter((r) => r['등락률'] > 0).length, 하락: all.filter((r) => r['등락률'] < 0).length, 보합: all.filter((r) => r['등락률'] === 0).length,
      거래대금_합계: sum(all, '거래대금'), 시가총액_합계: sum(all, '시가총액'),
    };
  }
  let rows = all;
  if (a.code) {
    const c = String(a.code).trim().toUpperCase();
    rows = rows.filter((r) => CODE_LABELS.some((k) => r[k] && String(r[k]).toUpperCase().includes(c)));
  }
  if (a.name_contains) {
    const q = String(a.name_contains).toLowerCase();
    const nameLabels = api.fields.filter(([, code]) => /_NM$/.test(code) || code === 'ISU_ABBRV' || code === 'IDX_CLSS').map((f) => f[0]);
    rows = rows.filter((r) => nameLabels.some((k) => r[k] && String(r[k]).toLowerCase().includes(q)));
  }
  if (a.sort_by) {
    const dir = a.ascending ? 1 : -1; const k = a.sort_by;
    rows = [...rows].sort((x, y) => {
      const p = x[k]; const q = y[k];
      const pn = p === null || p === undefined; const qn = q === null || q === undefined;
      if (pn || qn) return pn && qn ? 0 : pn ? 1 : -1; // 빈 값은 항상 뒤로
      return (typeof p === 'number' && typeof q === 'number' ? p - q : String(p).localeCompare(String(q), 'ko')) * dir;
    });
  }
  out.matched = rows.length;
  const limit = Math.max(1, Math.min(Number(a.limit) || DEFAULT_LIMIT, MAX_LIMIT));
  rows = rows.slice(0, limit);
  if (pick) rows = rows.map((r) => Object.fromEntries(pick.map((f) => [f, r[f] === undefined ? null : r[f]])));
  out.shown = rows.length;
  if (out.shown < out.matched) out.note = `조건에 맞는 ${out.matched}건 중 ${out.shown}건만 표시. limit를 늘리거나 sort_by·name_contains·code로 좁히세요.`;
  out.rows = rows;
  return out;
}

// ───────────────────────── 도구 (분야별 7개) ─────────────────────────
const TOOLS = GROUPS.map(([name, cat, what]) => {
  const list = APIS.filter((x) => x.tool === name);
  return {
    name,
    description: `한국거래소(KRX) ${cat}: ${what}. 일별 자료(2010년 이후)이며 다음 영업일 아침에 갱신되어 당일 값은 없습니다. type별 출력 항목 — `
      + list.map((x) => `${x.type}(${x.name}, ${x.from}~): ${x.fields.map((f) => f[0]).join('·')}`).join(' / ')
      + '. API마다 KRX에 활용 신청·승인이 따로 필요합니다.',
    inputSchema: { type: 'object', properties: {
      type: { type: 'string', enum: list.map((x) => x.type), description: list.map((x) => `${x.type}=${x.name}`).join(', ') },
      date: { type: 'string', description: '기준일자 YYYYMMDD. 비우면 자료가 있는 가장 최근 영업일' },
      name_contains: { type: 'string', description: '이름(종목명·지수명·계열구분 등)에 이 글자가 들어간 것만' },
      code: { type: 'string', description: '종목코드(단축 또는 표준)로 거르기. 예: 005930' },
      sort_by: { type: 'string', description: '정렬할 출력 항목명. 예: 거래대금, 등락률, 시가총액' },
      ascending: { type: 'boolean', default: false, description: '오름차순(기본은 내림차순)' },
      limit: { type: 'integer', default: DEFAULT_LIMIT, maximum: MAX_LIMIT, description: '표시할 행 수' },
      fields: { type: 'array', items: { type: 'string' }, description: '필요한 출력 항목명만 고르기 (비우면 전부)' },
    }, required: ['type'] },
    run: (a) => query(name, a),
  };
});

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
        serverInfo: { name: 'krx-readonly', version: VERSION },
        instructions: '한국거래소 KRX Open API 조회 전용(일별, 전일까지). 한 번 호출하면 그날 시장 전체가 오므로 sort_by·limit·name_contains·code로 좁혀 쓰세요. 당일·실시간 값은 없습니다.',
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
        if (text.length > MAX_OUTPUT_CHARS) text = text.slice(0, MAX_OUTPUT_CHARS) + `\n…(잘림: 전체 ${text.length}자. limit를 줄이거나 fields로 항목을 고르세요)`;
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

// Desktop의 내장 Node는 래퍼를 거쳐 실행하므로 require.main 판정을 쓰지 않고 항상 시작. 시험에서만 KRX_MCP_NO_STDIO=1로 끔
if (process.env.KRX_MCP_NO_STDIO !== '1') {
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

module.exports = { TOOLS, APIS, GROUPS, conv, shape, checkDate, addDays, mask, krxGet,
  _setKey: (k) => { cachedKey = k; }, _clearCache: () => dayCache.clear(),
  _setHost: (h) => { if (process.env.KRX_MCP_NO_STDIO === '1') testHost = h; } };
