"use client";

// 地図上のナンバー札。画像化した共通 VehiclePlate を出し、画像化前・失敗時は SVG プレートで代替する。
// 本番 /admin/map の吹き出しと検討用プレビューで共用（バッジや状態表示は呼び出し側が children で足す）。
import { useEffect, useState } from "react";
import type { VehiclePlateData } from "@repo/core/types";
import { VehiclePlate } from "@/lib/components/VehiclePlate";
import { loadMapPlateImage, mapPlateImageKey, MAP_PLATE_HEIGHT, MAP_PLATE_WIDTH, type MapPlateImage } from "@/lib/map/mapPlateImage";

export function MapPlateLabel({
  vehicle,
  selected = false,
  children,
}: {
  vehicle: VehiclePlateData;
  selected?: boolean;
  children?: React.ReactNode;
}) {
  const imageKey = mapPlateImageKey(vehicle);
  const [plateImage, setPlateImage] = useState<MapPlateImage | null>(null);

  useEffect(() => {
    let active = true;
    loadMapPlateImage(vehicle).then((image) => {
      if (active) setPlateImage(image);
    }).catch((error) => {
      // 画像化できない場合も SVG プレートを表示して操作は維持する
      console.warn("地図用ナンバー札を画像化できませんでした", error);
    });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageKey]);

  return (
    <span
      className={`relative isolate block rounded-lg transition-shadow ${selected ? "ring-2 ring-amber-400 ring-offset-2 ring-offset-white/90" : ""}`}
      style={{ width: MAP_PLATE_WIDTH, height: MAP_PLATE_HEIGHT, transform: "translateZ(0)", backfaceVisibility: "hidden", WebkitBackfaceVisibility: "hidden" }}
    >
      {plateImage ? (
        <img
          aria-hidden
          alt=""
          draggable={false}
          src={plateImage.src}
          data-map-plate-rendering="bitmap"
          className="pointer-events-none absolute max-w-none select-none"
          style={{ left: -plateImage.padding, top: -plateImage.padding, width: plateImage.width, height: plateImage.height }}
        />
      ) : (
        <VehiclePlate vehicle={vehicle} compact glow={false} className="!max-w-none w-full pointer-events-none" />
      )}
      {children}
    </span>
  );
}
