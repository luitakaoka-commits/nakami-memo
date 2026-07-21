"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Box, Home, LogOut, PackageSearch, Plus, Search } from "lucide-react";
import { logout } from "@/lib/firebase/auth";
import { useAuth } from "@/lib/hooks/useAuth";

const navItems = [
  { href: "/app", label: "ホーム", icon: Home },
  { href: "/app/locations", label: "保管場所", icon: Box },
  { href: "/app/items/new", label: "追加", icon: Plus },
  { href: "/app/search", label: "検索", icon: Search },
  { href: "/app/low-stock", label: "少ない", icon: PackageSearch },
];

function isActivePath(pathname: string, href: string) {
  return href === "/app" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user } = useAuth();

  async function handleLogout() {
    await logout();
    router.replace("/login");
  }

  return (
    <div className="ui-app-shell">
      <aside className="ui-sidebar">
        <Link href="/app" className="ui-sidebar-brand">
          <span className="ui-brand-mark ui-brand-mark--small" aria-hidden="true"><Box size={21} strokeWidth={1.8} /></span>
          <span className="ui-brand-name">なかみメモ</span>
        </Link>

        <nav className="ui-sidebar-nav" aria-label="メインメニュー">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = isActivePath(pathname, item.href);
            return (
              <Link key={item.href} href={item.href} className="ui-nav-link" data-active={active} aria-current={active ? "page" : undefined}>
                <Icon size={18} strokeWidth={1.9} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="ui-sidebar-footer">
          <span className="ui-account">{user?.displayName || user?.email}</span>
          <button type="button" onClick={handleLogout} className="ui-sidebar-logout">
            <LogOut size={16} strokeWidth={1.9} />
            ログアウト
          </button>
        </div>
      </aside>

      <div className="ui-main-shell">
        <header className="ui-mobile-header">
          <Link href="/app" className="ui-mobile-brand">
            <span className="ui-brand-mark ui-brand-mark--small" aria-hidden="true"><Box size={21} strokeWidth={1.8} /></span>
            <span className="ui-brand-name">なかみメモ</span>
          </Link>
          <button type="button" onClick={handleLogout} className="ui-mobile-logout" aria-label="ログアウト" title="ログアウト">
            <LogOut size={17} strokeWidth={1.9} />
          </button>
        </header>

        <main className="ui-main"><div className="ui-content">{children}</div></main>

        <nav className="ui-mobile-nav" aria-label="メインメニュー">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = isActivePath(pathname, item.href);
            return (
              <Link key={item.href} href={item.href} className="ui-nav-link" data-active={active} aria-current={active ? "page" : undefined}>
                <Icon size={19} strokeWidth={1.9} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}

