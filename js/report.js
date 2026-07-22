/**
 * report.js — 공부 리포트 v2
 *
 * 개선사항:
 * 1. 단일 추천 문구 → 다양한 인사이트 카드 (조건별 독립 생성)
 * 2. 설정 타이머 사용자도 시간대별 공부량 차트가 보임 (focusScore 없어도)
 * 3. 졸음 많은 시간대 + 낮잠/휴식 추천
 * 4. 연속 공부일 스트릭
 * 5. 주중/주말 비교
 * 6. 긴/짧은 세션 효율 비교
 * 7. 임계값 완화 (더 자주 인사이트 표시)
 */

class ReportManager {
  constructor() { this.periodDays = 30; }

  // ── 날짜 유틸 ─────────────────────────────────────────────
  static dateStrOffset(offsetDays) {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    return d.toLocaleDateString('sv-SE');
  }

  /** 세션이 걸친 각 시간(0~23)별 겹치는 분 */
  static _hourOverlaps(startMs, endMs) {
    const segs = [];
    let cursor = startMs, guard = 0;
    while (cursor < endMs && guard < 72) {
      const d     = new Date(cursor);
      const hour  = d.getHours();
      const next  = new Date(d.getFullYear(), d.getMonth(), d.getDate(), hour + 1).getTime();
      const segEnd= Math.min(endMs, next);
      const min   = (segEnd - cursor) / 60000;
      if (min > 0) segs.push({ hour, minutes: min });
      cursor = segEnd; guard++;
    }
    return segs;
  }

  getSessionsInRange(days) {
    const cutoff = (days === Infinity || !days) ? 0 : Date.now() - days * 86400000;
    return Planner.sessions.filter(s => s.endTime && s.startTime >= cutoff);
  }

  static withScore(sessions) {
    return sessions.filter(s => typeof s.focusScore === 'number');
  }

  // ── 시간대별 통계 ─────────────────────────────────────────
  computeHourlyStats(sessions) {
    const b = Array.from({length: 24}, () => ({totalMin:0, weighted:0, drowsy:0, hasScore:false}));
    sessions.forEach(s => {
      const hasScore = typeof s.focusScore === 'number';
      const totalMin = (s.endTime - s.startTime) / 60000;
      ReportManager._hourOverlaps(s.startTime, s.endTime).forEach(({hour, minutes}) => {
        b[hour].totalMin += minutes;
        if (hasScore) {
          b[hour].weighted += s.focusScore * minutes;
          b[hour].hasScore  = true;
        }
        // 졸음도 비례 배분
        if (s.drowsyCount && totalMin > 0) {
          b[hour].drowsy += s.drowsyCount * (minutes / totalMin);
        }
      });
    });
    return b.map((bkt, hour) => ({
      hour,
      totalMin:  bkt.totalMin,
      avgScore:  bkt.hasScore && bkt.totalMin > 0 ? bkt.weighted / bkt.totalMin : null,
      drowsyRate: bkt.totalMin > 5 ? bkt.drowsy / (bkt.totalMin / 60) : null // 시간당 졸음 횟수
    }));
  }

  // ── 과목별 통계 ───────────────────────────────────────────
  computeSubjectStats(sessions) {
    const map = new Map();
    sessions.forEach(s => {
      const key = s.subjectName || '(이름없음)';
      if (!map.has(key)) map.set(key, { subjectName:key, color:s.color, totalMin:0, weighted:0, hasScore:false, count:0 });
      const e   = map.get(key);
      const min = (s.endTime - s.startTime) / 60000;
      e.totalMin += min; e.count++;
      if (typeof s.focusScore === 'number') { e.weighted += s.focusScore * min; e.hasScore = true; }
    });
    return [...map.values()].map(e => ({
      ...e,
      avgScore: e.hasScore && e.totalMin > 0 ? e.weighted / e.totalMin : null
    })).sort((a,b) => b.totalMin - a.totalMin);
  }

  // ── 오늘 vs 어제 ─────────────────────────────────────────
  compareTodayYesterday() {
    const today     = PlannerManager.today();
    const yesterday = ReportManager.dateStrOffset(-1);
    const avgOf = dateStr => {
      const list = ReportManager.withScore(
        Planner.sessions.filter(s => s.date === dateStr && s.endTime)
      );
      if (!list.length) return null;
      const totalMin = list.reduce((s,x) => s + (x.endTime - x.startTime)/60000, 0);
      const weighted = list.reduce((s,x) => s + x.focusScore * (x.endTime - x.startTime)/60000, 0);
      return totalMin > 0 ? weighted / totalMin : null;
    };
    return {
      todayAvg:     avgOf(today),
      yesterdayAvg: avgOf(yesterday),
      todayMin:     Planner.getTotalMs(today)     / 60000,
      yesterdayMin: Planner.getTotalMs(yesterday) / 60000,
    };
  }

