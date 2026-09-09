import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

/**
 * Next 15 では `next lint` が非推奨なので、ESLint のフラット設定を直接使う。
 * 追加ルールは CI を壊さないように warn 止まりにしてある。
 */
const config = [
  {
    ignores: [
      ".next/**",
      "out/**",
      "build/**",
      "node_modules/**",
      "next-env.d.ts",
      // public/ は同居させている素のHTML+JSアプリ（/money と /recipe）。
      // Next.js からは静的アセットで、ブラウザ用ESモジュールとNode用CommonJSテストが
      // 混在しているため、このアプリのlint規約は当てない。各アプリ側で node --check と
      // 独自テストを回している。
      "public/money/**",
      "public/recipe/**",
    ],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "warn",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
];

export default config;
