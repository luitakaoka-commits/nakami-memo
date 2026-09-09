import type { Config } from "tailwindcss";
import forms from "@tailwindcss/forms";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  // 配色は src/app/tokens.css の CSS 変数（--brand など）を唯一の情報源にする。
  theme: {
    extend: {},
  },
  plugins: [forms],
};

export default config;
