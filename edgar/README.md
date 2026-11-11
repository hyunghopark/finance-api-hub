# SEC EDGAR 조회 전용 MCP (Claude Desktop 확장)

미국 증권거래위원회(SEC) EDGAR의 공시·XBRL 재무 데이터를 조회만 하는 MCP입니다. DART 조회 전용 확장([../dart](../dart))과 같은 방식으로 만들었습니다.

- 현재 버전: **v0.1.0**
- 외부 패키지 없음 (Node 18+ 내장 모듈만)
- 호출 주소 `data.sec.gov`·`www.sec.gov`·`efts.sec.gov` 고정, GET만 사용
- **API 키는 없습니다.** 대신 SEC가 연락처(이메일)가 든 **User-Agent**를 요구합니다. 없으면 403
- 요청 속도: SEC 한도는 초당 10건. 이 서버는 초당 8건 이하로 한 줄로 세워 보내고, 응답은 5분간 메모리에 저장해 같은 요청을 다시 보내지 않음
- 캐시: 티커 목록 `~/.edgar-mcp/company_tickers.json` (하루마다 새로 받음, 권한 600)

## 설치

1. User-Agent 정하기 (이름과 이메일). 이메일은 공개 저장소에 올리지 말고 아래 둘 중 한 곳에만 넣기
   - 맥 키체인: `security add-generic-password -s edgar-mcp -a sec -w` (마지막 `-w` 뒤를 비워 두면 입력 창이 뜸. 입력값 예: `홍길동 me@example.com`)
   - 또는 Claude Desktop 확장 설정에 입력 (이때는 **확장을 껐다 켜야** 반영됨)
2. 확장 파일 만들기: `cd edgar && ./pack.sh`
3. `edgar-readonly.mcpb`를 Claude Desktop 설정 > 확장 프로그램에 끌어다 놓기
4. 설치·재설치 때 Desktop이 모든 로컬 확장을 다시 켬 → 예약 작업 시각 근처는 피하기

## 다른 에이전트에서 쓰기 (범용 MCP)

```json
{
  "mcpServers": {
    "edgar": {
      "command": "node",
      "args": ["/path/to/finance-api-hub/edgar/server/index.js"],
      "env": { "SEC_USER_AGENT": "이름 you@example.com" }
    }
  }
}
```

## 도구 (7개)

| 도구 | 쓰는 SEC 주소 | 용도 |
|---|---|---|
| sec_find_company | `www.sec.gov/files/company_tickers.json` | 티커·회사명·CIK 찾기 (현재 상장사만) |
| sec_filings | `data.sec.gov/submissions/CIK##########.json` (+ 옛 공시 파일) | 공시 목록 (양식·기간 필터, 원문·색인 주소) |
| sec_financials | `data.sec.gov/api/xbrl/companyconcept/…` | 핵심 재무 13개 항목 연간·분기 |
| sec_concept | 〃 | 임의 XBRL 항목 시계열 (정정 이력 포함 선택) |
| sec_frames | `data.sec.gov/api/xbrl/frames/…` | 한 기간·한 항목의 전 종목 비교 (서버에서 정렬해 상위 N개) |
| sec_search | `efts.sec.gov/LATEST/search-index` | 공시 전문 검색 ※ 아래 "공식이 아닌 것" 참고 |
| sec_document | `www.sec.gov/Archives/edgar/data/…` | 공시 원문 텍스트 (나눠 읽기, 단어 찾기) |

- 회사 지정: 티커(`AAPL`, `BRK.B`), 회사명 일부, CIK 숫자 중 아무거나. 같은 회사의 여러 티커(GOOG·GOOGL)는 한 회사로 봄
- 금액은 달러. EPS는 `USD/shares`
- 공시 원문 읽는 순서: `sec_filings`(forms="10-K") → 결과의 `url`을 `sec_document`에 → 길면 `find`로 "Risk Factors" 같은 단어 주변만

### sec_financials가 하는 일

핵심 항목: revenue(매출) · gross_profit · operating_income · net_income · eps_diluted · eps_basic · operating_cash_flow · capex · total_assets · total_liabilities · equity · cash · long_term_debt. 기본값은 매출·영업이익·순이익·희석EPS·자산·부채·자본·영업현금흐름.

SEC 원자료의 함정을 이렇게 처리합니다.

