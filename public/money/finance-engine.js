/**
 * finance-engine.js
 * DOM・Firebaseに依存しない純粋計算関数のみを置く。
 *
 * 主要な設計方針
 *  - 「支払い能力チェック」と「今使える金額」は同じ入力を使っても別関数・別結果オブジェクトにする。
 *  - クレジットカードは「利用日(transactionDate)」と「引落予定日(dueDate)」を必ず区別する。
 *  - 給与は暦月(1日〜末日)を勤務月とし、翌月15日を基本支給日、土日祝は前営業日へ繰り上げる。
 *  - カード引落日が土日祝の場合は翌営業日へ繰り下げる（給与とは逆方向）。
 */
(function attachFinanceEngine(root) {
  'use strict';

  /* ============================================================
   * 1. 日付ユーティリティ
   * ========================================================== */

  const pad = value => String(value).padStart(2, '0');

  function parseLocalDate(dateString) {
    if (dateString instanceof Date) return new Date(dateString.getFullYear(), dateString.getMonth(), dateString.getDate(), 12);
    const [year, month, day] = String(dateString || '').split('-').map(Number);
    if (!year || !month || !day) throw new Error('日付はYYYY-MM-DD形式で指定してください');
    return new Date(year, month - 1, day, 12);
  }

  function toDateString(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function daysInMonth(year, monthIndex) {
    return new Date(year, monthIndex + 1, 0, 12).getDate();
  }

  function dateAt(year, monthIndex, requestedDay) {
    const day = Math.min(Math.max(Number(requestedDay) || 1, 1), daysInMonth(year, monthIndex));
    return new Date(year, monthIndex, day, 12);
  }

  function addDays(date, days) {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
  }

  function daysBetween(from, to) {
    return Math.round((parseLocalDate(to) - parseLocalDate(from)) / 86400000);
  }

  /* ---- JST(UTC+9)ユーティリティ -------------------------------
   * メール取込の受信時刻はUTCのISO文字列で届く。
   * 日本時間の深夜0時〜朝9時に受信したメールは、UTCのままでは前日になってしまうため、
   * 日付を取り出す前に必ず +9時間 してから切り出す。
   * ---------------------------------------------------------- */
  const JST_OFFSET_MINUTES = 9 * 60;

  /** ISO文字列(UTC)から日本時間の 'YYYY-MM-DD' を返す。解釈できない場合は空文字。 */
  function jstDateStringOf(isoInstant) {
    if (!isoInstant) return '';
    const time = new Date(isoInstant).getTime();
    if (!Number.isFinite(time)) return '';
    const shifted = new Date(time + JST_OFFSET_MINUTES * 60000);
    return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
  }

  /** ISO文字列(UTC)から日本時間の 'HH:MM' を返す。解釈できない場合は空文字。 */
  function jstTimeStringOf(isoInstant) {
    if (!isoInstant) return '';
    const time = new Date(isoInstant).getTime();
    if (!Number.isFinite(time)) return '';
    const shifted = new Date(time + JST_OFFSET_MINUTES * 60000);
    return `${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`;
  }

  /** 「今日」を日本時間の 'YYYY-MM-DD' で返す。実行環境のタイムゾーンに依存しない。 */
  function jstToday(now = new Date()) {
    return jstDateStringOf(now instanceof Date ? now.toISOString() : now);
  }

  /**
   * 明細を新しい順に並べるための比較値(エポックミリ秒)を返す。
   *  ① transactionAt (UTCのISO文字列) があればそれを使う
   *  ② 無ければ利用日の日本時間0時とみなす
   * 時刻を持たない取引が同じ日に並ぶ場合は、呼び出し側で登録順を副キーにする。
   */
  function usageInstantOf(transaction) {
    const at = transaction?.transactionAt;
    if (at) {
      const time = new Date(at).getTime();
      if (Number.isFinite(time)) return time;
    }
    const date = transaction?.transactionDate || transaction?.dueDate || '';
    if (!date) return 0;
    const time = new Date(`${date}T00:00:00+09:00`).getTime();
    return Number.isFinite(time) ? time : 0;
  }

  /** 明細を利用時刻の新しい順に並べ替える（元の配列は変更しない）。 */
  function sortByUsageDesc(transactions = []) {
    return [...transactions].sort((a, b) => {
      const diff = usageInstantOf(b) - usageInstantOf(a);
      if (diff !== 0) return diff;
      return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
    });
  }

  /** 'YYYY-MM' 形式の月キーを扱う */
  function monthKeyOf(dateInput) {
    const date = parseLocalDate(dateInput);
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
  }

  function parseMonthKey(monthKey) {
    const [year, month] = String(monthKey || '').split('-').map(Number);
    if (!year || !month) throw new Error('月は YYYY-MM 形式で指定してください');
    return { year, monthIndex: month - 1 };
  }

  function shiftMonthKey(monthKey, delta) {
    const { year, monthIndex } = parseMonthKey(monthKey);
    const moved = new Date(year, monthIndex + delta, 1, 12);
    return `${moved.getFullYear()}-${pad(moved.getMonth() + 1)}`;
  }

  /** 暦月(1日〜末日)の範囲を返す */
  function calendarMonthRange(monthKey) {
    const { year, monthIndex } = parseMonthKey(monthKey);
    return {
      startDate: toDateString(new Date(year, monthIndex, 1, 12)),
      endDate: toDateString(new Date(year, monthIndex, daysInMonth(year, monthIndex), 12))
    };
  }

  /* ============================================================
   * 2. 日本の祝日エンジン
   *    法律ベースで年ごとに算出する。固定表を1年分だけ埋め込まない。
   * ========================================================== */

  /** 特例法などで通常規則から外れる日（追加） */
  const BUILTIN_HOLIDAY_EXTRA = {
    '2019-04-30': '国民の休日',
    '2019-05-01': '天皇の即位の日',
    '2019-05-02': '国民の休日',
    '2019-10-22': '即位礼正殿の儀の行われる日',
    '2020-07-23': '海の日',
    '2020-07-24': 'スポーツの日',
    '2020-08-10': '山の日',
    '2021-07-22': '海の日',
    '2021-07-23': 'スポーツの日',
    '2021-08-08': '山の日'
  };

  /** 特例法で移動したため、通常規則の日付からは削除するもの */
  const BUILTIN_HOLIDAY_REMOVED = new Set([
    '2020-07-20', '2020-08-11', '2020-10-12',
    '2021-07-19', '2021-08-11', '2021-10-11'
  ]);

  /** 第n月曜日の日にちを返す */
  function nthMondayDay(year, monthIndex, nth) {
    const firstWeekday = new Date(year, monthIndex, 1, 12).getDay();
    const offsetToMonday = (8 - firstWeekday) % 7;
    return 1 + offsetToMonday + (nth - 1) * 7;
  }

  /** 春分・秋分の日（1980〜2099年は下記の近似式で正しく求まる） */
  function equinoxDay(year, season) {
    let base;
    if (year >= 2100) base = season === 'spring' ? 21.8510 : 24.2488;
    else base = season === 'spring' ? 20.8431 : 23.2488;
    return Math.floor(base + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
  }

  /** 振替休日・国民の休日を適用する前の「国民の祝日」を組み立てる */
  function buildBaseHolidays(year) {
    const map = new Map();
    const add = (month, day, name) => {
      const key = `${year}-${pad(month)}-${pad(day)}`;
      if (BUILTIN_HOLIDAY_REMOVED.has(key)) return;
      map.set(key, name);
    };

    add(1, 1, '元日');
    if (year >= 2000) add(1, nthMondayDay(year, 0, 2), '成人の日');
    else add(1, 15, '成人の日');
    add(2, 11, '建国記念の日');
    if (year >= 2020) add(2, 23, '天皇誕生日');
    add(3, equinoxDay(year, 'spring'), '春分の日');
    add(4, 29, year >= 2007 ? '昭和の日' : 'みどりの日');
    add(5, 3, '憲法記念日');
    if (year >= 2007) add(5, 4, 'みどりの日');
    add(5, 5, 'こどもの日');
    if (year >= 2003) add(7, nthMondayDay(year, 6, 3), '海の日');
    else if (year >= 1996) add(7, 20, '海の日');
    if (year >= 2016) add(8, 11, '山の日');
    if (year >= 2003) add(9, nthMondayDay(year, 8, 3), '敬老の日');
    else if (year >= 1966) add(9, 15, '敬老の日');
    add(9, equinoxDay(year, 'autumn'), '秋分の日');
    if (year >= 2000) add(10, nthMondayDay(year, 9, 2), year >= 2020 ? 'スポーツの日' : '体育の日');
    else add(10, 10, '体育の日');
    add(11, 3, '文化の日');
    add(11, 23, '勤労感謝の日');
    if (year >= 1989 && year <= 2018) add(12, 23, '天皇誕生日');

    Object.keys(BUILTIN_HOLIDAY_EXTRA).forEach(key => {
      if (key.startsWith(`${year}-`)) map.set(key, BUILTIN_HOLIDAY_EXTRA[key]);
    });
    return map;
  }

  /** 振替休日と国民の休日を加えた、その年の休日一覧を返す */
  function buildYearHolidays(year) {
    const base = buildBaseHolidays(year);
    const all = new Map(base);

    // 振替休日: 祝日が日曜の場合、その後の最も近い「祝日でない日」を休日とする（1973年〜）
    if (year >= 1973) {
      [...base.keys()].sort().forEach(key => {
        const date = parseLocalDate(key);
        if (date.getDay() !== 0) return;
        let cursor = addDays(date, 1);
        while (all.has(toDateString(cursor))) cursor = addDays(cursor, 1);
        all.set(toDateString(cursor), '振替休日');
      });
    }

    // 国民の休日: 前日と翌日がともに国民の祝日である平日を休日とする（1986年〜）
    if (year >= 1986) {
      [...base.keys()].sort().forEach(key => {
        const date = parseLocalDate(key);
        const candidate = addDays(date, 1);
        const candidateKey = toDateString(candidate);
        if (all.has(candidateKey)) return;
        if (candidate.getDay() === 0) return;
        if (!base.has(toDateString(addDays(candidate, 1)))) return;
        all.set(candidateKey, '国民の休日');
      });
    }

    return all;
  }

  const holidayCache = new Map();

  function holidaysForYear(year) {
    if (!holidayCache.has(year)) holidayCache.set(year, buildYearHolidays(year));
    return holidayCache.get(year);
  }

  /**
   * 祝日かどうかを判定する。
   * options.overrides: { 'YYYY-MM-DD': '名称' } 将来の臨時祝日などを追加する
   * options.removals:  ['YYYY-MM-DD'] 祝日でなくなった日を除外する
   */
  function japaneseHolidayName(dateInput, options = {}) {
    const key = typeof dateInput === 'string' ? dateInput : toDateString(parseLocalDate(dateInput));
    const removals = options.removals || options.holidayRemovals;
    if (removals && (Array.isArray(removals) ? removals.includes(key) : removals[key])) return '';
    const overrides = options.overrides || options.holidayOverrides;
    if (overrides) {
      if (Array.isArray(overrides) && overrides.includes(key)) return '臨時の休日';
      if (!Array.isArray(overrides) && overrides[key]) return overrides[key];
    }
    const year = Number(key.slice(0, 4));
    return holidaysForYear(year).get(key) || '';
  }

  function isJapaneseHoliday(dateInput, options = {}) {
    return Boolean(japaneseHolidayName(dateInput, options));
  }

  function isWeekend(dateInput) {
    const day = parseLocalDate(dateInput).getDay();
    return day === 0 || day === 6;
  }

  /** 土日でも祝日でもない日を営業日とする */
  function isJapaneseBusinessDay(dateInput, options = {}) {
    return !isWeekend(dateInput) && !isJapaneseHoliday(dateInput, options);
  }

  /** 営業日でなければ、営業日になるまで前へ戻す（給与の繰り上げ用）。営業日ならそのまま返す。 */
  function previousBusinessDay(dateInput, options = {}) {
    let cursor = parseLocalDate(dateInput);
    let guard = 0;
    while (!isJapaneseBusinessDay(cursor, options) && guard < 30) {
      cursor = addDays(cursor, -1);
      guard += 1;
    }
    return toDateString(cursor);
  }

  /** 営業日でなければ、営業日になるまで後ろへ送る（カード引落の繰り下げ用）。営業日ならそのまま返す。 */
  function nextBusinessDay(dateInput, options = {}) {
    let cursor = parseLocalDate(dateInput);
    let guard = 0;
    while (!isJapaneseBusinessDay(cursor, options) && guard < 30) {
      cursor = addDays(cursor, 1);
      guard += 1;
    }
    return toDateString(cursor);
  }

  /* ============================================================
   * 3. クレジットカードの引落予定日
   * ========================================================== */

  /**
   * カード利用日から銀行口座の引落予定日を求める。
   *  - 締め日当日は当月の締めに含める
   *  - paymentMonthOffset は締め月から支払月までの月数（既定1）
   *  - closingDay / paymentDay の 0 は「月末」を意味する
   *  - 引落日が土日祝の場合は翌営業日へ繰り下げる（翌月へまたがる場合もそのまま）
   */
  function calculateCardPaymentDate(transactionDate, closingDay, paymentDay, paymentMonthOffset = 1, options = {}) {
    const usedDate = parseLocalDate(transactionDate);
    const year = usedDate.getFullYear();
    const monthIndex = usedDate.getMonth();
    const closingDate = Number(closingDay) === 0
      ? dateAt(year, monthIndex, daysInMonth(year, monthIndex))
      : dateAt(year, monthIndex, closingDay);

    // 締め日当日は当月に含めるため、超えたときだけ翌月締めにする
    const closingMonthOffset = usedDate > closingDate ? 1 : 0;
    const offset = Number.isFinite(Number(paymentMonthOffset)) ? Number(paymentMonthOffset) : 1;
    const paymentMonth = new Date(year, monthIndex + closingMonthOffset + offset, 1, 12);
    const rawPaymentDate = Number(paymentDay) === 0
      ? dateAt(paymentMonth.getFullYear(), paymentMonth.getMonth(), daysInMonth(paymentMonth.getFullYear(), paymentMonth.getMonth()))
      : dateAt(paymentMonth.getFullYear(), paymentMonth.getMonth(), paymentDay);

    if (options.skipBusinessDayAdjustment) return toDateString(rawPaymentDate);
    return nextBusinessDay(rawPaymentDate, options);
  }

  /** 旧API互換。オフセット1固定で呼び出される既存コードのために残す。 */
  function nextCardPaymentDate(usedOn, closingDay, paymentDay, paymentMonthOffset = 1, options = {}) {
    return calculateCardPaymentDate(usedOn, closingDay, paymentDay, paymentMonthOffset, options);
  }

  /* ============================================================
   * 4. 給与・シフト
   *    勤務月は暦月(1日〜末日)。支給日は翌月15日、土日祝は前営業日へ繰り上げる。
   * ========================================================== */

  const DEFAULT_SALARY_PAYMENT_DAY = 15;
  const DEFAULT_SALARY_MONTH_OFFSET = 1;

  /** 勤務月('YYYY-MM')から実際の支給予定日を求める */
  function calculateSalaryPaymentDate(workMonth, wageSettings = {}, options = {}) {
    const paymentMonth = shiftMonthKey(workMonth, Number(wageSettings.salaryMonthOffset) || DEFAULT_SALARY_MONTH_OFFSET);
    const { year, monthIndex } = parseMonthKey(paymentMonth);
    const day = Number(wageSettings.salaryPaymentDay) || DEFAULT_SALARY_PAYMENT_DAY;
    const base = dateAt(year, monthIndex, day);
    return previousBusinessDay(base, options);
  }

  /** 勤務日から、その勤務が支給される月('YYYY-MM')を求める */
  function paymentMonthForWorkDate(workDate, wageSettings = {}) {
    return shiftMonthKey(monthKeyOf(workDate), Number(wageSettings.salaryMonthOffset) || DEFAULT_SALARY_MONTH_OFFSET);
  }

  /**
   * 支給月を指定して、その月に支給される給与を集計する。
   * 支給月は保存値ではなく勤務日から毎回計算するため、ルール変更時も再計算できる。
   */
  function calculateSalaryByPaymentMonth(workEntries = [], targetPaymentMonth, wageSettings = {}, options = {}) {
    const monthOffset = Number(wageSettings.salaryMonthOffset) || DEFAULT_SALARY_MONTH_OFFSET;
    const workMonth = shiftMonthKey(targetPaymentMonth, -monthOffset);
    const range = calendarMonthRange(workMonth);
    const baseRate = Math.max(Number(wageSettings.hourlyRate) || 0, 0);

    const entries = workEntries
      .filter(entry => entry && entry.date >= range.startDate && entry.date <= range.endDate)
      .map(entry => {
        const hours = Math.max(Number(entry.hours) || 0, 0);
        const rate = Math.max(Number(entry.hourlyRateOverride) || baseRate, 0);
        return { ...entry, hours, rate, amount: Math.round(hours * rate) };
      })
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));

    const worked = entries.filter(entry => entry.status === 'worked');
    const planned = entries.filter(entry => entry.status !== 'worked');
    const sum = (items, field) => items.reduce((total, item) => total + Number(item[field] || 0), 0);
    const confirmedAmount = sum(worked, 'amount');
    const plannedAmount = sum(planned, 'amount');

    return {
      paymentMonth: targetPaymentMonth,
      workMonth,
      workStartDate: range.startDate,
      workEndDate: range.endDate,
      paymentDate: calculateSalaryPaymentDate(workMonth, wageSettings, options),
      scheduledPaymentDate: toDateString(dateAt(
        parseMonthKey(targetPaymentMonth).year,
        parseMonthKey(targetPaymentMonth).monthIndex,
        Number(wageSettings.salaryPaymentDay) || DEFAULT_SALARY_PAYMENT_DAY
      )),
      entries,
      workedCount: worked.length,
      plannedCount: planned.length,
      workedHours: sum(worked, 'hours'),
      plannedHours: sum(planned, 'hours'),
      totalHours: sum(entries, 'hours'),
      confirmedAmount,
      plannedAmount,
      totalAmount: confirmedAmount + plannedAmount
    };
  }

  /** 指定期間に支給日が入る給与をまとめて求める */
  function collectSalaryEvents(workEntries = [], wageSettings = {}, fromDate, toDate, options = {}) {
    const results = [];
    if (!fromDate || !toDate || fromDate > toDate) return results;
    // 支給日が期間内に入りうる支給月を、前後1か月の余裕をもって走査する
    let cursor = shiftMonthKey(monthKeyOf(fromDate), -1);
    const last = shiftMonthKey(monthKeyOf(toDate), 1);
    let guard = 0;
    while (cursor <= last && guard < 48) {
      const salary = calculateSalaryByPaymentMonth(workEntries, cursor, wageSettings, options);
      if (salary.paymentDate >= fromDate && salary.paymentDate <= toDate && salary.totalAmount > 0) results.push(salary);
      cursor = shiftMonthKey(cursor, 1);
      guard += 1;
    }
    return results;
  }

  /* ============================================================
   * 5. 未払いクレジットカード利用
   * ========================================================== */

  /** 取引の「実際の利用日」を返す。旧データで transactionDate が無い場合は dueDate を暫定値にする。 */
  function usageDateOf(transaction) {
    return transaction.transactionDate || transaction.dueDate || '';
  }

  /* ---------- 請求サイクル（締め月）ごとの集約 ---------- */

  const STATEMENT = 'statement';
  const ITEMIZED = 'itemized';

  /**
   * absorbed(吸収済み) = 請求総額を確定したときに内数として取り込まれた明細。
   * 残高にも予測にも一切影響させないが、履歴としては残し、総額から展開して閲覧できる。
   */
  const ABSORBED = 'absorbed';
  const INACTIVE_STATUSES = new Set(['settled', 'cancelled', ABSORBED]);

  /** 取引が「請求総額」か「明細」かを返す。未設定の手入力は請求総額として扱う。 */
  function entryTypeOf(transaction) {
    return transaction.entryType === ITEMIZED ? ITEMIZED : STATEMENT;
  }

  /** 利用日が属する締め月('YYYY-MM')。締め日当日は当月に含める。 */
  function closingMonthOf(transactionDate, closingDay) {
    const used = parseLocalDate(transactionDate);
    const year = used.getFullYear();
    const monthIndex = used.getMonth();
    const closingDate = Number(closingDay) === 0
      ? dateAt(year, monthIndex, daysInMonth(year, monthIndex))
      : dateAt(year, monthIndex, closingDay);
    return used > closingDate
      ? shiftMonthKey(`${year}-${pad(monthIndex + 1)}`, 1)
      : `${year}-${pad(monthIndex + 1)}`;
  }

  /**
   * カード取引が属する請求サイクル('YYYY-MM' 締め月)を求める。
   *  - 明細（利用日がある）    : 利用日から前向きに求める
   *  - 請求総額（引落日がある）: 引落日から逆算し、計算上の引落日が最も近い締め月を選ぶ
   * 営業日の繰り下げで日付がずれても同じサイクルに揃うようにしている。
   */
  function cardBillingCycleOf(transaction, card, options = {}) {
    const closingDay = Number(card?.closingDay || 0);
    if (entryTypeOf(transaction) === ITEMIZED && transaction.transactionDate) {
      return closingMonthOf(transaction.transactionDate, closingDay);
    }
    const dueDate = transaction.dueDate || transaction.transactionDate;
    if (!dueDate) return '';
    if (!card) return monthKeyOf(dueDate);

    const paymentDay = Number(card.paymentDay || 0);
    const offset = Number.isFinite(Number(card.paymentMonthOffset)) ? Number(card.paymentMonthOffset) : 1;
    let best = '';
    let bestDistance = Infinity;
    for (let back = 0; back <= 4; back += 1) {
      const cycle = shiftMonthKey(monthKeyOf(dueDate), -back);
      const { year, monthIndex } = parseMonthKey(cycle);
      // その締め月の最終日を利用日とみなして引落日を計算する
      const anchor = toDateString(dateAt(year, monthIndex, closingDay === 0 ? daysInMonth(year, monthIndex) : closingDay));
      const paid = calculateCardPaymentDate(anchor, closingDay, paymentDay, offset, options);
      const distance = Math.abs(daysBetween(paid, dueDate));
      if (distance < bestDistance) { bestDistance = distance; best = cycle; }
    }
    return best;
  }

  /**
   * カード取引を「カード×請求サイクル」でまとめる。
   *
   * 同じサイクルに請求総額と明細が混在した場合、確定している請求総額を採用し、
   * 明細は内数として計算から外す。請求総額がまだ無いサイクルは明細を採用するため、
   * 「利用してから総額を入力するまで」の空白期間も金額に反映される。
   */
  function groupCardCharges(transactions = [], cards = [], options = {}) {
    const cardsById = new Map((cards || []).map(card => [card.id, card]));
    const groups = new Map();

    (transactions || []).forEach(transaction => {
      if (!transaction || transaction.kind !== 'payment' || !transaction.cardId) return;
      if (INACTIVE_STATUSES.has(transaction.status)) return;
      if (transaction.affectsForecast === false) return;
      const card = cardsById.get(transaction.cardId) || null;
      const cycle = cardBillingCycleOf(transaction, card, options);
      const key = `${transaction.cardId}:${cycle}`;
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          cardId: transaction.cardId,
          cardName: card ? card.name : '登録解除済みのカード',
          accountId: card ? card.accountId : (transaction.sourceAccountId || ''),
          billingCycle: cycle,
          statements: [],
          itemized: []
        });
      }
      const group = groups.get(key);
      if (entryTypeOf(transaction) === ITEMIZED) group.itemized.push(transaction);
      else group.statements.push(transaction);
    });

    const sum = list => list.reduce((total, item) => total + Number(item.amount || 0), 0);

    return [...groups.values()].map(group => {
      const useStatement = group.statements.length > 0;
      const adopted = useStatement ? group.statements : group.itemized;
      const suppressed = useStatement ? group.itemized : [];
      const dueDates = adopted.map(item => item.dueDate).filter(Boolean).sort();
      const statementTotal = sum(group.statements);
      const itemizedTotal = sum(group.itemized);
      return {
        ...group,
        source: useStatement ? STATEMENT : ITEMIZED,
        adopted,
        adoptedTotal: sum(adopted),
        suppressed,
        suppressedTotal: sum(suppressed),
        statementTotal,
        itemizedTotal,
        dueDate: dueDates[0] || '',
        // 明細の合計が請求総額を上回る場合、総額の入力漏れや誤りの可能性がある
        itemizedExceedsStatement: useStatement && itemizedTotal > statementTotal
      };
    }).sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)) || a.cardName.localeCompare(b.cardName, 'ja'));
  }

  /**
   * 「今使える金額」から差し引くべき、実際に利用済みで未払いのカード額を求める。
   *  条件: 利用日が今日以前 / 未確定または未払い / 取消・返金済みでない
   *
   * dateEstimated が立っている取引は、利用日が復元できない旧データである。
   * 旧アプリでは引落予定日だけを登録していたため、これらは既に発生した利用として扱い、
   * 安全側（控除する側）に倒す。利用日はユーザーがあとから修正できる。
   */
  function calculateUnpaidCardUsage(transactions = [], today, options = {}) {
    const deadline = options.deadline || '';
    const groups = groupCardCharges(transactions, options.cards || [], options);

    // 請求サイクルごとに採用された取引だけを、未払い債務として集める。
    //  請求総額 : 締め済みで金額が確定しているため、登録時点から引落日まで控除する
    //  明細     : 実際に利用済みのものだけを控除する（未来の利用予定は含めない）
    const items = [];
    groups.forEach(group => {
      group.adopted.forEach(item => {
        if (group.source === STATEMENT) { items.push(item); return; }
        if (item.dateEstimated === true) { items.push(item); return; }
        const usedOn = usageDateOf(item);
        if (usedOn && usedOn <= today) items.push(item);
      });
    });

    const sum = list => list.reduce((total, item) => total + Number(item.amount || 0), 0);
    const withinDeadline = deadline ? items.filter(item => item.dueDate && item.dueDate <= deadline) : items;
    const beyondDeadline = deadline ? items.filter(item => !item.dueDate || item.dueDate > deadline) : [];
    const estimatedItems = items.filter(item => item.dateEstimated === true);
    const suppressed = groups.flatMap(group => group.suppressed);

    const byCard = new Map();
    items.forEach(item => {
      if (!byCard.has(item.cardId)) byCard.set(item.cardId, { cardId: item.cardId, total: 0, count: 0, items: [] });
      const entry = byCard.get(item.cardId);
      entry.total += Number(item.amount || 0);
      entry.count += 1;
      entry.items.push(item);
    });

    return {
      total: sum(items),
      count: items.length,
      items,
      groups,
      estimatedTotal: sum(estimatedItems),
      estimatedItems,
      withinDeadlineTotal: sum(withinDeadline),
      beyondDeadlineTotal: sum(beyondDeadline),
      beyondDeadlineItems: beyondDeadline,
      // 請求総額が入力されたことで、内数として計算から外れた取込明細
      suppressedTotal: sum(suppressed),
      suppressedItems: suppressed,
      conflicts: groups.filter(group => group.itemizedExceedsStatement),
      byCard: [...byCard.values()].sort((a, b) => b.total - a.total)
    };
  }

  /* ============================================================
   * 6. 定期予定の展開
   * ========================================================== */

  /**
   * recurringPlans を指定期間の仮想取引へ展開する。
   * 同じ plan / 同じ日付の実取引が既にある場合は展開しない（二重計上を防ぐ）。
   */
  function expandScheduledTransactions(recurringPlans = [], fromDate, toDate, existingTransactions = []) {
    if (!fromDate || !toDate || fromDate > toDate) return [];
    const taken = new Set(existingTransactions
      .filter(transaction => transaction && transaction.recurringPlanId)
      .map(transaction => `${transaction.recurringPlanId}:${transaction.dueDate}`));

    const results = [];
    const start = parseLocalDate(fromDate);
    const end = parseLocalDate(toDate);

    recurringPlans.forEach(plan => {
      if (!plan || plan.isActive === false) return;
      const amount = Number(plan.amount || 0);
      if (!amount) return;
      const dayOfMonth = Math.min(Math.max(Number(plan.dayOfMonth) || 1, 1), 31);
      let cursor = new Date(start.getFullYear(), start.getMonth(), 1, 12);
      let guard = 0;
      while (cursor <= end && guard < 120) {
        const occurrence = dateAt(cursor.getFullYear(), cursor.getMonth(), dayOfMonth);
        const key = toDateString(occurrence);
        if (occurrence >= start && occurrence <= end
          && (!plan.startDate || key >= plan.startDate)
          && (!plan.endDate || key <= plan.endDate)
          && !taken.has(`${plan.id}:${key}`)) {
          results.push({
            id: `recurring:${plan.id}:${key}`,
            kind: plan.kind || 'payment',
            amount,
            transactionDate: key,
            dueDate: key,
            status: 'planned',
            sourceAccountId: plan.sourceAccountId || '',
            destinationAccountId: plan.destinationAccountId || '',
            transferType: plan.transferType || 'external',
            cardId: '',
            category: plan.category || '固定費',
            memo: plan.name || '固定費',
            affectsForecast: true,
            recurringPlanId: plan.id,
            isVirtual: true
          });
        }
        cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1, 12);
        guard += 1;
      }
    });

    return results.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  }

  /* ============================================================
   * 7. 共通ヘルパ
   * ========================================================== */

  const NON_SPENDABLE_ROLES = ['savings', 'investment'];

  function isSpendableAccount(account) {
    if (!account) return false;
    if (NON_SPENDABLE_ROLES.includes(account.role)) return false;
    return account.includeInSpendable !== false;
  }

  function resolvePrimaryAccount(accounts = [], primaryAccountId = '') {
    return accounts.find(item => item.id === primaryAccountId)
      || accounts.find(item => item.isPrimary)
      || accounts.find(item => item.role === 'primary')
      || accounts[0]
      || null;
  }

  function isExternalTransfer(transaction) {
    return transaction.kind === 'transfer' && transaction.transferType === 'external';
  }

  /**
   * 1件の取引が各口座へ与える増減を返す。
   * 自分の口座間振替は送金元を減らし送金先を増やすため、全口座合計では二重に支出とならない。
   */
  function accountDeltasFor(transaction) {
    const amount = Number(transaction.amount || 0);
    const source = transaction.sourceAccountId || '';
    const destination = transaction.destinationAccountId || '';
    switch (transaction.kind) {
      case 'income':
      case 'reimbursement':
        return [{ accountId: source, delta: amount, direction: 'in' }];
      case 'saving':
      case 'nisa':
        return destination
          ? [{ accountId: source, delta: -amount, direction: 'out' }, { accountId: destination, delta: amount, direction: 'in' }]
          : [{ accountId: source, delta: -amount, direction: 'out' }];
      case 'transfer':
        if (isExternalTransfer(transaction) || !destination) return [{ accountId: source, delta: -amount, direction: 'out' }];
        return [{ accountId: source, delta: -amount, direction: 'out' }, { accountId: destination, delta: amount, direction: 'in' }];
      case 'payment':
      case 'adjustment':
      default:
        return [{ accountId: source, delta: -amount, direction: 'out' }];
    }
  }

  /* ============================================================
   * 8. 機能A｜支払い能力チェック
   *    「将来の支払い能力が維持できるか」を判定する。
   *    クレジットカードは利用時点では残高を減らさず、引落日にだけ支出として計上する。
   * ========================================================== */

  function calculateCashflowCheck(input = {}) {
    const today = input.today;
    if (!today) throw new Error('today は必須です');
    const horizonDays = Math.max(Number(input.horizonDays) || 90, 1);
    const endDate = input.endDate || toDateString(addDays(parseLocalDate(today), horizonDays));
    const accounts = Array.isArray(input.accounts) ? input.accounts : [];
    const defenseLine = Number(input.defenseLine || 0);
    const primary = resolvePrimaryAccount(accounts, input.primaryAccountId);
    const holidayOptions = input.holidayOptions || {};
    const includeSalary = input.includeSalary !== false;

    // 同じ請求サイクルに請求総額と明細が併存する場合、明細は内数なので銀行残高からは引かない
    const cardGroups = groupCardCharges(input.transactions || [], input.cards || [], holidayOptions);
    const suppressedIds = new Set(cardGroups.flatMap(group => group.suppressed).map(item => item.id));

    const realTransactions = (input.transactions || []).filter(transaction => transaction
      && transaction.status === 'planned'
      && transaction.affectsForecast !== false
      && !suppressedIds.has(transaction.id)
      && transaction.dueDate >= today
      && transaction.dueDate <= endDate);

    const virtualTransactions = expandScheduledTransactions(
      input.recurringPlans || [], today, endDate, input.transactions || []
    );

    const salaryEvents = includeSalary
      ? collectSalaryEvents(input.workEntries || [], input.wage || {}, today, endDate, holidayOptions)
      : [];

    const depositAccountId = (input.wage && input.wage.depositAccountId) || (primary ? primary.id : '');
    const salaryTransactions = salaryEvents.map(salary => ({
      id: `salary:${salary.paymentMonth}`,
      kind: 'income',
      amount: salary.totalAmount,
      transactionDate: salary.paymentDate,
      dueDate: salary.paymentDate,
      status: 'planned',
      sourceAccountId: depositAccountId,
      destinationAccountId: '',
      category: '給与',
      memo: `${salary.workMonth} 分の給与`,
      affectsForecast: true,
      isSalary: true,
      salary
    }));

    const events = [...realTransactions, ...virtualTransactions, ...salaryTransactions]
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate));

    const balances = new Map(accounts.map(item => [item.id, Number(item.currentBalance || 0)]));
    const startTotal = accounts.reduce((sum, item) => sum + Number(item.currentBalance || 0), 0);
    const startPrimary = primary ? Number(primary.currentBalance || 0) : 0;
    const primaryId = primary ? primary.id : '';

    const eventsByDate = new Map();
    events.forEach(event => {
      if (!eventsByDate.has(event.dueDate)) eventsByDate.set(event.dueDate, []);
      eventsByDate.get(event.dueDate).push(event);
    });

    const timeline = [];
    let totalBalance = startTotal;
    let primaryBalance = startPrimary;
    let minPrimaryBalance = startPrimary;
    let minPrimaryBalanceDate = today;
    let shortfallDate = '';
    let belowDefenseDate = '';

    let cursor = parseLocalDate(today);
    const last = parseLocalDate(endDate);
    let guard = 0;
    while (cursor <= last && guard < 1100) {
      const dateKey = toDateString(cursor);
      const dayEvents = eventsByDate.get(dateKey) || [];
      let inflow = 0;
      let outflow = 0;

      dayEvents.forEach(event => {
        let primaryNet = 0;
        let totalNet = 0;
        // 自分の口座間振替は送金元と送金先で相殺されるため、全口座合計では二重に支出とならない
        accountDeltasFor(event).forEach(({ accountId, delta }) => {
          if (!accountId || !balances.has(accountId)) return;
          balances.set(accountId, balances.get(accountId) + delta);
          totalNet += delta;
          if (accountId === primaryId) primaryNet += delta;
        });
        primaryBalance += primaryNet;
        totalBalance += totalNet;
        if (primaryNet >= 0) inflow += primaryNet; else outflow += -primaryNet;
      });

      if (primaryBalance < minPrimaryBalance) {
        minPrimaryBalance = primaryBalance;
        minPrimaryBalanceDate = dateKey;
      }
      if (!shortfallDate && primaryBalance < 0) shortfallDate = dateKey;
      if (!belowDefenseDate && primaryBalance < defenseLine) belowDefenseDate = dateKey;

      timeline.push({
        date: dateKey,
        events: dayEvents,
        eventCount: dayEvents.length,
        inflow,
        outflow,
        primaryBalance,
        totalBalance,
        belowDefense: primaryBalance < defenseLine,
        shortfall: primaryBalance < 0,
        byAccount: Object.fromEntries(balances)
      });

      cursor = addDays(cursor, 1);
      guard += 1;
    }

    const verdict = shortfallDate ? 'shortfall' : (belowDefenseDate ? 'belowDefense' : 'ok');
    const verdictLabel = { shortfall: '不足の可能性', belowDefense: '最低残高を下回る', ok: '支払い可能' }[verdict];
    const criticalDate = shortfallDate || belowDefenseDate || minPrimaryBalanceDate;

    const causes = events
      .filter(event => event.dueDate <= criticalDate)
      .map(event => {
        const out = accountDeltasFor(event)
          .filter(item => item.accountId === primaryId && item.delta < 0)
          .reduce((sum, item) => sum + -item.delta, 0);
        return { event, amount: out };
      })
      .filter(item => item.amount > 0)
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 10)
      .map(item => ({
        id: item.event.id,
        date: item.event.dueDate,
        amount: item.amount,
        kind: item.event.kind,
        cardId: item.event.cardId || '',
        memo: item.event.memo || '',
        category: item.event.category || ''
      }));

    const cardBills = aggregateCardBills(realTransactions, input.cards || [], today)
      .filter(bill => bill.dueDate <= endDate);

    return {
      startDate: today,
      endDate,
      days: daysBetween(today, endDate),
      defenseLine,
      primaryAccountId: primaryId,
      primaryAccountName: primary ? primary.name : '',
      startPrimaryBalance: startPrimary,
      startTotalBalance: startTotal,
      verdict,
      verdictLabel,
      minBalance: minPrimaryBalance,
      minBalanceDate: minPrimaryBalanceDate,
      riskiestDate: minPrimaryBalanceDate,
      shortfallDate,
      belowDefenseDate,
      shortfallAmount: Math.max(0, -minPrimaryBalance),
      defenseGap: Math.max(0, defenseLine - minPrimaryBalance),
      causes,
      cardBills,
      cardGroups,
      salaryEvents,
      timeline,
      eventDays: timeline.filter(day => day.eventCount > 0)
    };
  }

  /* ============================================================
   * 9. 不足解消の提案
   * ========================================================== */

  const RESOLUTION_PRIORITY = { spending: 0, other: 1, primary: 2, savings: 3, investment: 4 };

  /** 不足日を解消するために、どの口座からいくら振り替えればよいかを提案する */
  function suggestShortfallResolution(check, accounts = []) {
    if (!check || check.verdict === 'ok') return { required: 0, byDate: '', suggestions: [], covered: true, shortage: 0 };
    const required = check.verdict === 'shortfall'
      ? Math.max(0, check.defenseGap)
      : Math.max(0, check.defenseGap);
    if (required <= 0) return { required: 0, byDate: '', suggestions: [], covered: true, shortage: 0 };

    const byDate = check.shortfallDate || check.belowDefenseDate || check.minBalanceDate;
    const candidates = accounts
      .filter(item => item.id !== check.primaryAccountId && Number(item.currentBalance || 0) > 0)
      .sort((a, b) => (RESOLUTION_PRIORITY[a.role] ?? 9) - (RESOLUTION_PRIORITY[b.role] ?? 9)
        || Number(b.currentBalance || 0) - Number(a.currentBalance || 0));

    let remaining = required;
    const suggestions = [];
    candidates.forEach(item => {
      if (remaining <= 0) return;
      const available = Math.max(0, Number(item.currentBalance || 0) - Number(item.reserveAmount || 0));
      if (available <= 0) return;
      const amount = Math.min(available, remaining);
      remaining -= amount;
      suggestions.push({
        accountId: item.id,
        accountName: item.name,
        role: item.role,
        amount,
        balanceAfter: Number(item.currentBalance || 0) - amount,
        isProtected: NON_SPENDABLE_ROLES.includes(item.role)
      });
    });

    return { required, byDate, suggestions, covered: remaining <= 0, shortage: Math.max(0, remaining) };
  }

  /* ============================================================
   * 10. 機能B｜今使える金額
   *     クレカは「利用済みで未払いの額」を一度だけ控除する。
   *     引落予定日での再控除は行わない（二重計上の防止）。
   * ========================================================== */

  function calculateSpendableAmount(input = {}) {
    const today = input.today;
    if (!today) throw new Error('today は必須です');
    const deadline = input.deadline;
    if (!deadline) throw new Error('deadline は必須です');
    const accounts = Array.isArray(input.accounts) ? input.accounts : [];
    const defenseLine = Number(input.defenseLine || 0);
    const includeSalary = input.includeSalary !== false;
    const holidayOptions = input.holidayOptions || {};

    const spendable = accounts.filter(isSpendableAccount);
    const spendableIds = new Set(spendable.map(item => item.id));
    const cashAvailable = spendable.reduce((sum, item) => sum + Number(item.currentBalance || 0), 0);

    const withinRange = transaction => transaction
      && transaction.status === 'planned'
      && transaction.affectsForecast !== false
      && transaction.dueDate >= today
      && transaction.dueDate <= deadline;

    const virtualTransactions = expandScheduledTransactions(
      input.recurringPlans || [], today, deadline, input.transactions || []
    );
    const events = [...(input.transactions || []).filter(withinRange), ...virtualTransactions];

    // 収入は受取口座が使える口座のときだけ計上する
    const incomeItems = events.filter(item => ['income', 'reimbursement'].includes(item.kind)
      && (!item.sourceAccountId || spendableIds.has(item.sourceAccountId)));
    const incomeTotal = incomeItems.reduce((sum, item) => sum + Number(item.amount || 0), 0);

    // 現金支出。カード引落(cardIdあり)はここに含めない。未払いカード額として別に控除する。
    const cashOutflowItems = events.filter(item => {
      if (!['payment', 'adjustment', 'transfer'].includes(item.kind)) return false;
      if (item.kind === 'payment' && item.cardId) return false;
      if (item.sourceAccountId && !spendableIds.has(item.sourceAccountId)) return false;
      if (item.kind === 'transfer' && !isExternalTransfer(item)) {
        // 使える口座どうしの振替は残高が動かないため計上しない
        return Boolean(item.destinationAccountId) && !spendableIds.has(item.destinationAccountId);
      }
      return true;
    });
    const cashOutflow = cashOutflowItems.reduce((sum, item) => sum + Number(item.amount || 0), 0);

    const savingItems = events.filter(item => item.kind === 'saving'
      && (!item.sourceAccountId || spendableIds.has(item.sourceAccountId)));
    const nisaItems = events.filter(item => item.kind === 'nisa'
      && (!item.sourceAccountId || spendableIds.has(item.sourceAccountId)));
    const savingTotal = savingItems.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const nisaTotal = nisaItems.reduce((sum, item) => sum + Number(item.amount || 0), 0);

    const salaryEvents = includeSalary
      ? collectSalaryEvents(input.workEntries || [], input.wage || {}, today, deadline, holidayOptions)
      : [];
    const salaryTotal = salaryEvents.reduce((sum, item) => sum + Number(item.totalAmount || 0), 0);

    const unpaidCard = calculateUnpaidCardUsage(input.transactions || [], today, {
      deadline, cards: input.cards || [], ...holidayOptions
    });

    // 二重計上していないことを確認できるよう、意図的に現金支出から外したカード引落を保持する
    const excludedCardDues = events.filter(item => item.kind === 'payment' && item.cardId);

    const total = cashAvailable
      + incomeTotal
      + salaryTotal
      - cashOutflow
      - unpaidCard.total
      - savingTotal
      - nisaTotal
      - defenseLine;

    const days = daysBetween(today, deadline);
    const dailyDays = Math.max(days, 1);
    const daily = total >= 0 ? Math.floor(total / dailyDays) : Math.ceil(total / dailyDays);

    return {
      today,
      deadline,
      days,
      dailyDays,
      daily,
      total, // 不足しても0円に丸めない
      cashAvailable,
      spendableAccounts: spendable.map(item => ({ id: item.id, name: item.name, role: item.role, balance: Number(item.currentBalance || 0) })),
      incomeTotal,
      incomeItems,
      salaryTotal,
      salaryEvents,
      cashOutflow,
      cashOutflowItems,
      unpaidCardTotal: unpaidCard.total,
      unpaidCardCount: unpaidCard.count,
      unpaidCardItems: unpaidCard.items,
      unpaidCardByCard: unpaidCard.byCard,
      unpaidCardWithinDeadline: unpaidCard.withinDeadlineTotal,
      unpaidCardBeyondDeadline: unpaidCard.beyondDeadlineTotal,
      unpaidCardBeyondDeadlineItems: unpaidCard.beyondDeadlineItems,
      unpaidCardEstimated: unpaidCard.estimatedTotal,
      unpaidCardEstimatedItems: unpaidCard.estimatedItems,
      unpaidCardGroups: unpaidCard.groups,
      cardSuppressedTotal: unpaidCard.suppressedTotal,
      cardSuppressedItems: unpaidCard.suppressedItems,
      cardConflicts: unpaidCard.conflicts,
      excludedCardDues,
      excludedCardDueTotal: excludedCardDues.reduce((sum, item) => sum + Number(item.amount || 0), 0),
      savingTotal,
      savingItems,
      nisaTotal,
      nisaItems,
      defenseLine,
      breakdown: [
        { key: 'cash', label: '現在使える現金', amount: cashAvailable, direction: 'in' },
        { key: 'income', label: '期限までの収入', amount: incomeTotal, direction: 'in' },
        { key: 'salary', label: '期限までの給与', amount: salaryTotal, direction: 'in' },
        { key: 'cashOut', label: '期限までの現金支出', amount: -cashOutflow, direction: 'out' },
        { key: 'unpaidCard', label: '未払いのカード利用', amount: -unpaidCard.total, direction: 'out' },
        { key: 'saving', label: '期限までの貯金', amount: -savingTotal, direction: 'out' },
        { key: 'nisa', label: '期限までのNISA', amount: -nisaTotal, direction: 'out' },
        { key: 'defense', label: '最低限残す金額', amount: -defenseLine, direction: 'out' }
      ]
    };
  }

  /* ============================================================
   * 10b. 将来の期間に使える金額
   *      「今使える金額」の派生。開始日時点の予測残高を出発点にして、
   *      その期間だけの収支で試算する。
   * ========================================================== */

  function calculateFutureSpendable(input = {}, range = {}) {
    const today = input.today;
    if (!today) throw new Error('today は必須です');
    const startDate = range.startDate || today;
    const endDate = range.endDate;
    if (!endDate) throw new Error('endDate は必須です');
    if (endDate < startDate) throw new Error('終了日は開始日より後にしてください');

    const accounts = Array.isArray(input.accounts) ? input.accounts : [];
    let startingBalances = null;
    let basedOn = null;

    if (startDate > today) {
      // 開始日の前日までを走らせ、その時点の残高を出発点にする。
      // 開始日当日の予定は「使える金額」側で数えるため、ここでは含めない。
      const dayBefore = toDateString(addDays(parseLocalDate(startDate), -1));
      const check = calculateCashflowCheck({ ...input, endDate: dayBefore, includeSalary: true });
      const lastDay = check.timeline[check.timeline.length - 1];
      startingBalances = lastDay ? lastDay.byAccount : null;
      basedOn = {
        verdict: check.verdict,
        verdictLabel: check.verdictLabel,
        minBalance: check.minBalance,
        minBalanceDate: check.minBalanceDate,
        shortfallDate: check.shortfallDate
      };
    }

    const projectedAccounts = startingBalances
      ? accounts.map(item => ({
        ...item,
        currentBalance: Object.prototype.hasOwnProperty.call(startingBalances, item.id)
          ? startingBalances[item.id]
          : Number(item.currentBalance || 0)
      }))
      : accounts;

    // 開始日より前に引き落とされる分は、すでに残高へ反映済みなので除外する
    const transactions = (input.transactions || []).filter(item => !item.dueDate || item.dueDate >= startDate);

    const result = calculateSpendableAmount({
      ...input,
      accounts: projectedAccounts,
      transactions,
      today: startDate,
      deadline: endDate
    });

    return {
      ...result,
      isFuture: startDate > today,
      startDate,
      endDate,
      basedOn,
      startingBalances,
      startingCash: result.cashAvailable
    };
  }

  /* ============================================================
   * 11. シミュレーション
   * ========================================================== */

  /** 既存API。金額を使ったあとの残額と1日あたりの目安を返す。 */
  function simulateSpending(availableTotal, spendingAmount, remainingDays) {
    const total = Number(availableTotal) || 0;
    const spending = Math.max(Number(spendingAmount) || 0, 0);
    const days = Math.max(Math.trunc(Number(remainingDays) || 1), 1);
    const remaining = total - spending;
    const daily = remaining >= 0 ? Math.floor(remaining / days) : Math.ceil(remaining / days);
    return { spending, remaining, daily, days };
  }

  /**
   * 「いま○円使ったらどうなるか」を、今使える金額と支払い能力チェックの両方で試算する。
   * 実データは変更せず、仮の支出を1件足した入力で再計算する。
   */
  function simulateWhatIf(input = {}, plan = {}) {
    const amount = Math.max(Number(plan.amount) || 0, 0);
    const spendDate = plan.date || input.today;
    const cardId = plan.cardId || '';
    const primary = resolvePrimaryAccount(input.accounts || [], input.primaryAccountId);
    const sourceAccountId = plan.sourceAccountId || (primary ? primary.id : '');

    const draft = {
      id: 'whatif:draft',
      kind: 'payment',
      amount,
      transactionDate: spendDate,
      dueDate: cardId && plan.dueDate ? plan.dueDate : spendDate,
      status: 'planned',
      sourceAccountId,
      destinationAccountId: '',
      cardId,
      category: 'シミュレーション',
      memo: '仮の支出',
      affectsForecast: true,
      isWhatIf: true
    };

    const withDraft = { ...input, transactions: [...(input.transactions || []), draft] };
    const beforeSpendable = calculateSpendableAmount(input);
    const afterSpendable = calculateSpendableAmount(withDraft);
    const beforeCheck = calculateCashflowCheck(input);
    const afterCheck = calculateCashflowCheck(withDraft);

    return {
      amount,
      draft,
      spendable: {
        before: beforeSpendable.total,
        after: afterSpendable.total,
        difference: afterSpendable.total - beforeSpendable.total,
        dailyBefore: beforeSpendable.daily,
        dailyAfter: afterSpendable.daily
      },
      cashflow: {
        beforeVerdict: beforeCheck.verdict,
        afterVerdict: afterCheck.verdict,
        beforeMinBalance: beforeCheck.minBalance,
        afterMinBalance: afterCheck.minBalance,
        afterMinBalanceDate: afterCheck.minBalanceDate,
        becomesRisky: beforeCheck.verdict === 'ok' && afterCheck.verdict !== 'ok'
      },
      afterSpendable,
      afterCheck
    };
  }

  /* ============================================================
   * 12. 既存API（互換維持）
   * ========================================================== */

  function aggregateCardBills(transactions = [], cards = [], fromDate = '') {
    const cardsById = new Map(cards.map(card => [card.id, card]));
    const groups = new Map();
    transactions.forEach(transaction => {
      if (transaction.kind !== 'payment' || transaction.status !== 'planned' || !transaction.cardId || !transaction.dueDate) return;
      if (fromDate && transaction.dueDate < fromDate) return;
      const key = `${transaction.cardId}:${transaction.dueDate}`;
      const card = cardsById.get(transaction.cardId);
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          cardId: transaction.cardId,
          cardName: card?.name || '登録解除済みのカード',
          accountId: card?.accountId || transaction.sourceAccountId || '',
          dueDate: transaction.dueDate,
          total: 0,
          items: []
        });
      }
      const group = groups.get(key);
      group.total += Number(transaction.amount) || 0;
      group.items.push(transaction);
    });
    return [...groups.values()]
      .map(group => ({ ...group, count: group.items.length }))
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.cardName.localeCompare(b.cardName, 'ja'));
  }

  /**
   * 旧API互換。ただし給与ルールは暦月＋翌月15日（土日祝は前営業日）へ移行済みのため、
   * 内部では新ルールの計算結果を返す。
   */
  function calculateWageForecast(entries = [], wageSettings = {}, baseDate, options = {}) {
    const base = baseDate || toDateString(new Date());
    const monthOffset = Number(wageSettings.salaryMonthOffset) || DEFAULT_SALARY_MONTH_OFFSET;
    let paymentMonth = shiftMonthKey(monthKeyOf(base), 0);
    let salary = calculateSalaryByPaymentMonth(entries, paymentMonth, wageSettings, options);
    // 当月の支給日を過ぎていれば次の支給月を見る
    if (salary.paymentDate < base) {
      paymentMonth = shiftMonthKey(paymentMonth, 1);
      salary = calculateSalaryByPaymentMonth(entries, paymentMonth, wageSettings, options);
    }
    return {
      ...salary,
      startDate: salary.workStartDate,
      endDate: salary.workEndDate,
      monthOffset
    };
  }

  /* ============================================================
   * 明細の展開と、記録の期間集計
   * ========================================================== */

  /**
   * 請求総額の取引に紐づく明細を、利用時刻の新しい順に返す。
   *  - 確定済みの総額 : absorbedBy が自分を指している「吸収済み」の明細
   *  - 未確定の総額   : 同じカード・同じ請求サイクルにある明細（内数として計算から外れているもの）
   * 予定・記録のどちらの画面からでも同じ結果になる。
   */
  function detailsOfStatement(statement, transactions = [], cards = [], options = {}) {
    if (!statement || !statement.cardId) return [];
    if (entryTypeOf(statement) !== STATEMENT) return [];

    const absorbed = (transactions || []).filter(item => item && item.absorbedBy === statement.id);
    if (absorbed.length) return sortByUsageDesc(absorbed);

    const card = (cards || []).find(item => item.id === statement.cardId) || null;
    const cycle = cardBillingCycleOf(statement, card, options);
    if (!cycle) return [];
    const siblings = (transactions || []).filter(item => {
      if (!item || item.id === statement.id) return false;
      if (item.kind !== 'payment' || item.cardId !== statement.cardId) return false;
      if (entryTypeOf(item) !== ITEMIZED) return false;
      if (item.status === 'cancelled') return false;
      if (item.absorbedBy && item.absorbedBy !== statement.id) return false;
      return cardBillingCycleOf(item, card, options) === cycle;
    });
    return sortByUsageDesc(siblings);
  }

  /** 記録の集計で「支出」に数える取引か */
  function isExpenseKind(transaction) {
    if (transaction.kind === 'payment') return true;
    // 自分の口座どうしの移動は、家計全体では減っていないので数えない
    if (transaction.kind === 'transfer') return transaction.transferType === 'external';
    return false;
  }

  /**
   * 期間内の記録を集計する。円グラフと収支の表示に使う。
   *
   * 二重計上を防ぐため、請求総額に吸収された明細(status: 'absorbed')は必ず除外する。
   * 貯金・NISAは支出に混ぜず、別枠として返す。
   *
   * @param {object} range   { startDate, endDate } 両端を含む
   * @param {object} options { basis: 'real' | 'gross' } real は立替分を差し引いた実質負担
   */
  function summarizePeriod(transactions = [], range = {}, options = {}) {
    const startDate = range.startDate || '';
    const endDate = range.endDate || '';
    const basis = options.basis === 'gross' ? 'gross' : 'real';
    const statuses = options.statuses instanceof Set
      ? options.statuses
      : new Set(Array.isArray(options.statuses) && options.statuses.length ? options.statuses : ['settled']);

    const inRange = (transactions || []).filter(transaction => {
      if (!transaction) return false;
      if (transaction.status === ABSORBED || transaction.status === 'cancelled') return false;
      if (!statuses.has(transaction.status)) return false;
      const date = transaction.dueDate || '';
      if (!date) return false;
      if (startDate && date < startDate) return false;
      if (endDate && date > endDate) return false;
      return true;
    });

    const buckets = {
      income: new Map(),
      expense: new Map(),
      saving: new Map()
    };
    let lendingTotal = 0;

    inRange.forEach(transaction => {
      const gross = Math.abs(Number(transaction.amount || 0));
      const lending = Math.abs(Number(transaction.lendingAmount || 0));
      if (['income', 'reimbursement'].includes(transaction.kind)) {
        addToBucket(buckets.income, transaction.category || '収入', gross);
        return;
      }
      if (['saving', 'nisa'].includes(transaction.kind)) {
        addToBucket(buckets.saving, transaction.kind === 'nisa' ? 'NISA' : '貯金', gross);
        return;
      }
      if (!isExpenseKind(transaction)) return;
      lendingTotal += lending;
      const amount = basis === 'gross' ? gross : Math.max(gross - lending, 0);
      if (amount <= 0) return;
      addToBucket(buckets.expense, transaction.category || 'その他', amount);
    });

    const income = finalizeBucket(buckets.income);
    const expense = finalizeBucket(buckets.expense);
    const saving = finalizeBucket(buckets.saving);

    return {
      startDate,
      endDate,
      basis,
      income,
      expense,
      saving,
      lendingTotal,
      net: income.total - expense.total,
      count: inRange.length
    };
  }

  function addToBucket(map, label, amount) {
    const key = label || 'その他';
    map.set(key, (map.get(key) || 0) + amount);
  }

  function finalizeBucket(map) {
    const categories = [...map.entries()]
      .map(([label, amount]) => ({ label, amount }))
      .sort((a, b) => b.amount - a.amount || a.label.localeCompare(b.label, 'ja'));
    const total = categories.reduce((sum, item) => sum + item.amount, 0);
    return {
      total,
      categories: categories.map(item => ({ ...item, ratio: total > 0 ? item.amount / total : 0 }))
    };
  }

  /** 'YYYY-MM' の初日と末日を返す（期間指定の初期値に使う） */
  function monthRangeOf(monthKey) {
    const { year, monthIndex } = parseMonthKey(monthKey);
    return {
      startDate: toDateString(dateAt(year, monthIndex, 1)),
      endDate: toDateString(dateAt(year, monthIndex, daysInMonth(year, monthIndex)))
    };
  }

  /* ============================================================
   * 9. レシート明細と「買ったものの結末」
   * ------------------------------------------------------------
   * レシート明細は state に入れず、Firestoreのサブコレクションだけで持つ。
   * ここに置くのは、その配列を受け取って数えるだけの純粋関数。
   * 日付は必ず日本時間で扱う（ISO文字列は jstDateStringOf を通す）。
   * ========================================================== */

  /** 明細行に使えるカテゴリ。表示順もこのとおり。 */
  const RECEIPT_CATEGORIES = Object.freeze([
    '食品', '飲料', '調味料', '日用品', '消耗品', '外食',
    '交通', 'サービス', '書籍', '衣料', '雑貨', 'その他'
  ]);

  /** 既定で「ふりかえりで聞く」カテゴリ（食べ物と、使って減るもの） */
  const OUTCOME_TRACKED_CATEGORIES = Object.freeze(['食品', '飲料', '調味料', '日用品', '消耗品']);

  /** 消費が遅いので、ふりかえりを遅らせるカテゴリ */
  const DAILY_GOODS_CATEGORIES = Object.freeze(['日用品', '消耗品']);

  /** カテゴリに関わらず既定で聞く金額の下限（5,000円ちょうどを含む） */
  const OUTCOME_TRACK_AMOUNT = 5000;

  /** outcome ごとの「無駄と数える割合」。ここに無い値は無駄と数えない。 */
  const WASTE_RATIO = Object.freeze({
    in_stock: 0,      // まだある（既定値）
    consumed: 0,      // 使い切った
    expired: 1,       // 期限切れで捨てた
    discarded: 1,     // 使わないまま処分した
    unused: 0.5,      // 残っているが使う見込みがない
    unnecessary: 1    // そもそも不要だった
  });

  const RECEIPT_OUTCOMES = Object.freeze(Object.keys(WASTE_RATIO));

  /**
   * 明細行1件の無駄金額。
   * 半額扱い(unused)の端数は切り捨てる。金額が0以下、または見覚えのない outcome は0。
   */
  function wasteAmountOf(item) {
    const amount = Number(item?.amount || 0);
    if (!Number.isFinite(amount) || amount <= 0) return 0;
    const ratio = WASTE_RATIO[String(item?.outcome || 'in_stock')];
    if (!ratio) return 0;
    if (ratio === 1) return amount;
    return Math.floor(amount * ratio);
  }

  /**
   * その行をふりかえりで聞くかどうかの既定値。
   * 高額な買い物は、カテゴリに関わらず「無駄だったか」を確認する価値があるので必ず聞く。
   * ユーザーが行ごとに手で切り替えた場合は、この判定より手動の値を優先する（保存側の責任）。
   */
  function classifyOutcomeTracked(input = {}) {
    const amount = Number(input?.amount || 0);
    if (Number.isFinite(amount) && amount >= OUTCOME_TRACK_AMOUNT) return true;
    return OUTCOME_TRACKED_CATEGORIES.includes(String(input?.category || ''));
  }

  /**
   * 明細行の基準日を日本時間の 'YYYY-MM-DD' で返す。
   *   ① 結末を記録した日(outcomeAt) … 「まだある」と答えるたびに更新されるので、次に聞く起点になる
   *   ② 購入日(purchasedAt)         … レシート本体から呼び出し側が写しておく
   *   ③ 作成日(createdAt)
   */
  function receiptItemDateOf(item) {
    return jstDateStringOf(item?.outcomeAt)
      || String(item?.purchasedAt || '')
      || jstDateStringOf(item?.createdAt)
      || '';
  }

  /**
   * 期間内の廃棄額をまとめる。
   * 期間の判定日は receiptItemDateOf（結末を記録した日、無ければ購入日）。
   * from / to は 'YYYY-MM-DD' で、どちらも含む。空文字なら片側を制限しない。
   */
  function summarizeWaste(receiptItems = [], range = {}) {
    const from = range?.from || '';
    const to = range?.to || '';
    const inRange = (receiptItems || []).filter(item => {
      const date = receiptItemDateOf(item);
      if (!date) return false;
      if (from && date < from) return false;
      if (to && date > to) return false;
      return true;
    });

    const outcomes = {};
    RECEIPT_OUTCOMES.forEach(key => { outcomes[key] = 0; });
    const byCategory = new Map();
    let total = 0;
    let wastedCount = 0;

    inRange.forEach(item => {
      const outcome = String(item?.outcome || 'in_stock');
      outcomes[outcome] = (outcomes[outcome] || 0) + 1;
      const waste = wasteAmountOf(item);
      if (waste <= 0) return;
      total += waste;
      wastedCount += 1;
      const label = String(item?.category || '') || 'その他';
      byCategory.set(label, (byCategory.get(label) || 0) + waste);
    });

    const categories = [...byCategory.entries()]
      .map(([label, amount]) => ({ label, amount }))
      .sort((a, b) => b.amount - a.amount || a.label.localeCompare(b.label, 'ja'))
      .map(item => ({ ...item, ratio: total > 0 ? item.amount / total : 0 }));

    return { from, to, total, count: inRange.length, wastedCount, categories, outcomes };
  }

  /* ---------- 品名の名寄せ ----------
   * レシートでは「もやし」「ﾓﾔｼ」「モヤシ」「もやし2P」が全部別の行になる。
   * 寄せないと「繰り返し捨てているもの」が出せないので、2段構えでまとめる。
   *   ① normalizeItemName … 意味を判断しない、確実に同じと言える変換だけ
   *   ② itemAliases       … ①で寄らないもの（緑豆もやし→もやし）はユーザーの操作から学ぶ
   * ②を自動でやると別物を勝手に同じ扱いにしてしまうため、機械側は絶対に踏み込まない。
   */

  /** 末尾に付く数量・規格の表記。ひらがな化した後に当てるので、ひらがな形も並べる。 */
  const ITEM_QUANTITY_SUFFIX = /(\d+(\.\d+)?)\s*(個|本|枚|袋|ふくろ|パック|ぱっく|入り|入|kg|ml|g|l|リットル|りっとる|cc|束|玉|房|尾|切れ|人前|コ|こ|ご|p)$/;

  /** 先頭に付く店舗記号（軽減税率の印など） */
  const ITEM_LEADING_MARK = /^[*＊※#＃\-‐・]+/;

  /** 残す文字。ひらがなは「ゖ」まで取るので「ヴ→ゔ」も落とさない。 */
  const ITEM_ALLOWED_CHARS = /[^ぁ-ゖー一-龥0-9a-z]/g;

  /**
   * 品名を、意味を判断せずに寄せる。
   * 長音符「ー」は変換も削除もしない（消すと「コーヒー」が「こひ」になり別語と衝突する）。
   * 潰しすぎて空になったら、元の表記をトリムして返す。
   */
  function normalizeItemName(raw) {
    const source = String(raw ?? '');
    let text = source.normalize('NFKC');
    text = text.replace(/[\u30A1-\u30F6]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60));
    text = text.toLowerCase();
    text = text.replace(ITEM_LEADING_MARK, '');
    // 「もやし2P 3個」のように重なることがあるので、無くなるまで剥がす
    let previous = null;
    while (text !== previous) {
      previous = text;
      text = text.replace(ITEM_QUANTITY_SUFFIX, '').trim();
    }
    text = text.replace(ITEM_ALLOWED_CHARS, '');
    return text || source.trim();
  }

  /**
   * 別名辞書を引きやすい形に整える。
   * 配列・Map・オブジェクトのどれで渡されても同じ結果になる。
   * すでに整えた索引を渡されたらそのまま使う（毎行作り直さないため）。
   */
  function aliasIndexOf(aliases) {
    if (aliases && aliases.__aliasIndex === true) return aliases;
    const list = Array.isArray(aliases) ? aliases
      : (aliases instanceof Map) ? [...aliases.values()]
        : (aliases && typeof aliases === 'object') ? Object.values(aliases)
          : [];
    const byAliasKey = new Map();
    const canonicalNames = new Map();
    list.forEach(entry => {
      if (!entry || typeof entry !== 'object') return;
      const aliasKey = String(entry.aliasKey || entry.id || '').trim();
      const canonicalName = String(entry.canonicalName || '').trim();
      const canonicalKey = String(entry.canonicalKey || '').trim() || normalizeItemName(canonicalName);
      if (!aliasKey || !canonicalKey) return;
      byAliasKey.set(aliasKey, { aliasKey, canonicalKey, canonicalName: canonicalName || canonicalKey });
      if (canonicalName) canonicalNames.set(canonicalKey, canonicalName);
    });
    return { __aliasIndex: true, byAliasKey, canonicalNames, size: byAliasKey.size };
  }

  /**
   * 明細行1件の「まとめ先」のキー。
   * 辞書は1段だけ辿る。A→B→C と連鎖していても2段目は見ないので、
   * A→B→A のような循環があっても止まらなくなることはない。
   */
  function resolveItemKey(item, aliases) {
    const base = normalizeItemName(item?.name || item?.rawName || '');
    const hit = aliasIndexOf(aliases).byAliasKey.get(base);
    if (!hit) return base;
    return hit.canonicalKey || base;
  }

  /**
   * 「同じものを繰り返し捨てていないか」を品名でまとめる。
   * 一度も捨てていないものは並べても意味がないので落とす。
   * 並び順は 廃棄回数の多い順 → 同数なら廃棄額の多い順 → それも同じなら名前順。
   * options.aliases を渡すと resolveItemKey でまとめ、表示名は辞書の canonicalName、
   * 無ければグループ内で最も多かった rawName（同数なら先に出てきたもの）を使う。
   * aliases を渡さないときは、これまでどおり表記そのままでまとめる。
   */
  function repeatedWasteRanking(receiptItems = [], options = {}) {
    const limit = Number.isFinite(Number(options?.limit)) ? Math.max(Number(options.limit), 0) : 5;
    const aliases = aliasIndexOf(options?.aliases);
    const groups = new Map();
    (receiptItems || []).forEach(item => {
      const label = String(item?.name || item?.rawName || '').trim();
      if (!label) return;
      const key = aliases.size ? (resolveItemKey(item, aliases) || label) : label;
      const group = groups.get(key) || { key, name: '', purchaseCount: 0, wasteCount: 0, wasteTotal: 0, labels: new Map() };
      const raw = String(item?.rawName || item?.name || '').trim() || label;
      group.labels.set(raw, (group.labels.get(raw) || 0) + 1);
      group.purchaseCount += 1;
      const waste = wasteAmountOf(item);
      if (waste > 0) {
        group.wasteCount += 1;
        group.wasteTotal += waste;
      }
      groups.set(key, group);
    });
    return [...groups.values()]
      .filter(group => group.wasteCount > 0)
      .map(group => {
        const top = [...group.labels.entries()].reduce((best, entry) => (entry[1] > best[1] ? entry : best));
        return {
          key: group.key,
          name: aliases.canonicalNames.get(group.key) || top[0],
          purchaseCount: group.purchaseCount,
          wasteCount: group.wasteCount,
          wasteTotal: group.wasteTotal
        };
      })
      .sort((a, b) => b.wasteCount - a.wasteCount || b.wasteTotal - a.wasteTotal || a.name.localeCompare(b.name, 'ja'))
      .slice(0, limit);
  }

  /**
   * ふりかえりで聞く明細行を返す。
   *  条件 ① outcomeTracked が true
   *      ② outcome がまだ 'in_stock'（未記入も「まだある」として扱う）
   *      ③ 基準日から minDays〜maxDays 日経過（両端を含む）
   *  日用品・消耗品は減りが遅いので dailyGoodsMinDays 日以降にずらす。
   *  そのときの上限は、聞く期間の長さ(maxDays - minDays)を保ったまま後ろへ動かす。
   *  基準日は receiptItemDateOf なので、「まだある」と答えて outcomeAt を更新すると
   *  その日から数え直しになり、minDays 日後にもう一度出てくる。
   *  古い順（基準日の早い順）に limit 件まで。
   */
  function dueForReview(receiptItems = [], options = {}) {
    const todayDate = options?.today || jstToday();
    const minDays = Number.isFinite(Number(options?.minDays)) ? Number(options.minDays) : 7;
    const maxDays = Number.isFinite(Number(options?.maxDays)) ? Number(options.maxDays) : 21;
    const dailyGoodsMinDays = Number.isFinite(Number(options?.dailyGoodsMinDays)) ? Number(options.dailyGoodsMinDays) : 30;
    const limit = Number.isFinite(Number(options?.limit)) ? Math.max(Number(options.limit), 0) : 10;
    const windowDays = Math.max(maxDays - minDays, 0);

    return (receiptItems || [])
      .map(item => {
        if (item?.outcomeTracked !== true) return null;
        if (String(item?.outcome || 'in_stock') !== 'in_stock') return null;
        const baseDate = receiptItemDateOf(item);
        if (!baseDate) return null;
        let elapsedDays = 0;
        try { elapsedDays = daysBetween(baseDate, todayDate); } catch (error) { return null; }
        const slow = DAILY_GOODS_CATEGORIES.includes(String(item?.category || ''));
        const from = slow ? dailyGoodsMinDays : minDays;
        const to = slow ? Math.max(maxDays, dailyGoodsMinDays + windowDays) : maxDays;
        if (elapsedDays < from || elapsedDays > to) return null;
        return { ...item, baseDate, elapsedDays };
      })
      .filter(Boolean)
      .sort((a, b) => a.baseDate.localeCompare(b.baseDate) || String(a.id || '').localeCompare(String(b.id || '')))
      .slice(0, limit);
  }

  const engine = Object.freeze({
    // 日付
    parseLocalDate, toDateString, addDays, daysBetween, daysInMonth,
    monthKeyOf, shiftMonthKey, calendarMonthRange, monthRangeOf,
    // 日本時間(JST)と利用時刻
    jstDateStringOf, jstTimeStringOf, jstToday, usageInstantOf, sortByUsageDesc,
    // 祝日・営業日
    japaneseHolidayName, isJapaneseHoliday, isJapaneseBusinessDay,
    previousBusinessDay, nextBusinessDay, holidaysForYear,
    // カード
    calculateCardPaymentDate, nextCardPaymentDate, calculateUnpaidCardUsage, aggregateCardBills,
    closingMonthOf, cardBillingCycleOf, groupCardCharges, detailsOfStatement,
    // 記録の集計
    summarizePeriod,
    // 給与
    calculateSalaryPaymentDate, calculateSalaryByPaymentMonth, paymentMonthForWorkDate, collectSalaryEvents,
    // 予定
    expandScheduledTransactions,
    // 2つの主計算（必ず別関数・別結果）
    calculateCashflowCheck, calculateSpendableAmount,
    // 「今使える金額」の派生
    calculateFutureSpendable,
    // レシート明細（buy → 結末 → 無駄）
    RECEIPT_CATEGORIES, RECEIPT_OUTCOMES, receiptItemDateOf,
    wasteAmountOf, classifyOutcomeTracked, summarizeWaste, repeatedWasteRanking, dueForReview,
    // 品名の名寄せ
    normalizeItemName, resolveItemKey,
    // 補助
    isExternalTransfer, accountDeltasFor,
    suggestShortfallResolution, simulateSpending, simulateWhatIf,
    // 互換
    calculateWageForecast
  });

  root.FinanceEngine = engine;
  if (typeof module !== 'undefined' && module.exports) module.exports = engine;
})(typeof window !== 'undefined' ? window : globalThis);
