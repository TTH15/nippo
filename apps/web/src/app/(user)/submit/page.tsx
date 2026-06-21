import SubmitPageClientV2 from "./SubmitPageClientV2";

// Phase9 カットオーバー: /submit を v2 動的フォームへ差替。
// 旧 SubmitPageClient は revert 用に温存（このファイルの import を戻すだけで復帰可能）。
export default function SubmitPage() {
  return <SubmitPageClientV2 />;
}
