---
type: guide
title: 빠른 시작
description: finance-api-hub 저장소가 무엇이고 어떤 서버가 있는지 소개하고, 하려는 일에 따라 읽어야 할 위키 페이지를 안내한다.
tags: [quickstart, overview, navigation, mcp]
sources:
  - id: openwiki-source-5f5b95b3d6a215fa02ceb945
    resource: repo://.env.example
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
generated: { by: "claude-code", at: "2026-11-24T17:09:12.439Z" }
verified:
  - by: openwiki/0.5.2
    at: 2026-11-24T17:09:12.439Z
---

# 빠른 시작

finance-api-hub는 공식 금융 데이터 API를 **조회 전용 MCP 서버**로 제공하는 모음이다. MCP를 지원하는 에이전트(Claude Desktop, Claude Code, Cursor 등)에 등록하면 에이전트가 시세, 수급, 공시, 금리 같은 자료를 도구로 조회할 수 있다.

## 저장소의 네 가지 원칙

- **조회 전용.** 주문·계좌·제출 API는 코드에 없다. 호출 대상 호스트와 경로가 코드에 고정돼 있다.
- **의존성 없음.** Node.js 18 이상의 내장 모듈만 쓴다. `npm install`이 필요 없다.
- **인증 정보 분리.** 키는 환경변수나 macOS 키체인에서 읽고 저장소에 두지 않는다.
- **오프라인 테스트.** 서버마다 네트워크 없이 도는 테스트가 있다.

## 서버 한눈에 보기

| 서버 | 제공처 | 주로 쓰는 용도 | 도구 |
|---|---|---|---|
| [kis](servers/kis.md) | 한국투자증권 | 국내 종목 시세를 거래소별(KRX/NXT/통합)로, 분봉, 업종지수, 수급, 신용잔고, 해외 시세 | 10 |
| [toss](servers/toss.md) | 토스증권 | 시장·종목 수급, 공매도, 프로그램매매, 랭킹, 통합 시세 | 13 |
| [krx](servers/krx.md) | 한국거래소 | 전 종목 일별 확정 통계, 지수, ETF, 채권, 파생상품 | 7 |
| [dart](servers/dart.md) | 금융감독원 | 한국 기업 공시, 재무제표, 배당, 주요사항보고서 | 8 |
| [ecos](servers/ecos.md) | 한국은행 | 시장금리, 신용 스프레드, 거시 통계 | 7 |
| [fred](servers/fred.md) | 미국 세인트루이스 연준 | 미국 금리, 신용, 유동성, 물가·고용 | 6 |
| [edgar](servers/edgar.md) | 미국 SEC | 미국 기업 공시, XBRL 재무 | 7 |

`meritz/` 폴더는 서버가 아니라 메리츠증권이 직접 배포하는 MCP의 설치 안내다. 그 위치와 이유는 [데이터 반영 시각과 거래소 기준](concepts/data-timing.md)에 있다.

## 5분 안에 서버 하나 띄우기

1. 저장소를 받는다.
2. 쓸 서버의 인증 정보를 발급받는다. 서버별 환경변수 이름은 저장소 루트의 `.env.example`에, 발급처는 루트 `README.md`의 표에 있다.
3. MCP 클라이언트 설정에 서버를 등록한다.

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

4. 클라이언트를 다시 시작하고 도구 목록에 `ecos_market_rates` 등이 보이는지 확인한다.

Claude Desktop 확장으로 설치하는 방법과 설정 화면 입력값이 서버에 전달되는 경로는 [설치와 확장 패키징](operations/install-and-packaging.md)에 있다.

인증 정보 없이 동작만 확인하려면 테스트를 실행한다.

```bash
node kis/test/offline.test.js
```

## 하려는 일에 따라 읽을 페이지

### 서버를 설치하고 쓰려 한다

| 궁금한 것 | 페이지 |
|---|---|
| 등록 방법, 확장 파일 만들기 | [설치와 확장 패키징](operations/install-and-packaging.md) |
| 키를 어디에 넣나, 키체인을 쓸 수 있나 | [인증 정보와 비밀 값 처리](architecture/credentials-and-secrets.md) |
| 어느 서버에서 어떤 값을 받아야 하나 | [데이터 반영 시각과 거래소 기준](concepts/data-timing.md) |

