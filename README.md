# finance-api-hub

공식 금융 데이터 API를 **조회 전용 MCP(Model Context Protocol) 서버**로 제공하는 모음입니다. Claude Desktop, Claude Code, Cursor, Codex, Gemini CLI 등 MCP를 지원하는 에이전트에서 같은 방식으로 사용할 수 있습니다.

## 특징

- **조회 전용**: 모든 서버가 GET 요청만 보냅니다. 주문·계좌·제출 API는 코드에 포함하지 않았습니다.
- **의존성 없음**: Node.js 18 이상의 내장 모듈만 사용합니다. `npm install`이 필요 없습니다.
- **공식 API만 사용**: 각 제공처가 문서로 공개한 API만 호출하고, 호출 대상 호스트를 코드에 고정했습니다.
- **인증 정보 분리**: 키는 환경변수나 macOS 키체인에서 읽으며 저장소에는 저장하지 않습니다. 오류 메시지에서도 키를 가립니다.
- **오프라인 테스트**: 서버마다 네트워크 없이 실행되는 테스트가 있습니다.

## 제공 서버

| 서버 | 제공처 | 주요 데이터 | 도구 | 버전 |
|---|---|---|---|---|
| [krx](krx/) | 한국거래소 KRX Open API | 지수(업종지수 포함), 전 종목 일별 매매정보·종목 기본정보, ETF·ETN·ELW, 채권, 선물·옵션, 금·석유·배출권, ESG | 7 | 0.1.0 |
| [dart](dart/) | 금융감독원 DART | 기업 개황, 공시 목록·원문, 재무제표, 재무지표, 배당, 주요사항보고서 | 8 | 0.2.1 |
| [ecos](ecos/) | 한국은행 ECOS | 시장금리, 신용 스프레드, 기준금리·물가 등 전체 통계, 100대 지표, 통계용어사전 | 7 | 0.1.1 |
| [toss](toss/) | 토스증권 Open API | 시장·종목별 투자자 매매동향, 공매도, 프로그램매매, 섹터·주식 랭킹, 시세, 환율 | 13 | 0.2.1 |
| [fred](fred/) | 미국 세인트루이스 연준 FRED | 금리 곡선, 신용 스프레드, 연준 유동성, 물가·고용 등 시계열, 경제지표 발표 일정 | 6 | 0.1.1 |
| [edgar](edgar/) | 미국 SEC EDGAR | 공시 목록·원문, XBRL 재무(연간·분기), 전 종목 비교, 공시 전문 검색 | 7 | 0.1.0 |
| [meritz](meritz/) | 메리츠증권 Trading MCP | 국내·해외 지수, 선물, 환율, 종목 일봉 | — | 증권사 공식 배포 (설치 안내만 제공) |

서버별 도구 목록, 지원하는 API 범위, 제약 사항은 각 폴더의 README를 참고하세요.

## 빠른 시작

### 요구 사항

- Node.js 18 이상
- 사용할 서버의 API 인증 정보 (아래 표)

### 1. 저장소 받기

```bash
git clone https://github.com/hyunghopark/finance-api-hub.git
```

### 2. 인증 정보 준비

