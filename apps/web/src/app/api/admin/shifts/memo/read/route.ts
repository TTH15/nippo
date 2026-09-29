import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";
import { getAnthropic, isAnthropicConfigured } from "@/server/ai/client";
import { parseImageMemoRead } from "@/lib/shiftMemo/imageImport";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const OUTPUT_SCHEMA = {
  type: "object", additionalProperties: false,
  properties: {
    period: { type: "object", additionalProperties: false, properties: {
      year: { type: "integer" }, month: { type: "integer" },
    }, required: ["year", "month"] },
    rows: { type: "array", items: { type: "object", additionalProperties: false, properties: {
      name: { type: "string" },
      days: { type: "array", items: { type: "object", additionalProperties: false, properties: {
        day: { type: "integer" }, names: { type: "array", items: { type: "string" } },
      }, required: ["day", "names"] } },
    }, required: ["name", "days"] } },
    warnings: { type: "array", items: { type: "string" } },
  }, required: ["period", "rows", "warnings"],
} as const;

/** コースを行、日付を列にしたメモを読む。保存は端末側の確認後だけ。 */
export async function POST(req: NextRequest) {
  const user = await requirePermission(req, "can_manage_shifts");
  if (isAuthError(user)) return user;
  if (!isAnthropicConfigured()) return NextResponse.json({ error: "画像の読み取りを利用できません" }, { status: 503 });
  try {
    const form = await req.formData();
    const file = form.get("file");
    const year = Number(form.get("year"));
    const month = Number(form.get("month"));
    if (!(file instanceof File) || !Number.isInteger(year) || year < 2000 || year > 2100 || !Number.isInteger(month) || month < 1 || month > 12) {
      return NextResponse.json({ error: "ファイルと対象月を選んでください" }, { status: 400 });
    }
    const mime = ["image/png", "application/pdf"].includes(file.type) ? file.type
      : /\.png$/i.test(file.name) ? "image/png" : /\.pdf$/i.test(file.name) ? "application/pdf" : "";
    if (!["image/png", "application/pdf"].includes(mime) || file.size > 8 * 1024 * 1024 || file.size === 0) {
      return NextResponse.json({ error: "PNGまたはPDFを選んでください" }, { status: 400 });
    }
    const orgId = user.orgId ?? await resolveOrgId(user.driverId);
    const { data: courses, error } = await supabase.from("courses")
      .select("name, summary_title").eq("org_id", orgId);
    if (error) throw error;
    const fileBytes = Buffer.from(await file.arrayBuffer());
    const validFile = mime === "application/pdf" ? fileBytes.subarray(0, 5).toString("ascii") === "%PDF-"
      : fileBytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    if (!validFile) return NextResponse.json({ error: "画像・PDFを読み取れませんでした" }, { status: 400 });
    const bytes = fileBytes.toString("base64");
    const media = mime === "application/pdf"
      ? { type: "document" as const, source: { type: "base64" as const, media_type: "application/pdf" as const, data: bytes } }
      : { type: "image" as const, source: { type: "base64" as const, media_type: "image/png" as const, data: bytes } };
    const courseNames = (courses ?? []).map(course => course.summary_title ? `${course.name}（略記 ${course.summary_title}）` : course.name).join("、");
    const stream = getAnthropic().messages.stream({
      model: process.env.HAKOTORA_AI_MODEL || "claude-sonnet-5",
      max_tokens: 32000,
      output_config: { effort: "low", format: { type: "json_schema", schema: OUTPUT_SCHEMA as unknown as Record<string, unknown> } },
      messages: [{ role: "user", content: [media, { type: "text", text: [
        `この配送業者のシフトメモを、コース・担当枠を行、日付を列として読んでください。画面で選択中の月は${year}年${month}月です。`,
        `登録コース: ${courseNames || "なし"}。`,
        "periodは画像内に書かれた年月にしてください。年月が不明なら選択中の月を入れ、warningsにその旨を記してください。",
        "rowsには左端の担当枠ごとに1行を作り、nameをその表記のまま入れてください。『休み』『Free』なども人名札があるなら独立した行にしてください。親コースの見出し行や人数だけの合計行は担当枠にしないでください。",
        "daysには画像に写る日付のうち、名前札がある日だけを入れます。各セルに表示された全員の名前札をnamesへ、表記どおりに分けて入れてください。担当者名とコース名を取り違えないでください。",
        "判読できない名前・日付・行は推測して埋めず、warningsに記してください。画像の範囲外の日付は入れないでください。",
      ].join("\n") }] }],
    });
    const message = await stream.finalMessage();
    if (message.stop_reason === "refusal") throw new Error("画像の読み取りが拒否されました");
    if (message.stop_reason === "max_tokens") throw new Error("画像を分けて読み込んでください");
    const raw = JSON.parse(message.content.find(block => block.type === "text")?.text ?? "{}");
    const result = parseImageMemoRead(raw, { year, month });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "読み取りに失敗しました" }, { status: 502 });
  }
}
