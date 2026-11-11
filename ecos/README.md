# 한국은행 ECOS MCP 서버 (`ecos-readonly`)

한국은행 경제통계시스템(ECOS) Open API를 조회 전용으로 제공하는 MCP 서버입니다.

| 항목 | 내용 |
|---|---|
| 버전 | 0.1.1 |
| 대상 API | [ECOS Open API](https://ecos.bok.or.kr/api) 6개 서비스 전부 |
| 호출 대상 | `ecos.bok.or.kr` 고정, GET만 사용 |
| 인증 | `ECOS_API_KEY` 환경변수, 없으면 macOS 키체인(서비스 `ecos-api`, 계정 `ecos`) |
| 캐시 | 통계표 목록 `~/.ecos-mcp/tables.json` (7일, 권한 600) |
| 런타임 | Node.js 18 이상, 외부 패키지 없음 |

ECOS는 인증키가 요청 주소의 경로에 들어가므로, 이 서버는 오류 메시지에서 키 문자열을 가립니다.

## 도구

| 도구 | ECOS 서비스 | 설명 |
|---|---|---|
| `ecos_market_rates` | StatisticSearch (817Y002) | 시장금리 27개 항목을 날짜별 표로 조회. 신용 스프레드(회사채 AA- − 국고채 3년)와 국고채 10년−3년 금리차(bp)를 함께 계산 |
| `ecos_search` | StatisticSearch | 임의 통계의 시계열 조회 |
| `ecos_items` | StatisticItemList | 통계표의 항목 코드, 가중치, 상위 항목 조회 |
| `ecos_find_table` | StatisticTableList | 통계표 코드 검색. `parent_code`로 분류 트리 탐색 |
| `ecos_key_stats` | KeyStatisticList | 100대 통계지표 최신값 |
| `ecos_word` | StatisticWord | 통계용어사전 |
| `ecos_meta` | StatisticMeta | 통계 작성 방법과 공표 시기 |

일반 통계는 `ecos_find_table` → `ecos_items` → `ecos_search` 순서로 조회합니다.

## 설치

### 인증키

[ecos.bok.or.kr/api](https://ecos.bok.or.kr/api)에서 인증키를 발급받아 환경변수 `ECOS_API_KEY`로 전달합니다. macOS에서는 키체인에 넣어 둘 수도 있습니다.

```bash
security add-generic-password -s ecos-api -a ecos -w
```

### MCP 클라이언트에 등록

```json
{
  "mcpServers": {
    "ecos": {
      "command": "node",
      "args": ["/path/to/finance-api-hub/ecos/server/index.js"],
      "env": { "ECOS_API_KEY": "..." }
    }
  }
}
```

키체인을 쓰는 경우 `env`는 비워도 됩니다.

### Claude Desktop 확장

`./pack.sh`로 `ecos-readonly.mcpb`를 만든 뒤 Claude Desktop의 설정 > 확장 프로그램에 끌어다 놓습니다. 확장 설정에서 키를 입력하거나 바꾼 경우 확장을 껐다 켜야 적용됩니다.

## API 지원 범위

요청 주소 형식은 다음과 같습니다. 앞의 6개 인자는 모든 서비스에 공통이며 필수입니다. 이 서버는 `json`과 `kr`만 사용합니다.

```
https://ecos.bok.or.kr/api/{서비스명}/{인증키}/{json|xml}/{kr|en}/{요청시작건수}/{요청종료건수}/{추가 인자...}
```

| 서비스 | 추가 요청 인자 | 출력 항목 | 도구 |
|---|---|---|---|
| StatisticTableList (서비스 통계 목록) | 통계표코드 (선택) | P_STAT_CODE, STAT_CODE, STAT_NAME, CYCLE, SRCH_YN, ORG_NAME | `ecos_find_table` |
| StatisticWord (통계용어사전) | 용어 (필수) | WORD, CONTENT | `ecos_word` |
| StatisticItemList (통계 세부항목 목록) | 통계표코드 (필수) | STAT_CODE, STAT_NAME, GRP_CODE, GRP_NAME, ITEM_CODE, ITEM_NAME, P_ITEM_CODE, P_ITEM_NAME, CYCLE, START_TIME, END_TIME, DATA_CNT, UNIT_NAME, WEIGHT | `ecos_items` |
| StatisticSearch (통계 조회 조건 설정) | 통계표코드·주기·검색시작일자·검색종료일자 (필수), 통계항목코드 1~4 (선택) | STAT_CODE, STAT_NAME, ITEM_CODE1~4, ITEM_NAME1~4, UNIT_NAME, WGT, TIME, DATA_VALUE | `ecos_search`, `ecos_market_rates` |
| KeyStatisticList (100대 통계지표) | 없음 | CLASS_NAME, KEYSTAT_NAME, DATA_VALUE, CYCLE, UNIT_NAME | `ecos_key_stats` |
| StatisticMeta (통계메타DB) | 데이터명 (필수) | LVL, P_CONT_CODE, CONT_CODE, CONT_NAME, META_DATA | `ecos_meta` |

출력 항목은 모두 보존합니다. 다만 `ecos_meta`는 내용이 빈 제목 행과 코드 2개(P_CONT_CODE, CONT_CODE)를 제외합니다.

### 주기와 날짜 형식

| 주기 | 코드 | 날짜 형식 예 |
|---|---|---|
| 연 | `A` | 2026 |
| 반년 | `S` | 2026S1 |
| 분기 | `Q` | 2026Q3 |
| 월 | `M` | 202610 |
| 반월 | `SM` | 202610S1 |
| 일 | `D` | 20261109 |

항목 코드를 중간에서 비울 때는 `?`를 `%3F`로 인코딩해 보내면 "전체"로 동작합니다. 끝쪽의 빈 항목은 생략합니다.

### 오류 코드

| 코드 | 의미 |
|---|---|
| 정보-100 | 인증키 오류 |
| 정보-200 | 데이터 없음 (이 서버는 빈 결과로 반환) |
| 에러-100 | 필수 값 누락 |
| 에러-101 | 주기와 날짜 형식 불일치 |
| 에러-300, 301 | 조회 건수 오류 |
| 에러-400 | 60초 시간 초과 |
| 에러-500 | 서버 오류 |
| 에러-600, 601 | DB 오류 |
| 에러-602 | 과도한 호출로 이용 제한 |

## 데이터 범위

통계표는 844개이며, 그중 조회 가능한 통계표가 617개이고 나머지 227개는 분류 제목입니다(2026-11-09 기준).

### 시장금리 일별 (817Y002)

27개 항목 모두 `ecos_market_rates`에서 선택할 수 있습니다. 공식 항목 목록과의 일치 여부는 테스트로 고정되어 있습니다.

| 키 | 항목 | 코드 | 기본 표시 |
|---|---|---|---|
| call | 콜금리(1일, 전체거래) | 010101000 | |
| callBroker | 콜금리(1일, 중개회사거래) | 010102000 | |
| callBankSec | 콜금리(1일, 은행증권금융차입) | 010103000 | |
| kofr | KOFR(공시RFR) | 010901000 | |
| cd91 | CD(91일) | 010502000 | ○ |
| cp91 | CP(91일) | 010503000 | |
| koribor3m | KORIBOR(3개월) | 010150000 | |
| koribor6m | KORIBOR(6개월) | 010151000 | |
| koribor12m | KORIBOR(12개월) | 010152000 | |
| msb91d | 통안증권(91일) | 010400000 | |
| msb1y | 통안증권(1년) | 010400001 | |
| msb2y | 통안증권(2년) | 010400002 | |
| ktb1y | 국고채(1년) | 010190000 | |
| ktb2y | 국고채(2년) | 010195000 | ○ |
| ktb3y | 국고채(3년) | 010200000 | ○ |
| ktb5y | 국고채(5년) | 010200001 | ○ |
| ktb10y | 국고채(10년) | 010210000 | ○ |
| ktb20y | 국고채(20년) | 010220000 | |
| ktb30y | 국고채(30년) | 010230000 | ○ |
| ktb50y | 국고채(50년) | 010240000 | |
| kdb1y | 산금채(1년) | 010260000 | |
| housing5y | 국민주택채권1종(5년) | 010503500 | |
| corpAA | 회사채(3년, AA-) | 010300000 | ○ |
| corpAAmp | 회사채(3년, AA-, 민평) | 010310000 | |
| corpBBB | 회사채(3년, BBB-) | 010320000 | ○ |
| mmf7d | MMF(7일) | 010501000 | |
| cma | CMA(수시형) | 010504000 | |

### 자주 쓰는 통계표 코드

| 코드 | 통계표 | 주기 | 비고 |
|---|---|---|---|
| 722Y001 | 한국은행 기준금리 및 여수신금리 | 일 | 기준금리 항목 0101000 |
| 817Y002 | 시장금리(일별) | 일 | 위 27개 항목 |
| 721Y001 | 시장금리(월·분기·년) | 월 | |
| 901Y009 | 소비자물가지수 | 월·분기·연 | 품목 1,743개, 품목별 가중치 제공 |
| 513Y001 | 경제심리지수 | 월 | |
| 901Y056 | 증시주변자금동향 | 월·연 | 투자자 예탁금 S23A, 장내파생 예수금 S23B, RP S23C, 위탁매매 미수금 S23D, 신용융자 잔고 S23E, 신용대주 잔고 S23F (단위 원) |
| 802Y001 | 주식시장(일) | 일 | 출처 한국거래소 |
| 200Y101, 200Y102 | 국민계정 주요지표 (연간, 분기) | 연, 분기 | |

분류 트리 탐색 예: `ecos_find_table(parent_code="0000000398")`은 증권시장 분류의 통계표 6개를 반환합니다.

## 검증 내역

실제 호출로 확인한 내용입니다.

- **값의 일치**: 국고채 3년·10년, 회사채 AA- 3년, 신용 스프레드가 금융투자협회 자료를 인용한 당일 기사 값과 2026-11-04, 05, 06, 09, 10의 5거래일 모두 일치했습니다.
- **반영 시각**: 시장금리 당일 값은 20:13 조회 시 이미 제공되었고 20:35 재조회 때도 같았습니다(2026-11-10).
- **민평 회사채**: `corpAAmp`는 당일에는 빈 값이고 다음 날 채워집니다.

다른 제공처와의 비교는 [DATA_TIMING.md](../DATA_TIMING.md)를 참고하세요.

## 테스트

```bash
node test/offline.test.js
```

로컬 모의 서버로 주소 형식(`%3F` 처리, 빈 항목 생략), 오류 처리, 스프레드 계산, 빈 값 처리, 시장금리 27개 항목의 공식 목록 대조, 가중치와 상위 코드 보존, 분류 트리 탐색, MCP 통신(도구 7개), 인증키 없음 안내를 검증합니다. 테스트 캐시는 임시 폴더에만 기록합니다.

## 변경 이력

| 버전 | 날짜 | 내용 |
|---|---|---|
| 0.1.1 | 2026-11-09 | 가중치(WEIGHT, WGT), 상위 통계표·항목 코드, 그룹 코드를 출력에 보존. 분류 트리 탐색(`parent_code`) 추가. 시장금리 27개 항목 전체 지원 |
| 0.1.0 | 2026-11-09 | 최초 릴리스 |
