// KYC 承認支援 — 免許証写真の AI 読み取りと申告内容との照合。
// 運営の目視承認（§2-1a 承認1回統合）の補助として、免許証から氏名・生年月日・
// 有効期限・住所を抽出し、申請内容との一致/不一致をバッジ表示するための判定を返す。
// 抽出は Claude の vision + structured outputs、突合はサーバー側の決定的処理
//（shiftImport.ts と同じ役割分担）。判定はあくまで参考情報で、最終確定は運営が行う。
import { getAnthropic } from "./client";

// コスト優先の既定（ユーザー方針）。精度検証時は env で claude-opus-5 等に切替可能。
const MODEL = process.env.HAKOTORA_AI_MODEL || "claude-sonnet-5";

export type LicenseExtraction = {
  isDriversLicense: boolean;
  name: string;
  dob: string | null;
  expiry: string | null;
  address: string;
  warnings: string[];
};

export type CheckVerdict = "match" | "partial" | "mismatch" | "unknown";

export type KycCheck = {
  key: "name" | "dob" | "expiry" | "address";
  label: string;
  /** 申請内容（申告値）。未入力は空文字 */
  application: string;
  /** 免許証からの読み取り値。読めなかった場合は空文字 */
  extracted: string;
  verdict: CheckVerdict;
};

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    isDriversLicense: {
      type: "boolean",
      description: "画像が日本の運転免許証かどうか（別の書類・無関係な写真なら false）",
    },
    name: { type: "string", description: "氏名（記載のまま。読み取れなければ空文字）" },
    dob: {
      anyOf: [{ type: "string" }, { type: "null" }],
      description: "生年月日。和暦を西暦に変換して YYYY-MM-DD。読み取れなければ null",
    },
    expiry: {
      anyOf: [{ type: "string" }, { type: "null" }],
      description: "有効期限。和暦を西暦に変換して YYYY-MM-DD。読み取れなければ null",
    },
    address: { type: "string", description: "住所（記載のまま。読み取れなければ空文字）" },
    warnings: {
      type: "array",
      items: { type: "string" },
      description: "ぼやけ・見切れ・反射など、読み取りの確度に関わる注意を日本語で",
    },
  },
  required: ["isDriversLicense", "name", "dob", "expiry", "address", "warnings"],
  additionalProperties: false,
} as const;

const PROMPT = [
  "これは配送ドライバー登録の本人確認のために提出された、日本の運転免許証の写真です。",
  "記載されている氏名・生年月日・有効期限・住所を読み取ってください。",
  "",
  "ルール:",
  "- 生年月日・有効期限は和暦（昭和/平成/令和）で書かれているので、西暦の YYYY-MM-DD に変換する。",
  "- 氏名・住所は記載の表記のまま（旧字体もそのまま）。",
  "- 読み取れない項目は無理に推測せず、空文字 / null にして warnings に理由を書く。",
  "- 免許証以外の書類・写真だった場合は isDriversLicense を false にする。",
].join("\n");

/** 免許証画像から記載事項を読み取る。 */
export async function extractLicense(bytes: Uint8Array, mime: string): Promise<LicenseExtraction> {
  const client = getAnthropic();
  const mediaType = mime === "image/png" ? ("image/png" as const) : ("image/jpeg" as const);

  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 2000,
    output_config: {
      format: { type: "json_schema", schema: OUTPUT_SCHEMA as unknown as Record<string, unknown> },
    },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: mediaType, data: Buffer.from(bytes).toString("base64") },
          },
          { type: "text", text: PROMPT },
        ],
      },
    ],
  });

  const message = await stream.finalMessage();
  if (message.stop_reason === "refusal") {
    throw new Error("AI が免許証画像の読み取りを拒否しました");
  }
  const text = message.content.find((b) => b.type === "text")?.text ?? "";
  try {
    return JSON.parse(text) as LicenseExtraction;
  } catch {
    throw new Error("AI の読み取り結果を解析できませんでした");
  }
}

// ---- 突合（AI を使わない決定的処理） ----

/** 空白（全角含む）を除去。氏名の分かち書き差を吸収する。 */
const stripSpaces = (s: string) => s.replace(/[\s　]+/g, "");

/** 住所の正規化: 空白除去・全角英数→半角・ハイフン類統一・「丁目/番地/番/号」→ハイフン。 */
const normalizeAddress = (s: string) =>
  stripSpaces(s)
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[‐‑–—−ー―]/g, "-")
    .replace(/(\d)丁目(\d)/g, "$1-$2")
    .replace(/(\d)番地?(\d)/g, "$1-$2")
    .replace(/(\d)号/g, "$1")
    .replace(/番地?$/g, "");

const dateVerdict = (application: string, extracted: string | null): CheckVerdict => {
  if (!application || !extracted) return "unknown";
  return application === extracted ? "match" : "mismatch";
};

/** 免許証の読み取り値と申請内容を突合する。 */
export function compareLicense(
  extraction: LicenseExtraction,
  application: { name: string; dob: string; expiry: string; address: string },
): KycCheck[] {
  const nameVerdict: CheckVerdict =
    !application.name || !extraction.name
      ? "unknown"
      : stripSpaces(application.name) === stripSpaces(extraction.name)
        ? "match"
        : "mismatch";

  // 申告住所は「番地まで␣建物名」の空白結合（OnboardingWizard）。免許証側は建物名が
  // 無いことが多いため、全体一致に加えて番地までの一致も「一致」とみなす。
  const appAddr = normalizeAddress(application.address);
  const appBase = normalizeAddress(application.address.split(/\s+/)[0] ?? "");
  const licAddr = normalizeAddress(extraction.address);
  let addressVerdict: CheckVerdict;
  if (!appAddr || !licAddr) addressVerdict = "unknown";
  else if (licAddr === appAddr || licAddr === appBase) addressVerdict = "match";
  else if (licAddr.startsWith(appBase) || appBase.startsWith(licAddr)) addressVerdict = "partial";
  else addressVerdict = "mismatch";

  return [
    {
      key: "name",
      label: "氏名",
      application: application.name,
      extracted: extraction.name,
      verdict: nameVerdict,
    },
    {
      key: "dob",
      label: "生年月日",
      application: application.dob,
      extracted: extraction.dob ?? "",
      verdict: dateVerdict(application.dob, extraction.dob),
    },
    {
      key: "expiry",
      label: "有効期限",
      application: application.expiry,
      extracted: extraction.expiry ?? "",
      verdict: dateVerdict(application.expiry, extraction.expiry),
    },
    {
      key: "address",
      label: "住所",
      application: application.address,
      extracted: extraction.address,
      verdict: addressVerdict,
    },
  ];
}
