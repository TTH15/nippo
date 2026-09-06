// ドライバー一覧（本番 /admin/users のページ本体）用の架空データ。実在の個人情報は含まない。
import type { PreviewFixture } from "@/lib/preview/fixtureStore";

type Course = { id: string; name: string; color: string; carrier_name?: string | null };
type Identity = {
  id: string; slot: number; driver_code: string; office_code: string; label?: string | null;
  driver_courses: { course_id: string; courses: Course }[];
};
export type MockDriver = {
  id: string; name: string; display_name?: string | null; role?: string; role_id?: string | null;
  faceUrl?: string | null; phone_verified_at?: string | null; has_passkey?: boolean;
  company_code?: string; office_code: string; driver_code: string; list_no?: number | null; created_at?: string;
  license_expiry_date?: string | null; status?: string; active_from_month?: string | null; active_until_month?: string | null;
  postal_code?: string | null; address?: string | null; phone?: string | null;
  bank_name?: string | null; bank_no?: string | null; bank_holder?: string | null;
  driver_identities?: Identity[];
};
type Lease = { id?: string; mode: "MONTHLY" | "DAILY"; amount: number; valid_from: string; valid_to?: string | null };
type LeaseState = { lease: Lease | null; revision: string; upcoming: Lease[] };

export const previewCourses: Course[] = [
  { id: "course-1", name: "豊中", color: "#fbbf24", carrier_name: "ヤマト" },
  { id: "course-2", name: "吹田", color: "#38bdf8", carrier_name: "ヤマト" },
  { id: "course-3", name: "北大阪", color: "#34d399", carrier_name: "Amazon" },
];
export const previewRoles = [
  { id: "role-admin", label: "管理者" },
  { id: "role-accounting", label: "経理" },
  { id: "role-driver", label: "ドライバー" },
];

const names = ["佐藤 翔太", "田中 美咲", "鈴木 大輔", "高橋 健太", "伊藤 彩", "渡辺 直樹", "山本 葵", "中村 拓海"];

function identity(driverIndex: number, slot: number, office: string, code: string, courseIds: string[]): Identity {
  return {
    id: `identity-${driverIndex}-${slot}`, slot, driver_code: code, office_code: office, label: null,
    driver_courses: courseIds.map((course_id) => ({ course_id, courses: previewCourses.find((c) => c.id === course_id)! })),
  };
}

function makeDriver(i: number, name: string, overrides: Partial<MockDriver> = {}): MockDriver {
  const office = i % 2 ? "0902" : "0901";
  const code = String(1001 + i);
  return {
    id: `driver-${i + 1}`, name, display_name: null, role: "DRIVER", role_id: i === 0 ? "role-admin" : "role-driver",
    faceUrl: null, phone_verified_at: i % 3 === 2 ? null : "2026-06-01T09:00:00+09:00", has_passkey: i % 4 !== 3,
    company_code: "DEFAULT", office_code: office, driver_code: code, list_no: i + 1,
    created_at: `2026-0${1 + (i % 6)}-1${i % 9}T09:00:00+09:00`,
    license_expiry_date: i === 1 ? "2026-09-20" : i === 5 ? null : `2028-0${1 + (i % 9)}-15`,
    status: "active", active_from_month: "2026-01", active_until_month: null,
    postal_code: "530-0001", address: `大阪府大阪市北区梅田1-${i + 1}-${i + 2}`, phone: `0901234${String(5000 + i).padStart(4, "0")}`,
    bank_name: i % 2 ? "京都信用金庫 梅津支店" : null, bank_no: i % 2 ? `普通 ${3000000 + i}` : null, bank_holder: i % 2 ? name.replace(" ", "　") : null,
    driver_identities: [
      identity(i, 1, office, code, i === 6 ? [] : [previewCourses[i % 3].id]),
      ...(i === 2 ? [identity(i, 2, "0903", String(2001 + i), [previewCourses[2].id])] : []),
    ],
    ...overrides,
  };
}

function seedDrivers(): MockDriver[] {
  return [
    ...names.map((name, i) => makeDriver(i, name)),
    makeDriver(8, "小林 悠斗", { status: "inactive", active_until_month: "2026-06", list_no: 9 }),
    makeDriver(9, "加藤 真央", { status: "inactive", active_until_month: "2026-08", list_no: 10 }),
  ];
}

function longNameDrivers(): MockDriver[] {
  return [
    makeDriver(0, "ヴォルフガング・アマデウス・モーツァルト・フォン・ハプスブルク", {
      display_name: "とてもとても長い表示名を設定したドライバーのサンプルです",
      address: "京都府京都市右京区西京極徳大寺団子田町十六番地の三 サンプルレジデンス梅津川ハイツ壱番館一二〇三号室",
      bank_name: "京都中央信用金庫 西京極徳大寺団子田町駅前支店",
    }),
    makeDriver(1, "田中 美咲"),
    makeDriver(2, "李"),
  ];
}

