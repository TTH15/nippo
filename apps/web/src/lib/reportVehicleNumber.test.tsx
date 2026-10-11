import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ReportVehicleNumber } from "./components/ReportVehicleNumber";
import { reportVehicleNumber, vehicleNumberText } from "./reportVehicleNumber";
const content = (value: string, fieldKey = "vehicle_number") => [{ unitId: "u", unitName: "報告", fields: [{ fieldKey, label: "車両番号", inputType: "TEXT", groupLabel: null, valueNum: null, valueText: value }] }];
afterEach(cleanup);
it("紐付けが無くても日報に保存された番号を表示する", () => {
  render(<ReportVehicleNumber report={{ content: content("大阪 480 れ 45-67") }} />);
  expect(screen.getByText("大阪 480 れ 45-67")).toBeTruthy(); expect(screen.getByText("報告値")).toBeTruthy();
});
it("貸与車など日報に紐付いた実車両を報告値より優先する", () => {
  const { container } = render(<ReportVehicleNumber report={{ vehicle_plate: { id: "borrowed", number_numeric: "1234" }, content: content("5678") }} />);
  expect(container.querySelector('[data-vehicle-plate-id="borrowed"]')).toBeTruthy(); expect(screen.queryByText("報告値")).toBeNull();
});
it("確認済み原本と未確認OCRを区別し、番号のない日報は未登録にする", () => {
  const view = render(<ReportVehicleNumber report={{ vehicle_number_evidence: { number: "1234", source: "ocr" } }} />);
  expect(screen.getByText("原本OCR・未確認")).toBeTruthy();
  view.rerender(<ReportVehicleNumber report={{ vehicle_number_evidence: { number: "1234", source: "confirmed_image" } }} />);
  expect(screen.getByText("原本の確認値")).toBeTruthy();
  view.rerender(<ReportVehicleNumber report={{}} />); expect(screen.getByText("未登録")).toBeTruthy();
  view.rerender(<ReportVehicleNumber report={{ vehicle_number_unavailable: true }} />); expect(screen.getByText("番号確認待ち")).toBeTruthy();
});
it("別の番号を曖昧に選ばず、保存されていない番号を生成しない", () => {
  expect(reportVehicleNumber([...content("1234"), ...content("5678")])).toBeNull();
  expect(vehicleNumberText("１２－３４")).toBe("12-34"); expect(vehicleNumberText("12345")).toBeNull(); expect(vehicleNumberText("未登録")).toBeNull();
});
