import Link from "next/link";

// カスタム 404。Next 15.5.x の builtin global-not-found（VAR_ORIGINAL_PATHNAME invariant）
// を回避するためにも、ルートに not-found を用意しておく。
export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-[var(--color-bg)] px-6 text-center">
      <div className="text-5xl font-bold text-slate-300">404</div>
      <p className="text-sm text-slate-600">ページが見つかりませんでした。</p>
      <Link href="/" className="text-sm text-blue-600 hover:underline">
        トップへ戻る
      </Link>
    </div>
  );
}
