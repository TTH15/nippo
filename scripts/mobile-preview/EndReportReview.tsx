import { previewVehicle } from "../../apps/mobile/ui-preview/vehicle";
import { useEffect, useState } from "react";
import { DailyReportForm } from "../../apps/mobile/src/components/DailyReportForm";
import { setPreviewReportFailure } from "../../apps/mobile/ui-preview/report-fixture";
import { displayShiftDate } from "../../apps/mobile/ui-preview/end-of-day";
import { CheckboxField } from "../../apps/web/src/lib/components/CheckboxField";
// 実アプリの日報フォームとコース/便fixtureを再利用。APIは隔離runnerで置換する。
export function EndReportReview({ onSubmitted, onBack }: { onSubmitted: () => void; onBack: () => void }) {
  const [failure, setFailure] = useState(false);
  useEffect(() => { setPreviewReportFailure(failure); return () => setPreviewReportFailure(false); }, [failure]);
  return <div data-testid="end-report" style={{ padding: 4 }}>
    <button onClick={onBack} style={{ minHeight: 44, color: "#526074", marginBottom: 12 }}>ホームへ</button>
    <h2 style={{ fontSize: 26, fontWeight: 700 }}>日報</h2>
    <p style={{ color: "#526074", fontSize: 14, margin: "12px 0 20px" }}>{displayShiftDate("2026-09-23")}</p>
    <DailyReportForm confirmedVehicle={previewVehicle} date="2026-09-23" showSubmitButton onSubmitted={onSubmitted} />
    <div style={{ marginTop: 32 }}><CheckboxField label="確認用：日報の送信エラー" checked={failure} onCheckedChange={setFailure} variant="row" /></div>
  </div>;
}
