---
type: architecture
title: MCP 서버 공통 구조
description: 모든 서버가 공유하는 단일 파일 구조, stdio JSON-RPC 처리, 도구 정의 방식, 조회 전용 원칙을 지키는 장치, 오류를 돌려주는 방식을 설명한다.
tags: [mcp, architecture, json-rpc, read-only, stdio]
sources:
  - id: openwiki-source-1d34fa17b34fe29bbe8f60ee
    resource: repo://dart/server/index.js
  - id: openwiki-source-da64edabd94143649d65fb36
    resource: repo://ecos/server/index.js
  - id: openwiki-source-84deab234ff8a0f3b3a44c71
    resource: repo://edgar/server/index.js
  - id: openwiki-source-8fdaa5aa1e2f741c83ecbba1
    resource: repo://fred/server/index.js
  - id: openwiki-source-d22879e7241e310cc4e86450
    resource: repo://kis/server/index.js
  - id: openwiki-source-110194fb47b75af2466f370f
    resource: repo://krx/server/index.js
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
  - id: openwiki-source-20f822cbebdb1e3dd39b9e72
    resource: repo://toss/server/index.js
generated: { by: "claude-code", at: "2026-11-24T17:09:12.439Z" }
verified:
  - by: openwiki/0.5.2
    at: 2026-11-24T17:09:12.439Z
---

# MCP 서버 공통 구조

이 저장소의 서버 7개(krx, dart, ecos, toss, kis, fred, edgar)는 서로 코드를 공유하지 않지만 같은 틀을 따른다. 서버 하나는 `<이름>/server/index.js` 파일 하나이고, Node.js 18 이상의 내장 모듈만 쓴다. `npm install`이 필요 없고 서버 폴더만 복사해도 동작한다.

공유 모듈을 두지 않은 것은 의도된 선택이다. 서버 폴더 하나를 그대로 zip으로 묶어 Claude Desktop 확장으로 배포하기 때문에([설치와 확장 패키징](../operations/install-and-packaging.md)), 폴더 밖의 파일에 의존하면 배포물이 깨진다.

## 파일 하나의 구성

파일은 위에서 아래로 같은 순서를 따른다.

1. **상수**: 호출 대상 호스트, 버전, 캐시 위치, 한도 관련 값
2. **인증 정보 읽기**: `getKey()` 또는 `credentials()` ([인증 정보와 비밀 값 처리](credentials-and-secrets.md))
3. **HTTP 호출 함수**: 서버마다 하나 (`krxGet`, `dartGet`, `ecosGet`, `fredGet`, `secGet`, `apiGet`)
4. **도구 목록** `TOOLS`
5. **MCP 처리** `handle()`과 표준 입력 읽기
6. **`module.exports`**: 테스트가 내부 함수를 직접 부를 수 있게 내보냄

## 조회 전용 원칙을 지키는 장치

"주문·계좌 기능이 없다"는 것은 문서의 약속이 아니라 코드 구조로 강제된다. 세 겹의 장치가 있다.

**호스트 고정.** 호출 대상은 파일 맨 위의 상수다. 도구 인자로 주소를 바꿀 수 없다. edgar만 호스트가 셋이라 허용 집합으로 두고, 리디렉션 응답도 그 집합 안일 때만 따라간다.

**허용 목록.** HTTP 호출 함수는 미리 등록된 경로만 받는다.

| 서버 | 허용 목록 | 등록되지 않은 경로 |
|---|---|---|
| toss | `READ_ENDPOINTS`의 경로 함수 13개 | 도구가 이 객체만 참조 |
| kis | `READ_ENDPOINTS`의 `{path, trId}` 10쌍 | `apiGet`이 "허용되지 않은 주소"로 거부 |
| fred | `ENDPOINTS`의 v1 경로 31개 | `fredGet`이 거부 |
| ecos | `SERVICES`의 서비스 이름 6개 | `ecosGet`이 거부 |
| krx | `APIS` 명세 표의 31개 | 도구가 표에서만 경로를 고름 |
| dart | 엔드포인트 이름 형식 검사 | `dartGet`이 거부 |

**메서드 고정.** 조회 요청은 `method: 'GET'`으로 적혀 있다. POST는 toss와 kis의 접근토큰 발급 한 군데뿐이다.

kis에서는 주문과 조회가 같은 호스트의 다른 경로와 거래 ID(`tr_id`)로 나뉘므로, 허용 목록이 경로와 거래 ID를 쌍으로 묶는다. 조회 경로에 주문용 거래 ID를 붙이는 조합이 만들어질 수 없다. 이 조건은 [오프라인 테스트](../testing/offline-tests.md)가 검사한다.

## 도구 정의