  // ── 인사이트 카드 생성 ────────────────────────────────────
  buildInsights(hourlyStats, subjectStats, sessions) {
    const cards = [];

    // 1. 연속 공부일 스트릭
    const streak = this._streakInsight();
    if (streak) cards.push(streak);

    // 2. 졸음 많은 시간대 + 맞춤 조언
    const drowsy = this._drowsyTimeInsight(hourlyStats);
    if (drowsy) cards.push(drowsy);

    // 3. 집중 황금시간
    const peak = this._peakHourInsight(hourlyStats);
    if (peak) cards.push(peak);

    // 4. 집중이 낮은 과목 → 황금시간에 배치 추천
    const subReco = this._subjectRecoInsight(hourlyStats, subjectStats);
    if (subReco) cards.push(subReco);

    // 5. 주중 vs 주말 비교
    const weekday = this._weekdayInsight(sessions);
    if (weekday) cards.push(weekday);

    // 6. 짧은 vs 긴 세션 효율
    const sessionLen = this._sessionLengthInsight(sessions);
    if (sessionLen) cards.push(sessionLen);

    // 7. 데이터 부족 안내
    if (cards.length === 0) {
      return `<div class="insight-empty">
        📊 AI 타이머로 며칠 더 공부하면 다양한 인사이트가 나타나요!<br>
        <small style="color:var(--text-muted)">집중도 분석은 AI 타이머에서만 기록돼요</small>
      </div>`;
    }

    return cards.map(c => `
      <div class="insight-card">
        <div class="insight-icon">${c.icon}</div>
        <div class="insight-body">
          <div class="insight-title">${c.title}</div>
          <div class="insight-desc">${c.desc}</div>
        </div>
      </div>`).join('');
  }

  // ── 개별 인사이트 로직 ────────────────────────────────────

  /** 연속 공부일 */
  _streakInsight() {
    const dates = new Set(Planner.sessions.filter(s=>s.endTime).map(s => s.date));
    let streak = 0;
    const d = new Date();
    for (let i = 0; i < 60; i++) {
      const ds = d.toLocaleDateString('sv-SE');
      if (!dates.has(ds)) break;
      streak++;
      d.setDate(d.getDate() - 1);
    }
    if (streak < 2) return null;
    const emojis = ['', '', '🌱', '🔥', '🔥', '⚡', '⚡', '🏆', '🏆', '🏅'];
    const icon   = emojis[Math.min(streak, emojis.length-1)] || '🏅';
    let desc = `${streak}일 연속 공부 중이에요!`;
    if      (streak >= 7)  desc += ' 이 의지라면 무엇이든 할 수 있어요. 멈추지 마세요!';
    else if (streak >= 5)  desc += ' 이 흐름을 계속 유지해보세요.';
    else if (streak >= 3)  desc += ' 좋은 습관이 만들어지고 있어요.';
    else                   desc += ' 좋은 시작이에요!';
    return { icon, title: `${streak}일 연속 공부 중!`, desc };
  }

  /** 졸음 많은 시간대 + 시간대별 맞춤 조언 */
  _drowsyTimeInsight(hourlyStats) {
    // 최소 15분 공부 + 졸음 있는 시간대만
    const valid = hourlyStats.filter(h => h.drowsyRate !== null && h.totalMin >= 15 && h.drowsyRate > 0.3);
    if (!valid.length) return null;
    const worst = [...valid].sort((a,b) => b.drowsyRate - a.drowsyRate)[0];
    if (worst.drowsyRate < 0.4) return null;

    const h   = worst.hour;
    const str = `${h}시~${(h+1)%24}시`;
    let advice;
    if      (h >= 13 && h <= 15) advice = '점심 식후 졸음은 자연스러워요. 15분 파워낮잠이 오후 집중력을 확 올려줄 수 있어요! 💤';
    else if (h >= 22 || h < 2)   advice = '늦은 밤은 집중력이 자연히 떨어져요. 일찍 자고 아침에 공부하는 것도 좋은 전략이에요 🌙';
    else if (h >= 6  && h <= 8)  advice = '아침 시간대는 가벼운 운동이나 스트레칭으로 몸을 깨워보세요. 효과가 좋아요! ☀️';
    else                          advice = '이 시간엔 잠깐 자리에서 일어나 스트레칭하거나 10분 산책을 해보세요 🚶';

    return {
      icon:  '😴',
      title: `${str}에 가장 자주 조셨어요`,
      desc:  advice
    };
  }

