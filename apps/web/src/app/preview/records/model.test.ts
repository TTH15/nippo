import { describe, expect, it } from "vitest";
import { initialDemo, canCreate, canReadRecord, canSeeForm, canEditRecord, displayValue, validateDefinition, validateAnswers, makeTemplate } from "./model";

describe("orgフォームのプレビュー", () => {
  it("解決済みだけが対応終了で、フォーム間や過去記録に設定変更が波及しない", () => {
    const { forms, records } = initialDemo();
    expect(forms[0].statuses.filter(s => s.terminal).map(s => s.id)).toEqual(["resolved"]);
    forms[0].statuses.find(s => s.id === "resolved")!.terminal = false;
    expect(validateDefinition(forms[0])).toContain("対応状況");
    expect(makeTemplate("case", "other").statuses.find(s => s.id === "resolved")!.terminal).toBe(true);
    expect(records[0].schema.statuses.find(s => s.id === "resolved")!.terminal).toBe(true);
    forms[0].statuses = [];
    expect(validateDefinition(forms[0])).toBeNull();
    expect(records[0].status).toBe("resolved");
    expect(forms[1].statuses).toEqual([]);
    expect(records[2].status).toBe("");
  });
  it("運営と経理で見えるフォームを分ける", () => {
    const {forms}=initialDemo();
    expect(forms.filter(f=>canSeeForm(f,"operations")).map(f=>f.id)).toEqual(["cases","memos"]);
    expect(forms.filter(f=>canSeeForm(f,"accounting")).map(f=>f.id)).toEqual(["payments","memos"]);
    expect(canCreate(forms[2],"accounting")).toBe(false);
  });
  it("提出の公開は他人の記録の公開にならない", () => {
    const {forms,records}=initialDemo();
    expect(canCreate(forms[0],"driver")).toBe(true);
    expect(canReadRecord(forms[0],"driver",records[0])).toBe(true);
    expect(canReadRecord(forms[0],"driver",records[1])).toBe(false);
    expect(canEditRecord(forms[0],"driver",records[0])).toBe(false);
  });
  it("本人宛の日払いを閲覧だけ公開できる", () => {
    const {forms,records}=initialDemo();
    forms[1].driver.readSubject=true;
    expect(canSeeForm(forms[1],"driver")).toBe(true);
    expect(canReadRecord(forms[1],"driver",records[2])).toBe(true);
    expect(canCreate(forms[1],"driver")).toBe(false);
    expect(canEditRecord(forms[1],"driver",records[2])).toBe(false);
    records[2].answers.recipient="sakata";
    expect(canReadRecord(forms[1],"driver",records[2])).toBe(false);
  });
  it("フォームの項目・選択肢を変更しても過去記録を保持する", () => {
    const {forms,records}=initialDemo();
    forms[0].fields.find(f=>f.id==="category")!.options![0].label="配達先相違";
    forms[0].fields=forms[0].fields.filter(f=>f.id!=="prevention");
    expect(displayValue(records[0].schema.fields.find(f=>f.id==="category")!,records[0].answers.category)).toBe("誤配");
    expect(records[0].schema.fields.some(f=>f.id==="prevention")).toBe(true);
  });
  it("テンプレートは独立し、金額を任意の単位で表示する", () => {
    const a=makeTemplate("payment","a"),b=makeTemplate("payment","b");
    a.fields[0].label="変更";
    expect(b.fields[0].label).toBe("件名");
    expect(displayValue(a.fields.find(f=>f.id==="amount")!,8500)).toBe("8,500円");
  });
  it("公開範囲とフォーム定義の不整合を拒否する", () => {
    const f=makeTemplate("memo","test");
    f.driver.readSubject=true;
    expect(validateDefinition(f)).toContain("対象者");
    f.driver.readSubject=false;f.driver.editOwn=true;
    expect(validateDefinition(f)).toContain("閲覧");
    f.driver.editOwn=false;f.titleField="missing";
    expect(validateDefinition(f)).toContain("件名");
  });
  it("必須項目と数値制約を適用する", () => {
    const f=makeTemplate("payment","test");
    expect(validateAnswers(f,{})).toContain("件名");
    const values={title:"支払い",date:"2026-06-18",work_date:"2026-06-17",recipient:"sato",amount:-1,method:"bank"};
    expect(validateAnswers(f,values)).toContain("数値");
    expect(validateAnswers(f,{...values,amount:8500})).toBeNull();
  });
  it("その他の自由入力を表示・検索用文字列へ反映し、保存時の定義も保持する", () => {
    const f = makeTemplate("case", "test");
    const old = structuredClone(f);
    const field = f.fields.find(field => field.id === "category")!;
    const answer = { selected: [], other: "建物の入館方法" };
    expect(validateAnswers(f, { title: "記録", date: "2026-08-30", body: "確認", category: answer })).toBeNull();
    expect(displayValue(field, answer)).toBe("その他：建物の入館方法");
    field.allowOther = false;
    expect(old.fields.find(field => field.id === "category")!.allowOther).toBe(true);
    expect(displayValue(old.fields.find(field => field.id === "category")!, answer)).toBe("その他：建物の入館方法");
  });
});
