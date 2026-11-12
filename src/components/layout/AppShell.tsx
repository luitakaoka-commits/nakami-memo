"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Box, ChefHat, Home, LogOut, Menu, Plus, Search, Users, X } from "lucide-react";
import { logout } from "@/lib/firebase/auth";
import { useAuth } from "@/lib/hooks/useAuth";
import { InventoryProvider } from "@/lib/hooks/useInventory";
import { AppSwitcher } from "./AppSwitcher";

const navItems = [
  { href: "/app", label: "ホーム", icon: Home },
  { href: "/app/locations", label: "保管場所", icon: Box },
  { href: "/app/items/new", label: "追加", icon: Plus },
  { href: "/app/search", label: "検索", icon: Search },
  // 「少ない」はホームの「残り少ないもの」から開ける（2026-09-14 決定でレシピに置き換え）
  { href: "/app/recipes", label: "レシピ", icon: ChefHat },
];

/* ヘッダーに出す画面名。各画面の見出しと同じ言葉を使う（上から順に当てる） */
const screenTitles: { match: (pathname: string) => boolean; title: string }[] = [
  { match: (p) => p === "/app", title: "ホーム" },
  { match: (p) => p === "/app/items/new", title: "アイテムを追加" },
  { match: (p) => /^\/app\/items\/[^/]+\/edit$/.test(p), title: "アイテムを編集" },
  { match: (p) => p === "/app/locations/new", title: "保管場所を追加" },
  { match: (p) => /^\/app\/locations\/[^/]+\/edit$/.test(p), title: "保管場所を編集" },
  { match: (p) => p === "/app/locations" || p.startsWith("/app/locations/"), title: "保管場所" },
  { match: (p) => p.startsWith("/app/search"), title: "検索" },
  { match: (p) => p.startsWith("/app/expiring"), title: "期限一覧" },
  { match: (p) => p.startsWith("/app/low-stock"), title: "買い替え時のもの" },
  { match: (p) => p.startsWith("/app/recipes"), title: "レシピ提案" },
  { match: (p) => p.startsWith("/app/tools"), title: "調理器具" },
  { match: (p) => p.startsWith("/app/areas"), title: "エリア管理" },
  { match: (p) => p.startsWith("/app/household"), title: "同居人と共有" },
  { match: (p) => p.startsWith("/app/join"), title: "家に参加する" },
  { match: (p) => p.startsWith("/app/health"), title: "からだの記録" },
];

function screenTitleOf(pathname: string) {
  return screenTitles.find((entry) => entry.match(pathname))?.title ?? "";
}

function isActivePath(pathname: string, href: string) {
  return href === "/app" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, household } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDialogElement>(null);

  // 開閉は menuOpen だけで決め、<dialog> の表示はそれに合わせる（プロトタイプと同じモーダルのサイドバー）
  useEffect(() => {
    const dialog = menuRef.current;
    if (!dialog) return;
    if (menuOpen && !dialog.open) dialog.showModal();
    if (!menuOpen && dialog.open) dialog.close();
    document.body.classList.toggle("ui-modal-open", menuOpen);
  }, [menuOpen]);

  // 画面を移ったら閉じる
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  useEffect(() => () => document.body.classList.remove("ui-modal-open"), []);

  async function handleLogout() {
    await logout();
    router.replace("/login");
  }

  return (
    <div className="ui-app-shell">
      <header className="ui-app-header">
        <button type="button" className="ui-icon-button" onClick={() => setMenuOpen(true)} aria-label="メニュー" aria-haspopup="dialog" aria-expanded={menuOpen}>
          <Menu size={24} strokeWidth={1.7} />
        </button>
        <span className="ui-app-header__title">{screenTitleOf(pathname)}</span>
        <span className="ui-app-header__caption">なかみメモ</span>
      </header>

      <dialog
        ref={menuRef}
        className="ui-sidebar"
        aria-label="メインメニュー"
        onClose={() => setMenuOpen(false)}
        onClick={(event) => { if (event.target === event.currentTarget) setMenuOpen(false); }}
      >
        <div className="ui-sidebar__inner">
          <div className="ui-sidebar__heading">
            <Link href="/app" className="ui-sidebar__brand">なかみメモ</Link>
            <button type="button" className="ui-icon-button" onClick={() => setMenuOpen(false)} aria-label="閉じる">
              <X size={22} strokeWidth={1.7} />
            </button>
          </div>

          <nav className="ui-menu-group" aria-label="メインメニュー">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = isActivePath(pathname, item.href);
              return (
                <Link key={item.href} href={item.href} className="ui-menu-link" aria-current={active ? "page" : undefined} onClick={() => setMenuOpen(false)}>
                  <Icon size={20} strokeWidth={1.7} aria-hidden="true" />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>

          <AppSwitcher />

          <div className="ui-menu-group ui-sidebar__footer">
            {/* 同居人との共有（2026-09-28）。共有中は家の名前を出す */}
            <Link href="/app/household" className="ui-menu-link" aria-current={isActivePath(pathname, "/app/household") ? "page" : undefined} data-shared={household ? "true" : undefined} onClick={() => setMenuOpen(false)}>
              <Users size={20} strokeWidth={1.7} aria-hidden="true" />
              <span>{household ? household.name : "同居人と共有"}</span>
            </Link>
            <span className="ui-account">{user?.displayName || user?.email}</span>
            <button type="button" onClick={handleLogout} className="ui-menu-link">
              <LogOut size={20} strokeWidth={1.7} aria-hidden="true" />
              <span>ログアウト</span>
            </button>
          </div>
        </div>
      </dialog>

      <main className="ui-main" data-wide={pathname === "/app/locations" ? "true" : undefined}>
        <InventoryProvider>{children}</InventoryProvider>
      </main>
    </div>
  );
}