| 함정 | 처리 |
|---|---|
| `fy`·`fp`는 "공시 기준"이라 전년도 값이 다음 해 10-K에 같은 값으로 다시 실림 | 기간(start·end)으로 묶고 가장 늦게 공시된 값만 사용. 정정(10-K/A)도 같은 방식으로 반영 |
| 3분기 10-Q에 9개월 누적, 2분기에 6개월 누적이 섞여 있음 | 기간 길이로 분기(80~100일)·연간(340~380일)·9개월 누적(250~290일)을 구분 |
| 4분기는 따로 공시되지 않음 | 분기 모드에서 `연간 − 9개월 누적`으로 계산하고 `derived: true`로 표시. EPS는 주식수 변화 때문에 근사값 |
| 회사마다·연도마다 같은 항목을 다른 이름으로 씀 (매출: `RevenueFromContractWithCustomer…`·`Revenues`·`SalesRevenueNet`) | 후보 이름을 차례로 조회해 이어 붙임. 같은 기간은 앞쪽 이름 우선, 어떤 이름을 썼는지 `tags_used`·행별 `tag`에 표시 |
| 대차대조표 항목은 다음 분기 보고서에 비교값으로 다시 나옴 | 연간 모드는 10-K 결산일만 사용 |

한계: 미국 GAAP(`us-gaap`) 공시 회사용입니다. IFRS(20-F) 회사는 `sec_concept`에서 `taxonomy=ifrs-full`로 조회하세요. 회사 고유 항목(`aapl:…`)은 SEC가 모아 주지 않아서 조회할 수 없습니다.

## SEC EDGAR가 제공하는 것 전체와 이 확장의 사용 여부

