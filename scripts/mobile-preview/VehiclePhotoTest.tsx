import { useState } from "react";

const photos = [
  { id: "front", label: "正面", file: "IMG_1679.JPG" },
  { id: "right", label: "右側面", file: "IMG_1678.JPG" },
  { id: "rear", label: "背面", file: "IMG_1677.JPG" },
  { id: "left", label: "左側面", file: "IMG_1676.JPG" },
] as const;

export function VehiclePhotoTest() {
  const [selected, setSelected] = useState(0);
  const photo = photos[selected];
  return <section aria-label="車体撮影テスト" style={{ padding: "16px 16px 32px", color: "#192333" }}>
    <h1 style={{ fontSize: 24, fontWeight: 700, margin: "0 0 14px" }}>車体撮影テスト</h1>
    <div role="group" aria-label="表示する写真" style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
      {photos.map((item, index) => <button key={item.id} type="button" aria-pressed={selected === index} onClick={() => setSelected(index)} style={{ minHeight: 48, padding: "8px 16px", borderRadius: 12, border: "1px solid #CBD5E1", backgroundColor: selected === index ? "#192333" : "white", color: selected === index ? "white" : "#192333", fontWeight: 600 }}>{item.label}</button>)}
    </div>
    <div style={{ background: "#20282F", borderRadius: 14, padding: 8, display: "grid", placeItems: "center" }}>
      <img key={photo.id} src={`/__local_vehicle_photo/${photo.id}`} alt={`${photo.label}の車体写真`} style={{ display: "block", width: "100%", maxHeight: "calc(100vh - 220px)", minHeight: 320, objectFit: "contain" }} />
    </div>
    <p style={{ margin: "10px 0 0", fontSize: 13, color: "#526074" }}>{photo.file}</p>
  </section>;
}
