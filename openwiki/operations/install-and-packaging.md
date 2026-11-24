---
type: operations
title: 설치와 확장 패키징
description: 서버를 MCP 클라이언트에 등록하는 방법과, manifest.json과 pack.sh로 Claude Desktop 확장(.mcpb)을 만드는 과정, 설정 화면 입력값이 서버에 전달되는 경로를 설명한다.
tags: [install, packaging, mcpb, manifest, claude-desktop]
verified:
  - by: openwiki/0.5.2
    at: 2026-11-24T12:24:57.291Z
sources:
  - id: openwiki-source-f57d3e747bd0edfda85bf228
    resource: repo://edgar/manifest.json
  - id: openwiki-source-c07e5e54077a868d4eaac653
    resource: repo://kis/manifest.json
  - id: openwiki-source-49c5399d12f751883cdbd76b
    resource: repo://kis/pack.sh
  - id: openwiki-source-d22879e7241e310cc4e86450
    resource: repo://kis/server/index.js
  - id: openwiki-source-3d473299ca5b0b50546c4edb
    resource: repo://krx/manifest.json
  - id: openwiki-source-84414e3927b1f7880e942d67
    resource: repo://krx/pack.sh
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
generated: { by: "claude-code", at: "2026-11-24T12:24:57.291Z" }
---

# 설치와 확장 패키징

서버를 쓰는 방법은 두 가지다. MCP 클라이언트 설정에 서버 파일 경로를 직접 등록하거나, 서버 폴더를 확장 파일(`.mcpb`)로 묶어 Claude Desktop에 설치한다. 두 방법 모두 같은 `server/index.js`를 실행하며, 차이는 인증 정보가 환경변수로 들어오는 경로뿐이다.

## 방법 1: MCP 클라이언트에 직접 등록

Node.js 18 이상만 있으면 된다. 저장소를 받은 뒤 클라이언트 설정의 `mcpServers`에 서버를 추가한다.

```json
{
  "mcpServers": {
    "kis": {
      "command": "node",
      "args": ["/path/to/finance-api-hub/kis/server/index.js"],
      "env": { "KIS_APP_KEY": "...", "KIS_APP_SECRET": "..." }
    }
  }
}
```

필요한 서버만 골라 등록한다. 서버끼리 의존하지 않는다. 서버별 환경변수 이름과 발급처는 루트 `README.md`의 표와 `.env.example`에 있다.

서버는 `.env` 파일을 읽지 않는다. `.env.example`은 변수 이름을 모아 둔 참고용이고, 값은 위 설정의 `env`로 넣어야 한다. krx, dart, ecos, fred, edgar는 macOS 키체인에 값을 넣어 두면 `env`를 비워도 된다([인증 정보와 비밀 값 처리](../architecture/credentials-and-secrets.md)).

## 방법 2: Claude Desktop 확장

### 묶는 과정

서버 폴더마다 `pack.sh`가 있다. 하는 일은 두 가지다.

1. 오프라인 테스트를 실행한다. 스크립트가 `set -e`로 시작하므로 테스트가 실패하면 확장 파일이 만들어지지 않는다.
2. `manifest.json`, `server/`, `README.md`를 zip으로 묶어 `<이름>-readonly.mcpb`를 만든다.

`.mcpb`는 `manifest.json`이 최상위에 있는 zip 파일이다. 묶이는 것이 서버 폴더 안의 세 항목뿐이라는 점이, 서버가 폴더 밖의 코드에 의존하지 않아야 하는 이유다([MCP 서버 공통 구조](../architecture/server-anatomy.md)). 테스트 폴더와 폴더 안의 `.env`는 묶이지 않는다.

krx, ecos, fred의 `pack.sh`는 임시 디렉터리에서 zip을 만든 뒤 내용을 최종 파일에 덮어쓰고, 나머지는 기존 파일을 지운 뒤 제자리에서 만든다. 결과물은 같다.

### manifest.json의 역할

`manifest.json`은 Claude Desktop에 세 가지를 알려 준다.

**실행 방법.** `server.mcp_config`가 `node ${__dirname}/server/index.js`를 실행하도록 지정한다. `${__dirname}`은 확장이 설치된 위치로 바뀐다.

**설정 화면의 입력 칸.** `user_config`에 정의한 항목이 설치 화면의 입력 칸이 된다. `sensitive: true`인 값은 Claude Desktop이 보관한다.

**입력값을 환경변수로 넘기는 연결.** `mcp_config.env`에서 `${user_config.<항목>}`으로 입력값을 환경변수에 연결한다. 예를 들어 kis는 입력 칸 `app_key`를 `KIS_APP_KEY`로 넘긴다. 서버 코드는 어떤 방법으로 설치됐는지 알 필요 없이 환경변수만 읽는다.

입력 칸의 필수 여부는 서버 부류에 따라 다르다.

| 서버 | 입력 칸 | 필수 |
|---|---|---|
| toss | `client_id`, `client_secret` | 필수 |
| kis | `app_key`, `app_secret` | 필수 |
| krx, dart, ecos, fred | `api_key` | 선택 (키체인으로 대체 가능) |
| edgar | `user_agent` | 선택 (키체인으로 대체 가능) |

선택 칸을 비워 두면 `${user_config.api_key}`라는 자리표시자가 치환되지 않은 채 환경변수로 넘어올 수 있다. 서버가 `${`가 든 값을 "설정되지 않음"으로 취급하는 이유가 이것이다.

toss와 kis의 매니페스트는 로그 파일 경로(`TOSS_MCP_LOG_FILE`, `KIS_MCP_LOG_FILE`)도 `${HOME}` 아래로 지정한다. 직접 등록 방식에서는 이 변수를 주지 않으면 파일 로그가 남지 않는다.

`tools` 항목은 설치 화면에 보여 줄 도구 이름과 짧은 설명이다. 서버 코드의 `TOOLS`와 따로 관리되므로 도구를 추가하거나 이름을 바꾸면 양쪽을 함께 고쳐야 한다.

### 설치와 갱신

만든 `.mcpb`를 Claude Desktop의 설정 > 확장 프로그램에 끌어다 놓고, 입력 칸을 채운 뒤 확장을 사용 상태로 바꾼다.

운영에서 알아 둘 점은 다음과 같다.

- 확장 설정에서 키를 바꾼 뒤에는 확장을 껐다 켜야 적용된다. 서버가 키를 프로세스 메모리에 보관하기 때문이다.
- 확장을 설치하거나 다시 설치하면 Claude Desktop이 로컬 확장을 모두 재시작한다.
- 코드를 고친 뒤에는 `pack.sh`를 다시 실행해 새 파일을 설치해야 한다. 직접 등록 방식은 저장소의 파일을 그대로 실행하므로 클라이언트만 다시 시작하면 된다.

## 버전을 올릴 때 고칠 곳

버전 문자열이 여러 곳에 있다.

- `server/index.js`의 버전 상수 (`initialize` 응답에 실린다)
- `manifest.json`의 `version`
- 서버 폴더 `README.md`의 표
- 루트 `README.md`의 제공 서버 표

## 커밋에서 제외되는 것

`.gitignore`가 빌드 산출물(`*.mcpb`)과 `.env` 계열 파일, 서버가 홈 디렉터리에 만드는 캐시 디렉터리 이름을 제외한다. 확장 파일은 `pack.sh`로 언제든 다시 만들 수 있으므로 저장소에 올리지 않는다.

## 관련 페이지

- [빠른 시작](../quickstart.md)
- [오프라인 테스트](../testing/offline-tests.md)
- [인증 정보와 비밀 값 처리](../architecture/credentials-and-secrets.md)
