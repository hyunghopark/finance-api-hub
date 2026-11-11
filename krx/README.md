# 한국거래소 KRX MCP 서버 (`krx-readonly`)

한국거래소 KRX Open API를 조회 전용으로 제공하는 MCP 서버입니다. 공식 31개 서비스를 모두 지원합니다.

| 항목 | 내용 |
|---|---|
| 버전 | 0.1.0 |
| 대상 API | [KRX Open API](https://openapi.krx.co.kr) 31개 서비스 전부 |
| 호출 대상 | `data-dbg.krx.co.kr` 고정, GET만 사용 |
| 인증 | `KRX_API_KEY` 환경변수, 없으면 macOS 키체인(서비스 `krx-api`, 계정 `krx`). 요청 헤더 `AUTH_KEY`로 전달 |
| 런타임 | Node.js 18 이상, 외부 패키지 없음 |

## KRX Open API의 특성

- **일별 자료만 제공합니다.** 실시간·당일 장중 값은 없으며, 전일 자료는 다음 영업일 오전에 조회할 수 있습니다.
- 2010년 이후 자료를 제공합니다. 일부 서비스는 시장 개설일부터 제공합니다.
- 요청 인자는 기준일자(`basDd`, YYYYMMDD) 하나이며, 한 번의 호출에 **해당일 시장 전체**가 반환됩니다. 종목 단위 요청이 없으므로 이 서버가 응답을 받은 뒤 걸러 냅니다.
- 응답 값은 모두 문자열입니다. 이 서버가 쉼표를 제거하고 숫자로 변환합니다. 빈 값과 `-`는 null로, 코드·이름·날짜는 문자열 그대로 둡니다.
- 투자자별 매매동향, 공매도, PER·PBR 등은 Open API에 포함되어 있지 않습니다.

## 도구

분야별로 도구 7개를 제공하며, `type` 인자로 서비스를 선택합니다.

| 도구 | 분야 | `type` |
|---|---|---|
| `krx_index` | 지수 | `krx` `kospi` `kosdaq` `bond` `derivative` |
| `krx_stock` | 주식 | `kospi` `kosdaq` `konex` `warrant` `right` `kospi_info` `kosdaq_info` `konex_info` |
| `krx_etp` | 증권상품 | `etf` `etn` `elw` |
| `krx_bond` | 채권 | `kts` `general` `small` |
| `krx_derivative` | 파생상품 | `futures` `stock_futures_kospi` `stock_futures_kosdaq` `options` `stock_options_kospi` `stock_options_kosdaq` |
| `krx_commodity` | 일반상품 | `oil` `gold` `emission` |
| `krx_esg` | ESG | `etp` `sri_bond` `index` |

### 공통 인자

| 인자 | 설명 |
|---|---|
| `type` (필수) | 조회할 서비스 |
| `date` | 기준일자 YYYYMMDD. 생략하면 전일부터 최대 10일을 거슬러 자료가 있는 가장 최근 날짜를 조회 |
| `name_contains` | 이름(종목명, 지수명, 계열구분 등)에 해당 문자열이 포함된 행만 반환 |
| `code` | 종목코드(단축 또는 표준)로 필터 |
| `sort_by`, `ascending` | 출력 항목명 기준 정렬. 기본은 내림차순이며 빈 값은 항상 뒤에 배치 |
| `limit` | 반환할 행 수 (기본 50, 최대 3000) |
| `fields` | 반환할 출력 항목명 목록 |

- 출력 키는 공식 명세의 한글 항목명입니다(예: `종가`, `거래대금`).
- `krx_stock`의 `kospi`, `kosdaq`, `konex`는 `market_summary`(상승·하락·보합 종목 수, 거래대금·시가총액 합계)를 함께 반환합니다. 필터 적용 전 시장 전체 기준입니다.
- 같은 날짜·같은 서비스의 응답은 실행 중 메모리에 캐시(최근 30건)하므로, 정렬이나 필터만 바꾼 재조회는 API를 다시 호출하지 않습니다.
- `date`를 생략한 경우 응답의 `date`로 실제 기준일을 확인하세요.

### 사용 예

```
krx_stock(type="kospi", sort_by="거래대금", limit=10)
krx_index(type="krx", date="20240805", name_contains="반도체")
krx_etp(type="etf", name_contains="반도체", fields=["종목명", "종가", "순자산가치(NAV)", "순자산총액"])
krx_index(type="derivative", name_contains="변동성")
```

## 설치

### 인증키와 API 이용신청

KRX Open API는 인증키와 별도로 **서비스마다 이용신청**이 필요합니다.

1. [openapi.krx.co.kr](https://openapi.krx.co.kr)에 가입하고 로그인합니다.
2. 마이페이지 > API 인증키 신청에서 인증키를 발급받습니다.
3. 서비스 이용 > 분야 > 서비스 상세 화면에서 **API 이용신청**을 합니다. 이용 기간(1·3·6·12개월)과 목적을 선택하며, 기간이 끝나면 다시 신청해야 합니다.

이용신청이 승인되지 않은 서비스를 호출하면 `401 Unauthorized API Call`이 반환되고, 이 서버는 신청할 화면의 위치를 안내합니다. 2026-11-11 기준으로 인증키 발급과 이용신청 모두 신청 즉시 승인되었습니다.

인증키는 환경변수 `KRX_API_KEY`로 전달하거나 macOS 키체인에 넣습니다.

```bash
security add-generic-password -s krx-api -a krx -w
```

### MCP 클라이언트에 등록

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

키체인을 쓰는 경우 `env`는 비워도 됩니다.

### Claude Desktop 확장

`./pack.sh`로 `krx-readonly.mcpb`를 만든 뒤 Claude Desktop의 설정 > 확장 프로그램에 끌어다 놓습니다. 확장 설정에서 키를 입력하거나 바꾼 경우 확장을 껐다 켜야 적용됩니다.

## API 지원 범위

요청 형식: `GET https://data-dbg.krx.co.kr/svc/apis/{경로}?basDd=YYYYMMDD`, 헤더 `AUTH_KEY: {인증키}`

| 분야 | 서비스 | 경로 | 제공 시작일 | 도구 / `type` |
|---|---|---|---|---|
| 지수 | KRX 시리즈 일별시세정보 | `idx/krx_dd_trd` | 2010-01-04 | `krx_index` / `krx` |
| 지수 | KOSPI 시리즈 일별시세정보 | `idx/kospi_dd_trd` | 2010-01-04 | `krx_index` / `kospi` |
| 지수 | KOSDAQ 시리즈 일별시세정보 | `idx/kosdaq_dd_trd` | 2010-01-04 | `krx_index` / `kosdaq` |
| 지수 | 채권지수 시세정보 | `idx/bon_dd_trd` | 2010-01-04 | `krx_index` / `bond` |
| 지수 | 파생상품지수 시세정보 | `idx/drvprod_dd_trd` | 2010-01-04 | `krx_index` / `derivative` |
| 주식 | 유가증권 일별매매정보 | `sto/stk_bydd_trd` | 2010-01-04 | `krx_stock` / `kospi` |
| 주식 | 코스닥 일별매매정보 | `sto/ksq_bydd_trd` | 2010-01-04 | `krx_stock` / `kosdaq` |
| 주식 | 코넥스 일별매매정보 | `sto/knx_bydd_trd` | 2013-07-01 | `krx_stock` / `konex` |
| 주식 | 신주인수권증권 일별매매정보 | `sto/sw_bydd_trd` | 2010-01-04 | `krx_stock` / `warrant` |
| 주식 | 신주인수권증서 일별매매정보 | `sto/sr_bydd_trd` | 2010-02-12 | `krx_stock` / `right` |
| 주식 | 유가증권 종목기본정보 | `sto/stk_isu_base_info` | 2010-01-04 | `krx_stock` / `kospi_info` |
| 주식 | 코스닥 종목기본정보 | `sto/ksq_isu_base_info` | 2010-01-04 | `krx_stock` / `kosdaq_info` |
| 주식 | 코넥스 종목기본정보 | `sto/knx_isu_base_info` | 2013-07-01 | `krx_stock` / `konex_info` |
| 증권상품 | ETF 일별매매정보 | `etp/etf_bydd_trd` | 2010-01-04 | `krx_etp` / `etf` |
| 증권상품 | ETN 일별매매정보 | `etp/etn_bydd_trd` | 2014-11-17 | `krx_etp` / `etn` |
| 증권상품 | ELW 일별매매정보 | `etp/elw_bydd_trd` | 2010-01-04 | `krx_etp` / `elw` |
| 채권 | 국채전문유통시장 일별매매정보 | `bon/kts_bydd_trd` | 2010-01-04 | `krx_bond` / `kts` |
| 채권 | 일반채권시장 일별매매정보 | `bon/bnd_bydd_trd` | 2010-01-04 | `krx_bond` / `general` |
| 채권 | 소액채권시장 일별매매정보 | `bon/smb_bydd_trd` | 2010-01-04 | `krx_bond` / `small` |
| 파생상품 | 선물 일별매매정보 (주식선물 제외) | `drv/fut_bydd_trd` | 2010-01-04 | `krx_derivative` / `futures` |
| 파생상품 | 주식선물(유가) 일별매매정보 | `drv/eqsfu_stk_bydd_trd` | 2010-01-04 | `krx_derivative` / `stock_futures_kospi` |
| 파생상품 | 주식선물(코스닥) 일별매매정보 | `drv/eqkfu_ksq_bydd_trd` | 2015-08-03 | `krx_derivative` / `stock_futures_kosdaq` |
| 파생상품 | 옵션 일별매매정보 (주식옵션 제외) | `drv/opt_bydd_trd` | 2010-01-04 | `krx_derivative` / `options` |
| 파생상품 | 주식옵션(유가) 일별매매정보 | `drv/eqsop_bydd_trd` | 2010-01-04 | `krx_derivative` / `stock_options_kospi` |
| 파생상품 | 주식옵션(코스닥) 일별매매정보 | `drv/eqkop_bydd_trd` | 2017-06-26 | `krx_derivative` / `stock_options_kosdaq` |
| 일반상품 | 석유시장 일별매매정보 | `gen/oil_bydd_trd` | 2012-03-30 | `krx_commodity` / `oil` |
| 일반상품 | 금시장 일별매매정보 | `gen/gold_bydd_trd` | 2014-03-24 | `krx_commodity` / `gold` |
| 일반상품 | 배출권 시장 일별매매정보 | `gen/ets_bydd_trd` | 2015-01-12 | `krx_commodity` / `emission` |
| ESG | ESG 증권상품 | `esg/esg_etp_info` | 2020-01-02 | `krx_esg` / `etp` |
| ESG | 사회책임투자채권 정보 | `esg/sri_bond_info` | 2019-01-01 | `krx_esg` / `sri_bond` |
| ESG | ESG 지수 | `esg/esg_index_info` | 2020-01-02 | `krx_esg` / `index` |

서비스별 출력 항목(항목명과 출력명)은 `server/index.js`의 명세 표에 공식 화면 순서대로 정의되어 있으며, 각 도구의 설명에도 포함됩니다. 명세는 2026-11-10에 공식 사이트의 서비스 상세 화면 31개에서 수집했습니다.

## 검증 내역

2026-11-11에 아래 8개 서비스를 실제 호출해 요청 주소, 응답 구조(`OutBlock_1` 배열), 값 변환을 확인했습니다.

| 서비스 | 확인 내용 (2026-11-10 자료) |
|---|---|
| KOSPI 시리즈 지수 | 지수 54개 |
| KOSDAQ 시리즈 지수 | 지수 40개 |
| KRX 시리즈 지수 | 지수 40개 |
| 파생상품지수 | 지수 323개. 코스피 200 변동성지수(VKOSPI) 포함 |
| 유가증권 일별매매정보 | 936종목, 시장 요약 계산 |
| 코스닥 일별매매정보 | 1,832종목, 시장 요약 계산 |
| 유가증권 종목기본정보 | 표준코드·단축코드 검색 |
| ETF 일별매매정보 | 1,190종목, NAV·순자산총액·기초지수 |

- 나머지 23개 서비스는 같은 요청·응답 구조를 전제로 구현했으며 실제 호출로는 검증하지 않았습니다. 응답 배열의 이름이 다르더라도 처리하도록 구현되어 있습니다.
- 지수 응답의 "코스피 (외국주포함)", "코스닥 (외국주포함)" 행은 종가와 등락률 없이 거래량·거래대금·시가총액만 제공됩니다.
- 자료 반영 시각은 [DATA_TIMING.md](../DATA_TIMING.md)를 참고하세요.

## 테스트

```bash
node test/offline.test.js
```

로컬 모의 서버로 31개 서비스 명세(경로, 항목 수), 값 변환, 요청 주소와 `AUTH_KEY` 헤더, 시장 요약, 정렬·필터·항목 선택, 캐시, 최근 영업일 탐색, 자료 없는 날짜, 인자 오류의 사전 차단, 미승인 서비스 안내, 인증키 가림, 호출 한도 초과, MCP 통신(도구 7개)을 검증합니다.

## 변경 이력

| 버전 | 날짜 | 내용 |
|---|---|---|
| 0.1.0 | 2026-11-10 | 최초 릴리스. 31개 서비스 전부 지원, 분야별 도구 7개 |
