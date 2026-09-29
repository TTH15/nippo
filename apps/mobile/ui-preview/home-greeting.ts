// 隔離プレビューの挨拶。ドライバーの業務日付と同じ日本時間で切り替える。
export function homeGreeting(timestamp: number): "おはようございます" | "お疲れ様です" {
  const hour = new Date(timestamp + 9 * 3600_000).getUTCHours();
  return hour >= 4 && hour < 12 ? "おはようございます" : "お疲れ様です";
}
