/**
 * finance-engine の計算テスト。
 * Node（node tests/run.js）とブラウザ（tests.html）の両方から同じ定義を使う。
 */
(function attachTests(root) {
  'use strict';

  function createSuite(engine) {
    const cases = [];
    const test = (name, fn) => cases.push({ name, fn });

    function assert(condition, message) {
      if (!condition) throw new Error(message || '条件を満たしませんでした');
    }
    function equal(actual, expected, message) {
      if (actual !== expected) {
        throw new Error(`${message || '値が一致しません'}: expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
      }
    }

    const TODAY = '2026-08-25';
    const DEADLINE = '2026-09-14';

    const account = (id, name, role, balance, extra = {}) => ({
      id, name, role, currentBalance: balance,
      includeInSpendable: !['savings', 'investment'].includes(role),
      reserveAmount: 0, isPrimary: role === 'primary', ...extra
    });

    const tx = (over = {}) => ({
      id: over.id || `t${cases.length}_${Math.random().toString(36).slice(2, 8)}`,
      kind: 'payment', amount: 0, transactionDate: '', dueDate: '', status: 'planned',
      sourceAccountId: '', destinationAccountId: '', transferType: 'external',
      cardId: '', category: 'その他', memo: '', affectsForecast: true, ...over
    });

    const work = (date, hours, status = 'worked', rate = 0) => ({
      id: `w_${date}_${hours}_${status}`, date, hours, status, hourlyRateOverride: rate, memo: ''
    });

    const WAGE = { hourlyRate: 1200, salaryPaymentDay: 15, salaryMonthOffset: 1, depositAccountId: '' };

    /* ---------- 祝日・営業日エンジン ---------- */

    test('祝日エンジン: 2026年の主要な祝日を正しく判定する', () => {
      equal(engine.japaneseHolidayName('2026-01-01'), '元日', '元日');
      equal(engine.japaneseHolidayName('2026-01-12'), '成人の日', '成人の日は1月第2月曜');
      equal(engine.japaneseHolidayName('2026-03-20'), '春分の日', '春分の日');
      equal(engine.japaneseHolidayName('2026-09-23'), '秋分の日', '秋分の日');
      equal(engine.japaneseHolidayName('2026-10-12'), 'スポーツの日', 'スポーツの日は10月第2月曜');
      equal(engine.isJapaneseHoliday('2026-06-10'), false, '平日は祝日ではない');
    });

    test('祝日エンジン: 振替休日と国民の休日を扱える', () => {
      // 2026-05-03(憲法記念日)が日曜のため、5/4・5/5を飛ばして5/6が振替休日になる
      equal(engine.japaneseHolidayName('2026-05-06'), '振替休日', '連休をまたぐ振替休日');
      // 2026-09-21(敬老の日)と2026-09-23(秋分の日)に挟まれた9/22は国民の休日
      equal(engine.japaneseHolidayName('2026-09-21'), '敬老の日', '敬老の日は9月第3月曜');
      equal(engine.japaneseHolidayName('2026-09-22'), '国民の休日', '祝日に挟まれた平日');
    });

    /* ---------- 1. 残高が最低限残す金額を下回る ---------- */

    test('1. 未来の支払いで残高が最低限残す金額を下回る', () => {
      const accounts = [account('a1', '生活費口座', 'primary', 200000)];
      const check = engine.calculateCashflowCheck({
        today: TODAY, endDate: '2026-09-30', accounts, defenseLine: 150000,
        transactions: [tx({ kind: 'payment', amount: 80000, transactionDate: '2026-09-05', dueDate: '2026-09-05', sourceAccountId: 'a1', memo: '家賃' })]
      });
      equal(check.verdict, 'belowDefense', '判定は最低残高を下回る');
      equal(check.verdictLabel, '最低残高を下回る', '判定ラベル');
      equal(check.belowDefenseDate, '2026-09-05', '下回る日');
      equal(check.minBalance, 120000, '期間内の最低予測残高');
      equal(check.minBalanceDate, '2026-09-05', '最低残高になる日');
      assert(check.causes.length > 0 && check.causes[0].amount === 80000, '不足原因が抽出される');
    });

    /* ---------- 2. クレカ利用日と引落日を分ける ---------- */

    test('2. 支払い能力チェックはカード利用日で残高を減らさず、引落日に減らす', () => {
      const accounts = [account('a1', '生活費口座', 'primary', 300000)];
      const card = tx({ kind: 'payment', amount: 50000, transactionDate: '2026-08-26', dueDate: '2026-10-13', sourceAccountId: 'a1', cardId: 'c1', memo: 'カード利用' });
      const check = engine.calculateCashflowCheck({
        today: TODAY, endDate: '2026-10-31', accounts, defenseLine: 0,
        cards: [{ id: 'c1', name: 'メインカード', accountId: 'a1', closingDay: 15, paymentDay: 10, paymentMonthOffset: 1 }],
        transactions: [card]
      });
      const onUsage = check.timeline.find(day => day.date === '2026-08-26');
      const beforeDue = check.timeline.find(day => day.date === '2026-10-12');
      const onDue = check.timeline.find(day => day.date === '2026-10-13');
      equal(onUsage.primaryBalance, 300000, '利用日には残高が減らない');
      equal(beforeDue.primaryBalance, 300000, '引落前日まで残高は減らない');
      equal(onDue.primaryBalance, 250000, '引落日に残高が減る');
      equal(check.cardBills.length, 1, 'クレカ引落予定が一覧化される');
    });

    test('2b. 引落予定日は締め日当日を当月に含め、土日祝は翌営業日へ繰り下げる', () => {
      // 15日締め・翌月10日払い
      equal(engine.calculateCardPaymentDate('2026-08-15', 15, 10, 1), '2026-09-10', '締め日当日は当月締め');
      // 2026-10-10は土曜、10-12はスポーツの日のため10-13へ繰り下がる
      equal(engine.calculateCardPaymentDate('2026-08-16', 15, 10, 1), '2026-10-13', '締め日翌日は翌月締め＋休日繰り下げ');
      // 月末締め・月末払い（0は月末を意味する）
      equal(engine.calculateCardPaymentDate('2026-08-31', 0, 0, 1, { skipBusinessDayAdjustment: true }), '2026-09-30', '月末締め月末払い');
      // 支払月オフセット2（月末締め翌々月払い）
      equal(engine.calculateCardPaymentDate('2026-08-31', 0, 10, 2, { skipBusinessDayAdjustment: true }), '2026-10-10', '支払月オフセット2');
    });

    /* ---------- 3. 二重控除しない ---------- */

    test('3. 同じクレカ利用を「今使える金額」で二重控除しない', () => {
      const accounts = [account('a1', '生活費口座', 'primary', 300000)];
      const withinDue = tx({ kind: 'payment', amount: 30000, transactionDate: '2026-07-20', dueDate: '2026-09-10', sourceAccountId: 'a1', cardId: 'c1' });
      const beyondDue = tx({ kind: 'payment', amount: 50000, transactionDate: '2026-08-20', dueDate: '2026-10-13', sourceAccountId: 'a1', cardId: 'c1' });
      const result = engine.calculateSpendableAmount({
        today: TODAY, deadline: DEADLINE, accounts, defenseLine: 0,
        transactions: [withinDue, beyondDue]
      });
      equal(result.unpaidCardTotal, 80000, '未払いカード利用は合計80,000円');
      equal(result.cashOutflow, 0, '引落予定は現金支出に含めない');
      equal(result.excludedCardDueTotal, 30000, '期限内の引落は意図的に現金支出から除外している');
      equal(result.unpaidCardBeyondDeadline, 50000, '期限外に引き落とされる分を内訳に出す');
      equal(result.total, 300000 - 80000, 'カード利用は一度だけ差し引かれる');
    });

    /* ---------- 4. 未払いクレカが今使える金額に反映される ---------- */

    test('4. 実際に利用済みで未払いのカード額が即時に反映される', () => {
      const accounts = [account('a1', '生活費口座', 'primary', 200000)];
      const base = engine.calculateSpendableAmount({ today: TODAY, deadline: DEADLINE, accounts, defenseLine: 50000, transactions: [] });
      const used = engine.calculateSpendableAmount({
        today: TODAY, deadline: DEADLINE, accounts, defenseLine: 50000,
        transactions: [tx({ kind: 'payment', amount: 20000, transactionDate: '2026-08-24', dueDate: '2026-10-13', sourceAccountId: 'a1', cardId: 'c1' })]
      });
      equal(base.total, 150000, 'カード利用前');
      equal(used.total, 130000, 'カード利用直後に減る');
      // 未来の利用予定は「未払い実利用」に含めない。
      // これは明細(itemized)の話で、請求総額(statement)は締め済みのため登録時点から控除する。
      // entryType を省くと手入力＝請求総額として扱われるので、明細であることを明示する。
      const future = engine.calculateSpendableAmount({
        today: TODAY, deadline: DEADLINE, accounts, defenseLine: 50000,
        transactions: [tx({ kind: 'payment', amount: 20000, transactionDate: '2026-09-01', dueDate: '2026-10-13', sourceAccountId: 'a1', cardId: 'c1', entryType: 'itemized' })]
      });
      equal(future.unpaidCardTotal, 0, '利用日が未来の予定は未払い実利用に含めない');
    });

    test('4d. 利用日が不明な旧カード取引は未払い実利用として安全側に扱う', () => {
      const accounts = [account('a1', '生活費口座', 'primary', 200000)];
      const legacy = tx({ kind: 'payment', amount: 25000, transactionDate: '2026-09-10', dueDate: '2026-09-10', dateEstimated: true, sourceAccountId: 'a1', cardId: 'c1' });
      const result = engine.calculateSpendableAmount({ today: TODAY, deadline: DEADLINE, accounts, defenseLine: 0, transactions: [legacy] });
      equal(result.unpaidCardTotal, 25000, '利用日が未来の暫定値でも控除する');
      equal(result.unpaidCardEstimated, 25000, '利用日不明として内訳に出す');
      equal(result.total, 175000, '今使える金額へ反映される');
    });

    test('4b. 不足しても0円に丸めず負数で返す', () => {
      const accounts = [account('a1', '生活費口座', 'primary', 10000)];
      const result = engine.calculateSpendableAmount({ today: TODAY, deadline: DEADLINE, accounts, defenseLine: 50000, transactions: [] });
      equal(result.total, -40000, '負数のまま返す');
      assert(result.daily < 0, '1日あたりの目安も負数');
    });

    test('4c. 自分の口座間振替を全体キャッシュフローで二重控除しない', () => {
      const accounts = [account('a1', '生活費口座', 'primary', 200000), account('a2', '自由費口座', 'spending', 50000)];
      const check = engine.calculateCashflowCheck({
        today: TODAY, endDate: '2026-09-30', accounts, defenseLine: 0,
        transactions: [tx({ kind: 'transfer', transferType: 'internal', amount: 30000, transactionDate: '2026-09-01', dueDate: '2026-09-01', sourceAccountId: 'a1', destinationAccountId: 'a2' })]
      });
      const day = check.timeline.find(item => item.date === '2026-09-01');
      equal(day.totalBalance, 250000, '全口座合計は振替で変わらない');
      equal(day.primaryBalance, 170000, '送金元の口座別残高は減る');
      equal(day.byAccount.a2, 80000, '送金先の口座別残高は増える');
    });

    /* ---------- 5〜9. 給与の支給月と支給日 ---------- */

    test('5. 1月分のシフトが2月15日支給として集計される', () => {
      const entries = [work('2026-01-10', 5), work('2026-01-31', 4), work('2026-02-01', 8)];
      const salary = engine.calculateSalaryByPaymentMonth(entries, '2026-02', WAGE);
      equal(salary.workMonth, '2026-01', '勤務月は前月');
      equal(salary.workStartDate, '2026-01-01', '勤務月の開始は1日');
      equal(salary.workEndDate, '2026-01-31', '勤務月の終わりは末日');
      equal(salary.entries.length, 2, '2月のシフトは含めない');
      equal(salary.totalAmount, Math.round(9 * 1200), '1月分の合計金額');
      equal(salary.scheduledPaymentDate, '2026-02-15', '基本支給日は翌月15日');
    });

    test('6. 支給日が土曜日のとき前営業日へ繰り上がる', () => {
      // 2026-08-15 は土曜日
      const salary = engine.calculateSalaryByPaymentMonth([work('2026-07-01', 8)], '2026-08', WAGE);
      equal(salary.scheduledPaymentDate, '2026-08-15', '基本支給日');
      equal(salary.paymentDate, '2026-08-14', '土曜のため前日の金曜へ');
    });

    test('7. 支給日が日曜日のとき前営業日へ繰り上がる', () => {
      // 2026-02-15 は日曜日
      const salary = engine.calculateSalaryByPaymentMonth([work('2026-01-05', 8)], '2026-02', WAGE);
      equal(salary.scheduledPaymentDate, '2026-02-15', '基本支給日');
      equal(salary.paymentDate, '2026-02-13', '日曜のため前週の金曜へ');
    });

    test('8. 支給日が祝日のとき前営業日へ繰り上がる', () => {
      // 2024-07-15 は海の日（月曜）
      equal(engine.japaneseHolidayName('2024-07-15'), '海の日', '前提: 2024-07-15は海の日');
      const salary = engine.calculateSalaryByPaymentMonth([work('2024-06-03', 8)], '2024-07', WAGE);
      equal(salary.paymentDate, '2024-07-12', '祝日のため直前の金曜へ');
    });

    test('9. 月曜が祝日のとき前週の金曜日へ繰り上がる', () => {
      // 2025-09-15 は敬老の日（月曜）
      equal(engine.japaneseHolidayName('2025-09-15'), '敬老の日', '前提: 2025-09-15は敬老の日');
      const salary = engine.calculateSalaryByPaymentMonth([work('2025-08-04', 8)], '2025-09', WAGE);
      equal(salary.paymentDate, '2025-09-12', '土日を飛ばして前週金曜へ');
    });

    /* ---------- 10〜12. 過去・未来の集計と削除後の再計算 ---------- */

    test('10. 過去月・未来月の給与を支給月別に集計できる', () => {
      const entries = [
        work('2026-06-10', 6), // → 2026-07 支給
        work('2026-07-05', 4), // → 2026-08 支給
        work('2026-11-20', 5, 'planned') // → 2026-12 支給
      ];
      equal(engine.calculateSalaryByPaymentMonth(entries, '2026-07', WAGE).totalAmount, Math.round(6 * 1200), '過去月');
      equal(engine.calculateSalaryByPaymentMonth(entries, '2026-08', WAGE).totalAmount, Math.round(4 * 1200), '当月');
      equal(engine.calculateSalaryByPaymentMonth(entries, '2026-12', WAGE).totalAmount, Math.round(5 * 1200), '未来月');
      equal(engine.paymentMonthForWorkDate('2026-11-20', WAGE), '2026-12', '勤務日から支給月を求める');
      // 表示月を変えても現在月に戻らないこと（純粋関数のため入力どおりの月を返す）
      equal(engine.calculateSalaryByPaymentMonth(entries, '2026-07', WAGE).paymentMonth, '2026-07', '指定した支給月を保持する');
    });

    test('11. 勤務済み額と予定込み額を分けて集計する', () => {
      const entries = [work('2026-07-05', 4, 'worked'), work('2026-07-20', 6, 'planned'), work('2026-07-25', 3, 'worked', 1500)];
      const salary = engine.calculateSalaryByPaymentMonth(entries, '2026-08', WAGE);
      equal(salary.confirmedAmount, Math.round(4 * 1200) + Math.round(3 * 1500), '勤務済みの確定額（時給上書きを反映）');
      equal(salary.plannedAmount, Math.round(6 * 1200), '予定シフトの金額');
      equal(salary.totalAmount, salary.confirmedAmount + salary.plannedAmount, '見込み額は合計');
      equal(salary.workedHours, 7, '勤務済み時間');
      equal(salary.plannedHours, 6, '予定時間');
    });

    test('12. シフトを削除すると給与が即時に再計算される', () => {
      const entries = [work('2026-07-05', 4), work('2026-07-20', 6)];
      const before = engine.calculateSalaryByPaymentMonth(entries, '2026-08', WAGE);
      const after = engine.calculateSalaryByPaymentMonth(entries.filter(item => item.date !== '2026-07-20'), '2026-08', WAGE);
      equal(before.totalAmount, Math.round(10 * 1200), '削除前');
      equal(after.totalAmount, Math.round(4 * 1200), '削除後は再計算される');
      equal(after.entries.length, 1, '残るシフトは1件');
    });

    /* ---------- 給与のキャッシュフロー反映と不足解消提案 ---------- */

    test('給与の支給日と支給額がキャッシュフローに反映される', () => {
      const accounts = [account('a1', '生活費口座', 'primary', 100000)];
      const check = engine.calculateCashflowCheck({
        today: TODAY, endDate: '2026-09-30', accounts, defenseLine: 0,
        workEntries: [work('2026-08-01', 10)],
        wage: { ...WAGE, depositAccountId: 'a1' }
      });
      equal(check.salaryEvents.length, 1, '期間内の給与が1件');
      equal(check.salaryEvents[0].paymentDate, '2026-09-15', '9/15は火曜のためそのまま');
      const day = check.timeline.find(item => item.date === '2026-09-15');
      equal(day.primaryBalance, 100000 + Math.round(10 * 1200), '支給日に残高が増える');
    });

    test('不足解消の提案が振替元と金額を返す', () => {
      const accounts = [
        account('a1', '生活費口座', 'primary', 100000),
        account('a2', '自由費口座', 'spending', 40000),
        account('a3', '貯金口座', 'savings', 500000)
      ];
      const check = engine.calculateCashflowCheck({
        today: TODAY, endDate: '2026-09-30', accounts, defenseLine: 100000,
        transactions: [tx({ kind: 'payment', amount: 60000, transactionDate: '2026-09-05', dueDate: '2026-09-05', sourceAccountId: 'a1' })]
      });
      const plan = engine.suggestShortfallResolution(check, accounts);
      equal(plan.required, 60000, '必要額は最低残高までの不足分');
      equal(plan.covered, true, '解消できる');
      equal(plan.suggestions[0].accountId, 'a2', '自由費口座を優先する');
      equal(plan.suggestions[0].amount, 40000, '自由費口座から出せる分');
      equal(plan.suggestions[1].accountId, 'a3', '足りない分は貯金口座から');
      equal(plan.suggestions[1].amount, 20000, '残りの必要額');
    });

    test('シミュレーションが2つの計算の両方への影響を返す', () => {
      const input = {
        today: TODAY, deadline: DEADLINE, endDate: '2026-09-30',
        accounts: [account('a1', '生活費口座', 'primary', 200000)],
        defenseLine: 100000, transactions: []
      };
      const light = engine.simulateWhatIf(input, { amount: 50000, date: '2026-08-26' });
      equal(light.spendable.before, 100000, '使う前');
      equal(light.spendable.after, 50000, '使った後');
      equal(light.spendable.difference, -50000, '差分');
      equal(light.cashflow.becomesRisky, false, '最低残高を割らない金額では警告にならない');

      const heavy = engine.simulateWhatIf(input, { amount: 150000, date: '2026-08-26' });
      equal(heavy.spendable.after, -50000, '使いすぎた場合は負数になる');
      equal(heavy.cashflow.becomesRisky, true, '最低残高を割ると支払い能力チェックが警告に変わる');
      equal(heavy.cashflow.afterVerdict, 'belowDefense', '判定が最低残高割れへ変わる');
    });

    test('定期予定を期間内へ展開し、実取引と二重にしない', () => {
      const plans = [{ id: 'p1', kind: 'payment', name: '家賃', amount: 60000, dayOfMonth: 27, sourceAccountId: 'a1', isActive: true }];
      const expanded = engine.expandScheduledTransactions(plans, '2026-08-25', '2026-10-31', []);
      equal(expanded.length, 3, '8/27・9/27・10/27の3件');
      equal(expanded[0].dueDate, '2026-08-27', '最初の展開日');
      const deduped = engine.expandScheduledTransactions(plans, '2026-08-25', '2026-10-31', [
        tx({ dueDate: '2026-09-27', recurringPlanId: 'p1', amount: 60000 })
      ]);
      equal(deduped.length, 2, '実取引がある日は展開しない');
    });

    return cases;
  }

  root.FinanceEngineTests = { createSuite };
  if (typeof module !== 'undefined' && module.exports) module.exports = { createSuite };
})(typeof window !== 'undefined' ? window : globalThis);
