// @vitest-environment node
import { describe, expect, it } from "vitest";
import { saveSlots } from "@/server/shiftSlots/config";

// 便（shift_request_slots）は org 列を持たない共有マスタ。元請→下請へ設定が伝わる構造を
// 保つため共有のままにし、**名前・時刻の変更と削除は作った会社だけ**にする（migration 179）。
// 2026-09-18 の点検では、保存が「一覧に無い便を全部消す」「割当を全部消す」を全社横断で
// やっており、A社の保存でB社の便・割当（＋CASCADE で希望休）が消える状態だった。
type Call = { table: string; op: string; args: unknown[] };
type SlotRow = { id: string; name: string; owner_org_id?: string | null };

function client(opts: {
  orgDriverIds: string[];
  slots: SlotRow[];
  ownerSupported?: boolean;
  assignments?: { slot_id: string; driver_id: string }[];
}) {
  const ownerSupported = opts.ownerSupported !== false;
  const calls: Call[] = [];
  const from = (table: string) => {
    const state: { op: string; cols: string; args: unknown[] } = { op: "select", cols: "", args: [] };
    const push = () => calls.push({ table, op: state.op, args: state.args });
    const result = () => {
      if (table === "drivers") return { data: opts.orgDriverIds.map((id) => ({ id })), error: null };
      if (table === "shift_request_slots") {
        // owner_org_id を要求されたとき、未適用環境ではエラーを返す
        if (state.cols.includes("owner_org_id") && !ownerSupported) {
          return { data: null, error: { code: "42703", message: 'column "owner_org_id" does not exist' } };
        }
        return { data: opts.slots, error: null };
      }
      if (table === "driver_request_slots") return { data: opts.assignments ?? [], error: null };
      return { data: [], error: null };
    };
    const chain: Record<string, unknown> = {};
    chain.select = (cols: string) => {
      state.op = state.op === "select" ? "select" : state.op;
      state.cols = cols ?? "";
      return chain;
    };
    chain.update = (v: unknown) => {
      state.op = "update";
      state.args = [v];
      return chain;
    };
    chain.insert = (rows: unknown) => {
      state.op = "insert";
      state.args = [rows];
      push();
      const c: Record<string, unknown> = {};
      c.select = () => c;
      c.single = async () => ({ data: { id: "new-slot" }, error: null });
      c.then = (r: (v: unknown) => unknown) => r({ data: null, error: null });
      return c;
    };
    chain.delete = () => {
      state.op = "delete";
      return chain;
    };
    chain.eq = (col: string, v: unknown) => {
      if (state.op === "update") {
        state.args = [...state.args, col, v];
        push();
        return Promise.resolve({ data: null, error: null });
      }
      return chain;
    };
    chain.in = (col: string, v: unknown) => {
      if (state.op === "delete") {
        state.args = [col, v];
        push();
        return Promise.resolve({ data: null, error: null });
      }
      return chain;
    };
    chain.order = () => chain;
    chain.then = (r: (v: unknown) => unknown) => r(result());
    return chain;
  };
  return { supabase: { from } as never, calls };
}

const slot = (id: string, name: string, owner: string | null) => ({ id, name, owner_org_id: owner });
const input = (id: string | null, name: string, driverIds: string[] = []) => ({
  id, name, startTime: null, endTime: null, active: true, driverIds,
});

