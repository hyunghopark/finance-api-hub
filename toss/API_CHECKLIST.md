# 토스증권 Open API 체크리스트 (명세 v1.2.28)

- 기준: `openapi.json` (info.version = 1.2.28), 도구: toss-readonly v0.2.0
- 전체 42개: ✅ 설치 13 · ⚙️ 내부 사용 1 · ⬜ 미설치 13 · ⛔ 제외 (주문) 6 · ⛔ 제외 (계좌) 9
- 계좌 헤더 = `X-Tossinvest-Account` 필요 여부 (필요하면 계좌 API)

| # | 그룹 | 메서드 | 경로 | 이름 | 계좌 헤더 | 호출 한도 그룹 | 상태 | 도구 / 메모 |
|---|---|---|---|---|---|---|---|---|
| 1 | Auth | POST | `/oauth2/token` | OAuth2 액세스 토큰 발급 | - | AUTH | ⚙️ 내부 사용 | 도구 아님. 서버 안에서 자동 발급·재사용 |
| 2 | Market Data | GET | `/api/v1/orderbook` | 호가 조회 | - | MARKET_DATA | ⬜ 미설치 |  |
| 3 | Market Data | GET | `/api/v1/prices` | 현재가 조회 | - | MARKET_DATA | ✅ 설치 | `toss_stock_prices` |
| 4 | Market Data | GET | `/api/v1/trades` | 최근 체결 내역 조회 | - | MARKET_DATA | ⬜ 미설치 |  |
| 5 | Market Data | GET | `/api/v1/price-limits` | 상/하한가 조회 | - | MARKET_DATA | ⬜ 미설치 |  |
| 6 | Market Data | GET | `/api/v1/candles` | 캔들 차트 조회 | - | MARKET_DATA_CHART | ✅ 설치 | `toss_stock_candles` |
| 7 | Market Indicators | GET | `/api/v1/market-indicators/prices` | 시장 지표 현재가 조회 | - | MARKET_INDICATOR | ✅ 설치 | `toss_market_indicator_prices` |
| 8 | Market Indicators | GET | `/api/v1/market-indicators/{symbol}/candles` | 시장 지표 캔들 차트 조회 | - | MARKET_INDICATOR_CHART | ✅ 설치 | `toss_market_indicator_candles` |
| 9 | Market Indicators | GET | `/api/v1/market-indicators/{symbol}/investor-trading` | 투자자별 매매대금 조회 | - | MARKET_INDICATOR | ✅ 설치 | `toss_market_investor_trading` |
| 10 | Stock Info | GET | `/api/v1/stocks` | 종목 기본 정보 조회 | - | STOCK | ⬜ 미설치 |  |
| 11 | Stock Info | GET | `/api/v1/stocks/all` | 마켓별 전체 종목 조회 | - | STOCK_ALL | ⬜ 미설치 |  |
| 12 | Stock Info | GET | `/api/v1/stocks/{symbol}/warnings` | 매수 유의사항 조회 | - | STOCK | ⬜ 미설치 |  |
| 13 | Stock Info | GET | `/api/v1/stocks/{symbol}/investor-trading` | 투자자별 매매동향 조회 | - | STOCK_TRADING_TREND | ✅ 설치 | `toss_stock_investor_trading` |
| 14 | Stock Info | GET | `/api/v1/stocks/{symbol}/program-trades` | 프로그램매매 동향 조회 | - | STOCK_TRADING_TREND | ✅ 설치 | `toss_stock_program_trades` |
| 15 | Stock Info | GET | `/api/v1/stocks/{symbol}/short-selling` | 공매도 동향 조회 | - | STOCK_TRADING_TREND | ✅ 설치 | `toss_stock_short_selling` |
| 16 | Stock Info | GET | `/api/v1/stocks/{symbol}/credit-trades` | 신용거래 동향 조회 | - | STOCK_TRADING_TREND | ⬜ 미설치 |  |
| 17 | Stock Info | GET | `/api/v1/stocks/{symbol}/securities-lending` | 대차거래 동향 조회 | - | STOCK_TRADING_TREND | ⬜ 미설치 |  |
| 18 | Market Info | GET | `/api/v1/exchange-rate` | 환율 조회 | - | MARKET_INFO | ✅ 설치 | `toss_exchange_rate` |
| 19 | Market Info | GET | `/api/v1/market-calendar/KR` | 국내 장 운영 정보 조회 | - | MARKET_INFO | ✅ 설치 | `toss_kr_market_calendar` |
| 20 | Market Info | GET | `/api/v1/market-calendar/US` | 해외 장 운영 정보 조회 | - | MARKET_INFO | ⬜ 미설치 |  |
| 21 | Ranking | GET | `/api/v1/rankings` | 주식 랭킹 조회 | - | RANKING | ✅ 설치 | `toss_stock_rankings` |
| 22 | Ranking | GET | `/api/v1/rankings/investor-trading` | 투자자별 순매수·순매도 랭킹 조회 | - | RANKING | ✅ 설치 | `toss_investor_trading_rankings` |
| 23 | Sector | GET | `/api/v1/sectors` | 섹터 목록 조회 | - | SECTOR | ⬜ 미설치 |  |
| 24 | Sector | GET | `/api/v1/sectors/rankings` | 섹터 랭킹 조회 | - | SECTOR_RANKING | ✅ 설치 | `toss_sector_rankings` |
| 25 | Sector | GET | `/api/v1/sectors/{sectorId}` | 섹터 상세 조회 | - | SECTOR | ⬜ 미설치 |  |
| 26 | Sector | GET | `/api/v1/sectors/{sectorId}/stocks` | 섹터 구성 주식 조회 | - | SECTOR | ⬜ 미설치 |  |
| 27 | Sector | GET | `/api/v1/sectors/{sectorId}/etfs` | 섹터 관련 ETF 조회 | - | SECTOR | ⬜ 미설치 |  |
| 28 | Account | GET | `/api/v1/accounts` | 계좌 목록 조회 | - | ACCOUNT | ⛔ 제외 (계좌) | 계좌 정보라 브리핑에 불필요 |
| 29 | Asset | GET | `/api/v1/holdings` | 보유 주식 조회 | 필요 | ASSET | ⛔ 제외 (계좌) | 계좌 정보라 브리핑에 불필요 |
| 30 | Order | POST | `/api/v1/orders` | 주문 생성 | 필요 | ORDER | ⛔ 제외 (주문) | 안전상 코드에 넣지 않음 |
| 31 | Order | POST | `/api/v1/orders/{orderId}/modify` | 주문 정정 | 필요 | ORDER | ⛔ 제외 (주문) | 안전상 코드에 넣지 않음 |
| 32 | Order | POST | `/api/v1/orders/{orderId}/cancel` | 주문 취소 | 필요 | ORDER | ⛔ 제외 (주문) | 안전상 코드에 넣지 않음 |
| 33 | Order History | GET | `/api/v1/orders` | 주문 목록 조회 | 필요 | ORDER_HISTORY | ⛔ 제외 (계좌) | 계좌 정보라 브리핑에 불필요 |
| 34 | Order History | GET | `/api/v1/orders/{orderId}` | 주문 상세 조회 | 필요 | ORDER_HISTORY | ⛔ 제외 (계좌) | 계좌 정보라 브리핑에 불필요 |
| 35 | Order Info | GET | `/api/v1/buying-power` | 매수 가능 금액 조회 | 필요 | ORDER_INFO | ⛔ 제외 (계좌) | 계좌 정보라 브리핑에 불필요 |
| 36 | Order Info | GET | `/api/v1/sellable-quantity` | 판매 가능 수량 조회 | 필요 | ORDER_INFO | ⛔ 제외 (계좌) | 계좌 정보라 브리핑에 불필요 |
| 37 | Order Info | GET | `/api/v1/commissions` | 매매 수수료 조회 | 필요 | ORDER_INFO | ⛔ 제외 (계좌) | 계좌 정보라 브리핑에 불필요 |
| 38 | Conditional Order | POST | `/api/v1/conditional-orders` | 조건주문 생성 | 필요 | CONDITIONAL_ORDER | ⛔ 제외 (주문) | 안전상 코드에 넣지 않음 |
| 39 | Conditional Order | DELETE | `/api/v1/conditional-orders/{conditionalOrderId}` | 조건주문 취소 | 필요 | CONDITIONAL_ORDER | ⛔ 제외 (주문) | 안전상 코드에 넣지 않음 |
| 40 | Conditional Order | POST | `/api/v1/conditional-orders/{conditionalOrderId}/modify` | 조건주문 수정 | 필요 | CONDITIONAL_ORDER | ⛔ 제외 (주문) | 안전상 코드에 넣지 않음 |
| 41 | Conditional Order History | GET | `/api/v1/conditional-orders` | 조건주문 목록 조회 | 필요 | CONDITIONAL_ORDER_HISTORY | ⛔ 제외 (계좌) | 계좌 정보라 브리핑에 불필요 |
| 42 | Conditional Order History | GET | `/api/v1/conditional-orders/{conditionalOrderId}` | 조건주문 상세 조회 | 필요 | CONDITIONAL_ORDER_HISTORY | ⛔ 제외 (계좌) | 계좌 정보라 브리핑에 불필요 |

## 범례
- ✅ 설치: toss-readonly에 도구로 들어 있음
- ⚙️ 내부 사용: 도구는 아니고 서버가 자동으로 씀
- ⬜ 미설치: 조회 API지만 아직 넣지 않음 (필요하면 추가 가능)
- ⛔ 제외: 주문·계좌 관련이라 안전상 넣지 않음