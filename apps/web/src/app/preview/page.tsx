"use client";

// ============================================================
// プレビュー一覧（開発用・認証不要）。ドライバー向け画面/演出を調整用に確認する。
// ============================================================

const ITEMS: { href: string; title: string; desc: string }[] = [
  { href: "/preview/onboarding", title: "初期登録ウィザード", desc: "招待リンク→氏名→SMS→Face ID→免許→顔→住所→申請完了（モック・SMS/DBなしで通し確認）" },
  { href: "/preview/post-submit", title: "送信後画面", desc: "個数の報告後に見える画面（報酬・チーム累計ポイント・ランキング）" },
  { href: "/preview/animations", title: "アニメーション", desc: "カウントアップ・膨張演出・ボーナス付与オーバーレイ" },
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
