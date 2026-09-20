// 本番 /admin/report-images を再利用。提出された原本の確認を架空データだけで見る。
// 原本の画像は様式プレビューと同じ架空の表（実物の配完表は置かない）。
import type { PreviewFixture } from "@/lib/preview/fixtureStore";
import type { ReviewValue } from "@/server/reports/sourceImageReview";
import { PREVIEW_SAMPLE_IMAGE_URL } from "./reportImageTemplates";

type Row = {
  id: string;
  reportDate: string;
  driverName: string;
  courseName: string | null;
  status: string;
  receivedAt: string;
  capturedAt: string | null;
  capturedAtSource: string;
  byteSize: number;
  originalFilename: string | null;
  templateName: string | null;
  templateVersion: string | null;
  adopted: boolean;
  confirmedAt: string | null;
  readingCount: number;
  values: ReviewValue[];
  duplicate: string;
  reasons: string[];
};

const value = (
  fieldId: string,
  label: string,
  read: number | null,
  confirmed: number | null,
  status = "read",
  confidence: number | null = 0.96,
): ReviewValue => ({
  fieldId,
  label,
  read,
  confirmed,
  status,
  confidence,
  corrected: confirmed != null && String(confirmed) !== String(read),
});

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const at = (date: string, hour: number, minute: number) => `${date}T${String(hour - 9).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00.000Z`;

function rows(): Row[] {
  const today = day(0);
  const yesterday = day(-1);
  return [
    {
      id: "img-1",
      reportDate: today,
      driverName: "山田 太郎",
      courseName: "北ルート",
      status: "confirmed",
      receivedAt: at(today, 20, 5),
      capturedAt: null,
      capturedAtSource: "unknown",
      byteSize: 128_000,
      originalFilename: "IMG_2023.JPG",
      templateName: "ヤマト 配達集計精算書",
      templateVersion: "1",
      adopted: true,
      confirmedAt: at(today, 20, 6),
      readingCount: 1,
      values: [value("takkyubin-done", "宅急便 配完", 38, 38), value("takkyubin-back", "宅急便 持戻", 2, 2)],
      duplicate: "none",
      reasons: [],
    },
    {
      id: "img-2",
      reportDate: today,
      driverName: "佐藤 花子",
      courseName: "南ルート",
      status: "confirmed",
      receivedAt: at(today, 19, 40),
      capturedAt: at(today, 19, 38),
      capturedAtSource: "exif",
      byteSize: 240_000,
      originalFilename: "screenshot.png",
      templateName: "ヤマト 配達集計精算書",
      templateVersion: "1",
      adopted: true,
      confirmedAt: at(today, 19, 41),
      readingCount: 2,
      // 読み取りを本人が直した例。読み取り値も残す
      values: [value("takkyubin-done", "宅急便 配完", 41, 42), value("takkyubin-back", "宅急便 持戻", null, 1, "not_found", null)],
      duplicate: "none",
      reasons: ["読み取りから直した項目が2件あります"],
    },
    {
      id: "img-3",
      reportDate: today,
      driverName: "鈴木 次郎",
      courseName: null,
      status: "needs_review",
      receivedAt: at(today, 21, 12),
      capturedAt: null,
      capturedAtSource: "unknown",
      byteSize: 96_000,
      originalFilename: null,
      templateName: "ヤマト 配達集計精算書",
      templateVersion: "1",
      adopted: false,
      confirmedAt: null,
      readingCount: 1,
      values: [value("takkyubin-done", "宅急便 配完", 23, null, "uncertain", 0.29)],
      duplicate: "other_date",
      reasons: ["同じ画像が別の日の提出にもあります", "件数が確定していません"],
    },
    {
      id: "img-4",
      reportDate: yesterday,
      driverName: "田中 三郎",
      courseName: "東ルート",
      status: "unsupported",
      receivedAt: at(yesterday, 18, 30),
      capturedAt: null,
      capturedAtSource: "unknown",
      byteSize: 310_000,
      originalFilename: "photo.jpg",
      templateName: null,
      templateVersion: null,
      adopted: false,
      confirmedAt: null,
      readingCount: 1,
      values: [],
      duplicate: "none",
      reasons: ["様式に当てはまらず手入力になりました"],
    },
  ];
}

type State = { rows: Row[]; fail: boolean };

export const reportImagesFixture: PreviewFixture<State> = {
  id: "report-images",
  title: "画像の確認",
  pathname: "/admin/report-images",
  scenarios: {
    normal: { label: "通常", description: "確定・確定待ち・手入力が混ざった一覧" },
    empty: { label: "提出なし", description: "この期間の提出が無い" },
    "long-name": { label: "長い名前", description: "氏名・コース・項目名の折り返し" },
    large: { label: "多数", description: "40件の提出" },
    error: { label: "原本を開けない", description: "原本の表示が失敗したときの見え方" },
  },
  createState: ({ scenario }) => ({
    fail: scenario === "error",
    rows:
      scenario === "empty"
        ? []
        : scenario === "large"
          ? Array.from({ length: 40 }, (_, i) => ({ ...rows()[i % 4], id: `img-${i + 1}`, reportDate: day(-(i % 7)) }))
          : scenario === "long-name"
            ? rows().map((row) => ({
                ...row,
                driverName: "長い氏名で折り返しを確かめるためのドライバー名前",
                courseName: "枚方から交野を回って寝屋川へ戻る長いコース名",
                values: row.values.map((v) => ({ ...v, label: `${v.label}（宅急便コンパクト・EAZY を含む）` })),
              }))
            : rows(),
  }),
  read: (state, { path }) => {
    if (path.startsWith("/api/admin/report-source-images/file")) {
      if (state.fail) throw new Error("原本を確認できませんでした");
      return { url: PREVIEW_SAMPLE_IMAGE_URL };
    }
    if (path.startsWith("/api/admin/report-source-images")) {
      const params = new URLSearchParams(path.split("?")[1] ?? "");
      const status = params.get("status") ?? "all";
      const from = params.get("from") ?? "";
      const to = params.get("to") ?? "";
      const filtered = state.rows.filter(
        (row) =>
          (status === "all" || row.status === status) &&
          (!from || row.reportDate >= from) &&
          (!to || row.reportDate <= to),
      );
      return { images: filtered, unavailable: false, from, to };
    }
    return undefined;
  },
};
