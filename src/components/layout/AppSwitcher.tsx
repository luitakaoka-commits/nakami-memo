"use client";

import { useEffect, useState } from "react";
import { Box, CookingPot, Wallet } from "lucide-react";

/**
 * 3アプリの切り替え（サイドバーの中のメニュー項目）。
 *
 * 2026-11 の UI 統一（docs/ui-unification/audit.md §4-4）で、なかみメモでは共通の切り替えバー
 * （public/shared/app-switcher.js の緑系のバー）を出すのをやめ、サイドバーの項目として描く。
 * 行き先・並び・「今ここ」・ほかのアプリの状態の1行は、共通のバーと同じものを出す。
 *
 * バーを出さなくても、共通モジュールが担っていた次の2つは続ける（ここで共通モジュールを読んで呼ぶ）。
 *   - window.__appStatus … useInventory がなかみメモの状態を書き残す（ほかのアプリの切り替えに出る）
 *   - rememberLastApp("nakami") … くらしノートを次に起動したとき、なかみメモから始める（/start.html）
 * public/ 配下はバンドル対象にできないので、`import` ではなく module スクリプトを差し込む。
 */

const APPS = [
  { id: "money", name: "お金管理", href: "/money", icon: Wallet },
  { id: "nakami", name: "なかみメモ", href: "/app", icon: Box },
  { id: "recipe", name: "つくりおきノート", href: "/recipe", icon: CookingPot },
] as const;

const CURRENT = "nakami";

/* 状態の読み方は public/shared/app-switcher.js の statusTextFor と同じ（キー・3日で出さない） */
const STATUS_KEY = "appSwitcherStatus";
const STATUS_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 3;

function readStatusTexts(): Record<string, string> {
  try {
    const raw = localStorage.getItem(STATUS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== "object") return {};
    const texts: Record<string, string> = {};
    for (const [id, entry] of Object.entries(parsed as Record<string, { text?: unknown; at?: unknown }>)) {
      if (!entry || typeof entry.text !== "string" || !entry.text) continue;
      if (typeof entry.at === "number" && Date.now() - entry.at > STATUS_MAX_AGE_MS) continue;
      texts[id] = entry.text;
    }
    return texts;
  } catch {
    return {};
  }
}

export function AppSwitcher() {
  const [statuses, setStatuses] = useState<Record<string, string>>({});

  useEffect(() => {
    setStatuses(readStatusTexts());

    if (document.querySelector('script[data-appsw="js"]')) return;
    const script = document.createElement("script");
    script.type = "module";
    script.dataset.appsw = "js";
    script.textContent = [
      'import { publishAppStatus } from "/shared/app-switcher.js";',
      'import { rememberLastApp } from "/shared/last-app.js";',
      `window.__appStatus = (text) => publishAppStatus("${CURRENT}", text);`,
      `rememberLastApp("${CURRENT}");`,
    ].join("\n");
    document.body.appendChild(script);
  }, []);

  return (
    <div className="ui-menu-group" role="group" aria-labelledby="appsw-title">
      <p id="appsw-title" className="ui-menu-group__title">アプリを切り替え</p>
      {APPS.map((app) => {
        const Icon = app.icon;
        if (app.id === CURRENT) {
          return (
            <div key={app.id} className="ui-menu-link" aria-current="page">
              <Icon size={20} strokeWidth={1.7} aria-hidden="true" />
              <span>{app.name}</span>
              <span className="ui-menu-link__badge">今ここ</span>
            </div>
          );
        }
        const state = statuses[app.id];
        return (
          <a key={app.id} href={app.href} className="ui-menu-link">
            <Icon size={20} strokeWidth={1.7} aria-hidden="true" />
            <span>{app.name}</span>
            {state && <span className="ui-menu-link__badge ui-menu-link__badge--muted">{state}</span>}
          </a>
        );
      })}
    </div>
  );
}
