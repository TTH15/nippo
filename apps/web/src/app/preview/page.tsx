"use client";

// ============================================================
// プレビュー一覧（開発用・認証不要）。ドライバー向け画面/演出を調整用に確認する。
// ============================================================

const ITEMS: { href: string; title: string; desc: string }[] = [
  { href: "/preview/shift-memo", title: "シフトメモ・半月グリッド", desc: "個人用のコース×日付グリッド、可変列幅、名前札D&D（モック・保存なし）" },
  { href: "/preview/course-settings", title: "コース設定・統合案1", desc: "基本情報と運行設定を左右に統合した2タブ構成（モック・保存なし）" },
  { href: "/preview/course-rate", title: "コース単価設定", desc: "売上・支払カード、税抜・税込換算、日当・歩合（モック・保存なし）" },
  { href: "/preview/onboarding", title: "初期登録ウィザード", desc: "招待リンク→氏名→SMS→Face ID→免許→顔→住所→申請完了（モック・SMS/DBなしで通し確認）" },
  { href: "/preview/post-submit", title: "送信後画面", desc: "個数の報告後に見える画面（報酬・チーム累計ポイント・ランキング）" },
  { href: "/preview/animations", title: "アニメーション", desc: "カウントアップ・膨張演出・ボーナス付与オーバーレイ" },
  { href: "/preview/loader", title: "ピクセル箱ローダー", desc: "シフトAI取り込み・請求書作成などの待ち時間に出す「箱が組み上がる」演出" },
  { href: "/preview/plate", title: "ナンバープレート", desc: "SVGグリフ版 VehiclePlate の見た目確認（4色・フォールバック込み）" },
];

export default function PreviewIndexPage() {
  return (
    <div className="min-h-screen bg-slate-100 py-8 px-4">
      <div className="max-w-md mx-auto space-y-5">
        <div>
          <h1 className="text-lg font-bold text-slate-900">プレビュー</h1>
          <p className="text-xs text-slate-500 mt-1">ドライバー向け画面・演出の調整用（開発専用）。</p>
        </div>
        <div className="space-y-3">
          {ITEMS.map((it) => (
            <a
              key={it.href}
              href={it.href}
              className="block rounded-xl border border-slate-200 bg-white p-4 hover:border-slate-400 transition-colors"
            >
              <div className="text-sm font-semibold text-slate-900">{it.title}</div>
              <div className="text-xs text-slate-500 mt-0.5">{it.desc}</div>
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
