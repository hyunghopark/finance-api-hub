# 한국투자증권 MCP 서버 (`kis-readonly`)

한국투자증권(KIS) Open API를 조회 전용으로 제공하는 MCP 서버입니다.

| 항목 | 내용 |
|---|---|
| 버전 | 0.1.0 |
| 대상 API | 한국투자증권 Open API (공식 저장소 `koreainvestment/open-trading-api` 샘플 기준, 2026-11-24 확인) |
| 호출 대상 | `https://openapi.koreainvestment.com:9443` 고정 (실전 도메인) |
| 인증 | appkey, appsecret으로 접근토큰 발급 (`KIS_APP_KEY`, `KIS_APP_SECRET`) |
| 런타임 | Node.js 18 이상, 외부 패키지 없음 |

> **검증 상태**: 0.1.0은 공식 샘플 코드의 주소·tr_id·파라미터를 그대로 옮기고 모의 응답으로만 시험했습니다. 실제 한국투자증권 서버 호출로는 아직 확인하지 않았습니다.

## 도구

| 도구 | 설명 |
|---|---|
| `kis_stock_price` | 국내 종목 현재가. 거래소를 KRX 단독·NXT·통합 중에서 선택 |
| `kis_stock_daily_chart` | 국내 종목 일·주·월·년봉 (한 번에 최대 100건, 수정주가 선택) |
| `kis_stock_minute_chart` | 국내 종목 당일 분봉 (한 번에 최대 30건) |
| `kis_index_price` | 국내 업종지수 현재값 (0001 코스피, 1001 코스닥, 2001 코스피200) |
| `kis_index_daily_chart` | 국내 업종지수 일·주·월·년봉 |
| `kis_market_investor_daily` | 코스피·코스닥 시장별 투자자 매매동향 (일별) |
| `kis_stock_investor_daily` | 종목별 투자자 매매동향 (일별) |
| `kis_credit_balance_daily` | 종목 신용잔고 일별 추이 (한 번에 최대 30건) |
| `kis_overseas_price` | 해외 종목 현재체결가 |
| `kis_overseas_daily_chart` | 해외지수·환율·국채·금선물 일·주·월·년봉 |

국내 종목 도구의 `market`은 `J`(KRX 단독, 기본값), `NX`(넥스트레이드), `UN`(KRX+NXT 통합)입니다. 날짜는 `YYYY-MM-DD`로 넣으면 KIS 형식으로 바꿔 보냅니다. 응답은 KIS 원본 항목명(`stck_prpr` 등)을 그대로 돌려줍니다.

## 설치

### 인증 정보 발급

[KIS Developers](https://apiportal.koreainvestment.com)에서 Open API 서비스를 신청하고 **실전투자용** appkey와 appsecret을 발급받습니다. 이 서버는 실전 도메인만 호출하므로 모의투자용 키는 쓸 수 없습니다. 실계좌에 연결된 키이므로 외부에 노출하지 마세요.

### MCP 클라이언트에 등록

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

### Claude Desktop 확장

1. `./pack.sh`를 실행해 `kis-readonly.mcpb`를 만듭니다.
2. 파일을 Claude Desktop의 설정 > 확장 프로그램에 끌어다 놓습니다.
3. 설치 화면에 appkey와 appsecret을 입력하고 확장을 사용 상태로 바꿉니다.

## API 지원 범위

한국투자증권 Open API 334개 중 국내주식·해외주식 시세 조회 10개를 도구로 제공합니다. 주문·계좌 73개는 조회 전용 원칙에 따라, 실시간시세 60개는 웹소켓 방식이라 코드에 포함하지 않았습니다. 선물옵션·ELW·채권·ETF는 범위 밖입니다. 전체 목록과 상태는 [API_CHECKLIST.md](API_CHECKLIST.md)에 있습니다.

한국투자증권은 주문까지 가능한 공식 MCP(`Kis Trading MCP`)를 [공식 저장소](https://github.com/koreainvestment/open-trading-api)에서 배포합니다. 이 서버는 그와 별개로, 조회만 필요할 때 쓰는 용도입니다.

## 보안

- `server/index.js`의 `READ_ENDPOINTS`에 등록된 GET 경로만 호출합니다. POST는 접근토큰 발급(`/oauth2/tokenP`)에만 씁니다.
- 계좌번호를 받지 않으며, 잔고·주문 관련 주소와 tr_id는 코드에 없습니다.
- appkey와 appsecret은 환경변수로만 받습니다. KIS는 조회할 때마다 두 값을 요청 헤더로 보내도록 요구하므로 고정된 KIS 주소로만 전송합니다.
- 접근 토큰은 `~/.kis-mcp/token-*.json`(권한 600)에 캐시합니다. KIS는 토큰을 발급할 때마다 알림톡을 보내고 1분당 1회만 발급하므로, 만료(1일) 전까지 재사용합니다.
- 실행 로그는 `KIS_MCP_LOG_FILE`을 지정했을 때만 남기며(Claude Desktop 확장은 `~/.kis-mcp/server.log`), 인증 정보는 기록하지 않습니다. 오류 문구에서도 키와 토큰을 가립니다.

## 데이터 기준과 제약

- **거래소 기준**: `market`에 따라 값이 달라집니다. KRX 정규장 기준 값이 필요하면 `J`를 쓰세요. `UN`은 NXT 체결이 합쳐진 값입니다.
- **조회 시점 값**: 현재가와 지수는 실시간 스트림이 아니라 호출한 시점의 값입니다.
- **건수 제한**: 기간별 시세는 한 번에 최대 100건, 분봉과 신용잔고는 30건입니다. 더 긴 기간은 날짜를 나눠 조회합니다. 분봉은 당일 자료만 제공됩니다.
- **호출 한도**: 초당 호출 수에 제한이 있어 서버가 요청을 한 건씩 간격을 두고 보냅니다. 한도 초과 응답(`EGW00201`)을 받으면 한 번 기다렸다 다시 시도합니다.
- **오류 형식**: KIS는 HTTP 200으로 응답하면서 본문의 `rt_cd`로 실패를 알리는 경우가 있습니다. 이때 `msg_cd`와 `msg1`을 오류로 돌려줍니다.

## 테스트

```bash
node test/offline.test.js
```

모의 응답으로 검증하며 실제 서버에 접속하지 않습니다.