| 서버 | 환경변수 | 발급처 | 비고 |
|---|---|---|---|
| krx | `KRX_API_KEY` | [openapi.krx.co.kr](https://openapi.krx.co.kr) | 인증키 발급 후 API별 이용신청이 따로 필요 |
| dart | `DART_API_KEY` | [opendart.fss.or.kr](https://opendart.fss.or.kr) | |
| ecos | `ECOS_API_KEY` | [ecos.bok.or.kr/api](https://ecos.bok.or.kr/api) | |
| toss | `TOSS_CLIENT_ID`, `TOSS_CLIENT_SECRET` | [developers.tossinvest.com](https://developers.tossinvest.com/docs) | 등록한 허용 IP에서만 호출 가능 |
| fred | `FRED_API_KEY` | [fredaccount.stlouisfed.org/apikeys](https://fredaccount.stlouisfed.org/apikeys) | |
| edgar | `SEC_USER_AGENT` | 발급 없음 | API 키 대신 이름과 이메일을 담은 User-Agent 문자열 |

환경변수 이름은 [`.env.example`](.env.example)에도 정리되어 있습니다.

### 3. MCP 클라이언트에 등록

대부분의 MCP 클라이언트는 아래 형식을 사용합니다. 필요한 서버만 골라 등록하고, 경로는 저장소를 받은 위치로 바꾸세요.

```json
{
  "mcpServers": {
    "krx": {
      "command": "node",
      "args": ["/path/to/finance-api-hub/krx/server/index.js"],
      "env": { "KRX_API_KEY": "..." }
    },
    "dart": {
      "command": "node",
      "args": ["/path/to/finance-api-hub/dart/server/index.js"],
      "env": { "DART_API_KEY": "..." }
    },
    "ecos": {
      "command": "node",
      "args": ["/path/to/finance-api-hub/ecos/server/index.js"],
      "env": { "ECOS_API_KEY": "..." }
    },
    "toss": {
      "command": "node",
      "args": ["/path/to/finance-api-hub/toss/server/index.js"],
      "env": { "TOSS_CLIENT_ID": "...", "TOSS_CLIENT_SECRET": "..." }
    },
    "fred": {
      "command": "node",
      "args": ["/path/to/finance-api-hub/fred/server/index.js"],
      "env": { "FRED_API_KEY": "..." }
    },
    "edgar": {
      "command": "node",
      "args": ["/path/to/finance-api-hub/edgar/server/index.js"],
      "env": { "SEC_USER_AGENT": "Your Name you@example.com" }
    }
  }
}
```

### Claude Desktop 확장으로 설치 (선택)

각 서버 폴더에서 `./pack.sh`를 실행하면 `*-readonly.mcpb` 파일이 만들어집니다. 이 파일을 Claude Desktop의 설정 > 확장 프로그램에 끌어다 놓으면 설치됩니다.

- 인증 정보는 설치 화면에서 입력하거나 macOS 키체인에 넣어 둡니다.
- 확장 설정에서 키를 바꾼 뒤에는 확장을 껐다 켜야 적용됩니다.
- 확장을 설치하거나 다시 설치하면 Claude Desktop이 로컬 확장을 모두 재시작합니다.
- `.mcpb`는 빌드 산출물이므로 저장소에 커밋하지 않습니다.

## 인증 정보 관리

모든 서버는 환경변수에서 인증 정보를 읽습니다. macOS에서는 환경변수가 없을 때 키체인에서도 읽을 수 있습니다(toss 제외).

| 서버 | 키체인 서비스 | 계정 |
|---|---|---|
| krx | `krx-api` | `krx` |
| dart | `dart-api` | `opendart` |
| ecos | `ecos-api` | `ecos` |
| fred | `fred-api` | `fred` |
| edgar | `edgar-mcp` | `sec` |

```bash
# 마지막 -w 뒤를 비워 두면 입력 창이 떠서 값이 셸 기록에 남지 않습니다.
security add-generic-password -s krx-api -a krx -w
```

키체인에 넣은 서버는 MCP 설정의 `env`를 비워도 됩니다. 인증 정보를 저장소에 커밋하지 마세요.

## 데이터 반영 시각

같은 날짜의 값이라도 제공처마다 반영·확정되는 시각이 다릅니다. 조회 시각에 따라 잠정치나 전일 값을 받을 수 있으므로, 확인된 반영 시각을 [DATA_TIMING.md](DATA_TIMING.md)에 정리했습니다.

## 테스트

로컬 모의 서버를 사용하므로 네트워크와 인증 정보 없이 실행됩니다.

```bash
node krx/test/offline.test.js
node dart/test/offline.test.js
node ecos/test/offline.test.js
node toss/test/test.js
node fred/test/offline.test.js
node edgar/test/offline.test.js
```

## 포함하지 않는 것

| 대상 | 이유 |
|---|---|
| Yahoo Finance, 네이버 증권 | 공식 공개 API가 아님 |
| 주문·계좌·공시 제출 API | 조회 전용 원칙 |
| [FRED 공식 MCP 커넥터](https://mcp.stlouisfed.org) | 세인트루이스 연준이 직접 운영하는 원격 커넥터. 차이는 [fred](fred/) 참고 |

## 유의 사항

- 이 저장소는 각 데이터 제공처와 제휴하거나 제공처의 승인을 받은 프로젝트가 아닙니다. API 이용 조건과 호출 한도는 각 제공처의 약관을 따릅니다.
- 제공되는 데이터와 계산값은 참고용이며 투자 권유가 아닙니다. 데이터의 정확성과 적시성은 원 제공처에 달려 있습니다.
