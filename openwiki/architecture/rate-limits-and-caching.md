---
type: architecture
title: 호출 한도와 캐시
description: 제공처별 호출 한도에 맞춰 서버가 요청을 줄 세우고 재시도하는 방식과, 디스크·메모리에 두는 캐시의 위치와 수명을 설명한다.
tags: [rate-limit, throttling, retry, cache, http]
verified:
  - by: openwiki/0.5.2
    at: 2026-11-24T12:24:57.291Z
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
generated: { by: "claude-code", at: "2026-11-24T12:24:57.291Z" }
---

# 호출 한도와 캐시

각 제공처는 호출 한도와 그 초과를 알리는 방식이 다르다. 서버는 한도를 넘지 않도록 요청을 한 줄로 세우고, 넘었다는 응답을 받으면 정해진 횟수만 다시 시도한다. 반복해서 필요한 큰 목록은 캐시해 호출 수를 줄인다.

## 요청을 줄 세우는 방식

kis, fred, edgar는 같은 구조를 쓴다. 모듈 수준의 프로미스 하나(`gate` 또는 `chain`)에 각 요청을 이어 붙이고, 직전 요청의 시작 시각에서 최소 간격이 지나지 않았으면 그만큼 기다린다. 에이전트가 도구 여러 개를 동시에 불러도 실제 요청은 순서대로 간격을 두고 나간다.

| 서버 | 최소 간격 | 근거 |
|---|---|---|
| kis | 110ms (초당 9건쯤) | 60ms 간격으로는 15번째 호출에서 한도 초과가 발생한 실측 |
| fred | 550ms | 분당 120회 한도 |
| edgar | 125ms (초당 8건) | SEC 공정 접근 정책의 초당 10건 |

간격은 요청의 **시작** 사이에만 적용된다. 응답이 늦어도 다음 요청은 간격만 지나면 나간다.

krx, dart, ecos, toss는 간격 조절이 없다. krx는 대신 같은 날짜·같은 API의 결과를 메모리에 두어 반복 호출을 피한다.

## 한도 초과와 일시 오류의 재시도

재시도는 모두 횟수가 정해져 있어 무한히 돌지 않는다.

| 서버 | 조건 | 동작 |
|---|---|---|
| kis | 본문 `msg_cd`가 `EGW00201` (HTTP 500으로 옴) | 1초 기다렸다 한 번 재시도 |
| kis | HTTP 401 또는 `EGW00123` | 토큰을 한 번 재발급하고 재시도 |
| toss | HTTP 401 | 토큰을 한 번 재발급하고 재시도 |
| fred | HTTP 429 | 20초 기다렸다 한 번 재시도 |
| edgar | HTTP 500·502·503·504 | 1초 뒤 한 번 재시도 |
| krx | HTTP 429 | 재시도 없이 안내 오류 |

kis는 한도 초과 여부를 HTTP 상태가 아니라 본문의 코드로 판단한다. 제공처가 같은 500 상태로 다른 오류도 보낼 수 있기 때문이다. 토큰 재발급에는 1분 제한 보호가 따로 있다([인증 정보와 비밀 값 처리](credentials-and-secrets.md) 참고).

edgar는 403과 429를 재시도하지 않는다. SEC는 한도를 넘으면 약 10분간 차단하므로, 다시 보내면 상황이 나빠진다.

## 캐시

| 서버 | 대상 | 위치 | 수명 |
|---|---|---|---|
| toss, kis | 접근토큰 | `~/.toss-mcp/`, `~/.kis-mcp/`의 파일 + 메모리 | 토큰 만료 60초 전까지 |
| dart | 전체 회사 고유번호 목록 | `~/.dart-mcp/corpcode.json` + 메모리 | 7일 |
| ecos | 통계표 목록 | `~/.ecos-mcp/tables.json` + 메모리 | 7일 |
| edgar | 티커·CIK 목록 | `~/.edgar-mcp/company_tickers.json` + 메모리 | 24시간 |
| edgar | 응답 본문 | 메모리 (최대 40건, 8MB 이하만) | 5분 |
| krx | 날짜별 API 결과 | 메모리 (최대 30건) | 프로세스가 끝날 때까지 |

디스크 캐시는 모두 디렉터리 권한 700, 파일 권한 600으로 만든다. 파일의 수정 시각으로 수명을 판단하므로, 캐시를 강제로 새로 받으려면 파일을 지우면 된다.

dart와 ecos의 목록은 한 번 내려받는 데 큰 응답이 필요하다. dart는 zip으로 묶인 XML을 받아 풀고, ecos는 1000건씩 나눠 최대 20000건까지 받는다. 이 목록으로 회사 이름이나 통계표 이름을 코드로 바꾸므로 대부분의 도구가 첫 호출에서 이 캐시를 채운다.

ecos는 캐시 파일의 형식도 확인한다. 첫 행에 `parent_code` 항목이 없으면 이전 형식으로 보고 다시 받는다.

krx의 메모리 캐시는 "최근 영업일 찾기"와 맞물려 있다. 날짜를 비우고 조회하면 어제부터 최대 10일을 거슬러 올라가며 자료가 있는 날을 찾는데, 이때 빈 날의 결과도 캐시되어 같은 탐색을 반복해도 호출이 늘지 않는다.

## 시간 제한과 크기 제한

- 요청 시간 제한은 toss와 kis가 15초, krx·dart·fred·edgar가 30초, ecos가 65초다.
- edgar는 응답이 40MB를 넘으면 중단한다.
- krx·dart·ecos·fred·edgar는 도구 출력이 60000자를 넘지 않게 자른다. kis는 제공처가 한 번에 30~300일치를 주는 도구에 `count` 인자를 두어 행 수로 줄인다.

## 관련 페이지

- [MCP 서버 공통 구조](server-anatomy.md)
- [한국투자증권 서버](../servers/kis.md)
- [SEC EDGAR 서버](../servers/edgar.md)
