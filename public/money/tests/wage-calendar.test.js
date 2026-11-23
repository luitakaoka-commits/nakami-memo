/* 平日時給・土日祝時給（2026-11-24 ユーザー要望）。
 * 勤務日が平日か土日祝かを日本のカレンダー（振替休日を含む）で決め、それぞれの時給を使う。
 * どちらも未設定なら今までどおり基本時給、日ごとの変更がいちばん優先（今の機能は残す）。 */
const assert = require('node:assert/strict');
const engine = require('../finance-engine.js');
const fs = require('node:fs');
const path = require('node:path');

const checks = [];
const test = (name, fn) => { try { fn(); checks.push({ name, pass: true }); } catch (e) { checks.push({ name, pass: false, message: e.message }); } };
const wage = { hourlyRate: 1100, weekdayHourlyRate: 1200, holidayHourlyRate: 1400, salaryPaymentDay: 15, salaryMonthOffset: 1 };

test('平日は平日時給、土日は土日祝時給', () => {
  assert.deepEqual(engine.hourlyRateForDate('2026-11-20', wage), { rate: 1200, kind: 'weekday', holidayName: '' }); // 金
  assert.equal(engine.hourlyRateForDate('2026-11-21', wage).rate, 1400); // 土
  assert.equal(engine.hourlyRateForDate('2026-11-22', wage).rate, 1400); // 日
});

test('祝日と振替休日は土日祝時給（日本のカレンダー）', () => {
  const labor = engine.hourlyRateForDate('2026-11-23', wage); // 勤労感謝の日（月）
  assert.equal(labor.rate, 1400);
  assert.equal(labor.kind, 'holiday');
  assert.ok(labor.holidayName.includes('勤労感謝'), labor.holidayName);
  assert.equal(engine.hourlyRateForDate('2026-05-06', wage).rate, 1400); // 振替休日（憲法記念日が日曜）
  assert.equal(engine.hourlyRateForDate('2026-11-24', wage).rate, 1200); // 翌日の火曜は平日
});

test('設定で足した臨時の休日も土日祝として扱う', () => {
  assert.equal(engine.hourlyRateForDate('2026-11-25', wage, { overrides: { '2026-11-25': '臨時の休日' } }).rate, 1400);
});

test('今の機能はそのまま：未設定なら基本時給、その日だけの時給がいちばん優先', () => {
  assert.deepEqual(engine.hourlyRateForDate('2026-11-21', { hourlyRate: 1100 }), { rate: 1100, kind: 'base', holidayName: '' });
  assert.equal(engine.hourlyRateForDate('2026-11-20', { hourlyRate: 1100, holidayHourlyRate: 1400 }).rate, 1100, '平日時給が空なら基本時給');
  assert.deepEqual(engine.hourlyRateForDate('2026-11-21', wage, {}, 1500), { rate: 1500, kind: 'override', holidayName: '' });
});

test('給与の見込みは、勤務日ごとの時給で計算する', () => {
  const entries = [
    { id: 'a', date: '2026-11-20', hours: 5, status: 'worked' },   // 平日 1200 × 5 = 6000
    { id: 'b', date: '2026-11-23', hours: 4, status: 'planned' },  // 祝日 1400 × 4 = 5600
    { id: 'c', date: '2026-11-21', hours: 2, status: 'planned', hourlyRateOverride: 1000 } // 変更 1000 × 2 = 2000
  ];
  const salary = engine.calculateSalaryByPaymentMonth(entries, '2026-12', wage);
  assert.equal(salary.confirmedAmount, 6000);
  assert.equal(salary.plannedAmount, 7600);
  assert.deepEqual(salary.entries.map(e => e.rateKind), ['weekday', 'override', 'holiday']);
});

test('画面：シフトの追加は「勤務予定」から、設定に平日時給・土日祝時給がある', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  assert.ok(app.includes("$('#work-status').value = current?.status || 'planned';"), 'シフトの追加が勤務予定から始まらない');
  assert.ok(app.includes('id="wage-weekday-rate"') && app.includes('id="wage-holiday-rate"'), '設定に平日時給・土日祝時給が無い');
  assert.ok(app.includes("weekdayHourlyRate: Number($('#wage-weekday-rate')"), '平日時給を保存していない');
});

test('画面：確定・保存の画面を開いても、金額欄に自動で入らない（キーボードを出さない）', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  assert.ok(!app.includes("$('#event-amount').focus()"), '記録の画面で金額欄に入っている');
  assert.ok(!app.includes("form.elements.namedItem('amount').focus()"), '引落の確定で金額欄に入っている');
});

const failures = checks.filter(c => !c.pass);
console.log(JSON.stringify({ suite: 'wage-calendar', total: checks.length, passed: checks.length - failures.length, failed: failures.length, ...(failures.length ? { failures } : {}) }));
if (failures.length) process.exitCode = 1;
