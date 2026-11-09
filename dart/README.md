# DART 전자공시 조회 전용 MCP (Claude Desktop 확장)

금융감독원 DART 오픈 API(opendart.fss.or.kr)를 조회만 하는 Claude Desktop 확장입니다. 토스 조회 전용 확장([../toss](../toss))과 같은 방식으로 만들었습니다.

- 현재 버전: **v0.2.1**
- 외부 패키지 없음 (Node 18+ 내장 모듈만)
- 호출 주소 `opendart.fss.or.kr` 고정, GET만 사용. DART 오픈 API에는 쓰기 기능이 없음
- 키: 확장 설정의 API 키 → 없으면 맥 키체인(서비스 `dart-api`, 계정 `opendart`). 오류 메시지에서 키를 가림
- 고유번호 목록 캐시: `~/.dart-mcp/corpcode.json` (7일마다 새로 받음, 권한 600)
- 하루 호출 한도: 2만 건 (DART 기준, 넘으면 오류 020)

## 설치

1. 키를 키체인에 넣기 (마지막 `-w` 뒤를 비워 두면 입력 창이 떠서 키가 터미널 기록에 남지 않음)
   ```
   security add-generic-password -s dart-api -a opendart -w
   ```
   또는 Claude Desktop 확장 설정에 키를 넣어도 됨. 이때는 **확장을 껐다 켜야** 반영됨(키는 서버가 시작될 때만 전달됨)
2. 확장 파일 만들기: `cd dart && ./pack.sh`
3. `dart-readonly.mcpb`를 Claude Desktop 설정 > 확장 프로그램에 끌어다 놓기
4. 설치·재설치 때 Desktop이 모든 로컬 확장(토스·메리츠·ECOS 포함)을 다시 켬 → 07:25·20:20 예약 작업 시각 근처는 피하기


## 다른 에이전트에서 쓰기 (범용 MCP)

Claude Desktop이 아니어도 MCP를 지원하는 에이전트라면 아래처럼 등록합니다. 경로는 이 저장소를 받은 위치로 바꾸세요.

```json
{
  "mcpServers": {
    "dart": {
      "command": "node",
      "args": ["/path/to/finance-api-hub/dart/server/index.js"],
      "env": { "DART_API_KEY": "..." }
    }
  }
}
```

맥에서 키를 키체인에 넣었다면 `env`는 비워도 됩니다. 맥이 아니면 환경변수가 필요합니다.

## 도구 (8개)

| 도구 | 쓰는 DART API | 용도 |
|---|---|---|
| dart_find_corp | corpCode.xml | 회사명·종목코드 → 고유번호(corp_code) |
| dart_company | company.json | 기업 개황 |
| dart_disclosures | list.json | 공시 목록 (기간·유형·상세유형·제목 글자 필터), DART 원문 주소 |
| dart_financials | fnlttSinglAcnt / fnlttSinglAcntAll / fnlttMultiAcnt | 재무제표 주요계정 / 전체 / 여러 회사 주요계정 |
| dart_indicators | fnlttSinglIndx / fnlttCmpnyIndx | 주요 재무지표 (수익성·안정성·성장성·활동성) |
| dart_dividends | alotMatter.json | 배당에 관한 사항 |
| dart_report | 정기보고서 주요정보 16 · 지분공시 2 · 주요사항보고서 30 | 허용 목록 48개 (아래 표에서 `dart_report`로 표시) |
| dart_document | document.xml | 공시 원문 텍스트 (나눠 읽기, 단어 찾기) |

- 회사 지정: 종목코드 6자리, 고유번호 8자리, 정확한 회사명 중 아무거나. `dart_financials`(주요계정)와 `dart_indicators`는 쉼표로 여러 회사 가능
- 보고서 구분: `annual`(사업보고서 11011) · `half`(반기 11012) · `q1`(1분기 11013) · `q3`(3분기 11014)
- 재무지표 분류(idx_cl_code): 수익성 M210000 · 안정성 M220000 · 성장성 M230000 · 활동성 M240000

