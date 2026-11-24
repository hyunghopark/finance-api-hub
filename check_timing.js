#!/usr/bin/env node
/**
 * 6대 MCP 실시간 데이터 반영 시점(Timing & Latency) 점검 도구
 * 
 * 실행:
 *   node check_timing.js
 * 
 * 각 MCP의 최신 데이터 날짜(date), 갱신시각(updatedAt), 당일 데이터 반영 여부를 
 * 즉시 확인하여 DATA_TIMING.md 기록을 돕습니다.
 */
'use strict';

const { spawn } = require('child_process');
const path = require('path');

const mcpConfig = require('/Users/nsone/.gemini/config/mcp_config.json').mcpServers;

function callMcp(scriptPath, env, method, params, timeoutMs = 12000) {
  return new Promise((resolve) => {
    const p = spawn('node', [scriptPath], { env: { ...process.env, ...env } });
    let stdout = '';
    let resolved = false;

    p.stdout.on('data', d => {
      stdout += d.toString();
      const lines = stdout.split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.id === 1) {
            resolved = true;
            p.kill();
            resolve(msg.result);
            return;
          }
        } catch (_) {}
      }
    });

    p.stdin.write(JSON.stringify({
      jsonrpc: '2.0',
      id: 0,
      method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'timing-checker', version: '1.0' } }
    }) + '\n');

    setTimeout(() => {
      p.stdin.write(JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: method, arguments: params }
      }) + '\n');
    }, 300);

    setTimeout(() => {
      if (!resolved) {
        p.kill();
        resolve(null);
      }
    }, timeoutMs);
  });
}

function getTodayStr() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

