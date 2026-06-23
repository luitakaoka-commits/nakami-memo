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

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user } = useAuth();

  async function handleLogout() {
    await logout();
    router.replace("/login");
  }

  return (
    <div className="min-h-screen bg-slate-50 pb-20 md:pb-0">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <Link href="/app" className="flex items-center gap-2 font-bold text-slate-900">
            <span className="grid h-9 w-9 place-items-center rounded-2xl bg-brand-600 text-white">中</span>
            <span>なかみメモ</span>
          </Link>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-slate-500 sm:inline">{user?.displayName || user?.email}</span>
            <button onClick={handleLogout} className="inline-flex items-center gap-1 rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50">
              <LogOut size={16} />
              ログアウト
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-6xl gap-6 px-4 py-6">
        <aside className="hidden w-48 shrink-0 md:block">
          <nav className="sticky top-20 space-y-2">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold ${
                    active ? "bg-brand-600 text-white" : "text-slate-600 hover:bg-white"
                  }`}
                >
                  <Icon size={18} />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </aside>

        <main className="min-w-0 flex-1">{children}</main>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-slate-200 bg-white md:hidden">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = pathname === item.href;
          return (
            <Link key={item.href} href={item.href} className={`flex flex-col items-center gap-1 py-2 text-xs font-semibold ${active ? "text-brand-700" : "text-slate-500"}`}>
              <Icon size={20} />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