  /** 집중 황금시간 */
  _peakHourInsight(hourlyStats) {
    const valid = hourlyStats.filter(h => h.avgScore !== null && h.totalMin >= 10);
    if (valid.length < 2) return null;
    const best  = [...valid].sort((a,b) => b.avgScore - a.avgScore)[0];
    const worst = [...valid].sort((a,b) => a.avgScore - b.avgScore)[0];
    if (best.avgScore - worst.avgScore < 8) return null; // 차이가 너무 적으면 의미 없음

    const timeStr = `${best.hour}시~${(best.hour+1)%24}시`;
    const ampm    = best.hour < 12 ? '오전' : best.hour < 18 ? '오후' : '저녁';
    return {
      icon:  '⭐',
      title: `${timeStr}이 황금 집중 시간이에요`,
      desc:  `이 시간 평균 집중도 ${Math.round(best.avgScore)}점으로 ${ampm} 중 가장 높아요. 어렵거나 중요한 과목은 이 시간에 배치해보세요.`
    };
  }

  /** 집중도 낮은 과목을 황금시간에 배치 추천 */
  _subjectRecoInsight(hourlyStats, subjectStats) {
    const validH = hourlyStats.filter(h => h.avgScore !== null && h.totalMin >= 10);
    const validS = subjectStats.filter(s => s.avgScore !== null && s.totalMin >= 10);
    if (validH.length < 2 || validS.length < 2) return null;

    const bestH   = [...validH].sort((a,b) => b.avgScore - a.avgScore)[0];
    const worstS  = [...validS].sort((a,b) => a.avgScore - b.avgScore)[0];
    const bestS   = [...validS].sort((a,b) => b.avgScore - a.avgScore)[0];
    if (worstS.subjectName === bestS.subjectName) return null;

    const timeStr = `${bestH.hour}시~${(bestH.hour+1)%24}시`;
    return {
      icon:  '💡',
      title: '과목 배치 추천',
      desc:  `집중도가 비교적 낮은 <b>${worstS.subjectName}</b>(평균 ${Math.round(worstS.avgScore)}점)을 집중이 잘 되는 <b>${timeStr}</b>에 배치해보는 건 어떨까요?`
    };
  }

  /** 주중 vs 주말 비교 */
  _weekdayInsight(sessions) {
    const wday = {min:0, w:0}, wend = {min:0, w:0};
    ReportManager.withScore(sessions).forEach(s => {
      const dow = new Date(s.startTime).getDay();
      const min = (s.endTime - s.startTime) / 60000;
      const b   = (dow===0||dow===6) ? wend : wday;
      b.min += min; b.w += s.focusScore * min;
    });
    const wdAvg = wday.min >= 30 ? wday.w / wday.min : null;
    const weAvg = wend.min >= 30 ? wend.w / wend.min : null;
    if (wdAvg === null || weAvg === null) return null;
    const diff = Math.abs(wdAvg - weAvg);
    if (diff < 8) return null;

    if (wdAvg > weAvg) {
      return { icon:'📅', title:'주중에 더 집중해요',
        desc:`주중 평균 집중도(${Math.round(wdAvg)}점)가 주말(${Math.round(weAvg)}점)보다 ${Math.round(diff)}점 높아요. 중요한 공부는 주중에 배치해보세요.` };
    } else {
      return { icon:'🌅', title:'주말에 더 집중해요',
        desc:`주말 평균 집중도(${Math.round(weAvg)}점)가 주중(${Math.round(wdAvg)}점)보다 ${Math.round(diff)}점 높아요. 여유로운 주말을 적극 활용해보세요!` };
    }
  }

