/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./App.tsx", "./src/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        // ハコ虎ブランド: Primary=Charcoal（信頼/現場/機械/アスファルト）。Web(apps/web/tailwind.config.ts)と同じレンジ。
        brand: {
          50: "#f6f7f8",
          100: "#e9ebed",
          200: "#cfd3d8",
          300: "#a9b0b8",
          400: "#7c848f",
          500: "#5b636e",
          600: "#454c56",
          700: "#363c44",
          800: "#252a30",
          900: "#15181c",
        },
        // アクセント=Amber（CTA/完了/選択状態）。
        accent: {
          50: "#fffbeb",
          100: "#fef3c7",
          200: "#fde68a",
          300: "#fcd34d",
          400: "#fbbf24",
          500: "#f59e0b",
          600: "#d97706",
          700: "#b45309",
        },
      },
    },
  },
  plugins: [],
};