async function run() {
  const now = new Date();
  const nowKst = now.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  const todayYmd = getTodayStr();
  const todayDash = `${todayYmd.slice(0, 4)}-${todayYmd.slice(4, 6)}-${todayYmd.slice(6, 8)}`;

  console.log('='.repeat(80));
  console.log(`⏱️  6대 MCP 실시간 데이터 반영 시점 점검 (${nowKst})`);
  console.log(`📌 기준 일자: ${todayDash} (${todayYmd})`);
  console.log('='.repeat(80));

  const results = [];

  // 1. Toss - 코스피 수급
  try {
    const res = await callMcp(mcpConfig.toss.args[0], mcpConfig.toss.env, 'toss_market_investor_trading', { market: 'KOSPI' });
    const text = res?.content?.[0]?.text;
    if (text) {
      const data = JSON.parse(text);
      const row = data.요약?.[0] || {};
      const isToday = row.date === todayDash;
      results.push({
        제공처: '토스 (TOSS)',
        지표: '코스피 시장 수급',
        수신일자: row.date || 'N/A',
        갱신시각: row.updatedAt ? row.updatedAt.replace('T', ' ').slice(0, 19) : 'N/A',
        당일여부: isToday ? '🟢 당일 (NXT 반영 중)' : '🟡 전일치',
        비고: `외인 ${row.순매수_억원?.외국인 || 0}억 / 기관 ${row.순매수_억원?.기관 || 0}억`
      });
    } else {
      results.push({ 제공처: '토스', 지표: '코스피 시장 수급', 수신일자: '실패/타임아웃', 갱신시각: '-', 당일여부: '🔴', 비고: '' });
    }
  } catch (e) {
    results.push({ 제공처: '토스', 지표: '코스피 시장 수급', 수신일자: '에러', 갱신시각: '-', 당일여부: '🔴', 비고: e.message });
  }

  // 2. 한국은행 ECOS - 시장금리
  try {
    const res = await callMcp(mcpConfig.ecos.args[0], mcpConfig.ecos.env, 'ecos_market_rates', {});
    const text = res?.content?.[0]?.text;
    if (text) {
      const data = JSON.parse(text);
      const rows = data.rows || [];
      const lastRow = rows[rows.length - 1] || {};
      const isToday = lastRow.date === todayYmd;
      results.push({
        제공처: '한국은행 (ECOS)',
        지표: '시장금리 (817Y002)',
        수신일자: lastRow.date || 'N/A',
        갱신시각: isToday ? '확정 반영됨' : '전일 마감값',
        당일여부: isToday ? '🟢 당일 확정' : '🟡 전일치',
        비고: `국고10Y ${lastRow['국고채(10년)'] || '-'}% / 국고3Y ${lastRow['국고채(3년)'] || '-'}%`
      });
    } else {
      results.push({ 제공처: '한국은행', 지표: '시장금리', 수신일자: '실패/타임아웃', 갱신시각: '-', 당일여부: '🔴', 비고: '' });
    }
  } catch (e) {
    results.push({ 제공처: '한국은행', 지표: '시장금리', 수신일자: '에러', 갱신시각: '-', 당일여부: '🔴', 비고: e.message });
  }

  // 3. 한국거래소 KRX - 코스피 일별 매매
  try {
    const res = await callMcp(mcpConfig.krx.args[0], mcpConfig.krx.env, 'krx_stock', { type: 'kospi' });
    const text = res?.content?.[0]?.text;
    if (text) {
      const data = JSON.parse(text);
      const isToday = data.date === todayYmd;
      results.push({
        제공처: '한국거래소 (KRX)',
        지표: '코스피 일별 매매 (정규장)',
        수신일자: data.date || 'N/A',
        갱신시각: isToday ? '당일 확정치' : '아직 미갱신 (전일치)',
        당일여부: isToday ? '🟢 당일 확정' : '🟡 전일치 (익일 오전 갱신)',
        비고: `상승 ${data.market_summary?.상승 || 0} / 하락 ${data.market_summary?.하락 || 0}`
      });
    } else {
      results.push({ 제공처: '한국거래소', 지표: '코스피 일별 매매', 수신일자: '실패/타임아웃', 갱신시각: '-', 당일여부: '🔴', 비고: '' });
    }
  } catch (e) {
    results.push({ 제공처: '한국거래소', 지표: '코스피 일별 매매', 수신일자: '에러', 갱신시각: '-', 당일여부: '🔴', 비고: e.message });
  }

  // 4. FRED - 미국 금리
  try {
    const res = await callMcp(mcpConfig.fred.args[0], mcpConfig.fred.env, 'fred_bundle', { bundle: 'rates' }, 12000);
    const text = res?.content?.[0]?.text;
    if (text) {
      const data = JSON.parse(text);
      const dgs10 = (data.rows || []).find(r => r.id === 'DGS10');
      results.push({
        제공처: '미 연준 (FRED)',
        지표: '미국채 10년 (DGS10)',
        수신일자: dgs10?.date || 'N/A',
        갱신시각: '미국 익일 15:00 CST',
        당일여부: '🟡 미국 관측일 기준',
        비고: `DGS10 ${dgs10?.value || '-'}% (직전 대비 ${dgs10?.change || '-'})`
      });
    } else {
      results.push({ 제공처: '미 연준', 지표: '미국채 10년', 수신일자: '호출 지연', 갱신시각: '-', 당일여부: '⚪', 비고: '' });
    }
  } catch (e) {
    results.push({ 제공처: '미 연준', 지표: '미국채 10년', 수신일자: '에러', 갱신시각: '-', 당일여부: '🔴', 비고: e.message });
  }

  // 5. DART - 삼성전자 최신 공시
  try {
    const res = await callMcp(mcpConfig.dart.args[0], mcpConfig.dart.env, 'dart_disclosures', { corp: '005930' }, 10000);
    const text = res?.content?.[0]?.text;
    if (text) {
      const data = JSON.parse(text);
      const last = data.results?.[0] || data.list?.[0];
      const dt = last?.rcept_dt || last?.date || 'N/A';
      results.push({
        제공처: '금융감독원 (DART)',
        지표: '기업 공시 (삼성전자)',
        수신일자: dt,
        갱신시각: '공시 접수 즉시',
        당일여부: dt === todayYmd ? '🟢 당일 신규 공시 있음' : '⚪ 최근 접수',
        비고: (last?.report_nm || '').slice(0, 30)
      });
    } else {
      results.push({ 제공처: '금융감독원', 지표: '기업 공시', 수신일자: '호출 지연', 갱신시각: '-', 당일여부: '⚪', 비고: '' });
    }
  } catch (e) {
    results.push({ 제공처: '금융감독원', 지표: '기업 공시', 수신일자: '에러', 갱신시각: '-', 당일여부: '🔴', 비고: e.message });
  }

  // 6. 한국투자증권 KIS - 삼성전자 KRX 일봉 당일 행 vs 15:30 분봉, 코스피 시장 수급
  // 설정 파일에 kis가 없으면 이 저장소의 서버 파일과 kis/.env(커밋 안 됨) 또는 현재 환경변수를 씀
  const kisScript = mcpConfig.kis?.args?.[0] || path.join(__dirname, 'kis', 'server', 'index.js');
  const kisEnv = { ...(mcpConfig.kis?.env || {}) };
  if (!kisEnv.KIS_APP_KEY) {
    try {
      for (const line of require('fs').readFileSync(path.join(__dirname, 'kis', '.env'), 'utf8').split('\n')) {
        const m = /^\s*(KIS_APP_KEY|KIS_APP_SECRET)\s*=\s*(.*)$/.exec(line);
        if (m) kisEnv[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
      }
    } catch (_) { /* 파일 없음 → 환경변수에 있으면 그것을 씀 */ }
  }
  const kisCall = async (tool, args) => {
    const res = await callMcp(kisScript, kisEnv, tool, args);
    const text = res?.content?.[0]?.text;
    if (!text) throw new Error('실패/타임아웃');
    if (res.isError) throw new Error(text.slice(0, 60));
    return JSON.parse(text);
  };
  try {
    const daily = await kisCall('kis_stock_daily_chart', { symbol: '005930', market: 'J', from: todayDash, to: todayDash });
    const row = (daily.output2 || [])[0] || {};
    const minute = await kisCall('kis_stock_minute_chart', { symbol: '005930', market: 'J', time: '15:30' });
    const bar = (minute.output2 || []).find(r => r.stck_cntg_hour === '153000');
    const isToday = row.stck_bsop_date === todayYmd;
    const same = isToday && bar && row.stck_clpr === bar.stck_prpr;
    results.push({
      제공처: '한국투자증권 (KIS)',
      지표: '삼성전자 일봉 (J=KRX)',
      수신일자: row.stck_bsop_date || 'N/A',
      갱신시각: !isToday ? '당일 행 없음' : !bar ? '15:30 분봉 없음 (장중·휴장)' : same ? '15:30 분봉과 같음' : '15:30 분봉과 다름',
      당일여부: !isToday ? '🟡 전일치' : same ? '🟢 당일 (정규장 종가)' : '🟡 당일 (정규장 종가 아님)',
      비고: `일봉 종가 ${row.stck_clpr || '-'} / 15:30 봉 ${bar?.stck_prpr || '-'}`
    });
  } catch (e) {
    results.push({ 제공처: '한국투자증권', 지표: '삼성전자 일봉', 수신일자: '에러', 갱신시각: '-', 당일여부: '🔴', 비고: e.message });
  }
  try {
    const inv = await kisCall('kis_market_investor_daily', { market: 'KOSPI', count: 1 });
    const row = (inv.output || [])[0] || {};
    const eok = (v) => (v === undefined || v === '' ? '-' : Math.round(Number(v) / 100)); // 백만원 → 억원
    const isToday = row.stck_bsop_date === todayYmd;
    results.push({
      제공처: '한국투자증권 (KIS)',
      지표: '코스피 시장 수급',
      수신일자: row.stck_bsop_date || 'N/A',
      갱신시각: '확정 시각 미확인',
      당일여부: isToday ? '🟢 당일' : '🟡 전일치',
      비고: `외인 ${eok(row.frgn_ntby_tr_pbmn)}억 / 기관 ${eok(row.orgn_ntby_tr_pbmn)}억`
    });
  } catch (e) {
    results.push({ 제공처: '한국투자증권', 지표: '코스피 시장 수급', 수신일자: '에러', 갱신시각: '-', 당일여부: '🔴', 비고: e.message });
  }

  console.table(results);
  console.log('='.repeat(80));
  console.log('💡 Tip: 위 결과를 토대로 finance-api-hub/DATA_TIMING.md 문서를 업데이트하세요.');
}

run();
