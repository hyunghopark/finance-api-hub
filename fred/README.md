# FRED 미국 경제 데이터 조회 전용 MCP (Claude Desktop 확장)

세인트루이스 연준 FRED API(https://fred.stlouisfed.org/docs/api/fred/)를 조회만 하는 확장입니다. [DART](../dart)·[ECOS](../ecos) 확장과 같은 방식입니다.

- 현재 버전: **v0.1.1**
- 외부 패키지 없음 (Node 18+ 내장 모듈만), 호출 주소 `api.stlouisfed.org` 고정, GET만, v1 경로 31개 허용 목록
- 키: 확장 설정 → 없으면 맥 키체인(서비스 `fred-api`, 계정 `fred`). 키는 32자리 영문 소문자·숫자, 쿼리 `api_key`로 전달. 오류 메시지에서 키를 가림
- 요청 한도: 분당 120회(넘으면 429, 계속 넘기면 일시 차단될 수 있음) → 요청 사이 0.55초 간격, 동시 요청도 줄 세움, 429는 20초 뒤 한 번만 재시도
- 응답 형식은 항상 JSON(`file_type=json` 고정)

## 공식 FRED MCP 커넥터와의 관계

세인트루이스 연준은 **공식 FRED MCP Connector**(`https://mcp.stlouisfed.org`, 무료, API 키 대신 별도 커넥터 계정, 도구 5개: 시리즈 검색·메타데이터·관측값·다운로드 링크·그래프)를 직접 운영합니다(2026-11-10 FRED 도움말 확인). 원격 커넥터라 PC가 꺼져 있어도 쓸 수 있으니, 검색·관측값만 필요하면 그쪽이 간편합니다.

이 서버는 공식 FRED API(v1)를 직접 부르는 로컬 MCP로, 공식 커넥터에 없는 것을 채웁니다.

| 기능 | 공식 커넥터 | 이 서버 |
|---|---|---|
| 시리즈 검색·메타·관측값(변환·주기 집계) | ○ | ○ |
| 그래프·다운로드 링크 | ○ | × |
| 경제지표 발표 일정(미래 포함) | × | ○ `fred_release_calendar` |
| 묶음 조회(금리 곡선·스프레드·유동성·경기)와 순유동성 계산 | × | ○ `fred_bundle` |
| 카테고리·태그·릴리스 표·과거 시점 값 등 v1 31개 경로 | × | ○ `fred_get` |
| 키 | 커넥터 계정 | FRED API 키 |

그 밖의 공개 FRED MCP(예: stefanoamorelli/fred-mcp-server)는 연준과 무관한 개인 프로젝트이고 외부 패키지 빌드가 필요합니다. 이 저장소 원칙(공식 API만, 조회 전용, 외부 패키지 없음)에 맞추려고 직접 만들었습니다.

## 설치

1. `./pack.sh` → `fred-readonly.mcpb`를 Claude Desktop 설정 > 확장 프로그램에 끌어다 놓기
2. 확장 설정에 키 입력 → **확장을 껐다 켜기** (키는 서버가 시작될 때만 전달됨). 또는 `security add-generic-password -s fred-api -a fred -w`
3. 설치·재설치 때 Desktop이 모든 로컬 확장을 다시 켬 → 다른 확장을 쓰는 예약 작업 시각 근처는 피하기

## 다른 에이전트에서 쓰기 (범용 MCP)

Claude Desktop이 아니어도 MCP를 지원하는 에이전트라면 아래처럼 등록합니다. 경로는 이 저장소를 받은 위치로 바꾸세요.

```json
{
  "mcpServers": {
    "fred": {
      "command": "node",
      "args": ["/path/to/finance-api-hub/fred/server/index.js"],
      "env": { "FRED_API_KEY": "..." }
    }
  }
}
```

맥에서 키를 키체인(서비스 `fred-api`, 계정 `fred`)에 넣었다면 `env`는 비워도 됩니다. 맥이 아니면 환경변수가 필요합니다.

## 도구 (6개)

| 도구 | FRED API | 용도 |
|---|---|---|
| fred_bundle | series, series/observations | 브리핑 묶음 4종. 항목마다 최신값·관측일·직전 대비·1주 전 대비(일간)·FRED 갱신 시각. liquidity는 순유동성 표 추가 |
| fred_observations | series/observations | 여러 시리즈(최대 10개) 날짜별 표. units 변환, frequency 집계 |
| fred_search | series/search | 시리즈 검색 (전문 검색 / ID 패턴) |
| fred_series_info | series, series/release, release/dates | 시리즈 설명·소속 릴리스·다음 발표일 |
| fred_release_calendar | releases/dates | 경제지표 발표 일정(미래 포함). 이름 글자로 거름 |
| fred_get | v1 경로 31개 | 위에 없는 것 (카테고리 트리, 릴리스 표, 태그, 수정 이력 등) |

### 브리핑 묶음 시리즈 (35개, 2026-11-10 FRED 공개 페이지로 모두 존재 확인)

**rates** — 미국 금리 곡선·분해

| 시리즈 | 이름 | 변환 |
|---|---|---|
| `DGS3MO` | 3개월 | 그대로 |
| `DGS2` | 2년 | 그대로 |
| `DGS5` | 5년 | 그대로 |
| `DGS10` | 10년 | 그대로 |
| `DGS30` | 30년 | 그대로 |
| `T10Y2Y` | 10년−2년 | 그대로 |
| `T10Y3M` | 10년−3개월 | 그대로 |
| `T10YIE` | 10년 기대인플레(BEI) | 그대로 |
| `DFII10` | 10년 실질금리(TIPS) | 그대로 |
| `T5YIFR` | 5년 후 5년 기대인플레 | 그대로 |
| `DFEDTARU` | 연방기금 목표 상단 | 그대로 |
| `EFFR` | 실효 연방기금금리 | 그대로 |

**credit** — 신용·금융 스트레스

| 시리즈 | 이름 | 변환 |
|---|---|---|
| `BAMLH0A0HYM2` | 하이일드 스프레드(OAS) | 그대로 |
| `BAMLC0A4CBBB` | BBB 스프레드(OAS) | 그대로 |
| `BAMLC0A0CM` | 투자등급 스프레드(OAS) | 그대로 |
| `BAMLH0A0HYM2EY` | 하이일드 실효수익률 | 그대로 |
| `VIXCLS` | VIX | 그대로 |
| `STLFSI4` | 세인트루이스 연준 금융스트레스(주간) | 그대로 |
| `NFCI` | 시카고 연준 금융여건(주간) | 그대로 |

**liquidity** — 연준·달러 유동성

| 시리즈 | 이름 | 변환 |
|---|---|---|
| `WALCL` | 연준 총자산(주간, 수요일) | 그대로 |
| `WTREGEN` | 재무부 일반계정 TGA(주간) | 그대로 |
| `RRPONTSYD` | 역레포(일간) | 그대로 |
| `WRESBAL` | 지급준비금(주간) | 그대로 |
| `SOFR` | SOFR | 그대로 |
| `EFFR` | 실효 연방기금금리 | 그대로 |

**macro** — 미국 경기·물가

| 시리즈 | 이름 | 변환 |
|---|---|---|
| `CPIAUCSL` | CPI 전년비(%) | pc1 |
| `CPILFESL` | 근원 CPI 전년비(%) | pc1 |
| `PCEPI` | PCE 물가 전년비(%) | pc1 |
| `PCEPILFE` | 근원 PCE 전년비(%) | pc1 |
| `PAYEMS` | 비농업 고용 전월비(천 명) | chg |
| `UNRATE` | 실업률(%) | 그대로 |
| `ICSA` | 신규 실업수당 청구(주간) | 그대로 |
| `CCSA` | 계속 실업수당 청구(주간) | 그대로 |
| `UMCSENT` | 미시간대 소비자심리 | 그대로 |
| `INDPRO` | 산업생산 전년비(%) | pc1 |
| `IPG3344S` | 반도체·전자부품 산업생산 전년비(%) | pc1 |

순유동성 어림값 = 연준 총자산(WALCL) − TGA(WTREGEN) − 역레포(RRPONTSYD). 시장에서 쓰는 어림식이며 공식 지표가 아닙니다. 세 시리즈의 단위가 달라(백만·십억 달러) FRED가 알려 주는 단위를 읽어 맞춘 뒤 십억 달러로 표시합니다. WALCL·TGA는 수요일 기준 주간, 역레포는 그 수요일 또는 직전 영업일 값입니다.

## FRED API 전체 목록

2026-11-10 공식 문서 기준. **v1 경로 31개는 모두 `fred_get`으로 조회 가능**하고, 그중 6개는 전용 도구가 씁니다.

### Categories (6)

| 경로 | 용도 | 이 확장 |
|---|---|---|
| `fred/category` | 카테고리 정보 | fred_get |
| `fred/category/children` | 하위 카테고리 | fred_get |
| `fred/category/related` | 관련 카테고리 | fred_get |
| `fred/category/series` | 카테고리의 시리즈 | fred_get |
| `fred/category/tags` | 카테고리의 태그 | fred_get |
| `fred/category/related_tags` | 카테고리의 관련 태그 | fred_get |

### Releases (9)

| 경로 | 용도 | 이 확장 |
|---|---|---|
| `fred/releases` | 전체 릴리스(발표 자료) 목록 | fred_get |
| `fred/releases/dates` | 전체 릴리스 발표일 | fred_release_calendar · fred_get |
| `fred/release` | 릴리스 정보 | fred_get |
| `fred/release/dates` | 릴리스 발표일 | fred_series_info (다음 발표일) · fred_get |
| `fred/release/series` | 릴리스의 시리즈 | fred_get |
| `fred/release/sources` | 릴리스의 출처 | fred_get |
| `fred/release/tags` | 릴리스의 태그 | fred_get |
| `fred/release/related_tags` | 릴리스의 관련 태그 | fred_get |
| `fred/release/tables` | 릴리스 표 구조 | fred_get |

### Series (10)

| 경로 | 용도 | 이 확장 |
|---|---|---|
| `fred/series` | 시리즈 정보 | fred_series_info, 모든 묶음(단위·갱신 시각) · fred_get |
| `fred/series/categories` | 시리즈의 카테고리 | fred_get |
| `fred/series/observations` | 시리즈 관측값 | fred_observations, fred_bundle · fred_get |
| `fred/series/release` | 시리즈의 릴리스 | fred_series_info · fred_get |
| `fred/series/search` | 시리즈 검색 | fred_search · fred_get |
| `fred/series/search/tags` | 검색어의 태그 | fred_get |
| `fred/series/search/related_tags` | 검색어의 관련 태그 | fred_get |
| `fred/series/tags` | 시리즈의 태그 | fred_get |
| `fred/series/updates` | 최근 갱신된 시리즈 | fred_get |
| `fred/series/vintagedates` | 시리즈 수정 이력 날짜 | fred_get |

### Sources (3)

| 경로 | 용도 | 이 확장 |
|---|---|---|
| `fred/sources` | 전체 출처 | fred_get |
| `fred/source` | 출처 정보 | fred_get |
| `fred/source/releases` | 출처의 릴리스 | fred_get |

### Tags (3)

| 경로 | 용도 | 이 확장 |
|---|---|---|
| `fred/tags` | 전체 태그 | fred_get |
| `fred/related_tags` | 관련 태그 | fred_get |
| `fred/tags/series` | 태그의 시리즈 | fred_get |

### 이 확장에 넣지 않은 API

| API | 이유 |
|---|---|
| v2 `fred/v2/release/observations` | 한 릴리스의 모든 시리즈 전체 이력을 대량으로 받는 용도. 인증 방식이 v1 문서 페이지에 나와 있지 않아 보류 |
| Maps API (GeoFRED: Shape Files, Series Group Meta, Series Regional Data, Regional Data) | 미국 주·카운티 지역 데이터. 이 프로젝트 목적과 거리가 멂 |

### 자주 쓰는 인자 (series/observations, 공식 문서)

- `observation_start`, `observation_end`: YYYY-MM-DD
- `units`: lin(그대로) · chg(변화량) · ch1(전년 대비 변화량) · pch(변화율) · pc1(전년 대비 %) · pca(연율 복리) · cch(연속복리) · cca(연속복리 연율) · log(자연로그)
- `frequency`: d·w·bw·m·q·sa·a, 요일 지정 주간 wef·weth·wew·wetu·wem·wesu·wesa, 격주 bwew·bwem. 원래 주기보다 높게는 안 됨
- `aggregation_method`: avg(기본)·sum·eop(기간말) — frequency를 줄 때만
- `limit`: 최대 100,000 (series/search는 최대 1,000)
- 오류 응답: `error_code`, `error_message` (400·404·423·429·500)

## 알려진 한계 (공식 문서·확인 결과)

- **발표 일정**: 날짜는 원 기관이 정한 발표일이며 FRED에 실제로 올라오는 시각과 다를 수 있음. 발표 시각·예상치(컨센서스)는 FRED에 없음
- **ICE BofA 계열**(하이일드·BBB·투자등급 스프레드): 최근 3년치만 제공(2026년 4월부터)
- **갱신 시각**: 2026-11-10 02시(KST) 공개 페이지 기준 DGS2·DGS10은 미국 시각 11/6 오후 4:05(CST)에 갱신, 하이일드 스프레드는 11/9 오전 8:41(CST). 일간 지표가 하루 늦게 올라오는 경우가 있어 관측일(date)을 꼭 확인

## 시험

`node test/offline.test.js` — 로컬 가짜 서버로: 공식 v1 경로 31개 대조와 그 밖 경로 차단, 묶음 시리즈 35개를 존재 확인 목록과 대조, 결측(".")·단위 배율, 여러 시리즈 표, 묶음 최신·직전·1주 변화, 전년비 변환 전달, 순유동성 단위 맞춤, 발표 일정·다음 발표일, 오류·키 가림·429 재시도, api_key·file_type 덮어쓰기 금지, 동시 요청 간격, 래퍼로 불러온 MCP 통신(6개 도구), 키 없음 안내

## 실제 호출로 확인한 것 (2026-11-11 10시 KST)

- 결측값은 `"."`로 옴 (예: DGS10 2025-11-27 추수감사절). 이 확장은 null로 바꿈
- 단위: WALCL·WTREGEN 백만 달러, RRPONTSYD 십억 달러 → 순유동성 계산이 단위를 읽어 맞춤 (11/4 기준 5조 7,907억 달러)
- 갱신 시각(관측일 기준 미국 시각): DGS2·DGS10 등 국채 금리는 **다음 날 오후 3시경**(11/9 값이 11/10 15:16 CST), T10Y2Y·T10Y3M·T10YIE·T5YIFR는 **당일 오후 4시경**(11/10 값이 11/10 16:04 CST), 하이일드 등 ICE 스프레드·VIX는 다음 날 오전
- 발표 일정: 미래 날짜가 실제로 나옴 (11/13 PPI, 11/17 소매판매, 11/25 GDP·개인소득)
- 2025년 10월 CPI가 결측(".")이라 2026년 10월 CPI 전년비가 결측 → v0.1.1에서 묶음이 이를 숨기지 않고 `missing_latest`로 알림
- Yahoo Finance 값과 비교: VIX는 같음(11/9 19.92), 10년물은 1~2bp 차이(Yahoo `^TNX` 4.864 vs DGS10 4.88), 3개월물은 Yahoo `^IRX`(할인율 기준)와 DGS3MO(수익률 기준)가 약 0.2%p 달라 10년−3개월 금리차도 그만큼 다름

## 변경 이력

- v0.1.1 (2026-11-11): 묶음에서 가장 최근 관측이 결측이면 `missing_latest`(날짜, 사유, 변환값이면 원 수준값)로 알림
- v0.1.0 (2026-11-10): 첫 판

키 발급: https://fredaccount.stlouisfed.org/apikeys (32자리 영문 소문자·숫자)