function manyDrivers(): MockDriver[] {
  const family = ["佐藤", "鈴木", "高橋", "田中", "伊藤", "渡辺", "山本", "中村", "小林", "加藤"];
  const given = ["翔太", "美咲", "大輔", "健太", "彩", "直樹", "葵", "拓海", "悠斗", "真央"];
  return Array.from({ length: 45 }, (_, i) => makeDriver(i, `${family[i % 10]} ${given[Math.floor(i / 10) % 10]}${i >= 10 ? i : ""}`, { role_id: "role-driver" }));
}

type State = { drivers: MockDriver[]; leases: Map<string, LeaseState> };

const PAGE_SIZE = 20;

function snake(key: string) {
  return key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

export const usersFixture: PreviewFixture<State> = {
  id: "users",
  title: "ドライバー一覧",
  pathname: "/admin/users",
  scenarios: {
    normal: { label: "通常", description: "稼働中8名・稼働終了2名。免許期限間近・コース未設定・電話未認証を含む" },
    empty: { label: "0件", description: "ドライバーが1人もいない" },
    "long-name": { label: "長い名前", description: "長い氏名・表示名・住所・銀行名と1文字の氏名" },
    large: { label: "大量", description: "45名。20名ずつの追加読み込み" },
  },
  createState: ({ scenario }) => ({
    drivers: scenario === "empty" ? [] : scenario === "long-name" ? longNameDrivers() : scenario === "large" ? manyDrivers() : seedDrivers(),
    leases: new Map(),
  }),
  read: (state, { path, params }) => {
    if (path === "/api/admin/users") {
      const status = params.get("status") ?? "active";
      const list = state.drivers.filter((d) => (d.status ?? "active") === status);
      const cursor = Number(params.get("cursor") ?? "0") || 0;
      const limit = Number(params.get("limit") ?? String(PAGE_SIZE)) || PAGE_SIZE;
      const hasMore = cursor + limit < list.length;
      return { drivers: list.slice(cursor, cursor + limit), nextCursor: hasMore ? String(cursor + limit) : null, hasMore, total: list.length };
    }
    if (path === "/api/admin/courses") return { courses: previewCourses };
    if (path === "/api/admin/roles") return { roles: previewRoles };
    if (path === "/api/admin/driver-lease") {
      const id = params.get("driver_id") ?? "";
      return state.leases.get(id) ?? { lease: null, revision: "rev-0", upcoming: [] };
    }
    const match = path.match(/^\/api\/admin\/users\/([^/]+)$/);
    if (match) {
      const driver = state.drivers.find((d) => d.id === match[1]);
      return driver ? { driver } : undefined;
    }
    return undefined;
  },
  write: (state, { path, method, body }) => {
    if (path === "/api/admin/users" && method === "POST") {
      const i = state.drivers.length;
      const driver = makeDriver(i, String(body.name ?? "新規ドライバー"), {
        id: `driver-new-${i + 1}`, display_name: (body.displayName as string) ?? null, role_id: null, list_no: i + 1,
        office_code: String(body.officeCode ?? "0901"), driver_code: String(body.driverCode ?? String(1100 + i)),
        phone_verified_at: null, has_passkey: false, license_expiry_date: (body.licenseExpiryDate as string) ?? null,
        postal_code: (body.postalCode as string) ?? null, address: (body.address as string) ?? null, phone: (body.phone as string) ?? null,
        bank_name: (body.bankName as string) ?? null, bank_no: (body.bankNo as string) ?? null, bank_holder: (body.bankHolder as string) ?? null,
        driver_identities: [identity(i, 1, String(body.officeCode ?? "0901"), String(body.driverCode ?? String(1100 + i)), Array.isArray(body.courseIds) ? (body.courseIds as string[]) : [])],
      });
      state.drivers.push(driver);
      return { driver };
    }
    if (path === "/api/admin/driver-lease" && method === "PUT") {
      const id = String(body.driver_id ?? "");
      const enabled = !!body.enabled;
      const next: LeaseState = {
        lease: enabled ? { id: `lease-${id}`, mode: body.mode === "DAILY" ? "DAILY" : "MONTHLY", amount: Number(body.amount) || 0, valid_from: String(body.valid_from ?? "2026-09-01"), valid_to: null } : null,
        revision: `rev-${Date.now()}`,
        upcoming: [],
      };
      state.leases.set(id, next);
      return next;
    }
    const phone = path.match(/^\/api\/admin\/users\/([^/]+)\/phone$/);
    if (phone && method === "DELETE") {
      const driver = state.drivers.find((d) => d.id === phone[1]);
      if (!driver) return undefined;
      driver.phone = null; driver.phone_verified_at = null;
      return { ok: true };
    }
    const match = path.match(/^\/api\/admin\/users\/([^/]+)$/);
    if (match && method === "PUT") {
      const driver = state.drivers.find((d) => d.id === match[1]);
      if (!driver) return undefined;
      for (const [key, value] of Object.entries(body)) {
        if (["courseIds", "courseIds2", "officeCode2", "driverNumber2"].includes(key)) continue;
        (driver as Record<string, unknown>)[snake(key)] = value;
      }
      return { ok: true };
    }
    if (match && method === "DELETE") {
      state.drivers = state.drivers.filter((d) => d.id !== match[1]);
      return { ok: true };
    }
    return undefined;
  },
};
