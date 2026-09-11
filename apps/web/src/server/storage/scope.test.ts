// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isStoredPathInScope } from "./scope";
import { uploadDataUrl, resolveStoredUrl, resolveStoredUrls, removeStoredPaths } from "./dataUrl";
import { signInvoiceAttachments, storeInvoiceAttachments } from "@/server/billing/invoiceAttachments";
import { signKyc } from "@/server/kyc/storage";
import { signMeterPhoto } from "@/server/vehicleQr/meterStorage";
import { signInspectionPhoto } from "@/server/vehicleQr/inspectionStorage";
import { signAttachments, removeReportFiles } from "@/server/reportKinds/attachments";
const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
function storage() {
 const bucket = {
  createSignedUrl: vi.fn(async (path: string) => ({data: {signedUrl: `signed:${path}`}})),
  createSignedUrls: vi.fn(async (paths: string[]) => ({data: paths.map(path=>({signedUrl: `signed:${path}`}))})),
  remove: vi.fn(async () => ({error:null})), upload: vi.fn(async () => ({error:null})),
 };
 const from = vi.fn(() => bucket);
 return { db: {storage:{from}} as unknown as SupabaseClient, bucket, from };
}
describe("private file scope", () => {
 it.each(['b/file.png','a-other/file.png','a/../b/file.png','a/%2e%2e/b.png','a//file.png','a/./file.png','a\\file.png','https://example.com/a/file.png','/a/file.png','a/file.png?x=1','a'])('別の範囲・正規化が必要なパスを保存・署名・削除しない: %s',async path=>{
  const {db,from} = storage();
  expect(isStoredPathInScope(path,'a')).toBe(false);
  expect((await uploadDataUrl(db,'files','a',path)).ok).toBe(false);
  expect(await resolveStoredUrl(db,'files',path,'a')).toBeNull();
  await removeStoredPaths(db,'files',[path],'a'); expect(from).not.toHaveBeenCalled();
 });
 it('正規パスは再アップロードしない。PDFは一括署名でもダウンロードを強制する',async()=>{
  const {db,bucket}=storage();
  expect(await uploadDataUrl(db,'files','a','a/file.png')).toEqual({ok:true,path:'a/file.png'});
  expect(bucket.upload).not.toHaveBeenCalled();
  expect(await resolveStoredUrls(db,'files',['a/file.pdf','b/private.png',png,'a/image.png'],'a')).toEqual(['signed:a/file.pdf',null,png,'signed:a/image.png']);
  expect(bucket.createSignedUrls).toHaveBeenCalledWith(['a/file.pdf'],3600,{download:true});
  expect(bucket.createSignedUrls).toHaveBeenCalledTimes(2);
 });
 it('旧base64画像を保ち、HTML/SVGデータURLや偽装PNGは通さない',async()=>{
  const {db,from}=storage();
  expect(await resolveStoredUrl(db,'files',png,'a')).toBe(png);
  for(const value of ['data:text/html;base64,PHNjcmlwdD4=', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:image/png;base64,aGk=']) expect(await resolveStoredUrl(db,'files',value,'a')).toBeNull();
  expect(from).not.toHaveBeenCalled();
 });
 it('他社の請求書添付は全件を検査してから拒否し、アップロードを始めない',async()=>{
  const {db,from}=storage();
  expect((await storeInvoiceAttachments(db,'a',{attachments:[{dataUrl:png},{path:'b/file.pdf'}]})).ok).toBe(false);
  expect(from).not.toHaveBeenCalled();
 });
 it('請求書の外部URLを保存せず、DBの他社参照・偽造済みURLも配らない',async()=>{
  const {db,bucket}=storage();
  const result=await storeInvoiceAttachments(db,'a',{attachments:[{path:'a/file.pdf',url:'https://evil.test/'}]});
  expect(result.ok && (result.payload?.attachments as any[])[0].url).toBeUndefined();
  expect((await storeInvoiceAttachments(db,'a',{attachments:[{dataUrl:'https://evil.test/'}]})).ok).toBe(false);
  const signed=await signInvoiceAttachments(db,'a',{attachments:[{path:'b/file.pdf',url:'https://evil.test/'}]});
  expect(signed?.attachments).toEqual([{path:null,url:null}]); expect(bucket.createSignedUrl).not.toHaveBeenCalled();
 });
 it('本人確認・点検写真は本人単位の保存範囲で検査する',async()=>{
  const {db,bucket}=storage();
  expect(await signKyc(db,'identity-a','identity-b/face.jpg')).toBeNull();
  expect(await signKyc(db,'identity-a','identity-a/face.jpg')).toBe('signed:identity-a/face.jpg');
  expect(await signMeterPhoto(db,{orgId:'a',driverId:'d'},'a/other/1.jpg')).toBeNull();
  expect(await signInspectionPhoto(db,{orgId:'a',driverId:'d'},'b/d/1.jpg')).toBeNull();
  expect(bucket.createSignedUrl).toHaveBeenCalledTimes(1);
 });
 it('旧諸報告のdriver接頭辞を維持し、別driverの添付は閲覧・削除しない',async()=>{
  const {db,bucket}=storage();
  const result=await signAttachments(db,'driver-a',[{fieldId:'file',path:'driver-b/x.pdf',name:'test.pdf',mime:'application/pdf',size:20}]);
  expect(result[0].url).toBeNull();
  await removeReportFiles(db,'driver-a',['driver-b/x.pdf']); expect(bucket.remove).not.toHaveBeenCalled();
 });
});
