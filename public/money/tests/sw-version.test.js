#!/usr/bin/env node
/**
 * お金管理の画面のファイルを変えたのに、sw.js の VERSION を上げ忘れていないかを確かめる。
 *
 * sw.js はキャッシュ優先なので、VERSION を上げない限り、一度開いた端末には古いファイルが出続ける。
 * 実際に 22 のまま finance-engine.js を2回直していて、スマホに届いていなかった（2026-09-14 に発覚）。
 *
 * やっていること: 画面のファイルの中身をまとめてハッシュにし、sw-shell-hashes.json の
 * 「今の VERSION の行」と一致するかを見る。一致しなければ、中身が変わったのに VERSION が同じ。
 *
 * 落ちたら: sw.js の VERSION を上げ（index.html と app.js の ?v= も合わせる）、
 * sw-shell-hashes.json に新しい VERSION の行を足す（値は失敗メッセージに出る）。
 * 既存の行を書き換えて通すのは禁止。それをすると、この確認の意味がなくなる。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
/* sw.js がキャッシュ優先で抱えるファイル。sw.js の ASSETS と揃える。 */
const SHELL = ['index.html', 'styles.css', 'finance-engine.js', 'app.js', 'firebase-sync.js', 'icons/app-icon.svg'];

const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
const version = (sw.match(/const VERSION = '(\d+)'/) || [])[1];
const hash = crypto.createHash('sha256');
SHELL.forEach(file => {
  hash.update(file + '\0');
  // 改行コードの違い（Windows の CRLF）でハッシュが変わらないようにそろえる
  hash.update(fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n') + '\0');
});
const actual = hash.digest('hex').slice(0, 16);

const history = JSON.parse(fs.readFileSync(path.join(__dirname, 'sw-shell-hashes.json'), 'utf8'));
const versions = Object.keys(history).map(Number).sort((a, b) => a - b);

const failures = [];
if (!version) failures.push({ name: 'VERSION', message: "sw.js に const VERSION = '数字' が見つかりません" });
else {
  if (Math.max(...versions) !== Number(version)) {
    failures.push({ name: '最新', message: `sw-shell-hashes.json の一番新しい行（${Math.max(...versions)}）が sw.js の VERSION（${version}）と違います` });
  }
  if (history[version] !== actual) {
    failures.push({
      name: '上げ忘れ',
      message: `画面のファイルの中身が VERSION ${version} のときと変わっています。`
        + `sw.js の VERSION を ${Number(version) + 1} に上げ（index.html と app.js の ?v= も）、`
        + `sw-shell-hashes.json に "${Number(version) + 1}": "<上げたあとに出る値>" を足してください。今の値: ${actual}`
    });
  }
  const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const stale = (indexHtml.match(/\?v=(\d+)/g) || []).filter(q => q !== `?v=${version}`);
  if (stale.length) failures.push({ name: '?v=', message: `index.html に VERSION と違うクエリがあります: ${[...new Set(stale)].join(', ')}` });
}

const total = 3;
if (!failures.length) {
  console.log(JSON.stringify({ suite: 'sw-version', total, passed: total, failed: 0 }));
  process.exit(0);
}
console.log(JSON.stringify({ suite: 'sw-version', total, passed: total - failures.length, failed: failures.length, failures }, null, 2));
process.exit(1);
