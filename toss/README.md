# 토스증권 MCP 서버 (`toss-readonly`)

토스증권 Open API를 조회 전용으로 제공하는 MCP 서버입니다.

| 항목 | 내용 |
|---|---|
| 버전 | 0.2.1 |
| 대상 API | 토스증권 Open API (명세 v1.2.28) |
| 호출 대상 | `https://openapi.tossinvest.com` 고정 |
| 인증 | OAuth2 client credentials (`TOSS_CLIENT_ID`, `TOSS_CLIENT_SECRET`) |
| 제약 | 토스증권 개발자 센터에 등록한 허용 IP에서만 호출 가능 |
| 런타임 | Node.js 18 이상, 외부 패키지 없음 |

## 도구

| 도구 | 설명 |
|---|---|
| `toss_market_investor_trading` | 코스피·코스닥 시장 전체의 투자자별 매매대금. 순매수 요약(억원), 기관 세부 7종, 주체별 합계 검증 |
| `toss_market_indicator_prices` | KOSPI, KOSDAQ, 국고채 2·3·5·10·20·30년 지표 현재가 |
| `toss_market_indicator_candles` | 위 지표의 캔들 (지수 분봉·일봉, 국고채 일봉) |
| `toss_investor_trading_rankings` | 외국인·기관·개인 순매수/순매도 상위 종목 |
| `toss_stock_investor_trading` | 종목별 투자자 매매동향 (주식 수 기준, 등록외국인) |
| `toss_stock_short_selling` | 종목 공매도 동향 (거래량·거래대금·비중, 일별) |
| `toss_stock_program_trades` | 종목 프로그램매매 (차익·비차익, 주식 수 기준, KRX만) |
| `toss_sector_rankings` | 섹터 랭킹 (등락률·거래대금 상위, 한국/미국) |
| `toss_stock_rankings` | 주식 랭킹 (거래대금·거래량, 등락률 상위·하위, 한국/미국) |
| `toss_stock_prices` | 종목 현재가 (국내 6자리 코드, 미국 티커, 최대 200개) |
| `toss_stock_candles` | 종목 캔들 (분봉·일봉, 수정주가) |
| `toss_exchange_rate` | 원/달러 매매기준율 |
| `toss_kr_market_calendar` | 국내 장 운영 정보 (휴장일, 개장·폐장 시각) |

## 설치

### MCP 클라이언트에 등록

```json
{
  "mcpServers": {
    "toss": {
      "command": "node",
      "args": ["/path/to/finance-api-hub/toss/server/index.js"],
      "env": { "TOSS_CLIENT_ID": "...", "TOSS_CLIENT_SECRET": "..." }
    }
  }
}
```

### Claude Desktop 확장

1. `./pack.sh`를 실행해 `toss-readonly.mcpb`를 만듭니다.
2. 파일을 Claude Desktop의 설정 > 확장 프로그램에 끌어다 놓습니다.
3. 설치 화면에 client_id와 client_secret을 입력하고 확장을 사용 상태로 바꿉니다.

## API 지원 범위

토스증권 Open API 42개 중 조회용 13개를 도구로 제공합니다. 주문 6개와 계좌 9개는 조회 전용 원칙에 따라 코드에 포함하지 않았습니다. 전체 목록과 상태는 [API_CHECKLIST.md](API_CHECKLIST.md)에 있습니다.

토스증권이 배포하는 원본 명세(`openapi.json`)는 이 저장소에 포함하지 않습니다. [토스증권 개발자 문서](https://developers.tossinvest.com/docs)에서 받을 수 있습니다.

## 보안

- `server/index.js`의 `READ_ENDPOINTS`에 등록된 GET 경로만 호출합니다.
- client_id와 client_secret은 환경변수로만 받습니다. Claude Desktop에서는 설치 화면의 입력값을 Desktop이 보관하고 서버에 전달합니다.
- 접근 토큰은 `~/.toss-mcp/token-*.json`(권한 600)에 캐시합니다. 토스증권은 client당 유효 토큰이 하나뿐이어서 재발급하면 이전 토큰이 무효가 되므로, 만료 전까지 재사용합니다.
- 실행 로그는 `TOSS_MCP_LOG_FILE`을 지정했을 때만 남기며(Claude Desktop 확장은 `~/.toss-mcp/server.log`), 인증 정보는 기록하지 않습니다.

## 데이터 기준과 제약

- **통합 시세 기준**: 국내 종목의 현재가·일봉·수급은 KRX와 넥스트레이드(NXT)를 합친 값입니다. 장 마감 후에는 NXT 애프터마켓 체결가가 반영되므로 KRX 정규장 공식 종가와 다를 수 있습니다. 지수는 공식 값과 같습니다.
- **잠정치**: 당일 시장 수급은 장중에는 잠정치이며 20시 직후 확정됩니다. 응답의 `updatedAt`으로 기준 시각을 확인하세요.
- **허용 IP**: 등록되지 않은 IP에서 호출하면 403이 반환됩니다.
- 항목별 반영·확정 시각은 [DATA_TIMING.md](../DATA_TIMING.md)를 참고하세요.

## 테스트

```bash
node test/test.js
```

모의 응답으로 검증하며 실제 서버에 접속하지 않습니다.
