# 한국투자증권 Open API 체크리스트

- 기준: 공식 저장소 [koreainvestment/open-trading-api](https://github.com/koreainvestment/open-trading-api)의 API 목록(`MCP/KIS Code Assistant MCP/data.csv`, 334개)과 `examples_llm` 샘플 코드, 2026-11-24 확인
- 도구: kis-readonly v0.1.2
- 경로와 tr_id는 샘플 코드에서 기계적으로 뽑은 값입니다. tr_id가 둘 이상이면 실전·모의 또는 조회 구분에 따라 갈립니다. 설치한 10개 외에는 이 저장소에서 호출해 보지 않았습니다.

## 전체 334개 요약

| 분류 | 세부 | 개수 | 상태 |
|---|---|---|---|
| 인증 | 인증 | 2 | ⚙️ 접근토큰발급 1개만 내부 사용. 웹소켓 접속키는 쓰지 않음 |
| 국내주식 | ELW시세 | 1 | ⬜ 범위 밖 (미설치) |
| 국내주식 | 기본시세 | 16 | ✅ 설치 3 · ⬜ 미설치 13 (아래 표) |
| 국내주식 | 순위분석 | 22 | ✅ 설치 0 · ⬜ 미설치 22 (아래 표) |
| 국내주식 | 시세분석 | 29 | ✅ 설치 3 · ⬜ 미설치 26 (아래 표) |
| 국내주식 | 실시간시세 | 25 | ⛔ 제외 (웹소켓) |
| 국내주식 | 업종/기타 | 14 | ✅ 설치 2 · ⬜ 미설치 12 (아래 표) |
| 국내주식 | 종목정보 | 26 | ✅ 설치 0 · ⬜ 미설치 26 (아래 표) |
| 국내주식 | 주문/계좌 | 23 | ⛔ 제외 (주문·계좌) |
| 해외주식 | 기본시세 | 13 | ✅ 설치 2 · ⬜ 미설치 11 (아래 표) |
| 해외주식 | 시세분석 | 15 | ✅ 설치 0 · ⬜ 미설치 15 (아래 표) |
| 해외주식 | 실시간시세 | 4 | ⛔ 제외 (웹소켓) |
| 해외주식 | 주문/계좌 | 18 | ⛔ 제외 (주문·계좌) |
| 국내선물옵션 | 기본시세 | 9 | ⬜ 범위 밖 (미설치) |
| 국내선물옵션 | 실시간시세 | 20 | ⛔ 제외 (웹소켓) |
| 국내선물옵션 | 주문/계좌 | 14 | ⛔ 제외 (주문·계좌) |
| 해외선물옵션 | 기본시세 | 20 | ⬜ 범위 밖 (미설치) |
| 해외선물옵션 | 실시간시세 | 4 | ⛔ 제외 (웹소켓) |
| 해외선물옵션 | 주문/계좌 | 11 | ⛔ 제외 (주문·계좌) |
| ELW | ELW시세 | 21 | ⬜ 범위 밖 (미설치) |
| ELW | 실시간시세 | 3 | ⛔ 제외 (웹소켓) |
| 장내채권 | 기본시세 | 8 | ⬜ 범위 밖 (미설치) |
| 장내채권 | 실시간시세 | 3 | ⛔ 제외 (웹소켓) |
| 장내채권 | 주문/계좌 | 7 | ⛔ 제외 (주문·계좌) |
| ETF/ETN | 기본시세 | 5 | ⬜ 범위 밖 (미설치) |
| ETF/ETN | 실시간시세 | 1 | ⛔ 제외 (웹소켓) |

- 주문·계좌(73개)는 조회 전용 원칙에 따라 코드에 포함하지 않습니다. 잔고·체결내역 같은 계좌 조회도 여기에 들어갑니다.
- 실시간시세(60개)는 웹소켓 방식이라 이 서버(REST 조회)의 대상이 아닙니다.
- 선물옵션, ELW, 채권, ETF/ETN은 이 저장소의 범위(주식·지수·수급) 밖이라 목록을 싣지 않았습니다.

## 국내주식·해외주식 시세 조회 135개

| # | 분류 | 세부 | 이름 | 경로 | tr_id | 상태 | 도구 |
|---|---|---|---|---|---|---|---|
| 1 | 국내주식 | 기본시세 | 주식현재가 일자별 | `/uapi/domestic-stock/v1/quotations/inquire-daily-price` | `FHKST01010400` | ⬜ 미설치 |  |
| 2 | 국내주식 | 기본시세 | 주식현재가 시세 | `/uapi/domestic-stock/v1/quotations/inquire-price` | `FHKST01010100` | ✅ 설치 | `kis_stock_price` |
| 3 | 국내주식 | 기본시세 | 국내주식 시간외현재가 | `/uapi/domestic-stock/v1/quotations/inquire-overtime-price` | `FHPST02300000` | ⬜ 미설치 |  |
| 4 | 국내주식 | 기본시세 | 주식현재가 시간외시간별체결 | `/uapi/domestic-stock/v1/quotations/inquire-time-overtimeconclusion` | `FHPST02310000` | ⬜ 미설치 |  |
| 5 | 국내주식 | 기본시세 | 주식현재가 시간외일자별주가 | `/uapi/domestic-stock/v1/quotations/inquire-daily-overtimeprice` | `FHPST02320000` | ⬜ 미설치 |  |
| 6 | 국내주식 | 기본시세 | 국내주식 시간외호가 | `/uapi/domestic-stock/v1/quotations/inquire-overtime-asking-price` | `FHPST02300400` | ⬜ 미설치 |  |
| 7 | 국내주식 | 기본시세 | 주식현재가 당일시간대별체결 | `/uapi/domestic-stock/v1/quotations/inquire-time-itemconclusion` | `FHPST01060000` | ⬜ 미설치 |  |
| 8 | 국내주식 | 기본시세 | 주식현재가 시세2 | `/uapi/domestic-stock/v1/quotations/inquire-price-2` | `FHPST01010000` | ⬜ 미설치 |  |
| 9 | 국내주식 | 기본시세 | 주식일별분봉조회 | `/uapi/domestic-stock/v1/quotations/inquire-time-dailychartprice` | `FHKST03010230` | ⬜ 미설치 |  |
| 10 | 국내주식 | 기본시세 | 국내주식기간별시세(일/주/월/년) | `/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice` | `FHKST03010100` | ✅ 설치 | `kis_stock_daily_chart` |
| 11 | 국내주식 | 기본시세 | 주식현재가 호가/예상체결 | `/uapi/domestic-stock/v1/quotations/inquire-asking-price-exp-ccn` | `FHKST01010200` | ⬜ 미설치 |  |
| 12 | 국내주식 | 기본시세 | 주식현재가 체결 | `/uapi/domestic-stock/v1/quotations/inquire-ccnl` | `FHKST01010300` | ⬜ 미설치 |  |
| 13 | 국내주식 | 기본시세 | 주식현재가 회원사 | `/uapi/domestic-stock/v1/quotations/inquire-member` | `FHKST01010600` | ⬜ 미설치 |  |
| 14 | 국내주식 | 기본시세 | 주식현재가 투자자 | `/uapi/domestic-stock/v1/quotations/inquire-investor` | `FHKST01010900` | ⬜ 미설치 |  |
| 15 | 국내주식 | 기본시세 | 국내주식 장마감 예상체결가 | `/uapi/domestic-stock/v1/quotations/exp-closing-price` | `FHKST117300C0` | ⬜ 미설치 |  |
| 16 | 국내주식 | 기본시세 | 주식당일분봉조회 | `/uapi/domestic-stock/v1/quotations/inquire-time-itemchartprice` | `FHKST03010200` | ✅ 설치 | `kis_stock_minute_chart` |
| 17 | 국내주식 | 업종/기타 | 국내주식 예상체결지수 추이 | `/uapi/domestic-stock/v1/quotations/exp-index-trend` | `FHPST01840000` | ⬜ 미설치 |  |
| 18 | 국내주식 | 업종/기타 | 국내주식업종기간별시세(일/주/월/년) | `/uapi/domestic-stock/v1/quotations/inquire-daily-indexchartprice` | `FHKUP03500100` | ✅ 설치 | `kis_index_daily_chart` |
| 19 | 국내주식 | 업종/기타 | 국내업종 시간별지수(분) | `/uapi/domestic-stock/v1/quotations/inquire-index-timeprice` | `FHPUP02110200` | ⬜ 미설치 |  |
| 20 | 국내주식 | 업종/기타 | 국내업종 구분별전체시세 | `/uapi/domestic-stock/v1/quotations/inquire-index-category-price` | `FHPUP02140000` | ⬜ 미설치 |  |
| 21 | 국내주식 | 업종/기타 | 업종 분봉조회 | `/uapi/domestic-stock/v1/quotations/inquire-time-indexchartprice` | `FHKUP03500200` | ⬜ 미설치 |  |
| 22 | 국내주식 | 업종/기타 | 국내휴장일조회 | `/uapi/domestic-stock/v1/quotations/chk-holiday` | `CTCA0903R` | ⬜ 미설치 |  |
| 23 | 국내주식 | 업종/기타 | 국내주식 예상체결 전체지수 | `/uapi/domestic-stock/v1/quotations/exp-total-index` | `FHKUP11750000` | ⬜ 미설치 |  |
| 24 | 국내주식 | 업종/기타 | 국내업종 현재지수 | `/uapi/domestic-stock/v1/quotations/inquire-index-price` | `FHPUP02100000` | ✅ 설치 | `kis_index_price` |
| 25 | 국내주식 | 업종/기타 | 국내선물 영업일조회 | `/uapi/domestic-stock/v1/quotations/market-time` | `HHMCM000002C0` | ⬜ 미설치 |  |
| 26 | 국내주식 | 업종/기타 | 국내업종 시간별지수(초) | `/uapi/domestic-stock/v1/quotations/inquire-index-tickprice` | `FHPUP02110100` | ⬜ 미설치 |  |
| 27 | 국내주식 | 업종/기타 | 국내업종 일자별지수 | `/uapi/domestic-stock/v1/quotations/inquire-index-daily-price` | `FHPUP02120000` | ⬜ 미설치 |  |
| 28 | 국내주식 | 업종/기타 | 금리 종합(국내채권/금리) | `/uapi/domestic-stock/v1/quotations/comp-interest` | `FHPST07020000` | ⬜ 미설치 |  |
| 29 | 국내주식 | 업종/기타 | 변동성완화장치(VI) 현황 | `/uapi/domestic-stock/v1/quotations/inquire-vi-status` | `FHPST01390000` | ⬜ 미설치 |  |
| 30 | 국내주식 | 업종/기타 | 종합 시황/공시(제목) | `/uapi/domestic-stock/v1/quotations/news-title` | `FHKST01011800` | ⬜ 미설치 |  |
| 31 | 국내주식 | 종목정보 | 상품기본조회 | `/uapi/domestic-stock/v1/quotations/search-info` | `CTPF1604R` | ⬜ 미설치 |  |
| 32 | 국내주식 | 종목정보 | 예탁원정보(상장정보일정) | `/uapi/domestic-stock/v1/ksdinfo/list-info` | `HHKDB669107C0` | ⬜ 미설치 |  |
| 33 | 국내주식 | 종목정보 | 예탁원정보(공모주청약일정) | `/uapi/domestic-stock/v1/ksdinfo/pub-offer` | `HHKDB669108C0` | ⬜ 미설치 |  |
| 34 | 국내주식 | 종목정보 | 국내주식 재무비율 | `/uapi/domestic-stock/v1/finance/financial-ratio` | `FHKST66430300` | ⬜ 미설치 |  |
| 35 | 국내주식 | 종목정보 | 예탁원정보(자본감소일정) | `/uapi/domestic-stock/v1/ksdinfo/cap-dcrs` | `HHKDB669106C0` | ⬜ 미설치 |  |
| 36 | 국내주식 | 종목정보 | 예탁원정보(무상증자일정) | `/uapi/domestic-stock/v1/ksdinfo/bonus-issue` | `HHKDB669101C0` | ⬜ 미설치 |  |
| 37 | 국내주식 | 종목정보 | 국내주식 증권사별 투자의견 | `/uapi/domestic-stock/v1/quotations/invest-opbysec` | `FHKST663400C0` | ⬜ 미설치 |  |
| 38 | 국내주식 | 종목정보 | 국내주식 당사 신용가능종목 | `/uapi/domestic-stock/v1/quotations/credit-by-company` | `FHPST04770000` | ⬜ 미설치 |  |
| 39 | 국내주식 | 종목정보 | 예탁원정보(주식매수청구일정) | `/uapi/domestic-stock/v1/ksdinfo/purreq` | `HHKDB669103C0` | ⬜ 미설치 |  |
| 40 | 국내주식 | 종목정보 | 예탁원정보(액면교체일정) | `/uapi/domestic-stock/v1/ksdinfo/rev-split` | `HHKDB669105C0` | ⬜ 미설치 |  |
| 41 | 국내주식 | 종목정보 | 예탁원정보(배당일정) | `/uapi/domestic-stock/v1/ksdinfo/dividend` | `HHKDB669102C0` | ⬜ 미설치 |  |
| 42 | 국내주식 | 종목정보 | 국내주식 종목투자의견 | `/uapi/domestic-stock/v1/quotations/invest-opinion` | `FHKST663300C0` | ⬜ 미설치 |  |
| 43 | 국내주식 | 종목정보 | 국내주식 안정성비율 | `/uapi/domestic-stock/v1/finance/stability-ratio` | `FHKST66430600` | ⬜ 미설치 |  |
| 44 | 국내주식 | 종목정보 | 국내주식 수익성비율 | `/uapi/domestic-stock/v1/finance/profit-ratio` | `FHKST66430400` | ⬜ 미설치 |  |
| 45 | 국내주식 | 종목정보 | 예탁원정보(실권주일정) | `/uapi/domestic-stock/v1/ksdinfo/forfeit` | `HHKDB669109C0` | ⬜ 미설치 |  |
| 46 | 국내주식 | 종목정보 | 예탁원정보(의무예치일정) | `/uapi/domestic-stock/v1/ksdinfo/mand-deposit` | `HHKDB669110C0` | ⬜ 미설치 |  |
| 47 | 국내주식 | 종목정보 | 국내주식 손익계산서 | `/uapi/domestic-stock/v1/finance/income-statement` | `FHKST66430200` | ⬜ 미설치 |  |
| 48 | 국내주식 | 종목정보 | 당사 대주가능 종목 | `/uapi/domestic-stock/v1/quotations/lendable-by-company` | `CTSC2702R` | ⬜ 미설치 |  |
| 49 | 국내주식 | 종목정보 | 주식기본조회 | `/uapi/domestic-stock/v1/quotations/search-stock-info` | `CTPF1002R` | ⬜ 미설치 |  |
| 50 | 국내주식 | 종목정보 | 예탁원정보(유상증자일정) | `/uapi/domestic-stock/v1/ksdinfo/paidin-capin` | `HHKDB669100C0` | ⬜ 미설치 |  |
| 51 | 국내주식 | 종목정보 | 예탁원정보(주주총회일정) | `/uapi/domestic-stock/v1/ksdinfo/sharehld-meet` | `HHKDB669111C0` | ⬜ 미설치 |  |
| 52 | 국내주식 | 종목정보 | 국내주식 성장성비율 | `/uapi/domestic-stock/v1/finance/growth-ratio` | `FHKST66430800` | ⬜ 미설치 |  |
| 53 | 국내주식 | 종목정보 | 국내주식 대차대조표 | `/uapi/domestic-stock/v1/finance/balance-sheet` | `FHKST66430100` | ⬜ 미설치 |  |
| 54 | 국내주식 | 종목정보 | 예탁원정보(합병/분할일정) | `/uapi/domestic-stock/v1/ksdinfo/merger-split` | `HHKDB669104C0` | ⬜ 미설치 |  |
| 55 | 국내주식 | 종목정보 | 국내주식 종목추정실적 | `/uapi/domestic-stock/v1/quotations/estimate-perform` | `HHKST668300C0` | ⬜ 미설치 |  |
| 56 | 국내주식 | 종목정보 | 국내주식 기타주요비율 | `/uapi/domestic-stock/v1/finance/other-major-ratios` | `FHKST66430500` | ⬜ 미설치 |  |
| 57 | 국내주식 | 시세분석 | 프로그램매매 종합현황(시간) | `/uapi/domestic-stock/v1/quotations/comp-program-trade-today` | `FHPPG04600101` | ⬜ 미설치 |  |
| 58 | 국내주식 | 시세분석 | 국내주식 신용잔고 일별추이 | `/uapi/domestic-stock/v1/quotations/daily-credit-balance` | `FHPST04760000` | ✅ 설치 | `kis_credit_balance_daily` |
| 59 | 국내주식 | 시세분석 | 시장별 투자자매매동향(일별) | `/uapi/domestic-stock/v1/quotations/inquire-investor-daily-by-market` | `FHPTJ04040000` | ✅ 설치 | `kis_market_investor_daily` |
| 60 | 국내주식 | 시세분석 | 국내주식 공매도 일별추이 | `/uapi/domestic-stock/v1/quotations/daily-short-sale` | `FHPST04830000` | ⬜ 미설치 |  |
| 61 | 국내주식 | 시세분석 | 종목조건검색 목록조회 | `/uapi/domestic-stock/v1/quotations/psearch-title` | `HHKST03900300` | ⬜ 미설치 |  |
| 62 | 국내주식 | 시세분석 | 국내주식 상하한가 포착 | `/uapi/domestic-stock/v1/quotations/capture-uplowprice` | `FHKST130000C0` | ⬜ 미설치 |  |
| 63 | 국내주식 | 시세분석 | 프로그램매매 종합현황(일별) | `/uapi/domestic-stock/v1/quotations/comp-program-trade-daily` | `FHPPG04600001` | ⬜ 미설치 |  |
| 64 | 국내주식 | 시세분석 | 종목별 일별 대차거래추이 | `/uapi/domestic-stock/v1/quotations/daily-loan-trans` | `HHPST074500C0` | ⬜ 미설치 |  |
| 65 | 국내주식 | 시세분석 | 종목조건검색조회 | `/uapi/domestic-stock/v1/quotations/psearch-result` | `HHKST03900400` | ⬜ 미설치 |  |
| 66 | 국내주식 | 시세분석 | 국내주식 매물대/거래비중 | `/uapi/domestic-stock/v1/quotations/pbar-tratio` | `FHPST01130000` | ⬜ 미설치 |  |
| 67 | 국내주식 | 시세분석 | 국내기관_외국인 매매종목가집계 | `/uapi/domestic-stock/v1/quotations/foreign-institution-total` | `FHPTJ04400000` | ⬜ 미설치 |  |
| 68 | 국내주식 | 시세분석 | 관심종목 그룹별 종목조회 | `/uapi/domestic-stock/v1/quotations/intstock-stocklist-by-group` | `HHKCM113004C6` | ⬜ 미설치 |  |
| 69 | 국내주식 | 시세분석 | 주식현재가 회원사 종목매매동향 | `/uapi/domestic-stock/v1/quotations/inquire-member-daily` | `FHPST04540000` | ⬜ 미설치 |  |
| 70 | 국내주식 | 시세분석 | 종목별 프로그램매매추이(일별) | `/uapi/domestic-stock/v1/quotations/program-trade-by-stock-daily` | `FHPPG04650201` | ⬜ 미설치 |  |
| 71 | 국내주식 | 시세분석 | 관심종목 그룹조회 | `/uapi/domestic-stock/v1/quotations/intstock-grouplist` | `HHKCM113004C7` | ⬜ 미설치 |  |
| 72 | 국내주식 | 시세분석 | 종목별 외인기관 추정가집계 | `/uapi/domestic-stock/v1/quotations/investor-trend-estimate` | `HHPTJ04160200` | ⬜ 미설치 |  |
| 73 | 국내주식 | 시세분석 | 종목별일별매수매도체결량 | `/uapi/domestic-stock/v1/quotations/inquire-daily-trade-volume` | `FHKST03010800` | ⬜ 미설치 |  |
| 74 | 국내주식 | 시세분석 | 국내주식 체결금액별 매매비중 | `/uapi/domestic-stock/v1/quotations/tradprt-byamt` | `FHKST111900C0` | ⬜ 미설치 |  |
| 75 | 국내주식 | 시세분석 | 프로그램매매 투자자매매동향(당일) | `/uapi/domestic-stock/v1/quotations/investor-program-trade-today` | `HHPPG046600C1` | ⬜ 미설치 |  |
| 76 | 국내주식 | 시세분석 | 국내 증시자금 종합 | `/uapi/domestic-stock/v1/quotations/mktfunds` | `FHKST649100C0` | ⬜ 미설치 |  |
| 77 | 국내주식 | 시세분석 | 국내주식 예상체결가 추이 | `/uapi/domestic-stock/v1/quotations/exp-price-trend` | `FHPST01810000` | ⬜ 미설치 |  |
| 78 | 국내주식 | 시세분석 | 회원사 실 시간 매매동향(틱) | `/uapi/domestic-stock/v1/quotations/frgnmem-trade-trend` | `FHPST04320000` | ⬜ 미설치 |  |
| 79 | 국내주식 | 시세분석 | 시장별 투자자매매동향(시세) | `/uapi/domestic-stock/v1/quotations/inquire-investor-time-by-market` | `FHPTJ04030000` | ⬜ 미설치 |  |
| 80 | 국내주식 | 시세분석 | 종목별 프로그램매매추이(체결) | `/uapi/domestic-stock/v1/quotations/program-trade-by-stock` | `FHPPG04650101` | ⬜ 미설치 |  |
| 81 | 국내주식 | 시세분석 | 외국계 매매종목 가집계 | `/uapi/domestic-stock/v1/quotations/frgnmem-trade-estimate` | `FHKST644100C0` | ⬜ 미설치 |  |
| 82 | 국내주식 | 시세분석 | 국내주식 시간외예상체결등락률 | `/uapi/domestic-stock/v1/ranking/overtime-exp-trans-fluct` | `FHKST11860000` | ⬜ 미설치 |  |
| 83 | 국내주식 | 시세분석 | 종목별 외국계 순매수추이 | `/uapi/domestic-stock/v1/quotations/frgnmem-pchs-trend` | `FHKST644400C0` | ⬜ 미설치 |  |
| 84 | 국내주식 | 시세분석 | 관심종목(멀티종목) 시세조회 | `/uapi/domestic-stock/v1/quotations/intstock-multprice` | `FHKST11300006` | ⬜ 미설치 |  |
| 85 | 국내주식 | 순위분석 | 국내주식 예상체결 상승/하락상위 | `/uapi/domestic-stock/v1/ranking/exp-trans-updown` | `FHPST01820000` | ⬜ 미설치 |  |
| 86 | 국내주식 | 순위분석 | 국내주식 호가잔량 순위 | `/uapi/domestic-stock/v1/ranking/quote-balance` | `FHPST01720000` | ⬜ 미설치 |  |
| 87 | 국내주식 | 순위분석 | 국내주식 신용잔고 상위 | `/uapi/domestic-stock/v1/ranking/credit-balance` | `FHKST17010000` | ⬜ 미설치 |  |
| 88 | 국내주식 | 순위분석 | 국내주식 시간외거래량순위 | `/uapi/domestic-stock/v1/ranking/overtime-volume` | `FHPST02350000` | ⬜ 미설치 |  |
| 89 | 국내주식 | 순위분석 | 국내주식 배당률 상위 | `/uapi/domestic-stock/v1/ranking/dividend-rate` | `HHKDB13470100` | ⬜ 미설치 |  |
| 90 | 국내주식 | 순위분석 | 국내주식 시간외잔량 순위 | `/uapi/domestic-stock/v1/ranking/after-hour-balance` | `FHPST01760000` | ⬜ 미설치 |  |
| 91 | 국내주식 | 순위분석 | 국내주식 공매도 상위종목 | `/uapi/domestic-stock/v1/ranking/short-sale` | `FHPST04820000` | ⬜ 미설치 |  |
| 92 | 국내주식 | 순위분석 | 국내주식 이격도 순위 | `/uapi/domestic-stock/v1/ranking/disparity` | `FHPST01780000` | ⬜ 미설치 |  |
| 93 | 국내주식 | 순위분석 | HTS조회상위20종목 | `/uapi/domestic-stock/v1/ranking/hts-top-view` | `HHMCM000100C0` | ⬜ 미설치 |  |
| 94 | 국내주식 | 순위분석 | 거래량순위 | `/uapi/domestic-stock/v1/quotations/volume-rank` | `FHPST01710000` | ⬜ 미설치 |  |
| 95 | 국내주식 | 순위분석 | 국내주식 수익자산지표 순위 | `/uapi/domestic-stock/v1/ranking/profit-asset-index` | `FHPST01730000` | ⬜ 미설치 |  |
| 96 | 국내주식 | 순위분석 | 국내주식 신고/신저근접종목 상위 | `/uapi/domestic-stock/v1/ranking/near-new-highlow` | `FHPST01870000` | ⬜ 미설치 |  |
| 97 | 국내주식 | 순위분석 | 국내주식 우선주/괴리율 상위 | `/uapi/domestic-stock/v1/ranking/prefer-disparate-ratio` | `FHPST01770000` | ⬜ 미설치 |  |
| 98 | 국내주식 | 순위분석 | 국내주식 대량체결건수 상위 | `/uapi/domestic-stock/v1/ranking/bulk-trans-num` | `FHKST190900C0` | ⬜ 미설치 |  |
| 99 | 국내주식 | 순위분석 | 국내주식 재무비율 순위 | `/uapi/domestic-stock/v1/ranking/finance-ratio` | `FHPST01750000` | ⬜ 미설치 |  |
| 100 | 국내주식 | 순위분석 | 국내주식 시가총액 상위 | `/uapi/domestic-stock/v1/ranking/market-cap` | `FHPST01740000` | ⬜ 미설치 |  |
| 101 | 국내주식 | 순위분석 | 국내주식 당사매매종목 상위 | `/uapi/domestic-stock/v1/ranking/traded-by-company` | `FHPST01860000` | ⬜ 미설치 |  |
| 102 | 국내주식 | 순위분석 | 국내주식 등락률 순위 | `/uapi/domestic-stock/v1/ranking/fluctuation` | `FHPST01700000` | ⬜ 미설치 |  |
| 103 | 국내주식 | 순위분석 | 국내주식 시장가치 순위 | `/uapi/domestic-stock/v1/ranking/market-value` | `FHPST01790000` | ⬜ 미설치 |  |
| 104 | 국내주식 | 순위분석 | 국내주식 관심종목등록 상위 | `/uapi/domestic-stock/v1/ranking/top-interest-stock` | `FHPST01800000` | ⬜ 미설치 |  |
| 105 | 국내주식 | 순위분석 | 국내주식 체결강도 상위 | `/uapi/domestic-stock/v1/ranking/volume-power` | `FHPST01680000` | ⬜ 미설치 |  |
| 106 | 국내주식 | 순위분석 | 국내주식 시간외등락율순위 | `/uapi/domestic-stock/v1/ranking/overtime-fluctuation` | `FHPST02340000` | ⬜ 미설치 |  |
| 107 | 국내주식 | 시세분석 | 종목별 투자자매매동향(일별) | `/uapi/domestic-stock/v1/quotations/investor-trade-by-stock-daily` | `FHPTJ04160001` | ✅ 설치 | `kis_stock_investor_daily` |
| 108 | 해외주식 | 기본시세 | 해외주식 체결추이 | `/uapi/overseas-price/v1/quotations/inquire-ccnl` | `HHDFS76200300` | ⬜ 미설치 |  |
| 109 | 해외주식 | 기본시세 | 해외주식 기간별시세 | `/uapi/overseas-price/v1/quotations/dailyprice` | `HHDFS76240000` | ⬜ 미설치 |  |
| 110 | 해외주식 | 기본시세 | 해외결제일자조회 | `/uapi/overseas-stock/v1/quotations/countries-holiday` | `CTOS5011R` | ⬜ 미설치 |  |
| 111 | 해외주식 | 기본시세 | 해외주식 현재체결가 | `/uapi/overseas-price/v1/quotations/price` | `HHDFS00000300` | ✅ 설치 | `kis_overseas_price` |
| 112 | 해외주식 | 기본시세 | 해외주식조건검색 | `/uapi/overseas-price/v1/quotations/inquire-search` | `HHDFS76410000` | ⬜ 미설치 |  |
| 113 | 해외주식 | 기본시세 | 해외주식 상품기본정보 | `/uapi/overseas-price/v1/quotations/search-info` | `CTPF1702R` | ⬜ 미설치 |  |
| 114 | 해외주식 | 기본시세 | 해외지수분봉조회 | `/uapi/overseas-price/v1/quotations/inquire-time-indexchartprice` | `FHKST03030200` | ⬜ 미설치 |  |
| 115 | 해외주식 | 기본시세 | 해외주식분봉조회 | `/uapi/overseas-price/v1/quotations/inquire-time-itemchartprice` | `HHDFS76950200` | ⬜ 미설치 |  |
| 116 | 해외주식 | 기본시세 | 해외주식 현재가상세 | `/uapi/overseas-price/v1/quotations/price-detail` | `HHDFS76200200` | ⬜ 미설치 |  |
| 117 | 해외주식 | 기본시세 | 해외주식 업종별코드조회 | `/uapi/overseas-price/v1/quotations/industry-price` | `HHDFS76370100` | ⬜ 미설치 |  |
| 118 | 해외주식 | 기본시세 | 해외주식 종목/지수/환율기간별시세(일/주/월/년) | `/uapi/overseas-price/v1/quotations/inquire-daily-chartprice` | `FHKST03030100` | ✅ 설치 | `kis_overseas_daily_chart` |
| 119 | 해외주식 | 기본시세 | 해외주식 업종별시세 | `/uapi/overseas-price/v1/quotations/industry-theme` | `HHDFS76370000` | ⬜ 미설치 |  |
| 120 | 해외주식 | 기본시세 | 해외주식 현재가 1호가 | `/uapi/overseas-price/v1/quotations/inquire-asking-price` | `HHDFS76200100` | ⬜ 미설치 |  |
| 121 | 해외주식 | 시세분석 | 해외주식 거래증가율순위 | `/uapi/overseas-stock/v1/ranking/trade-growth` | `HHDFS76330000` | ⬜ 미설치 |  |
| 122 | 해외주식 | 시세분석 | 해외주식 기간별권리조회 | `/uapi/overseas-price/v1/quotations/period-rights` | `CTRGT011R` | ⬜ 미설치 |  |
| 123 | 해외주식 | 시세분석 | 해외주식 가격급등락 | `/uapi/overseas-stock/v1/ranking/price-fluct` | `HHDFS76260000` | ⬜ 미설치 |  |
| 124 | 해외주식 | 시세분석 | 해외주식 거래대금순위 | `/uapi/overseas-stock/v1/ranking/trade-pbmn` | `HHDFS76320010` | ⬜ 미설치 |  |
| 125 | 해외주식 | 시세분석 | 해외주식 거래량급증 | `/uapi/overseas-stock/v1/ranking/volume-surge` | `HHDFS76270000` | ⬜ 미설치 |  |
| 126 | 해외주식 | 시세분석 | 해외주식 신고/신저가 | `/uapi/overseas-stock/v1/ranking/new-highlow` | `HHDFS76300000` | ⬜ 미설치 |  |
| 127 | 해외주식 | 시세분석 | 해외주식 매수체결강도상위 | `/uapi/overseas-stock/v1/ranking/volume-power` | `HHDFS76280000` | ⬜ 미설치 |  |
| 128 | 해외주식 | 시세분석 | 해외주식 거래회전율순위 | `/uapi/overseas-stock/v1/ranking/trade-turnover` | `HHDFS76340000` | ⬜ 미설치 |  |
| 129 | 해외주식 | 시세분석 | 해외뉴스종합(제목) | `/uapi/overseas-price/v1/quotations/news-title` | `HHPSTH60100C1` | ⬜ 미설치 |  |
| 130 | 해외주식 | 시세분석 | 당사 해외주식담보대출 가능 종목 | `/uapi/overseas-price/v1/quotations/colable-by-company` | `CTLN4050R` | ⬜ 미설치 |  |
| 131 | 해외주식 | 시세분석 | 해외주식 시가총액순위 | `/uapi/overseas-stock/v1/ranking/market-cap` | `HHDFS76350100` | ⬜ 미설치 |  |
| 132 | 해외주식 | 시세분석 | 해외속보(제목) | `/uapi/overseas-price/v1/quotations/brknews-title` | `FHKST01011801` | ⬜ 미설치 |  |
| 133 | 해외주식 | 시세분석 | 해외주식 상승율/하락율 | `/uapi/overseas-stock/v1/ranking/updown-rate` | `HHDFS76290000` | ⬜ 미설치 |  |
| 134 | 해외주식 | 시세분석 | 해외주식 권리종합 | `/uapi/overseas-price/v1/quotations/rights-by-ice` | `HHDFS78330900` | ⬜ 미설치 |  |
| 135 | 해외주식 | 시세분석 | 해외주식 거래량순위 | `/uapi/overseas-stock/v1/ranking/trade-vol` | `HHDFS76310010` | ⬜ 미설치 |  |