  /** 짧은 세션 vs 긴 세션 효율 */
  _sessionLengthInsight(sessions) {
    const scored = ReportManager.withScore(sessions);
    const short  = scored.filter(s => (s.endTime-s.startTime)/60000 < 30);
    const long   = scored.filter(s => (s.endTime-s.startTime)/60000 >= 30);
    if (short.length < 3 || long.length < 3) return null;

    const avg = arr => arr.reduce((s,x) => s+x.focusScore, 0) / arr.length;
    const sA  = avg(short), lA = avg(long);
    const diff = Math.abs(sA - lA);
    if (diff < 10) return null;

    if (sA > lA) {
      return { icon:'⚡', title:'짧게 끊어서 공부하는 게 효과적이에요',
        desc:`30분 미만 세션(평균 ${Math.round(sA)}점)이 긴 세션(${Math.round(lA)}점)보다 집중도가 높아요. 포모도로처럼 짧게 집중하고 쉬어보세요!` };
    } else {
      return { icon:'🎯', title:'길게 집중하는 스타일이에요',
        desc:`긴 세션(평균 ${Math.round(lA)}점)에서 더 잘 집중돼요. 한 번에 충분한 시간을 확보하고 공부해보세요.` };
    }
  }

  // ── 렌더링 ────────────────────────────────────────────────
  render(days) {
    if (typeof days === 'number') this.periodDays = days;

    document.querySelectorAll('.report-period-btn').forEach(btn => {
      btn.classList.toggle('active',
        Number(btn.dataset.days) === this.periodDays ||
        (btn.dataset.days === 'all' && this.periodDays === Infinity));
    });

    const sessions    = this.getSessionsInRange(this.periodDays);
    const scored      = ReportManager.withScore(sessions);
    const hourly      = this.computeHourlyStats(sessions);
    const subjects    = this.computeSubjectStats(sessions);
    const cmp         = this.compareTodayYesterday();

    this._renderCompare(cmp);
    this._renderOverview(sessions, scored);
    this._renderHourlyChart(hourly);
    this._renderSubjectList(subjects);
    this._renderInsights(hourly, subjects, sessions);
  }

  _renderCompare(cmp) {
    const el = document.getElementById('report-compare');
    if (!el) return;
    if (cmp.todayAvg === null && cmp.yesterdayAvg === null) {
      el.innerHTML = `<div class="report-compare-empty">오늘·어제 집중도 기록이 없어요. AI 타이머로 공부를 시작해보세요! ✨</div>`;
      return;
    }
    if (cmp.todayAvg === null) {
      el.innerHTML = `<div class="report-compare-empty">오늘은 아직 기록이 없어요. 어제 평균 집중도는 <b>${Math.round(cmp.yesterdayAvg)}점</b>이었어요.</div>`;
      return;
    }
    if (cmp.yesterdayAvg === null) {
      el.innerHTML = `
        <div class="cmp-row">
          <div class="cmp-today"><span class="cmp-label">오늘</span><span class="cmp-score">${Math.round(cmp.todayAvg)}점</span></div>
        </div>
        <div class="cmp-note">어제 기록이 없어요. 내일부터 변화를 확인할 수 있어요!</div>`;
      return;
    }
    const diff    = cmp.todayAvg - cmp.yesterdayAvg;
    const diffAbs = Math.abs(diff).toFixed(1);
    const up      = diff > 0.5, down = diff < -0.5;
    const badge   = up   ? `<span class="cmp-badge cmp-up">▲ ${diffAbs}점 상승</span>`
                  : down ? `<span class="cmp-badge cmp-down">▼ ${diffAbs}점 하락</span>`
                  :        `<span class="cmp-badge cmp-flat">어제와 비슷해요</span>`;
    el.innerHTML = `
      <div class="cmp-row">
        <div class="cmp-today"><span class="cmp-label">오늘</span><span class="cmp-score">${Math.round(cmp.todayAvg)}점</span></div>
        <div class="cmp-vs">vs</div>
        <div class="cmp-yesterday"><span class="cmp-label">어제</span><span class="cmp-score" style="color:var(--text-dim)">${Math.round(cmp.yesterdayAvg)}점</span></div>
      </div>
      <div class="cmp-note">${badge}</div>`;
  }

  _renderOverview(sessions, scored) {
    const el = document.getElementById('report-overview');
    if (!el) return;
    const totalMin  = sessions.reduce((s,x) => s + (x.endTime-x.startTime)/60000, 0);
    const scoredMin = scored.reduce((s,x) => s + (x.endTime-x.startTime)/60000, 0);
    const avgScore  = scored.length && scoredMin > 0
      ? scored.reduce((s,x) => s + x.focusScore*(x.endTime-x.startTime)/60000, 0) / scoredMin
      : null;
    el.innerHTML = `
      <div class="ov-item"><div class="ov-num">${PlannerManager.formatDuration(totalMin*60000)}</div><div class="ov-label">총 공부 시간</div></div>
      <div class="ov-item"><div class="ov-num">${avgScore !== null ? Math.round(avgScore)+'점' : '-'}</div><div class="ov-label">평균 집중도</div></div>
      <div class="ov-item"><div class="ov-num">${sessions.length}</div><div class="ov-label">공부 세션</div></div>`;
  }