`TOOLS`는 `{name, description, inputSchema, run}` 객체의 배열이다. `tools/list` 응답에는 앞의 세 항목과 `readOnlyHint: true`, `openWorldHint: true` 주석을 붙여 내보낸다. 일부 서버는 도구 객체에 출력 한도 처리에 쓰는 항목을 더 두는데(아래 "출력 한도"), 이 항목은 목록 응답에 나가지 않는다.

도구 이름은 `<서버>_<대상>` 형식이다(`kis_stock_price`, `dart_financials`). 여러 서버를 함께 등록해도 이름이 겹치지 않는다.

설명(`description`)에는 사용법뿐 아니라 **데이터 기준 경고**를 직접 적는다. 예를 들어 toss의 시세 도구는 "KRX 정규장 공식 종가로 쓰지 말 것"을, kis의 일봉 도구는 "당일 행은 15:30 이후 값이 바뀐다"를 설명에 담는다. 에이전트가 도구를 고를 때 읽는 유일한 글이 이 설명이기 때문이다. 근거가 되는 실측은 [데이터 반영 시각과 거래소 기준](../concepts/data-timing.md)에 있다.

krx는 도구를 손으로 쓰지 않고 명세 표에서 만든다. `APIS`의 31행을 `GROUPS`의 7개 분야로 묶어, 분야마다 `type` 인자로 API를 고르는 도구 하나를 생성한다. 자세한 내용은 [한국거래소 서버](../servers/krx.md)에 있다.

## 입력 검증

도구는 인자를 그대로 주소에 넣지 않는다. 종목코드, 날짜, 열거값을 정규식과 목록으로 확인한 뒤에만 요청을 만든다. 경로에 값이 들어가는 toss에서는 `../orders` 같은 입력이 다른 API를 가리킬 수 있으므로 이 검증이 허용 목록의 일부 역할을 한다. 검증에 실패하면 외부 서버에 요청을 보내지 않고 바로 오류를 돌려준다.

목록에 없는 값은 조용히 빼지 않고 거절한다. toss의 지표 심볼과 ecos의 시장금리 항목 키는 모르는 값이 하나라도 있으면 조회하지 않고, 어느 값이 틀렸는지와 쓸 수 있는 값을 오류에 담는다. 틀린 값을 걸러 내고 나머지만 조회하면 요청한 것 일부가 빠진 결과가 정상 응답처럼 보이기 때문이다. 같은 이유로 ecos는 시작 시점이 끝 시점보다 늦은 기간을, toss는 범위를 벗어난 `count`와 시간대가 없는 시각을 요청 전에 거절한다. 세부는 [한국은행 ECOS 서버](../servers/ecos.md)와 [토스증권 서버](../servers/toss.md)에 있다.

## MCP 통신

통신은 표준 입출력으로 주고받는 줄 단위 JSON-RPC 2.0이다. 외부 MCP 라이브러리 없이 네 가지 메서드를 직접 처리한다.

| 메서드 | 응답 |
|---|---|
| `initialize` | 프로토콜 버전, 서버 이름·버전, 사용 안내(`instructions`) |
| `ping` | 빈 결과 |
| `tools/list` | 도구 목록 |
| `tools/call` | 도구 실행 결과를 JSON 문자열로 담은 텍스트 (긴 결과는 "출력 한도" 처리를 거침) |

`id`가 없는 메시지는 알림으로 보고 응답하지 않는다. 알 수 없는 메서드는 `-32601`로 답한다.

toss와 kis는 지원하는 프로토콜 버전 목록을 두고, 클라이언트가 요청한 버전이 목록에 있으면 그대로, 없으면 최신 버전으로 답한다. 나머지 서버는 요청받은 버전을 그대로 돌려준다.

## 오류를 돌려주는 방식

도구 실행 중의 오류는 JSON-RPC 오류가 아니라 **`isError: true`인 정상 결과**로 돌려준다. 에이전트가 오류 문구를 읽고 인자를 고쳐 다시 시도할 수 있게 하기 위해서다. JSON-RPC 오류는 프로토콜 수준의 문제(알 수 없는 메서드, 해석 불가)에만 쓴다.

오류 문구는 한국어로 원인과 조치를 함께 적는다. 예를 들어 krx는 401을 받으면 인증키 문제인지 API 이용신청 미승인인지와 신청 위치를 알려 준다. 문구는 내보내기 전에 `mask()`를 거친다.

toss와 kis는 `UserError` 클래스로 "사용자에게 그대로 보여 줄 오류"를 구분한다. 그 밖의 예외는 `오류:` 접두어를 붙이고, 시간 초과는 "응답 시간 초과(15초)"로 바꾼다.

## 출력 한도