2026-11-11 SEC 공식 문서 3곳을 읽어 정리했습니다. ① EDGAR Application Programming Interfaces(https://www.sec.gov/search-filings/edgar-application-programming-interfaces, 2025-04-08 갱신) ② Accessing EDGAR Data(https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data, 2024-06-26 갱신) ③ 필러용 API 문서(Overview of EDGAR APIs, EDGAR API Development Toolkit v1.11.0). 이 확장이 쓰는 것과 같은 주소 일부는 브라우저로 실제 응답까지 열어 확인했습니다(표의 "확인").

**요약: 조회용 REST API(data.sec.gov) 4개 중 3개 사용, 공시 원문 파일 시스템·티커 파일 일부 사용. 나머지는 용량이 크거나 목적과 맞지 않아 쓰지 않음.**

### 1. data.sec.gov REST API (키 없음, JSON) — 공식 4개

| API | 요청 주소 | 이 확장 | 확인 |
|---|---|---|---|
| submissions (공시 이력) | `data.sec.gov/submissions/CIK##########.json` | sec_filings (회사 정보·최근 공시. 문서상 "1년치 또는 1,000건 중 많은 쪽") | 확인 |
| submissions 추가 파일 | `data.sec.gov/submissions/CIK##########-submissions-001.json` | sec_filings (`from`을 옛날로 주거나 `include_older`) | 확인(`files` 목록만. 추가 파일 본문은 직접 열어 보지 않음) |
| companyconcept (회사·항목 하나의 시계열) | `data.sec.gov/api/xbrl/companyconcept/CIK##########/{taxonomy}/{tag}.json` | sec_financials, sec_concept | 확인 |
| frames (한 기간·한 항목의 전 회사) | `data.sec.gov/api/xbrl/frames/{taxonomy}/{tag}/{unit}/{period}.json` | sec_frames | 확인 |
| companyfacts (회사의 모든 항목) | `data.sec.gov/api/xbrl/companyfacts/CIK##########.json` | **미사용** | — |

- companyfacts를 안 쓰는 이유: 회사의 모든 항목이 한 번에 오기 때문에 응답이 큼(크기는 직접 재지 않음). 필요한 항목만 `companyconcept`로 받는 쪽이 가벼움
- XBRL API가 모으는 항목은 표준 택사노미(us-gaap · ifrs-full · dei · srt)이고 회사 고유 확장 항목은 제외됨. 기간 표기는 연간 `CY2019`, 분기 `CY2019Q1`, 시점 `CY2019Q1I`, 분수 단위는 `USD-per-shares`
- 갱신 주기: 공시 이력은 보통 1초 이내, XBRL은 보통 1분 이내(성수기에는 더 걸릴 수 있음)
- CORS는 지원하지 않음(브라우저 페이지에서 직접 호출 불가, 이 확장처럼 서버 쪽에서 호출)

### 2. 일괄 내려받기 (zip, 매일 새벽 3시경 ET 갱신)

| 파일 | 주소 | 이 확장 |
|---|---|---|
| companyfacts.zip (frames·companyfacts 전체) | `www.sec.gov/Archives/edgar/daily-index/xbrl/companyfacts.zip` | **미사용** |
| submissions.zip (전체 회사 공시 이력) | `www.sec.gov/Archives/edgar/daily-index/bulkdata/submissions.zip` | **미사용** |

미사용 이유: 용량이 매우 큼(제3자 가이드에서는 수 GB로 알려져 있고, 정확한 크기는 직접 확인하지 않음). 대량 분석용. 도구 한 번 호출로 쓰는 조회 전용 MCP에는 맞지 않음

### 3. 공시 파일 시스템 `www.sec.gov/Archives/edgar/…`

| 주소 | 내용 | 이 확장 | 확인 |
|---|---|---|---|
| `/data/{CIK}/{접수번호 대시 없음}/{파일명}` | 공시 원문·첨부 문서 | sec_document | 확인(10-K 본문 변환) |
| `/data/{CIK}/{접수번호 대시 없음}/{접수번호}-index.htm` | 제출 문서 목록 화면 | sec_filings가 주소(`index_url`)만 돌려줌 | — |
| `/data/{CIK}/{접수번호 대시 없음}/index.json` (`index.xml`도 있음) | 그 공시의 파일 목록 | **미사용** | 확인(애플 10-K 108개 파일, 항목 `name·type·size·last-modified`) |
| `/data/{CIK}/{접수번호}.txt` | 공시 전체 원문(SGML) | **미사용** | — |
| `/data/{CIK}/…/{접수번호}.hdr.sgml` | 공시 머리글 | **미사용** | — |
| `/full-index/`, `/daily-index/` | 1994년 3분기부터의 공시 색인(company·form·master·XBRL 4종). 디렉터리 목록은 `index.json`·`index.xml`로도 제공 | **미사용** | — |
| `/Feed/`, `/Oldloads/` | 일별 공시 압축 묶음(tar.gz) | **미사용** | — |
| `/vprr/` | 종이 제출분 PDF 스캔 | **미사용** | — |
| 월별 XBRL RSS 보관 폴더 | 2005년 4월부터 XBRL RSS | **미사용** | — |

미사용 이유: 공시 목록은 `submissions`가 같은 정보를 더 가볍게 주고, 원문 파일명도 `primaryDocument`로 알 수 있음. 색인·Feed·Oldloads는 전체 수집용이라 조회 전용 도구에 과함. 접수번호 디렉터리에서 첨부 파일(예: 재무제표 XBRL)이 필요해지면 `index.json`이 후보

### 4. 티커·CIK 연결 파일 `www.sec.gov/files/…`

| 파일 | 내용 | 이 확장 | 확인 |
|---|---|---|---|
| `company_tickers.json` | 티커·CIK·회사명 | sec_find_company 등 회사 지정 | 확인(10,419건) |
| `company_tickers_exchange.json` | 티커·CIK·회사명·**거래소** | **미사용** (후보) | 확인(10,405건. Nasdaq 4,355 · NYSE 3,264 · OTC 2,566 · CBOE 44 · TXSE 13 · 거래소 없음 163. 형식은 `fields`+`data` 배열) |
| `company_tickers_mf.json` | 펀드 CIK·시리즈·클래스·티커 | **미사용** | — |
| CIK 전체 목록(13MB 텍스트 `cik-lookup-data.txt`) | 펀드·개인 포함, 회사명 이력 누적 | **미사용** | — |

SEC가 이 파일들은 검색 기능용으로 주기적으로 갱신할 뿐 정확성과 범위를 보장하지 않는다고 적어 둠. 그래서 티커 목록에 없는 상장폐지·비상장 회사는 CIK 숫자로 직접 지정하게 했음

### 5. 웹사이트 검색 화면의 뒷단

| 항목 | 이 확장 | 비고 |
|---|---|---|
| 전문 검색 `efts.sec.gov/LATEST/search-index` | sec_search | 웹 화면(Full Text Search)이 쓰는 주소로 **API 문서에는 없음** (아래 "공식이 아닌 것") |
| 회사 검색·최신 공시 RSS(`cgi-bin/browse-edgar`) | **미사용** | 화면용. `submissions`로 대체 |

### 6. 분기별 데이터 모음 (DERA 데이터 라이브러리)

재무제표(및 주석), Form D, Regulation A, 크라우드펀딩, 뮤추얼펀드 위험·수익 요약, 이전대리인, EDGAR 로그, 양식별 공시 건수. **모두 미사용** — 분기 단위로 내려받는 대용량 데이터라 도구 호출형 조회에 맞지 않음.

### 7. 필러(공시 제출자)용 EDGAR API — `api.edgarfiling.sec.gov`

공시를 내는 회사·대행사용입니다. 개요 문서(2025-12-22판) 기준 14종: 공시 제출(Submission) · 제출 상태 · EDGAR 운영 상태 · 개인 추가 · 개인 삭제 · 개인 조회 · 역할 변경 · 위임 초대 보내기 · 위임 요청 · 위임 조회 · 필러 계정 조회 · CCC 생성 · CCC 직접 지정 · 필러 자격 확인. **모두 미사용**

- 필러 API 토큰·사용자 API 토큰(JWT)이 있어야 하고, EDGAR Next에 등록된 필러만 쓸 수 있음
- 공시 제출·계정 변경 기능이 있어 "조회 전용" 원칙에 맞지 않음. 운영 상태 API만 읽기용이지만 이것도 필러 토큰이 필요함

### 공통 규칙 (SEC 공정 접근 정책)

- 요청 한도 **초당 10건**(기계 수와 무관한 합계). 이 확장은 8건 이하로 직렬 호출. SEC는 과도한 요청을 보내는 IP를 차단할 수 있다고 밝힘(제3자 자료에서는 첫 위반 시 약 10분)
- 요청마다 `User-Agent`에 연락처를 선언해야 하고 `Accept-Encoding: gzip, deflate`를 권장(이 확장은 둘 다 보냄). SEC는 선언되지 않은 자동 도구는 제한할 수 있다고 밝힘
- 기술 지원은 제공하지 않음. 문의 `webmaster@sec.gov`(연결·일반), `opendata@sec.gov`(데이터 API 건의)

### 공식이 아닌 것 (확인 필요)

`sec_search`가 쓰는 `efts.sec.gov/LATEST/search-index`는 SEC 웹사이트 전문 검색이 내부에서 쓰는 주소입니다. 위 공식 API 문서 페이지에는 올라 있지 않아서 형식이 예고 없이 바뀔 수 있습니다. 이 저장소의 "공식 API만" 원칙에 어긋난다고 보면 `server/index.js`의 `sec_search` 도구 블록, `manifest.json`의 같은 이름 항목, 시험 11번을 지우면 됩니다.

## 실제 호출로 확인한 것 (2026-11-10, Claude Desktop 내장 브라우저)

- 정상: 애플(CIK 0000320193) 공시 목록 구조(최근 1,008건 + 옛 공시 파일 1개 1994~2015), `companyconcept` 응답 구조(순이익 341건, 항목 `start·end·val·accn·fy·fp·form·filed·frame`), `frames` 응답(2023년 매출 2,681개사, 약 410KB), 티커 파일(10,419건, 중복 티커 없음), 전문 검색 응답(2026년 10-K "share repurchase" 2,245건, 한 번에 100건)
- 계산 검증: 이 확장과 같은 로직을 실제 애플 순이익 데이터(341건)에 돌려 FY2025 112.01B·FY2024 93.74B(정정 반영), 4분기 계산값 FY2025 27.47B·FY2024 14.74B를 확인
- 설치한 확장으로 실제 호출 확인(2026-11-11): `sec_financials`(AAPL 연간 매출·순이익·EPS·자산 5년, 분기 순이익 4분기 계산값 FY2026 30.71B·FY2025 27.47B), `sec_filings`(10-K 목록·원문 주소), `sec_document`(10-K 원문 238,390자 변환, 'Risk Factors' 찾기 5곳). 매출은 세 가지 항목명(`RevenueFromContractWithCustomer…`·`Revenues`·`SalesRevenueNet`)을 이어 붙여 5년이 채워짐
- **아직 확인 못 한 것**: `sec_find_company`·`sec_concept`·`sec_frames`·`sec_search`를 확장으로 직접 호출한 것(브라우저에서는 응답 구조만 확인), 13F·내부자거래 같은 다른 양식의 원문 변환

## 시험

```
node test/offline.test.js
```
네트워크 없이 가짜 응답으로 확인: 정정값 우선, 연간·분기·4분기 계산, 대차대조표 시점값, 회사 지정(티커·중복 티커·모호한 이름), 항목 이어 붙이기, 공시 목록(옛 공시·`xsl` 접두어 유지), frames 정렬·거르기·주소 조작 차단, 전문 검색 주소 조립, 원문 변환(숨은 XBRL 머리말 제거·엔터티)·찾기·주소 제한, 허용 호스트·GET 고정, MCP 프로토콜(7개 도구), User-Agent 없음 안내

## 변경 이력

- v0.1.0 (2026-11-10): 첫 판 (도구 7개). 2026-11-11 README에 SEC 제공 API 전체 목록과 사용 여부 추가
