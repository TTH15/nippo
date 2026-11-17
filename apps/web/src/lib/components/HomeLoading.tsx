import { Skeleton } from "./Skeleton";

// 遷移前のホーム表示。隔離プレビューでも本番と同じ骨格を使う。
export function HomeLoading() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-4">
      <div className="flex flex-col items-center gap-3 w-48">
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-4 w-full max-w-32" />
        <Skeleton className="h-4 w-20" />
      </div>
    </div>
  );
}
