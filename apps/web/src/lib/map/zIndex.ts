// ============================================================
// 地図作戦盤の重なり順（この画面の憲法）。
//
// 監査（2026-09-08）で「札・検索ヒットピン・修正つまみが検索窓や設定パネルの前に出て
// クリックを奪う」「縮退ドットが隣の札を覆う」原因が、要素ごとにバラバラな z-index に
// あることを確定させた。Marker の zIndex も Tailwind の z-[...] も、必ずここから引く。
//
// 規約:
//   - 操作 UI（ツールバー・検索窓・各パネル）のラッパは pointer-events-none にし、
//     押せる子だけ pointer-events-auto。余白のクリックは地図へ抜ける。
//   - popup(30) は操作 UI(40) より下。隠れるときは地図側を寄せて避ける。
// 設計: docs/design/map-board-usability-2026-09.md §2
// ============================================================

export const MAP_Z = {
  /** Mapbox canvas（3Dモデル・面レイヤー・灯火） */
  canvas: 0,
  /** 拠点ピン */
  place: 1,
  /** 縮退ドット（束の他車）。札より下 */
  vehicleDot: 2,
  /** ナンバー札。「N台」バッジは札の内側に置く */
  plate: 5,
  /** 位置修正のつまみ・下書きピン・検索ヒットピン */
  handle: 6,
  /** 車両 popup（Mapbox Popup） */
  popup: 30,
  /** 地図上の操作 UI（ツールバー・検索窓・チップ・再検索・各パネル・凡例・バナー） */
  controls: 40,
  /** モーダル（fixed） */
  modal: 50,
} as const;

export type MapLayer = keyof typeof MAP_Z;

/** Tailwind の任意値クラス。`z-[40]` のような文字列を返す */
export const mapZClass = (layer: MapLayer) => `z-[${MAP_Z[layer]}]`;
