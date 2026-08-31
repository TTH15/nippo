export type DriverSaveSection = "profile" | "lease";
export type DriverSaveTask = { section: DriverSaveSection; save: () => Promise<unknown>; onSaved: () => void };

/** 成功した部分だけ基準を進める。失敗した入力は次の保存でも変更として残す。 */
export async function saveDriverSections(tasks: DriverSaveTask[]): Promise<void> {
  const results = await Promise.allSettled(tasks.map(task => task.save()));
  const failed: string[] = [];
  results.forEach((result, index) => {
    if (result.status === "fulfilled") tasks[index].onSaved();
    else failed.push(`${tasks[index].section === "lease" ? "リース契約" : "基本情報"}：${result.reason instanceof Error ? result.reason.message : "保存に失敗しました"}`);
  });
  if (failed.length) throw new Error(`${failed.join("\n")}\n成功した項目は保存済みです。未保存の入力は残っています。`);
}