describe("便の編集・削除は作った会社だけ", () => {
  it("他社が作った便は、画面から消しても削除しない", async () => {
    const { supabase, calls } = client({
      orgDriverIds: ["own-1"],
      slots: [slot("mine", "1便", "org-1"), slot("theirs", "朝便", "org-2")],
    });
    await saveSlots(supabase, "org-1", []); // 全部消した状態で保存
    const del = calls.find((c) => c.table === "shift_request_slots" && c.op === "delete");
    expect(del?.args[1]).toEqual(["mine"]);
  });

  it("持ち主不明の共有便も削除しない", async () => {
    const { supabase, calls } = client({
      orgDriverIds: ["own-1"],
      slots: [slot("shared", "共有便", null)],
    });
    await saveSlots(supabase, "org-1", []);
    expect(calls.find((c) => c.table === "shift_request_slots" && c.op === "delete")).toBeUndefined();
  });

  it("他社の便は名前を書き換えない（割り当てだけ受け付ける）", async () => {
    const { supabase, calls } = client({
      orgDriverIds: ["own-1"],
      slots: [slot("theirs", "朝便", "org-2")],
    });
    await saveSlots(supabase, "org-1", [input("theirs", "勝手に改名", ["own-1"])]);
    expect(calls.find((c) => c.table === "shift_request_slots" && c.op === "update")).toBeUndefined();
    const insert = calls.find((c) => c.table === "driver_request_slots" && c.op === "insert");
    expect(insert?.args[0]).toEqual([expect.objectContaining({ driver_id: "own-1", slot_id: "theirs" })]);
  });

  it("自社の便は従来どおり書き換えられる", async () => {
    const { supabase, calls } = client({ orgDriverIds: ["own-1"], slots: [slot("mine", "1便", "org-1")] });
    await saveSlots(supabase, "org-1", [input("mine", "1便（改）")]);
    const update = calls.find((c) => c.table === "shift_request_slots" && c.op === "update");
    expect(update?.args[0]).toEqual(expect.objectContaining({ name: "1便（改）" }));
  });

  it("新しい便には自社を持ち主として入れる", async () => {
    const { supabase, calls } = client({ orgDriverIds: ["own-1"], slots: [] });
    await saveSlots(supabase, "org-1", [input(null, "夕便")]);
    const insert = calls.find((c) => c.table === "shift_request_slots" && c.op === "insert");
    expect(insert?.args[0]).toEqual(expect.objectContaining({ name: "夕便", owner_org_id: "org-1" }));
  });
});

describe("割り当ては自社のドライバーに閉じる", () => {
  it("削除は自社のドライバーぶんだけ", async () => {
    const { supabase, calls } = client({ orgDriverIds: ["own-1", "own-2"], slots: [slot("mine", "1便", "org-1")] });
    await saveSlots(supabase, "org-1", [input("mine", "1便", ["own-1"])]);
    const del = calls.find((c) => c.table === "driver_request_slots" && c.op === "delete");
    expect(del?.args).toEqual(["driver_id", ["own-1", "own-2"]]);
  });

  it("他社のドライバーは割り当てに入れない", async () => {
    const { supabase, calls } = client({ orgDriverIds: ["own-1"], slots: [slot("mine", "1便", "org-1")] });
    await saveSlots(supabase, "org-1", [input("mine", "1便", ["own-1", "other-1"])]);
    const insert = calls.find((c) => c.table === "driver_request_slots" && c.op === "insert");
    expect(insert?.args[0]).toEqual([expect.objectContaining({ driver_id: "own-1" })]);
  });
});

describe("migration 179 未適用でも壊れない", () => {
  it("持ち主が分からないときは、他社が使っている便だけを守る", async () => {
    const { supabase, calls } = client({
      orgDriverIds: ["own-1"],
      ownerSupported: false,
      slots: [{ id: "used-by-other", name: "朝便" }, { id: "unused", name: "孤児便" }],
      assignments: [{ slot_id: "used-by-other", driver_id: "other-1" }],
    });
    await saveSlots(supabase, "org-1", []);
    const del = calls.find((c) => c.table === "shift_request_slots" && c.op === "delete");
    expect(del?.args[1]).toEqual(["unused"]);
  });

  it("持ち主列が無ければ owner_org_id を書き込まない", async () => {
    const { supabase, calls } = client({ orgDriverIds: ["own-1"], ownerSupported: false, slots: [] });
    await saveSlots(supabase, "org-1", [input(null, "夕便")]);
    const insert = calls.find((c) => c.table === "shift_request_slots" && c.op === "insert");
    expect(insert?.args[0]).not.toHaveProperty("owner_org_id");
  });
});