### 받은 값이 이상하다

| 증상 | 페이지 |
|---|---|
| 종가가 다른 출처와 다르다 | [데이터 반영 시각과 거래소 기준](concepts/data-timing.md) |
| 오늘 자료를 요청했는데 어제 것이 왔다 | [데이터 반영 시각과 거래소 기준](concepts/data-timing.md), [한국거래소 서버](servers/krx.md) |
| 응답에 `truncated: true`가 붙고 행이 요청보다 적다 | [MCP 서버 공통 구조](architecture/server-anatomy.md)의 "출력 한도" |
| 종목별 투자자 조회가 시간 제한 오류를 낸다 | [한국투자증권 서버](servers/kis.md)의 "종목별 투자자의 기본 기준일" |
| 인자가 틀렸다는 오류가 나고 조회가 되지 않는다 | [MCP 서버 공통 구조](architecture/server-anatomy.md)의 "입력 검증", 해당 서버 페이지 |
| 한도 초과 오류가 난다 | [호출 한도와 캐시](architecture/rate-limits-and-caching.md) |
| 인증 오류가 난다 | [인증 정보와 비밀 값 처리](architecture/credentials-and-secrets.md) |
| 새로 상장한 회사를 찾지 못한다 | [호출 한도와 캐시](architecture/rate-limits-and-caching.md) (목록 캐시 수명) |

### 코드를 고치거나 서버를 추가하려 한다

| 할 일 | 페이지 |
|---|---|
| 서버의 공통 틀 이해 | [MCP 서버 공통 구조](architecture/server-anatomy.md) |
| 기존 서버에 도구 추가 | 해당 서버 페이지 (예: [kis](servers/kis.md)의 "도구를 추가할 때") |
| 테스트 작성 | [오프라인 테스트](testing/offline-tests.md) |
| 버전 올리기, 확장 다시 묶기 | [설치와 확장 패키징](operations/install-and-packaging.md) |

### 조회 전용이 정말 지켜지는지 확인하려 한다

실계좌에 연결된 키를 넣기 전에 볼 곳이다.

1. [MCP 서버 공통 구조](architecture/server-anatomy.md)의 "조회 전용 원칙을 지키는 장치"
2. [한국투자증권 서버](servers/kis.md)의 "왜 조회 전용이 중요한가"
3. [오프라인 테스트](testing/offline-tests.md)의 "조회 전용 원칙을 지키는 단언"

## 위키와 저장소 문서의 관계

이 위키는 **코드가 어떻게 동작하는지**를 설명한다. 저장소에는 역할이 다른 문서가 따로 있다.

| 문서 | 역할 |
|---|---|
| 루트 `README.md` | 설치 안내와 서버 목록 |
| 각 서버 폴더의 `README.md` | 그 서버의 도구 목록, 지원 범위, 제약 |
| `DATA_TIMING.md` | 실제 조회로 확인한 반영 시각 기록. 코드에서 알 수 없는 사실의 정본 |
| `toss/API_CHECKLIST.md`, `kis/API_CHECKLIST.md` | 제공처 전체 API 대비 설치·제외 상태 |

값의 반영 시각이나 단위처럼 제공처의 실제 동작에 관한 내용은 `DATA_TIMING.md`가 기준이다. 위키의 해당 서술은 그 문서를 요약한 것이며, 확인 날짜가 함께 적힌 원본을 따른다.

## 전체 페이지

**구조**
- [MCP 서버 공통 구조](architecture/server-anatomy.md)
- [인증 정보와 비밀 값 처리](architecture/credentials-and-secrets.md)
- [호출 한도와 캐시](architecture/rate-limits-and-caching.md)

**개념**
- [데이터 반영 시각과 거래소 기준](concepts/data-timing.md)

**서버**
- [한국투자증권](servers/kis.md) · [토스증권](servers/toss.md) · [한국거래소](servers/krx.md)
- [금융감독원 DART](servers/dart.md) · [한국은행 ECOS](servers/ecos.md)
- [FRED](servers/fred.md) · [SEC EDGAR](servers/edgar.md)

**운영과 테스트**
- [설치와 확장 패키징](operations/install-and-packaging.md)
- [오프라인 테스트](testing/offline-tests.md)
