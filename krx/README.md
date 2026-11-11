# 한국거래소 KRX 조회 전용 MCP (Claude Desktop 확장)

한국거래소 Open API(https://openapi.krx.co.kr)를 조회만 하는 확장입니다. ECOS 확장([../ecos](../ecos))과 같은 방식입니다.

- 현재 버전: **v0.1.0**
- 외부 패키지 없음 (Node 18+ 내장 모듈만), 호출 주소 `data-dbg.krx.co.kr` 고정, GET만
- 키: 환경변수 `KRX_API_KEY`(확장 설정) → 없으면 맥 키체인(서비스 `krx-api`, 계정 `krx`). 키는 요청 헤더 `AUTH_KEY`로 보냄
- 공식 31개 서비스 전부 지원, 도구는 분야별 7개
- 명세 확인: 2026-11-10 공식 사이트의 서비스 목록과 31개 상세 화면에서 API ID·출력 항목을 수집, 2026-11-11 승인된 7개 API 실제 호출

> **실제 호출로 확인한 것 (2026-11-11)**
> 인증키와 API 7개(KRX·KOSPI·KOSDAQ 시리즈 지수, 유가증권·코스닥 일별매매, 유가증권 종목기본정보, ETF) 승인 뒤 2026-11-10 자료를 호출해 확인했습니다. 실제 주소는 `/svc/apis/{분야}/{API ID}`, 응답은 `OutBlock_1` 배열, 미승인 API는 `401 Unauthorized API Call`입니다. 인증키 발급과 API 이용신청은 둘 다 신청 즉시 승인됐습니다. 나머지 24개는 같은 구조라고 보고 만들었고, 아직 호출해 보지 않았습니다.
> 참고: 지수 응답의 "코스피 (외국주포함)"·"코스닥 (외국주포함)" 행은 종가·등락률이 비어 있고 거래량·거래대금·시가총액만 옵니다.

## KRX Open API의 성격

- **일별 자료만** 있습니다. 다음 영업일 아침에 갱신되므로 당일·실시간 값은 없습니다.
- 2010년 이후(일부는 시장 개설일부터) 자료를 줍니다.
- 요청 인자는 기준일자(`basDd`, YYYYMMDD) 하나이고, 한 번 부르면 **그날 시장 전체**가 옵니다. 종목 하나만 달라고 할 수 없어서, 이 확장이 받은 뒤 거릅니다.
- 응답 값은 전부 문자열입니다. 이 확장이 쉼표를 떼고 숫자로 바꿉니다(빈 값과 `-`는 null, 코드·이름·날짜는 글자 그대로).

## 신청 절차 (공식 "서비스 이용방법")

1. openapi.krx.co.kr 회원가입·로그인 (개인은 본인인증 또는 소셜 로그인)
2. 마이페이지 > API 인증키 신청 (2026-11-11에는 신청 즉시 발급됨)
3. 서비스 이용 > 분야 > API 상세 화면에서 **API 이용신청** (2026-11-11에는 신청 즉시 승인됨). 인증키만 받고 이 단계를 빼먹으면 401이 납니다
   - **API 하나씩 따로** 신청합니다. 승인되지 않은 API를 부르면 이 확장이 어느 화면에서 신청하는지 알려 줍니다.
   - 신청할 때 이용 기간(1·3·6·12개월)과 목적을 고릅니다. 기간이 끝나면 다시 신청해야 합니다.

## 설치

1. `security add-generic-password -s krx-api -a krx -w` (마지막 -w 뒤를 비우면 입력 창이 뜸)
   또는 Claude Desktop 확장 설정에 키 입력
2. `./pack.sh` → `krx-readonly.mcpb`를 Claude Desktop 설정 > 확장 프로그램에 끌어다 놓기

## 다른 에이전트에서 쓰기 (범용 MCP)

```json
{
  "mcpServers": {
    "krx": {
      "command": "node",
      "args": ["/path/to/finance-api-hub/krx/server/index.js"],
      "env": { "KRX_API_KEY": "..." }
    }
  }
}
```

맥에서 키를 키체인에 넣었다면 `env`는 비워도 됩니다. 맥이 아니면 환경변수가 필요합니다.

## 도구 (7개)와 공통 인자

| 도구 | 분야 | type |
|---|---|---|
| krx_index | 지수 | `krx` `kospi` `kosdaq` `bond` `derivative` |
| krx_stock | 주식 | `kospi` `kosdaq` `konex` `warrant` `right` `kospi_info` `kosdaq_info` `konex_info` |
| krx_etp | 증권상품 | `etf` `etn` `elw` |
| krx_bond | 채권 | `kts` `general` `small` |
| krx_derivative | 파생상품 | `futures` `stock_futures_kospi` `stock_futures_kosdaq` `options` `stock_options_kospi` `stock_options_kosdaq` |
| krx_commodity | 일반상품 | `oil` `gold` `emission` |
| krx_esg | ESG | `etp` `sri_bond` `index` |

| 인자 | 뜻 |
|---|---|
| `type` (필수) | 위 표의 종류 |
| `date` | 기준일자 YYYYMMDD. 비우면 어제부터 최대 10일 거슬러 자료가 있는 가장 최근 날 |
| `name_contains` | 이름(종목명·지수명·계열구분 등)에 이 글자가 든 것만 |
| `code` | 종목코드(단축·표준)로 거르기 |
| `sort_by`, `ascending` | 출력 항목명으로 정렬 (기본 내림차순, 빈 값은 항상 뒤) |
| `limit` | 표시할 행 수 (기본 50, 최대 3000) |
| `fields` | 필요한 출력 항목명만 고르기 |

- 출력의 키는 공식 화면의 한글 항목명입니다(예: `종가`, `거래대금`).
- `krx_stock`의 `kospi`·`kosdaq`·`konex`는 `market_summary`(상승·하락·보합 종목 수, 거래대금·시가총액 합계)를 함께 줍니다. 거르기 전 시장 전체 기준입니다.
- 같은 날 같은 API는 실행 중 한 번만 부릅니다(최근 30건 메모리 캐시). 정렬이나 거르기를 바꿔 다시 물어도 호출 한도를 쓰지 않습니다.

예: 어제 코스피 거래대금 상위 10 — `krx_stock(type="kospi", sort_by="거래대금", limit=10)`
예: 2024-08-05 KRX 반도체 지수 — `krx_index(type="krx", date="20240805", name_contains="반도체")`
예: 반도체 ETF의 NAV와 종가 — `krx_etp(type="etf", name_contains="반도체", fields=["종목명","종가","순자산가치(NAV)","순자산총액"])`

## KRX Open API 전체 목록 (공식 31개, 모두 지원)

요청: `GET https://data-dbg.krx.co.kr/svc/apis/{경로}?basDd=YYYYMMDD`, 헤더 `AUTH_KEY: {인증키}`

| 분야 | 공식 API 명 | 경로 | 제공 시작 | 도구 / type |
|---|---|---|---|---|
| 지수 | KRX 시리즈 일별시세정보 | idx/krx_dd_trd | 2010-01-04 | krx_index / krx |
| 지수 | KOSPI 시리즈 일별시세정보 | idx/kospi_dd_trd | 2010-01-04 | krx_index / kospi |
| 지수 | KOSDAQ 시리즈 일별시세정보 | idx/kosdaq_dd_trd | 2010-01-04 | krx_index / kosdaq |
| 지수 | 채권지수 시세정보 | idx/bon_dd_trd | 2010-01-04 | krx_index / bond |
| 지수 | 파생상품지수 시세정보 | idx/drvprod_dd_trd | 2010-01-04 | krx_index / derivative |
| 주식 | 유가증권 일별매매정보 | sto/stk_bydd_trd | 2010-01-04 | krx_stock / kospi |
| 주식 | 코스닥 일별매매정보 | sto/ksq_bydd_trd | 2010-01-04 | krx_stock / kosdaq |
| 주식 | 코넥스 일별매매정보 | sto/knx_bydd_trd | 2013-07-01 | krx_stock / konex |
| 주식 | 신주인수권증권 일별매매정보 | sto/sw_bydd_trd | 2010-01-04 | krx_stock / warrant |
| 주식 | 신주인수권증서 일별매매정보 | sto/sr_bydd_trd | 2010-02-12 | krx_stock / right |
| 주식 | 유가증권 종목기본정보 | sto/stk_isu_base_info | 2010-01-04 | krx_stock / kospi_info |
| 주식 | 코스닥 종목기본정보 | sto/ksq_isu_base_info | 2010-01-04 | krx_stock / kosdaq_info |
| 주식 | 코넥스 종목기본정보 | sto/knx_isu_base_info | 2013-07-01 | krx_stock / konex_info |
| 증권상품 | ETF 일별매매정보 | etp/etf_bydd_trd | 2010-01-04 | krx_etp / etf |
| 증권상품 | ETN 일별매매정보 | etp/etn_bydd_trd | 2014-11-17 | krx_etp / etn |
| 증권상품 | ELW 일별매매정보 | etp/elw_bydd_trd | 2010-01-04 | krx_etp / elw |
| 채권 | 국채전문유통시장 일별매매정보 | bon/kts_bydd_trd | 2010-01-04 | krx_bond / kts |
| 채권 | 일반채권시장 일별매매정보 | bon/bnd_bydd_trd | 2010-01-04 | krx_bond / general |
| 채권 | 소액채권시장 일별매매정보 | bon/smb_bydd_trd | 2010-01-04 | krx_bond / small |
| 파생상품 | 선물 일별매매정보 (주식선물外) | drv/fut_bydd_trd | 2010-01-04 | krx_derivative / futures |
| 파생상품 | 주식선물(유가) 일별매매정보 | drv/eqsfu_stk_bydd_trd | 2010-01-04 | krx_derivative / stock_futures_kospi |
| 파생상품 | 주식선물(코스닥) 일별매매정보 | drv/eqkfu_ksq_bydd_trd | 2015-08-03 | krx_derivative / stock_futures_kosdaq |
| 파생상품 | 옵션 일별매매정보 (주식옵션外) | drv/opt_bydd_trd | 2010-01-04 | krx_derivative / options |
| 파생상품 | 주식옵션(유가) 일별매매정보 | drv/eqsop_bydd_trd | 2010-01-04 | krx_derivative / stock_options_kospi |
| 파생상품 | 주식옵션(코스닥) 일별매매정보 | drv/eqkop_bydd_trd | 2017-06-26 | krx_derivative / stock_options_kosdaq |
| 일반상품 | 석유시장 일별매매정보 | gen/oil_bydd_trd | 2012-03-30 | krx_commodity / oil |
| 일반상품 | 금시장 일별매매정보 | gen/gold_bydd_trd | 2014-03-24 | krx_commodity / gold |
| 일반상품 | 배출권 시장 일별매매정보 | gen/ets_bydd_trd | 2015-01-12 | krx_commodity / emission |
| ESG | ESG 증권상품 | esg/esg_etp_info | 2020-01-02 | krx_esg / etp |
| ESG | 사회책임투자채권 정보 | esg/sri_bond_info | 2019-01-01 | krx_esg / sri_bond |
| ESG | ESG 지수 | esg/esg_index_info | 2020-01-02 | krx_esg / index |

출력 항목(항목명과 출력명)은 `server/index.js`의 명세 표에 공식 화면 순서 그대로 있고, 각 도구 설명에도 type별로 들어 있습니다.

## 다른 확장과 겹치는 부분

| 필요한 것 | 쓸 곳 |
|---|---|
| 당일·장중 시세, 투자자별 수급, 공매도, 섹터 순위 | [토스](../toss) (KRX Open API에는 수급·공매도가 없음) |
| 금리 | [ECOS](../ecos) |
| 과거 특정일의 전 종목 스냅샷, 공식 업종지수 전체, ETF NAV·순자산총액, 선물·옵션 미결제약정 | **이 확장** |

## 시험

`node test/offline.test.js` — 로컬 가짜 서버로 공식 31개 명세(경로·항목 수) 대조, 값 변환, 주소·`AUTH_KEY` 헤더·GET, 시장 요약, 정렬·거르기·항목 고르기, 하루 캐시, 최근 영업일 찾기, 자료 없는 날, 인자 오류 사전 차단, 미승인 API 안내·키 가림·한도 초과, 래퍼로 불러온 MCP 통신(7개 도구)

## 변경 이력

- v0.1.0 (2026-11-10): 첫 판. 공식 31개 서비스 전부, 분야별 도구 7개