  _renderHourlyChart(hourlyStats) {
    const el = document.getElementById('report-hourly-chart');
    if (!el) return;

    // 공부한 적 있는 시간대 (focusScore 없어도 OK)
    const withTime = hourlyStats.filter(h => h.totalMin >= 3);
    if (!withTime.length) {
      el.innerHTML = '<div class="rh-empty">아직 공부 기록이 없어요. 타이머를 켜고 공부를 시작해보세요!</div>';
      return;
    }

    const hasAnyScore = hourlyStats.some(h => h.avgScore !== null);
    const maxMin      = Math.max(...hourlyStats.map(h => h.totalMin), 1);

    // 6시~25시(=1시) 영역만 표시 (0시~5시는 숨김, 대부분 공부 안 하는 시간)
    const showHours = [...Array(24).keys()].filter(h => !(h >= 2 && h <= 5));

    let best = null, worst = null;
    if (hasAnyScore) {
      const scored = hourlyStats.filter(h => h.avgScore !== null && h.totalMin >= 5);
      if (scored.length >= 2) {
        best  = [...scored].sort((a,b) => b.avgScore - a.avgScore)[0];
        worst = [...scored].sort((a,b) => a.avgScore - b.avgScore)[0];
      }
    }

    el.innerHTML = showHours.map(h => {
      const stat     = hourlyStats[h];
      const hasTime  = stat.totalMin >= 3;
      const hasScore = stat.avgScore !== null && stat.totalMin >= 5;

      // 높이: 집중도 점수가 있으면 그걸 쓰고, 없으면 공부 시간 비율
      let heightPct = 2;
      if (hasScore)     heightPct = Math.max(5, stat.avgScore);
      else if (hasTime) heightPct = Math.max(5, (stat.totalMin / maxMin) * 70);

      let cls = 'rh-bar';
      if (hasScore && best?.hour === h)  cls += ' rh-best';
      else if (hasScore && worst?.hour === h) cls += ' rh-worst';
      else if (!hasTime) cls += ' rh-nodata';

      const tip = hasScore
        ? `${h}시 · 집중도 ${Math.round(stat.avgScore)}점 · ${Math.round(stat.totalMin)}분`
        : hasTime
        ? `${h}시 · ${Math.round(stat.totalMin)}분 공부 (AI타이머 미사용)`
        : `${h}시 · 기록 없음`;

      return `<div class="rh-col" title="${tip}">
        <div class="${cls}" style="height:${heightPct}%"></div>
        <div class="rh-hour">${h % 3 === 0 ? h : ''}</div>
      </div>`;
    }).join('');

    // 범례 추가
    const legendNote = hasAnyScore
      ? '<div class="rh-legend">막대 높이 = 집중도 점수 | <span class="legend-best">■</span> 최고 <span class="legend-worst">■</span> 최저</div>'
      : '<div class="rh-legend">막대 높이 = 공부 시간 (집중도는 AI 타이머에서 기록돼요)</div>';
    el.insertAdjacentHTML('afterend', legendNote);
  }

  _renderSubjectList(subjectStats) {
    const el = document.getElementById('report-subject-list');
    if (!el) return;
    if (!subjectStats.length) {
      el.innerHTML = '<div class="rs-empty">교재를 등록하고 타이머를 사용하면 과목별 기록이 나타나요</div>';
      return;
    }
    el.innerHTML = subjectStats.map(s => `
      <div class="rs-item">
        <div class="rs-dot" style="background:${s.color||'#a89bd8'}"></div>
        <div class="rs-info">
          <div class="rs-name">${s.subjectName}</div>
          <div class="rs-bar-track">
            <div class="rs-bar-fill" style="width:${s.avgScore!==null?s.avgScore:0}%;background:${s.color||'#a89bd8'}"></div>
          </div>
        </div>
        <div class="rs-score">${s.avgScore!==null ? Math.round(s.avgScore)+'점' : `${Math.round(s.totalMin)}분`}</div>
      </div>`).join('');
  }

  _renderInsights(hourlyStats, subjectStats, sessions) {
    const el = document.getElementById('report-recommendation');
    if (!el) return;
    el.innerHTML = this.buildInsights(hourlyStats, subjectStats, sessions);
  }
}

const Report = new ReportManager();
