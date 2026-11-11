# finance-api-hub

공식 금융 API를 조회 전용 MCP 서버로 모아 둔 저장소입니다. Claude뿐 아니라 MCP를 지원하는 에이전트(Cursor, Codex, Gemini CLI 등)에서 같은 방식으로 씁니다.

## 목록

| 폴더 | 제공처 | 주요 데이터 | 형태 | 키 (환경변수) |
|---|---|---|---|---|
| [toss](toss/) | 토스증권 Open API | 시장 전체 투자자별 매매대금, 종목 수급, 공매도, 섹터 랭킹, 국고채 지표, 환율, 장 운영 | 직접 만든 MCP 서버 (v0.2.1, 도구 13개) | `TOSS_CLIENT_ID`, `TOSS_CLIENT_SECRET` |
| [dart](dart/) | 금융감독원 DART | 기업 개황, 공시 목록·원문, 재무제표, 재무지표, 배당, 주요사항보고서 | 직접 만든 MCP 서버 (v0.2.1, 도구 8개) | `DART_API_KEY` |
| [ecos](ecos/) | 한국은행 ECOS | 국고채·회사채 금리, 신용 스프레드, 기준금리, 물가 등 전체 통계, 100대 지표, 용어사전 | 직접 만든 MCP 서버 (v0.1.1, 도구 7개) | `ECOS_API_KEY` |
| [edgar](edgar/) | 미국 SEC EDGAR | 미국 상장사 공시 목록·원문, XBRL 재무(연간·분기), 기간별 전 종목 비교, 공시 전문 검색 | 직접 만든 MCP 서버 (v0.1.0, 도구 7개) | `SEC_USER_AGENT` (키 아님, 이름+이메일) |
| [meritz](meritz/) | 메리츠증권 Trading MCP | 국내·해외 지수, 선물, 환율, EWY, 종목 일봉 | 증권사 공식 배포 (안내 문서만) | 설치 화면에서 입력 |

## 공통 원칙

- **조회 전용**: GET 호출만 있고 주문·계좌 API는 코드에 없습니다.
- **외부 패키지 없음**: Node 18 이상 내장 모듈만 씁니다. `npm install`이 필요 없습니다.
- **키 위치**: 모두 환경변수로 받습니다. DART·ECOS는 환경변수가 없으면 macOS 키체인도 봅니다. EDGAR는 키 대신 연락처가 든 User-Agent(`SEC_USER_AGENT`)를 받고, 같은 방식으로 키체인(서비스 `edgar-mcp`)도 봅니다. 토스는 환경변수만 씁니다(Claude Desktop에서는 설치 화면 입력값을 Desktop이 넘겨 줌). 키는 이 저장소에 절대 커밋하지 않습니다(`.env.example` 참고).

## 범용 MCP 설정 예시

대부분의 에이전트는 아래 형식(`command`·`args`·`env`)을 씁니다. 경로는 이 저장소를 받은 위치로 바꾸세요.

```json
{
  "mcpServers": {
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
    "edgar": {
      "command": "node",
      "args": ["/path/to/finance-api-hub/edgar/server/index.js"],
      "env": { "SEC_USER_AGENT": "이름 you@example.com" }
    },
    "toss": {
      "command": "node",
      "args": ["/path/to/finance-api-hub/toss/server/index.js"],
      "env": { "TOSS_CLIENT_ID": "...", "TOSS_CLIENT_SECRET": "..." }
    }
  }
}
```

맥에서 DART·ECOS 키를 키체인에 넣었다면 그 둘의 `env`는 비워도 됩니다.

토스는 토스증권에 등록한 허용 IP에서만 호출됩니다. 다른 PC·서버에서 쓰려면 그 공인 IP를 토스 개발자 센터에 등록해야 합니다(아니면 403).

## 시험

네트워크 없이 가짜 응답으로 점검합니다.

```
node toss/test/test.js
node dart/test/offline.test.js
node ecos/test/offline.test.js
node edgar/test/offline.test.js
```

## Claude Desktop (선택)

각 폴더에서 `./pack.sh`를 실행하면 `*-readonly.mcpb`가 만들어집니다. Claude Desktop 설정 > 확장 프로그램에 끌어다 놓으면 설치됩니다. `.mcpb`는 만들어지는 파일이라 커밋하지 않습니다.

## 의도적으로 넣지 않은 것

- Yahoo Finance: 비공식 서버이고, 범용 도구가 이미 많음
- 네이버 증권: 공식 API가 아님
