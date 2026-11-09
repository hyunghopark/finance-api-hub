# 메리츠증권 Trading MCP

메리츠증권이 공식 GitHub로 배포하는 MCP입니다. 직접 만든 코드가 아니므로 배포 파일은 이 저장소에 넣지 않고, 설치 방법과 써 보며 확인한 내용만 적습니다.

- 받는 곳: 메리츠증권 Open API 포털(openapi.imeritz.com)의 MCP 안내 페이지와 공식 GitHub
- 파일: Mac Apple 칩 `meritz-open-api-darwin-arm64.mcpb`, Mac Intel `...-darwin-x64.mcpb`, Windows `...-win32-x64.mcpb` (이름에 `codegen`이 들어간 파일은 다른 도구)

## 설치 (Claude Desktop)

1. Open API 포털이나 앱에서 APP KEY·SECRET 발급. 실계좌가 연결된 키이므로 대화창·저장소에 넣지 않습니다.
2. `.mcpb`를 Claude Desktop 설정 > 확장 프로그램에 끌어다 놓기
3. 설치 화면에 키 입력, **'조회 전용' 스위치를 반드시 켜 둠** (끄면 주문·환전 가능)
4. 확장을 '사용 중'으로 바꾸고 Desktop 재시작

## 확인한 코드 (2026-11-04)

| 구분 | 코드 |
|---|---|
| 국내지수 | 코스피 `KGG01P`, 코스닥 `QGG01P`, 코스피200 `K2G01P`, 업종지수도 같은 방식(예: 음식료·담배 `KGS01P`) |
| 해외지수 | 나스닥 `NAS@IXIC`, S&P500 `SPI@SPX`, 다우 `DJI@DJI`, SOX `NAS@SOX` |
| 선물·원자재 | 나스닥100 선물 `CME@NQ`, S&P500 선물 `CME@ES`, WTI `NYM@CL`, 달러인덱스 `ETC@DXY00`(시장 구분 `N`) |
| 환율 | 원/달러 `USDKRWSMBS` |
| EWY | 거래소 `AX` + `EWY` (`NY`는 빈 값). 정규장·애프터·주간거래 가격 모두 조회 |

## 주의

- **종목별 투자자 API `market_investors`는 쓰지 않습니다.** 장중 어느 시점 값에 멈춰 있고, 전일 행에 당일 값이 덮어써집니다.
- 종목 수급과 공식 종가는 **일봉 `market_candles_days`**(기본 `TJ`)를 씁니다. 종가가 KRX 정규장 공식 종가이고, 외국인·기관 순매수 수량이 토스와 맞습니다.
- 종목 현재가 `market_prices`(`J`)는 NXT 애프터마켓 이후 가격이라 공식 종가가 아닙니다.
- 지수 현재가의 상승·하락 종목 수(`ascn_issu_cnt`·`down_issu_cnt`)는 시간외 거래까지 반영돼 20시 무렵까지 바뀝니다.
- WTI·달러인덱스는 전일 정산값에 멈춰 있습니다. 미 10년물·VIX·시장 전체 수급은 없습니다.
- 맥과 Desktop 앱이 켜져 있을 때만 쓸 수 있습니다.
