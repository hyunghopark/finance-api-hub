---
type: architecture
title: 인증 정보와 비밀 값 처리
description: 서버별 인증 정보를 어디에서 읽는지, 접근토큰을 어떻게 발급하고 캐시하는지, 오류 문구와 로그에서 비밀 값을 어떻게 가리는지 설명한다.
tags: [credentials, secrets, token-cache, keychain, security]
verified:
  - by: openwiki/0.5.2
    at: 2026-11-24T12:24:57.291Z
sources:
  - id: openwiki-source-ea70eb6c045047448e446296
    resource: repo://.gitignore
  - id: openwiki-source-1d34fa17b34fe29bbe8f60ee
    resource: repo://dart/server/index.js
  - id: openwiki-source-84deab234ff8a0f3b3a44c71
    resource: repo://edgar/server/index.js
  - id: openwiki-source-d22879e7241e310cc4e86450
    resource: repo://kis/server/index.js
  - id: openwiki-source-20f822cbebdb1e3dd39b9e72
    resource: repo://toss/server/index.js
generated: { by: "claude-code", at: "2026-11-24T12:24:57.291Z" }
---

# 인증 정보와 비밀 값 처리

이 저장소의 서버는 인증 정보를 저장소 안에 두지 않는다. 값은 실행 시점에 환경변수나 macOS 키체인에서 읽고, 발급받은 접근토큰만 홈 디렉터리의 권한 제한 파일에 캐시한다. 이 페이지는 그 경로와 서버별 차이를 정리한다.

## 인증 정보의 출처

서버는 인증 방식에 따라 두 부류로 나뉜다.

| 부류 | 서버 | 읽는 순서 |
|---|---|---|
| 키 하나를 요청에 붙이는 서버 | krx, dart, ecos, fred, edgar | 환경변수 → macOS 키체인 |
| 키로 접근토큰을 발급받는 서버 | toss, kis | 환경변수만 |

**키 하나를 쓰는 서버**는 `getKey()`(edgar는 `getUA()`)에서 같은 순서를 따른다. 환경변수 값이 있으면 그것을 쓰고, 없으면 macOS에서만 `security find-generic-password`를 실행해 키체인에서 읽는다. 읽은 값은 프로세스가 끝날 때까지 메모리에 둔다.

**토큰을 발급받는 서버**(toss, kis)는 키체인을 보지 않는다. `credentials()`가 환경변수 두 개를 읽고, 하나라도 비어 있으면 어디에 넣어야 하는지 안내하는 오류를 던진다.

두 부류 모두 값에 `${`가 들어 있으면 "설정되지 않음"으로 취급한다. Claude Desktop 확장의 설정 칸을 비워 두면 `${user_config.app_key}` 같은 자리표시자가 그대로 환경변수로 넘어오기 때문이다. 이 처리가 없으면 자리표시자 문자열을 키로 착각해 외부 서버에 보내게 된다.

edgar는 API 키가 없고 대신 연락처가 든 User-Agent 문자열을 요구한다. `checkUA()`가 `@`가 없는 값을 거부한다.

환경변수 이름은 저장소 루트의 `.env.example`에 모여 있다. 다만 서버는 `.env` 파일을 직접 읽지 않는다. MCP 클라이언트 설정의 `env`나 확장 설정 화면을 통해 환경변수로 들어와야 한다([설치와 확장 패키징](../operations/install-and-packaging.md) 참고).

## 접근토큰 발급과 캐시

toss와 kis는 발급한 토큰을 `~/.toss-mcp/`, `~/.kis-mcp/` 아래 파일에 저장하고 만료 전까지 다시 쓴다. 파일 이름은 `token-<키의 SHA-256 앞 16자리>.json`이라 키 자체가 파일 이름에 드러나지 않고, 키를 바꾸면 다른 파일을 쓴다. 디렉터리는 권한 700, 파일은 600으로 만든다. 저장에 실패해도 메모리의 토큰으로 계속 동작한다.

재사용 조건은 두 서버가 같다. 만료 시각 60초 전까지만 유효한 것으로 본다.

두 제공처의 발급 정책이 달라서 재발급 처리는 다르다.

- **toss**: client당 유효 토큰이 하나뿐이어서 재발급하면 이전 토큰이 무효가 된다. 조회에서 401을 받으면 한 번만 재발급하고 다시 시도한다.
- **kis**: 발급은 1분당 1회이고 발급할 때마다 알림톡이 발송된다. 그래서 세 가지 보호가 더 있다.
  - 발급한 지 1분이 안 된 토큰이 거부되면 재발급하지 않고 "1분 뒤 다시 시도" 오류를 낸다.
  - 발급이 진행 중이면 다른 호출은 같은 발급 결과를 기다린다. 동시에 여러 도구가 불려도 발급은 한 번이다.
  - 만료 시각은 응답의 한국 시각 문자열(`access_token_token_expired`)을 우선 해석하고, 형식이 다르면 `expires_in`, 그것도 없으면 24시간으로 본다.

kis는 토큰과 별개로 조회할 때마다 appkey와 appsecret을 요청 헤더로 보내야 한다. 그래서 호출 대상 호스트를 코드에 상수로 고정해 키가 다른 주소로 나가지 않게 했다. 자세한 흐름은 [한국투자증권 서버](../servers/kis.md)에 있다.

## 비밀 값 가리기

오류 문구는 MCP 응답으로 에이전트에게 그대로 전달되므로, 제공처가 응답 본문에 키를 되돌려 보내면 대화에 키가 남을 수 있다. 서버마다 `mask()`가 이를 막는다.

| 서버 | 가리는 대상 |
|---|---|
| dart | 주소의 `crtfc_key=` 뒤 값 |
| fred | 주소의 `api_key=` 뒤 값과 메모리의 키 문자열 |
| krx, ecos | 메모리의 키 문자열 |
| edgar | User-Agent 문자열 전체와 이메일 주소 형태의 모든 문자열 |
| kis | appkey, appsecret, 메모리의 접근토큰 |

kis는 길이 4 미만인 값은 가리지 않는다. 짧은 문자열을 치환하면 오류 문구가 무의미하게 깨지기 때문이다.

로그에도 비밀 값을 쓰지 않는다. toss와 kis의 `log()`는 stderr에 쓰고, `*_MCP_LOG_FILE` 환경변수가 있을 때만 파일에도 남긴다. 기록하는 내용은 받은 메서드와 도구 이름, 오류 문구, 토큰 만료 시각이다.

## 저장소에 남지 않게 하는 장치

`.gitignore`가 `.env`, `.env.*`(예시 파일 제외), 서버별 캐시 디렉터리, `*.token`, `*.mcpb`를 제외한다. 테스트는 `HOME`을 임시 디렉터리로 바꿔 실행하므로 실제 토큰 캐시를 건드리지 않는다([오프라인 테스트](../testing/offline-tests.md) 참고).

## 관련 페이지

- [MCP 서버 공통 구조](server-anatomy.md)
- [호출 한도와 캐시](rate-limits-and-caching.md)
- [토스증권 서버](../servers/toss.md)
