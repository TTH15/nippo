import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AllReportCard, PendingDriverCard, DailyReportTable, DailyDriverRow, type ReportLike } from "./ReportCards";
const driver = { id: "driver", name: "架空 太郎" };
const first: ReportLike = { id: "c1", course_id: "course", course_name: "日中サンプル", cycle_no: 1, cycle_label: "C1", carrier: "YAMATO", vehicle_id: "van", vehicle_plate: { id: "van", number_prefix: "京都", number_class: "480", number_hiragana: "り", number_numeric: "1234" }, meter_value: 149063, submitted_at: new Date(2026, 9, 16, 19, 0).toISOString(), content: [{ unitId: "parcel", unitName: "宅急便", fields: [{ fieldKey: "completed", label: "完了", inputType: "INT", groupLabel: null, valueNum: 80, valueText: null }] }] };
const second = { ...first, id: "c2", cycle_no: 2, cycle_label: "C2", content: [{ ...first.content![0], fields: [{ ...first.content![0].fields[0], valueNum: 40 }] }] };
afterEach(cleanup);
it("1人1日で車両・メーター・送信時刻を1回表示し、両便の実績と編集先を保つ", () => {
  const edit = vi.fn(), approve = vi.fn();
  render(<PendingDriverCard driver={driver} reps={[first, second]} status="pending" canWrite onEdit={edit} onApprove={approve} onReject={vi.fn()} />);
  expect(screen.getAllByText("149,063")).toHaveLength(1);
  expect(screen.getAllByText("19:00")).toHaveLength(1);
  expect(screen.getAllByText("日中サンプル")).toHaveLength(1);
  expect(screen.getByText("80")).toBeTruthy(); expect(screen.getByText("40")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "日中サンプル C2を編集" }));
  expect(edit).toHaveBeenCalledWith(second);
  fireEvent.click(screen.getByRole("button", { name: /^承認$/ })); expect(approve).toHaveBeenCalledOnce();
});
it("却下分は共通の開閉から確認し、現行の日報とメーターに混ぜない", () => {
  render(<AllReportCard driver={driver} reps={[{ ...first, approved_at: "approved" }, { ...second, course_name: "変更前サンプル", rejected_at: "removed", meter_value: 999999 }]} canWrite onEdit={vi.fn()} onApprove={vi.fn()} onReject={vi.fn()} />);
  expect(screen.queryByText("変更前サンプル")).toBeNull(); expect(screen.queryByText("999,999")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "対象外・却下（1）" }));
  expect(screen.getByText("変更前サンプル")).toBeTruthy();
  expect(screen.queryByRole("button", { name: /^承認$/ })).toBeNull();
});
it("閲覧者には便別の編集と承認操作を出さない", () => {
  render(<PendingDriverCard driver={driver} reps={[first, second]} status="pending" canWrite={false} onEdit={vi.fn()} onApprove={vi.fn()} onReject={vi.fn()} />);
  expect(screen.queryByRole("button")).toBeNull();
  expect(screen.getByText("C1")).toBeTruthy(); expect(screen.getByText("C2")).toBeTruthy();
});

it("PCは別々の列見出しを一度だけ表示し、便を番号順に揃えて名前・メーターを共用する", () => {
  render(<DailyReportTable><DailyDriverRow driver={driver} reps={[second,first]} assignments={[{courseId:"course",courseName:"日中サンプル",cycleNo:2,cycleLabel:"C2"},{courseId:"course",courseName:"日中サンプル",cycleNo:1,cycleLabel:"C1"}]} status="pending" canWrite onEdit={vi.fn()} onApprove={vi.fn()} onReject={vi.fn()} /></DailyReportTable>);
  expect(screen.getAllByText("シフト",{exact:true})).toHaveLength(1);expect(screen.getAllByText("提出された日報",{exact:true})).toHaveLength(1);
  expect(screen.queryByText("シフト・提出内容")).toBeNull();
  const rows=screen.getAllByRole("row").slice(1);
  expect(rows).toHaveLength(2);expect(rows[0].textContent).toContain("C1");expect(rows[1].textContent).toContain("C2");
  expect(screen.getAllByText("149,063")).toHaveLength(1);expect(screen.getAllByText("架空",{exact:true})).toHaveLength(1);
});

it("通常の照合結果はラベルを増やさず、左右のコース色とシフト変更の履歴を保つ", () => {
  const { container } = render(<AllReportCard driver={driver} reps={[{...first,course_color:"#3b82f6"},{...second,id:"removed",course_name:"解除済み",course_color:"#a855f7",rejected_at:"removed",rejection_reason:"shift_changed"}]} assignments={[{courseId:"course",courseName:first.course_name!,courseColor:"#3b82f6",cycleNo:1,cycleLabel:"C1"}]} canWrite onEdit={vi.fn()} onApprove={vi.fn()} onReject={vi.fn()} />);
  expect(screen.queryByText("シフトと一致")).toBeNull();
  expect(screen.getAllByText("日中サンプル").map(e=>e.style.backgroundColor)).toEqual(["#3b82f626","#3b82f626"]);
  fireEvent.click(screen.getByRole("button",{name:"対象外・却下（1）"}));
  expect(screen.getByText("シフト変更で対象外")).toBeTruthy();
  expect(screen.getByText("解除済み").style.backgroundColor).toBe("#a855f726");
  expect(container.querySelectorAll('button[aria-label="解除済み C2を編集"]')).toHaveLength(0);
});
