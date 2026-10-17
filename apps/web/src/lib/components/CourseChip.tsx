/** コース設定の色を薄い背景に使い、明暗にかかわらず名称を読めるようにする。 */
export function CourseChip({ name, color }: { name: string; color?: string | null }) {
  const hex = color?.match(/^#([0-9a-f]{6}|[0-9a-f]{3})$/i)?.[1];
  const resolved = hex ? `#${hex.length === 3 ? [...hex].map(c => c + c).join("") : hex}` : null;
  return <span className="inline-flex max-w-full items-center rounded-md border px-2 py-1 text-xs font-semibold leading-snug break-words text-slate-800"
    style={{ backgroundColor: resolved ? `${resolved}26` : "#f1f5f9", borderColor: resolved ? `${resolved}66` : "#e2e8f0" }}>{name}</span>;
}
