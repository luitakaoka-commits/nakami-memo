#!/usr/bin/env node
/**
 * 同居している3アプリ分のテストをまとめて実行する。
 *
 * 各テストは単体でも動くが、それぞれ置き場所も起動方法も違うため、
 * CI（.github/workflows/ci.yml）と手元の両方から同じ1コマンドで叩けるようにする。
 * どれか1つでも落ちたら終了コード1。
 *
 * 実行: npm test
 *
 * ここに載っていないテスト:
 *   public/money/tests/ui/     … playwright が要る（別途 npm install playwright）
 *   public/shared/serving-check.mjs … 起動中のサーバー（BASE）が要る
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHARED_DIR = path.join(ROOT, "public", "shared");

const SUITES = [
  { name: "money", cwd: path.join(ROOT, "public", "money"), file: "tests/run.js" },
  { name: "recipe", cwd: path.join(ROOT, "public", "recipe"), file: "tests/row-template.test.js" },
  { name: "app-switcher", cwd: SHARED_DIR, file: "switcher.test.mjs", env: { SHARED_DIR } },
  { name: "install", cwd: SHARED_DIR, file: "install.test.mjs" },
  { name: "rules", cwd: SHARED_DIR, file: "rules.test.mjs" },
  { name: "migrate", cwd: SHARED_DIR, file: "migrate.test.mjs" },
];

const failures = [];

for (const suite of SUITES) {
  console.log(`\n=== ${suite.name} ===`);
  const run = spawnSync(process.execPath, [suite.file], {
    cwd: suite.cwd,
    env: { ...process.env, ...suite.env },
    stdio: "inherit",
  });
  if (run.error) {
    failures.push(`${suite.name}（起動できませんでした: ${run.error.message}）`);
  } else if (run.status !== 0) {
    failures.push(`${suite.name}（終了コード ${run.status ?? `シグナル ${run.signal}`}）`);
  }
}

if (failures.length) {
  console.error(`\n失敗したテスト: ${failures.join(" / ")}`);
  process.exit(1);
}

console.log(`\n${SUITES.length}件のテストがすべて通りました。`);
