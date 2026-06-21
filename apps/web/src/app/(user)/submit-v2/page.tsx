import SubmitPageClientV2 from "../submit/SubmitPageClientV2";

// 動的日報フォーム（新モデル）の並行ルート。
// 既存 /submit は温存。テスト後に /submit を差し替える想定。
export default function SubmitV2Page() {
  return <SubmitPageClientV2 />;
}
