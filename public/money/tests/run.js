#!/usr/bin/env node
/**
 * Nodeで動くテストを全部まとめて実行する。
 * 成功時はコンパクトなJSONだけを出力し、1つでも落ちたら終了コード1で詳細を出す。
 *
 * 追加したテストファイルは SUITES に1行足すだけで回るようになる。
 */
const path = require('path');
const { spawnSync } = require('child_process');

const engine = require(path.join(__dirname, '..', 'finance-engine.js'));
const { createSuite } = require(path.join(__dirname, 'finance-engine.tests.js'));

/** JSONを1行だけ出力する独立スクリプト形式のテスト */
const SUITES = [
  'card-netting.test.js',
  'records-view.test.js',
  'gas-parser.test.js',
  'app-contract.test.js',
  'receipt.test.js'
];

const results = [];

/* ---- finance-engine.tests.js はこのプロセス内で実行する ---- */
const cases = createSuite(engine);
const engineFailures = [];
cases.forEach(item => {
  try { item.fn(); } catch (error) { engineFailures.push({ name: item.name, message: error.message }); }
});
results.push({
  suite: 'finance-engine',
  total: cases.length,
  passed: cases.length - engineFailures.length,
  failed: engineFailures.length,
  failures: engineFailures
});

/* ---- 残りは単体でも動くスクリプトなので、子プロセスで実行して結果を集める ---- */
SUITES.forEach(file => {
  const full = path.join(__dirname, file);
  const run = spawnSync(process.execPath, [full], { encoding: 'utf8' });
  const output = `${run.stdout || ''}`.trim();
  let parsed = null;
  try { parsed = JSON.parse(output); } catch (error) { parsed = null; }
  if (!parsed) {
    results.push({
      suite: file.replace(/\.test\.js$/, ''),
      total: 0,
      passed: 0,
      failed: 1,
      failures: [{ name: file, message: `結果を読み取れませんでした: ${output || run.stderr || `exit=${run.status}`}` }]
    });
    return;
  }
  parsed.failures = parsed.failures || [];
  if (run.status !== 0 && !parsed.failures.length) {
    parsed.failures.push({ name: file, message: `終了コード ${run.status}` });
    parsed.failed = Math.max(Number(parsed.failed) || 0, 1);
  }
  results.push(parsed);
});

const total = results.reduce((sum, item) => sum + (Number(item.total) || 0), 0);
const failed = results.reduce((sum, item) => sum + (Number(item.failed) || 0), 0);
const summary = {
  suites: results.length,
  total,
  passed: total - failed,
  failed,
  bySuite: results.map(item => ({ suite: item.suite, total: item.total, failed: item.failed }))
};

if (failed === 0) {
  console.log(JSON.stringify(summary));
  process.exit(0);
}
summary.failures = results
  .filter(item => (item.failures || []).length)
  .map(item => ({ suite: item.suite, failures: item.failures }));
console.log(JSON.stringify(summary, null, 2));
process.exit(1);
