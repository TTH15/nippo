import { describe, expect, it, vi } from "vitest";
import { saveDriverSections } from "./saveSections";

describe("ドライバーの部分保存", () => {
  it("契約が失敗したら基本情報だけ確定し、契約を再試行できる", async () => {
    const profile = vi.fn().mockResolvedValue(undefined);
    const lease = vi.fn().mockRejectedValueOnce(new Error("DB unavailable")).mockResolvedValue(undefined);
    let profileDirty = true, leaseDirty = true;
    const save = () => saveDriverSections([
      ...(profileDirty ? [{ section:"profile" as const, save:profile,onSaved:()=>{profileDirty=false;} }] : []),
      ...(leaseDirty ? [{ section:"lease" as const, save:lease,onSaved:()=>{leaseDirty=false;} }] : []),
    ]);
    await expect(save()).rejects.toThrow("リース契約：DB unavailable");
    expect(profileDirty).toBe(false); expect(leaseDirty).toBe(true);
    await save(); expect(profile).toHaveBeenCalledTimes(1); expect(lease).toHaveBeenCalledTimes(2); expect(leaseDirty).toBe(false);
  });
  it("基本情報が失敗しても保存済みの契約を再送しない", async () => {
    const profileSaved=vi.fn(),leaseSaved=vi.fn();
    await expect(saveDriverSections([{section:"profile",save:async()=>{throw Error("profile failed");},onSaved:profileSaved},{section:"lease",save:async()=>{},onSaved:leaseSaved}])).rejects.toThrow("基本情報");
    expect(profileSaved).not.toHaveBeenCalled(); expect(leaseSaved).toHaveBeenCalledOnce();
  });
  it("両方失敗したらどちらも保存済みにしない", async () => {
    const saved=vi.fn();
    await expect(saveDriverSections(["profile","lease"].map(section=>({section:section as "profile"|"lease",save:async()=>{throw Error("error");},onSaved:saved})))).rejects.toThrow("未保存の入力は残っています");
    expect(saved).not.toHaveBeenCalled();
  });
});
