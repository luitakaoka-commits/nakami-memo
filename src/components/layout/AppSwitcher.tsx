"use client";

import { useEffect, useRef } from "react";

/**
 * 3アプリ共通の切り替えバー。
 *
 * 実体は public/shared/app-switcher.js（素のESモジュール）で、/money と /recipe も
 * まったく同じファイルを読み込んでいる。アイコンと配色を1箇所に保つため、
 * Reactで作り直さずにそのモジュールを呼んでいる。
 *
 * public/ 配下はバンドル対象にできないので、`import` ではなく
 * module スクリプトを差し込む形にしている。
 */
export function AppSwitcher() {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount || mount.childElementCount > 0) return;

    if (!document.querySelector('link[data-appsw="css"]')) {
      const css = document.createElement("link");
      css.rel = "stylesheet";
      css.href = "/shared/app-switcher.css";
      css.dataset.appsw = "css";
      document.head.appendChild(css);
    }

    const script = document.createElement("script");
    script.type = "module";
    script.dataset.appsw = "js";
    script.textContent = [
      'import { mountAppSwitcher } from "/shared/app-switcher.js";',
      'const mount = document.getElementById("appsw-mount");',
      'if (mount && mount.childElementCount === 0) mountAppSwitcher({ current: "nakami", mount });',
    ].join("\n");
    document.body.appendChild(script);

    return () => {
      script.remove();
    };
  }, []);

  return <div id="appsw-mount" ref={mountRef} />;
}
