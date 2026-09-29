"use client";

import { useMemo, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faChevronDown, faMagnifyingGlass } from "@fortawesome/free-solid-svg-icons";
import { SmoothCollapse } from "@/lib/components/SmoothCollapse";
import catalog from "@/lib/routePermissionsCatalog.json";
import roleCatalog from "@/lib/roleCatalog.json";

type Role = { id: string; key: string; label: string; capabilities: string[] };

function expandCapabilities(granted: string[]): Set<string> {
  const out = new Set<string>();
  const stack = [...granted];
  const implies: Record<string, string[]> = roleCatalog.capabilityImplies;
  while (stack.length) {
    const capability = stack.pop()!;
    if (out.has(capability)) continue;
    out.add(capability);
    stack.push(...(implies[capability] ?? []));
  }
  return out;
}

export function ApiPermissionCatalog({ roles }: { roles: Role[] }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [roleId, setRoleId] = useState("");
  const [limit, setLimit] = useState(50);
  const role = roles.find((item) => item.id === roleId);
  const effective = useMemo(
    () => role ? expandCapabilities(role.capabilities) : null,
    [role],
  );
  const rows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return catalog.filter((item) => !query || `${item.method} ${item.endpoint} ${item.description} ${item.guard}`.toLowerCase().includes(query));
  }, [search]);

  const access = (guard: string): string => {
    if (!role || !effective) return "";
    if (guard.startsWith("公開") || guard.startsWith("LINE署名") || guard.startsWith("CRON_SECRET")) return "ロール対象外";
    if (guard.startsWith("プラットフォーム")) return "運営者のみ";
    if (guard.startsWith("範囲 ")) return "本人・対象で判定";
    if (guard.startsWith("認証")) return "本人・対象で判定";
    if (guard.includes("フォームごと")) return "フォームごとに判定";
    if (role.key === "ADMIN") return "入口可";
    const required = [...guard.matchAll(/can_[a-z_]+/g)].map((match) => match[0]);
    if (!required.length) return "個別条件";
    const permitted = guard.startsWith("いずれか")
      ? required.some((capability) => effective.has(capability))
      : required.every((capability) => effective.has(capability));
    return permitted ? "入口可" : "権限なし";
  };

  return (
    <section className="mt-8 overflow-hidden rounded-xl border border-slate-200 bg-white" id="api-permissions">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls="api-permissions-table"
        className="flex w-full items-center justify-between gap-3 px-4 py-4 text-left text-sm font-semibold text-slate-900"
      >
        <span>API・権限一覧 <span className="ml-1 font-normal text-slate-500">{catalog.length}件</span></span>
        <FontAwesomeIcon icon={faChevronDown} className={`text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      <SmoothCollapse open={open} id="api-permissions-table">
        <div className="border-t border-slate-200 p-4">
          <div className="flex flex-col gap-2 sm:flex-row">
            <label className="relative min-w-0 flex-1">
              <span className="sr-only">APIを検索</span>
              <FontAwesomeIcon icon={faMagnifyingGlass} className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-400" />
              <input
                value={search}
                onChange={(event) => { setSearch(event.target.value); setLimit(50); }}
                placeholder="操作・URL・権限で検索"
                className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm"
              />
            </label>
            <label>
              <span className="sr-only">ロールを選択</span>
              <select value={roleId} onChange={(event) => setRoleId(event.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm sm:w-auto">
                <option value="">ロールを選択</option>
                {roles.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
            </label>
          </div>
          <p className="my-3 text-xs text-slate-500">{rows.length}件。表示する「入口可」は追加の所属・本人・対象条件を含みません。</p>
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full min-w-[660px] border-collapse text-left text-xs">
              <thead className="bg-slate-50 text-slate-600">
                <tr><th className="px-3 py-2">Method</th><th className="px-3 py-2">エンドポイント</th><th className="px-3 py-2">操作</th><th className="px-3 py-2">必要な権限</th>{role && <th className="px-3 py-2">{role.label}</th>}</tr>
              </thead>
              <tbody>
                {rows.slice(0, limit).map((item) => (
                  <tr key={`${item.method} ${item.endpoint}`} className="border-t border-slate-100 align-top">
                    <td className="px-3 py-2 font-semibold text-slate-700">{item.method}</td>
                    <td className="max-w-[240px] break-all px-3 py-2 font-mono text-slate-800">{item.endpoint}</td>
                    <td className="px-3 py-2 text-slate-700">{item.description}</td>
                    <td className="max-w-[260px] break-words px-3 py-2 text-slate-600">{item.guard}</td>
                    {role && <td className="whitespace-nowrap px-3 py-2 font-medium text-slate-700">{access(item.guard)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > limit && (
            <button type="button" onClick={() => setLimit((value) => value + 50)} className="mt-3 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700">さらに表示</button>
          )}
        </div>
      </SmoothCollapse>
    </section>
  );
}
