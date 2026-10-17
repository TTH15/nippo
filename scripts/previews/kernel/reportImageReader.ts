// 反映先・再アップロードの操作検証用。OCR精度の検証には使わない。
import * as actual from "../../../apps/web/src/lib/ocr/reportImageReader";
export * from "../../../apps/web/src/lib/ocr/reportImageReader";
const isFixture = () => location.pathname === "/preview/admin/submit" && ["cycles","image-multi","image-reupload"].includes(new URLSearchParams(location.search).get("scenario") ?? "");
export function prefetchReportImageReader() { if (!isFixture()) actual.prefetchReportImageReader(); }
export const releaseReaders = actual.releaseReaders;
export const readReportImage: typeof actual.readReportImage = async (file,templates,options) => {
  if(!isFixture()) return actual.readReportImage(file,templates,options);
  const template = templates[0];
  const canvas = document.createElement("canvas"); canvas.width=600;canvas.height=360;
  const ctx=canvas.getContext("2d")!;ctx.fillStyle="#fff";ctx.fillRect(0,0,600,360);ctx.fillStyle="#172033";ctx.font="24px sans-serif";
  const fields = template.definition.fields.filter(field => (field.role ?? "entry") === "entry").map((field,index) => {
    const value = ([72,64,53,48][index] ?? 10) + ((file instanceof File && file.name.includes("second")) ? 10 : 0);
    ctx.fillText(`${field.label}   ${value}`,24,50+index*65);
    return { fieldId: field.id,unitId: field.unitId,fieldKey: field.fieldKey,label: field.label,role: "entry" as const,raw: String(value),value,status: "read" as const,box: null,anchorBox: null,confidence: 99,refined: true };
  });
  return { template,rotation: 0,ambiguous: false,crops: {},prepared: { canvas,width:600,height:360,rotate:0,angle:0,inverted:false },attempts:[],
    result: { match: { templateKey:template.key,templateVersion:template.version,name:template.name,score:1,level:"high",missingRequired:[],hits:[],accepted:true },fields,readDate:options?.reportDate ?? null,warnings:[],trust: { level:"verified",checksRun:2,checksFailed:0,incomplete:false,reasons:[] } } };
};
