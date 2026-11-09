# 토스증권 조회 전용 MCP (toss-readonly)

토스증권 Open API(v1.2.28 명세 기준)를 조회만 하도록 만든 MCP 서버입니다. Claude Desktop 확장(.mcpb)으로도, 다른 에이전트의 MCP 서버로도 쓸 수 있습니다.

## 안전장치
- `server/index.js`의 `READ_ENDPOINTS`에 적힌 GET 주소만 호출합니다. 주문·정정·취소·조건주문·계좌·보유종목 API는 코드에 없습니다.
- 호출 주소는 `https://openapi.tossinvest.com`으로 고정돼 있습니다.
- client_id / client_secret은 환경변수 `TOSS_CLIENT_ID`·`TOSS_CLIENT_SECRET`로 받습니다. Claude Desktop에서는 설치 화면에 입력하면 Desktop이 macOS 키체인에 보관하고 서버에 넘겨 줍니다. 이 저장소에는 저장되지 않습니다.
- 발급받은 접근 토큰만 `~/.toss-mcp/token-*.json`(권한 600)에 캐시합니다. 토스는 client당 토큰이 1개라 재발급하면 이전 토큰이 무효가 되므로, 만료 전까지 재사용합니다.
- 외부 패키지 없이 Node 표준 기능만 씁니다.

## 도구
| 도구 | 내용 |
|---|---|
| toss_market_investor_trading | 코스피·코스닥 시장 전체 투자자별 매매대금 → 순매수 억원 요약, 기관 7개 세부, 네 주체 합(0이면 정상) |
| toss_market_indicator_prices | KOSPI, KOSDAQ, 국고채 2·3·5·10·20·30년 현재가 |
| toss_market_indicator_candles | 위 지표 캔들 (지수 분봉·일봉, 국채 일봉) |
| toss_investor_trading_rankings | 외국인·기관·개인 순매수/순매도 상위 종목 |
| toss_stock_investor_trading | 종목별 투자자 매매동향(주 수 기준, 등록외국인) |
| toss_exchange_rate | 원/달러 참고 환율 |
| toss_kr_market_calendar | 국내 장 운영 정보 |
| toss_stock_short_selling | 종목 공매도 동향(거래량·거래대금·비중, 일별) |
| toss_stock_program_trades | 종목 프로그램매매(차익·비차익, 주 수, KRX만) |
| toss_sector_rankings | 섹터 랭킹(등락률 상위·거래대금 상위, KR/US) |
| toss_stock_rankings | 주식 랭킹(시장 거래대금·거래량, 등락률 상위·하위, KR/US) |
| toss_stock_prices | 종목 현재가(국내 6자리 코드·미국 티커, 최대 200개) |
| toss_stock_candles | 종목 캔들(분봉·일봉, 수정주가) |

## 설치 (Claude Desktop)
`./pack.sh`로 `toss-readonly.mcpb`를 만든 뒤 더블클릭 → 설치 → client_id·client_secret 입력 → 사용 중으로 전환 → Desktop 재시작.

## 다른 에이전트에서 쓰기 (범용 MCP)

Claude Desktop이 아니어도 MCP를 지원하는 에이전트라면 아래처럼 등록합니다. 경로는 이 저장소를 받은 위치로 바꾸세요.

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

## 명세 파일

토스가 배포한 원본 명세(`openapi.json`, v1.2.28)는 이 저장소에 넣지 않았습니다. 토스증권 개발자 문서(https://developers.tossinvest.com/docs)에서 받습니다. 어떤 API를 썼고 왜 뺐는지는 `API_CHECKLIST.md`에 있습니다.

## 테스트
`node test/test.js` (가짜 응답으로 점검, 실제 서버에 접속하지 않음)

## 주의
- 국내 종목 현재가·일봉·수급은 KRX+NXT 통합 기준입니다. 장 마감 후에는 NXT 애프터마켓 가격이 반영돼 KRX 정규장 공식 종가와 다릅니다. 공식 종가는 메리츠 일봉이나 거래소 기사로 확인하세요. 지수는 공식 값과 같습니다.
- 토스 허용 IP 목록에 이 PC의 공인 IP가 있어야 합니다. IP가 바뀌면 403이 납니다.
- 당일 수급은 장 종료 전까지 잠정치입니다. `updatedAt`을 확인하세요.
- 실행 로그는 `TOSS_MCP_LOG_FILE`을 지정했을 때만 남깁니다(Desktop 확장은 `~/.toss-mcp/server.log`). 키·토큰은 기록하지 않습니다.