## DART 오픈 API 전체 목록 (공식 85개)

2026-11-09 공식 개발가이드(https://opendart.fss.or.kr/guide/main.do)의 DS001~DS006 목록과 각 상세 페이지(요청 주소·필수 인자)를 읽어 정리했습니다. 모든 API의 필수 인자에는 `crtfc_key`(인증키)가 들어가며 표에서는 생략했습니다. **85개 중 58개 사용, 27개 미사용(—)**. 이 목록과 요청 방식은 `test/offline.test.js`에 고정되어 있어, 공식 목록에 없는 API를 넣으면 시험이 실패합니다.

### DS001 공시정보

| apiId | API | 요청 주소 | 필수 인자 | 이 확장 |
|---|---|---|---|---|
| 2019001 | 공시검색 | `list.json` | 없음 (corp_code 없이 쓰면 기간 최대 3개월) | dart_disclosures |
| 2019002 | 기업개황 | `company.json` | corp_code | dart_company (모든 도구가 회사 지정에 씀) |
| 2019003 | 공시서류원본파일 | `document.xml` | rcept_no | dart_document |
| 2019018 | 고유번호 | `corpCode.xml` | 없음 (zip 파일로 내려옴) | dart_find_corp (모든 도구가 회사 지정에 씀) |

### DS002 정기보고서 주요정보 (필수: corp_code·bsns_year·reprt_code)

| apiId | API | 요청 주소 | 이 확장 |
|---|---|---|---|
| 2020002 | 주식의 총수 현황 | `stockTotqySttus.json` | dart_report (`stockTotqySttus`) |
| 2019006 | 자기주식 취득 및 처분 현황 | `tesstkAcqsDspsSttus.json` | dart_report (`tesstkAcqsDspsSttus`) |
| 2019005 | 배당에 관한 사항 | `alotMatter.json` | dart_dividends |
| 2019004 | 증자(감자) 현황 | `irdsSttus.json` | dart_report (`irdsSttus`) |
| 2020003 | 채무증권 발행실적 | `detScritsIsuAcmslt.json` | dart_report (`detScritsIsuAcmslt`) |
| 2020004 | 기업어음증권 미상환 잔액 | `entrprsBilScritsNrdmpBlce.json` | dart_report (`entrprsBilScritsNrdmpBlce`) |
| 2020005 | 단기사채 미상환 잔액 | `srtpdPsndbtNrdmpBlce.json` | dart_report (`srtpdPsndbtNrdmpBlce`) |
| 2020006 | 회사채 미상환 잔액 | `cprndNrdmpBlce.json` | dart_report (`cprndNrdmpBlce`) |
| 2020007 | 신종자본증권 미상환 잔액 | `newCaplScritsNrdmpBlce.json` | dart_report (`newCaplScritsNrdmpBlce`) |
| 2020008 | 조건부 자본증권 미상환 잔액 | `cndlCaplScritsNrdmpBlce.json` | dart_report (`cndlCaplScritsNrdmpBlce`) |
| 2020016 | 공모자금의 사용내역 | `pssrpCptalUseDtls.json` | — |
| 2020017 | 사모자금의 사용내역 | `prvsrpCptalUseDtls.json` | — |
| 2020009 | 회계감사인의 명칭 및 감사의견 | `accnutAdtorNmNdAdtOpinion.json` | dart_report (`accnutAdtorNmNdAdtOpinion`) |
| 2020010 | 감사용역체결현황 | `adtServcCnclsSttus.json` | — |
| 2020011 | 회계감사인과의 비감사용역 계약체결 현황 | `accnutAdtorNonAdtServcCnclsSttus.json` | — |
| 2020012 | 독립(사외)이사 및 그 변동현황 | `outcmpnyDrctrNdChangeSttus.json` | — |
| 2019007 | 최대주주 현황 | `hyslrSttus.json` | dart_report (`hyslrSttus`) |
| 2019008 | 최대주주 변동현황 | `hyslrChgSttus.json` | dart_report (`hyslrChgSttus`) |
| 2019009 | 소액주주 현황 | `mrhlSttus.json` | dart_report (`mrhlSttus`) |
| 2019010 | 임원 현황 | `exctvSttus.json` | dart_report (`exctvSttus`) |
| 2019011 | 직원 현황 | `empSttus.json` | dart_report (`empSttus`) |
| 2020013 | 미등기임원 보수현황 | `unrstExctvMendngSttus.json` | — |
| 2020014 | 이사·감사 전체의 보수현황(주주총회 승인금액) | `drctrAdtAllMendngSttusGmtsckConfmAmount.json` | — |
| 2019013 | 이사·감사 전체의 보수현황(보수지급금액 - 전체) | `hmvAuditAllSttus.json` | — |
| 2020015 | 이사·감사 전체의 보수현황(보수지급금액 - 유형별) | `drctrAdtAllMendngSttusMendngPymntamtTyCl.json` | — |
| 2019012 | 이사·감사의 개인별 보수현황(5억원 이상, 2026년 4월까지) | `hmvAuditIndvdlBySttus.json` | — |
| 2026001 | 이사·감사의 개인별 보수현황 Ver 2.0 (2026년 5월부터) | `hmvAuditIndvdlBySttusV2.json` | — |
| 2019014 | 개인별 보수지급 금액(5억 이상 상위 5인, 2026년 4월까지) | `indvdlByPay.json` | — |
| 2026002 | 개인별 보수지급 금액 Ver 2.0 (2026년 5월부터) | `indvdlByPayV2.json` | — |
| 2019015 | 타법인 출자현황 | `otrCprInvstmntSttus.json` | dart_report (`otrCprInvstmntSttus`) |

### DS003 정기보고서 재무정보

| apiId | API | 요청 주소 | 필수 인자 | 이 확장 |
|---|---|---|---|---|
| 2019016 | 단일회사 주요계정 | `fnlttSinglAcnt.json` | corp_code·bsns_year·reprt_code | dart_financials (scope=major) |
| 2019017 | 다중회사 주요계정 | `fnlttMultiAcnt.json` | corp_code(쉼표 여러 개)·bsns_year·reprt_code | dart_financials (여러 회사) |
| 2019019 | 재무제표 원본파일(XBRL) | `fnlttXbrl.xml` | rcept_no·reprt_code | — |
| 2019020 | 단일회사 전체 재무제표 | `fnlttSinglAcntAll.json` | corp_code·bsns_year·reprt_code·fs_div | dart_financials (scope=all) |
| 2020001 | XBRL 택사노미 재무제표 양식 | `xbrlTaxonomy.json` | sj_div | — |
| 2022001 | 단일회사 주요 재무지표 (2023년 3분기부터) | `fnlttSinglIndx.json` | corp_code·bsns_year·reprt_code·idx_cl_code | dart_indicators |
| 2022002 | 다중회사 주요 재무지표 (2023년 3분기부터) | `fnlttCmpnyIndx.json` | corp_code(쉼표 여러 개)·bsns_year·reprt_code·idx_cl_code | dart_indicators (여러 회사) |

### DS004 지분공시 종합정보 (필수: corp_code)

| apiId | API | 요청 주소 | 이 확장 |
|---|---|---|---|
| 2019021 | 대량보유 상황보고 | `majorstock.json` | dart_report (`majorstock`) |
| 2019022 | 임원·주요주주 소유보고 | `elestock.json` | dart_report (`elestock`) |

### DS005 주요사항보고서 주요정보 (필수: corp_code·bgn_de·end_de)

| apiId | API | 요청 주소 | 이 확장 |
|---|---|---|---|
| 2020018 | 자산양수도(기타), 풋백옵션 | `astInhtrfEtcPtbkOpt.json` | — |
| 2020019 | 부도발생 | `dfOcr.json` | dart_report (`dfOcr`) |
| 2020020 | 영업정지 | `bsnSp.json` | dart_report (`bsnSp`) |
| 2020021 | 회생절차 개시신청 | `ctrcvsBgrq.json` | dart_report (`ctrcvsBgrq`) |
| 2020022 | 해산사유 발생 | `dsRsOcr.json` | dart_report (`dsRsOcr`) |
| 2020023 | 유상증자 결정 | `piicDecsn.json` | dart_report (`piicDecsn`) |
| 2020024 | 무상증자 결정 | `fricDecsn.json` | dart_report (`fricDecsn`) |
| 2020025 | 유무상증자 결정 | `pifricDecsn.json` | dart_report (`pifricDecsn`) |
| 2020026 | 감자 결정 | `crDecsn.json` | dart_report (`crDecsn`) |
| 2020027 | 채권은행 등의 관리절차 개시 | `bnkMngtPcbg.json` | dart_report (`bnkMngtPcbg`) |
| 2020028 | 소송 등의 제기 | `lwstLg.json` | dart_report (`lwstLg`) |
| 2020029 | 해외 증권시장 주권등 상장 결정 | `ovLstDecsn.json` | — |
| 2020030 | 해외 증권시장 주권등 상장폐지 결정 | `ovDlstDecsn.json` | — |
| 2020031 | 해외 증권시장 주권등 상장 | `ovLst.json` | — |
| 2020032 | 해외 증권시장 주권등 상장폐지 | `ovDlst.json` | — |
| 2020033 | 전환사채권 발행결정 | `cvbdIsDecsn.json` | dart_report (`cvbdIsDecsn`) |
| 2020034 | 신주인수권부사채권 발행결정 | `bdwtIsDecsn.json` | dart_report (`bdwtIsDecsn`) |
| 2020035 | 교환사채권 발행결정 | `exbdIsDecsn.json` | dart_report (`exbdIsDecsn`) |
| 2020036 | 채권은행 등의 관리절차 중단 | `bnkMngtPcsp.json` | dart_report (`bnkMngtPcsp`) |
| 2020037 | 상각형 조건부자본증권 발행결정 | `wdCocobdIsDecsn.json` | — |
| 2020038 | 자기주식 취득 결정 | `tsstkAqDecsn.json` | dart_report (`tsstkAqDecsn`) |
| 2020039 | 자기주식 처분 결정 | `tsstkDpDecsn.json` | dart_report (`tsstkDpDecsn`) |
| 2020040 | 자기주식취득 신탁계약 체결 결정 | `tsstkAqTrctrCnsDecsn.json` | dart_report (`tsstkAqTrctrCnsDecsn`) |
| 2020041 | 자기주식취득 신탁계약 해지 결정 | `tsstkAqTrctrCcDecsn.json` | dart_report (`tsstkAqTrctrCcDecsn`) |
| 2020042 | 영업양수 결정 | `bsnInhDecsn.json` | dart_report (`bsnInhDecsn`) |
| 2020043 | 영업양도 결정 | `bsnTrfDecsn.json` | dart_report (`bsnTrfDecsn`) |
| 2020044 | 유형자산 양수 결정 | `tgastInhDecsn.json` | dart_report (`tgastInhDecsn`) |
| 2020045 | 유형자산 양도 결정 | `tgastTrfDecsn.json` | dart_report (`tgastTrfDecsn`) |
| 2020046 | 타법인 주식 및 출자증권 양수결정 | `otcprStkInvscrInhDecsn.json` | dart_report (`otcprStkInvscrInhDecsn`) |
| 2020047 | 타법인 주식 및 출자증권 양도결정 | `otcprStkInvscrTrfDecsn.json` | dart_report (`otcprStkInvscrTrfDecsn`) |
| 2020048 | 주권 관련 사채권 양수 결정 | `stkrtbdInhDecsn.json` | dart_report (`stkrtbdInhDecsn`) |
| 2020049 | 주권 관련 사채권 양도 결정 | `stkrtbdTrfDecsn.json` | dart_report (`stkrtbdTrfDecsn`) |
| 2020050 | 회사합병 결정 | `cmpMgDecsn.json` | dart_report (`cmpMgDecsn`) |
| 2020051 | 회사분할 결정 | `cmpDvDecsn.json` | dart_report (`cmpDvDecsn`) |
| 2020052 | 회사분할합병 결정 | `cmpDvmgDecsn.json` | dart_report (`cmpDvmgDecsn`) |
| 2020053 | 주식교환·이전 결정 | `stkExtrDecsn.json` | dart_report (`stkExtrDecsn`) |

### DS006 증권신고서 주요정보 (필수: corp_code·bgn_de·end_de)

| apiId | API | 요청 주소 | 이 확장 |
|---|---|---|---|
| 2020054 | 지분증권 | `estkRs.json` | — |
| 2020055 | 채무증권 | `bdRs.json` | — |
| 2020056 | 증권예탁증권 | `stkdpRs.json` | — |
| 2020057 | 합병 | `mgRs.json` | — |
| 2020058 | 주식의포괄적교환·이전 | `extrRs.json` | — |
| 2020059 | 분할 | `dvRs.json` | — |

### 쓰지 않는 27개와 이유

| 묶음 | 개수 | 이유 |
|---|---|---|
| 이사·감사·임원 보수 (V2 포함) | 8 | 학습·브리핑 목적과 거리가 멂 |
| 감사용역·비감사용역 | 2 | 〃 |
| 사외이사 변동 | 1 | 〃 |
| 공모·사모자금 사용내역 | 2 | 필요하면 공시 원문(dart_document)으로 확인 |
| 해외 증권시장 상장·상장폐지 | 4 | 해당 종목이 드묾 |
| 풋백옵션, 상각형 조건부자본증권 | 2 | 〃 |
| XBRL 원본·택사노미 | 2 | 원본 파일·계정체계용. 주요계정·전체 재무제표 API로 충분 |
| 증권신고서 6종 | 6 | IPO·증자 상세. 필요하면 공시 원문으로 확인 |

## 실제 호출로 확인한 것 (2026-11-09)

- 정상: 고유번호, 기업개황, 공시 목록, 공시 원문, 여러 회사 주요계정(삼성전자·SK하이닉스·LG전자, KB금융·삼성생명), 여러 회사 재무지표, 배당
- 맥쿼리인프라(088980): 기업개황·공시 목록·원문은 나오지만 재무제표·배당 API는 빈 값. 정기보고서도 이 고유번호의 공시 목록에 잡히지 않음. 분배금 결의 공시는 오픈 API에 없음(거래소 KIND 공시로 보임)
- 재무지표: 일부 지표는 값이 비어 오고, 칸이 넘친 값은 `#########`으로 옴(DART 원값). 금융주(은행)는 매출액이 정의되지 않아 순이익률·회전율 등이 대부분 비어 있음
- 반기 ROE 등은 연환산하지 않은 값으로 보임(확인 필요)

## 시험

```
node test/offline.test.js
```
네트워크 없이 확인: zip 해석, 고유번호 해석, EUC-KR, 회사 지정, 원문 변환, MCP 프로토콜(8개 도구), 키 없음 안내, 허용 목록 차단, 공식 목록 대조(허용 48개 + 재무 API), 여러 회사 지정

## 변경 이력

- v0.2.1 (2026-11-09): Desktop이 래퍼로 실행할 때 서버가 요청을 듣지 않던 문제 수정(`require.main` 조건 제거, 시험에서만 `DART_MCP_NO_STDIO=1`)
- v0.2.0 (2026-11-09): 공식 가이드 대조 후 23개 추가 — 재무지표(단일·다중), 다중회사 주요계정, 주요사항보고서·정기보고서 주요정보 20개
- v0.1.0 (2026-11-09): 첫 판 (35개 API)