krx, dart, ecos, fred, edgar는 도구 응답 한 번의 길이를 6만 자(`MAX_OUTPUT_CHARS`)로 제한한다. `handle()`은 도구 결과를 바로 문자열로 만들지 않고 `fitOutput()`에 넘긴다. 이 함수는 한도를 넘는 결과에서 **글자가 아니라 행 수를 줄인다.** 그래서 응답은 길이와 관계없이 항상 해석할 수 있는 JSON이다.

코드는 서버마다 따로 있지만 약속은 같다.

- 한도 이하인 결과는 한 글자도 바꾸지 않는다.
- 한도를 넘으면 행 배열에서 한도 안에 들어가는 가장 많은 행 수를 이분 탐색으로 찾아 그만큼만 남긴다.
- 줄인 결과에는 `truncated: true`가 붙고, `note`에 몇 건 중 몇 건을 표시했는지와 그 도구에서 범위를 좁히는 방법이 들어간다. `shown`은 실제로 돌려준 행 수가 된다.
- 전체 건수를 뜻하는 항목(`total`, `count`, `matched` 등)은 줄이기 전 값 그대로다.
- 줄일 배열이 없는 결과가 한도를 넘으면 `{ truncated, total_chars, note, preview }` 형태로 앞부분만 문자열에 담아 돌려준다.

남기는 쪽은 그 도구의 건수 제한 인자가 남기는 쪽과 같다. 대부분 앞쪽(정렬 순서의 위쪽, 최신·상위)이고, fred의 관측값만 최근 쪽인 뒤를 남긴다.

서버마다 다른 것은 "어느 배열을 줄이고 어떤 안내를 붙이는가"를 정하는 방법이다. 이 정보는 `TOOLS`의 도구 객체에 `tools/list`로는 나가지 않는 항목으로 붙어 있다.

| 서버 | 줄일 대상과 안내를 정하는 방법 |
|---|---|
| krx | `rows`, 없으면 가장 큰 배열. 안내 문구는 하나로 고정 |
| ecos | `rows`·`results`, 없으면 가장 큰 배열. 도구의 `narrow` 문구를 안내로 사용 |
| dart | 도구의 `rowsKey`와 `narrow`. `afterFit`으로 줄인 뒤의 `next_offset`을 다시 맞춤 |
| fred | 도구의 `trim`(`key`, 남기는 쪽 `keep`, `hint`). 없으면 응답 안에서 가장 큰 목록을 찾아 줄임 |
| edgar | 최상위 `rows`, 없으면 안쪽의 모든 배열을 같은 수로 줄임. 안내는 도구 이름별 표(`TRUNC_HINT`) |

kis와 toss에는 이 장치가 없다. kis는 제공처가 많이 주는 도구에서 `count` 인자로 행 수를 줄인다([호출 한도와 캐시](rate-limits-and-caching.md)).

이전에는 한도를 넘으면 문자열을 6만 자에서 잘라 끝에 안내 문구를 붙였다. 그 응답은 JSON이 아니었고 `shown`이 실제 행 수와 맞지 않았다. 지금의 동작은 [오프라인 테스트](../testing/offline-tests.md)가 서버마다 고정한다.

## 시작 방식과 테스트 스위치

서버는 파일이 불리면 바로 표준 입력을 읽기 시작한다. `require.main` 판정을 쓰지 않는데, Claude Desktop이 내장 Node로 이 파일을 감싸서 실행하면 그 판정이 거짓이 되어 서버가 시작되지 않기 때문이다.

대신 테스트용 환경변수(`KIS_MCP_NO_MAIN=1`, `TOSS_MCP_NO_MAIN=1`, 나머지는 `<이름>_MCP_NO_STDIO=1`)가 있으면 시작하지 않고 내보내기만 한다. krx, ecos, fred는 이 변수가 켜져 있을 때만 호출 대상을 로컬 가짜 서버로 바꾸는 `_setHost()`를 허용한다. 운영 중에는 호스트를 바꿀 방법이 없다.

## 새 서버를 추가할 때

기존 서버 폴더를 본보기로 삼아 다음을 맞춘다.

- `server/index.js` 한 파일, 외부 패키지 없음
- 호스트 상수와 허용 목록, GET 고정
- 환경변수 이름을 `.env.example`과 루트 `README.md` 표에 추가
- `manifest.json`, `pack.sh`, 오프라인 테스트, 폴더 `README.md`
- 토큰이나 캐시를 디스크에 쓰면 `.gitignore`에 그 디렉터리 추가

## 관련 페이지

- [호출 한도와 캐시](rate-limits-and-caching.md)
- [오프라인 테스트](../testing/offline-tests.md)
- [한국투자증권 서버](../servers/kis.md)
