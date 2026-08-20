# 車両3Dモデル — 引き継ぎ資料（2026-08-20 時点）

地図と車両詳細ページに載せる軽バン（ホンダ アクティバン）の3Dモデルを作る仕事。
**この文書だけ読めば作業を継続できる**ように書いてある。作業ログの該当エントリは
`docs/worklog/2026-08.md` の 2026-08-18〜20（`grep -n '^## ' docs/worklog/2026-08.md` で一覧）。

---

## 1. 今どこにいるか

### できていること

- **塗り分けが自動化された**。手作業（1車種10分の見込みだった）はゼロ
- **詳細ページ用モデルが確定**: `apps/web/public/models/acty_detail.glb`
  （105,568 三角形 / 0.79MB / Draco 圧縮）
- **プレビュー画面**が動く: `http://localhost:3001/preview/vehicle`（認証不要）
- Three.js 側の Draco 対応: `apps/web/src/lib/three/gltf-loader.ts`

### できていないこと（優先度順）

1. **地図用の粗いモデルが旧パイプラインのまま**。`actymap_b_tinted/fixed.glb` は
   Collapse 下ごしらえ時代の生成物で、車体が歪んでいる。新パイプラインで作り直す
2. **`rotation` が効いていない疑い**（本番にも影響）。§5-1 参照
3. 本番の地図画面 `/admin/map` へ、2レイヤー方式とヘッドライト光が**未移植**
4. 未コミットの glb が 25MB 近くある。検証用の中間生成物なので整理してからコミット

### 未コミット

`git status` に 40 件ほど。うち `apps/web/public/models/*.glb` の大半は**検証用の中間生成物**。
最終的に残すのは次の3つで足りるはず（＋比較用に数個）。

| 残すもの | 用途 |
|---|---|
| `acty_detail.glb` | 車両詳細ページ |
| 地図用 tinted | 地図・車体（作り直しが必要） |
| 地図用 fixed | 地図・窓/灯火/車輪（同上） |

---

## 2. 動かし方

### 前提

- Blender 5.2 が `/Applications/Blender.app/Contents/MacOS/Blender`
- 生ファイルは **git に入れない**。`~/Developer/assets/hakotora-3d/` に置く
  （100MB級。2026-08-11 に履歴ごと削除して .git を 258MB → 65MB にした経緯がある）
- 原本は `~/Developer/assets/hakotora-3d/Meshy_AI_acty_van_multiview_3d_0820084707_image-to-3d-texture.glb`
  （67MB / 1,951,116 三角形 / **テクスチャ付き**）

### モデルを作る

`build_vehicle.py` はパラメータを `globals()` から読む。**前置きファイルと連結して**渡す。

```bash
SP=/tmp/vehicle-build && mkdir -p $SP
cat > $SP/params.py <<'EOF'
import os
SOURCE_GLB = os.path.expanduser("~/Developer/assets/hakotora-3d/Meshy_AI_acty_van_multiview_3d_0820084707_image-to-3d-texture.glb")
OUT_DIR = os.path.expanduser("~/Developer/assets/hakotora-3d/acty")
NAME = "acty_detail"
DRACO = True          # 詳細ページ用は圧縮する。★地図用には掛けない
EOF
cat $SP/params.py scripts/blender-mcp/models/build_vehicle.py > $SP/build.py
/Applications/Blender.app/Contents/MacOS/Blender -b -P $SP/build.py
```

所要 3〜6分。出力は `OUT_DIR` に3つ:

| ファイル | 中身 |
|---|---|
| `{NAME}_raw.glb` | 全部入り（詳細ページ用） |
| `{NAME}_tinted_raw.glb` | 車体だけ（地図で `model-color` が乗る側） |
| `{NAME}_fixed_raw.glb` | 窓・灯火・車輪（色が変わらない側） |
| `{NAME}.blend` | 分割前の状態。手で触るときの正本 |

### 地図へ配信する

**必ず `finish-glb-for-mapbox.mjs` を通す。** Mapbox の model レイヤーが読める形に直すだけで、
幾何は動かさない（＝2ファイルを重ねてもズレない）。

```bash
node scripts/finish-glb-for-mapbox.mjs <入力_tinted_raw.glb> apps/web/public/models/<名前>_tinted.glb
node scripts/finish-glb-for-mapbox.mjs <入力_fixed_raw.glb>  apps/web/public/models/<名前>_fixed.glb
```

★**生成と配信はひとまとめにする**。glb を作り直したのに配信を忘れて旧版が出たまま、を
過去に2回やっている。

### 詳細ページへ配信する

Draco 込みで書き出したものをそのままコピーするだけ（finish は通さない）。

```bash
cp ~/Developer/assets/hakotora-3d/acty/acty_detail_raw.glb apps/web/public/models/acty_detail.glb
```

### 確認する

```bash
node scripts/glb-stats.mjs <glb...>      # 三角形数・頂点数・マテリアル・B/三角形
node scripts/glb-textures.mjs <glb> <出力先>   # テクスチャを取り出す
```

`glb-stats.mjs` の**頂点/三角形比**は連結性の目安になる。0.5 前後なら頂点共有あり、
3.0 なら完全にバラバラ。

見た目の確認は Blender で正射影レンダリングするのが速い（`docs/worklog/2026-08.md` の
20:40 のエントリに使ったスクリプトの説明がある）。ブラウザは WebGL の都合で詰まりやすい。

---

## 3. パイプラインの中身（`build_vehicle.py`）

順序に意味がある。**入れ替えると壊れる**。

```
import_and_normalize()        実寸化・原点=底面中心・前を -Y に。法線を再計算
classify_by_texture()         ★あらゆる減面より前。UV でテクスチャ色を引いて部位を判定
pre_dissolve()                浅い角度(1.5度)の限定的溶解。200万 → 695,616 面
smooth_material_boundaries()  ★平面統合の前。塗り分けの境界を多数決で均す
pre_collapse()                既定は無効（保険）
detect_wheels() / remove_wheel_geometry()
denoise_and_flatten()         稜線を守りつつ平面統合（delimit={SHARP, MATERIAL}）
cull_hidden_faces()           ★既定は無効。§4-6 参照
finalize_shading()            頂点を溶接 → drop_specks() → 角度で法線を共有
build_clean_wheels()          車輪を円柱に差し替え
```

### 確定した既定値（2026-08-20）

| パラメータ | 値 | 理由 |
|---|---|---|
| `PRE_DISSOLVE_ANGLE` | 1.5 | 下ごしらえ。**Collapse は使わない**（形が歪む） |
| `PLANAR_ANGLE` | 30.0 | 本番の平面統合 |
| `CLASSIFY_DOWNSAMPLE` | 16 | 分類前にテクスチャを 1/16 へ縮小 |
| `BOUNDARY_SMOOTH_PASSES` | 4 | 境界の多数決 |
| `SPECK_MAX_AREA` | 0.012 m2 | これ未満の塗り分けの島は車体色へ |
| `SHADE_SMOOTH_ANGLE` | 32.0 | 法線を共有する角度 |
| `HIDDEN_CULL_RAYS` | **0** | 無効。§4-6 |
| `MERGE_INTO_BODY` | `()` | 地図用だけ `("black",)` を指定する |
| `WHEEL_RADIUS` | 0.295 | 実測せず実車値を使う |

### テクスチャ色による分類

Meshy の texture 版は**テクスチャに塗り分けが焼かれている**。面の UV でベースカラーを
引けば部位が分かる。閾値は色分けレンダリングで目視確認したもの。

| 部位 | 判定（HSV） |
|---|---|
| `glass` | 0.30 ≤ V < 0.58 かつ S < 0.30 |
| `black` | V < 0.30（窓枠・グリル・モール・下回り） |
| `amber` | S > 0.35, V > 0.35, 色相 0.05〜0.19 |
| `red` | S > 0.35, V > 0.30, 色相 < 0.05 または > 0.95 |
| `body` | 上記以外 |

---

## 4. 地雷集（すべて実測で踏んだ）

### 4-1. 減面は Collapse ではなく限定的溶解

Collapse は誤差が小さい順に頂点を潰すので、**平らな面ほど先に削られて歪む**。
車体がボコボコになる元凶だった。**原本(200万面)に直接 溶解を掛けられる**
（「落ちる」という古い記録は誤り。ヘッドレスなら通る）。

### 4-2. 頂点を動かす平滑化はしない

`SMOOTH_ITER` の Smooth モディファイアは**リア窓の枠を溶かす**。稜線上の頂点を保護しても
隣の頂点が動いて段差を潰すので効かない。既定 0 のまま触らない。
**`shade_smooth_by_angle`（法線の共有）とは別物**。こちらは幾何を動かさないので必須。

### 4-3. 分類は「あらゆる減面より前」

減面すると面の UV 重心が UV アイランドの外（テクスチャの黒い隙間）に落ちる。

### 4-4. 塗り分けの境界が細かいと面数が落ちない

`delimit={MATERIAL}` で平面統合が境界に阻まれるため。窓の縁がギザギザになるのと同じ原因。
`smooth_material_boundaries()` で均してから統合する。

### 4-5. 分類用テクスチャの縮小は弱めるほど悪化する

| 縮小 | 破片の島 | 三角形 |
|---|---|---|
| 1/16 | 1,145 | 117,044 |
| 1/4 | 2,821 | 131,614 |

### 4-6. 見えない面のカリングは使えない

生成モデルは**法線が一部反転している**ので、レイの起点が面の内側に入って自己遮蔽と
判定される。実行すると**車体に大穴が開く**。削減量も 2,466 枚と小さい。
コードは `cull_hidden_faces()` に残してあるが `HIDDEN_CULL_RAYS = 0` で無効。

### 4-7. Blender の罠

- **glTF インポータは回転モードを QUATERNION にする** → `rotation_euler` への代入が
  **黙って無視される**。`obj.rotation_mode = "XYZ"` を先に入れる
- **UI 言語が日本語だとノード名・ソケット名が翻訳される**。
  **ノードは `type`、ソケットは `identifier` で引く**。名前で引くと色設定が黙って無視され、
  Workbench は `diffuse_color` を見るのでプレビューだけ正しく見えて気づけない
- **`blender -b` では `bpy.app.timers` が発火しない**
- 生成モデルは**9,188個の断片**に分かれている。連結成分での部品分けは使えない
  （＝ Blender の「平坦な面を選択」も効かない。手作業の手順書 `MATERIAL-GUIDE.md` は
  **最初から動かなかった**。もう使わない）

### 4-8. Mapbox の model レイヤーの制約

1. 頂点属性のインターリーブ不可 → `VertexLayout.SEPARATE`
2. プリミティブ間のアクセサ共有不可 → プリミティブごとに頂点を詰め直す
3. **Draco 圧縮を読めない**（詳細ページの Three.js は読める）
4. **`model-color` はモデル全体に掛かる**。マテリアル単位で選べないので、
   **「着色する部分」と「しない部分」に割って2レイヤー重ねる**。発光でも回避できない
5. **`model-scale` はズーム式にしないと引いたとき消える**。各段の値も
   **3要素配列**（`["literal",[3,3,3]]`）
6. **GeoJSON ソースは配列プロパティを文字列化する** → §5-1
7. fill/symbol は `lightPreset` の照明を受ける。夜に「光」を描くには
   `fill-emissive-strength` / `icon-emissive-strength` が要る（無いと影に見える）
8. **模型から光は出せない**。ヘッドライトで路面を照らすには地面に光を描いて偽装する

### 4-9. ブラウザ側（プレビュー画面で踏んだ）

- **WebGL コンテキストの上限はブラウザ全体で約16**。超えると**先に作られたものから
  黙って失われる**。Mapbox は `queryRenderedFeatures` に値を返すので
  「描画したと言うのに真っ白」という紛らわしい症状になる。
  `useNearViewport()` で画面外のキャンバスを作らないようにしてある
- **同じ Standard スタイルの Map を2枚並べると片方が死ぬ**。
  `map.style.fragments[0].style.loaded()` が `false` のまま止まる。
  地図は1枚にして昼夜をボタンで切り替える（`MapPanel`）

---

## 5. 残課題の詳細

### 5-1. `rotation` が文字列化される（本番に影響・最優先で確認）

GeoJSON ソースは配列プロパティを文字列にする。そのため

```ts
properties: { rotation: [0, 0, v.rotation] }   // → "[0,0,100]" になる
paint: { "model-rotation": ["get", "rotation"] }
```

がコンソールに次の警告を出す。

```
The expression ["get","rotation"] evaluated to string but was expected to be
of type array<number, 3>.
```

**本番の `apps/web/src/app/(admin)/admin/(ops)/map/page.tsx:928 も同じ実装**なので、
車両の向きが効いていない可能性が高い。まず本番で実際に向きが変わっているかを確認すること。

回避の方向性（未検証）:
- 向きを数値プロパティ `bearing` にして、`["step", ["get","bearing"], ["literal",[0,0,0]], 10, ["literal",[0,0,10]], ...]`
  のように**すべて `["literal", [...]]` で離散化**する。10度刻み36段でも実用上は足りる
- Mapbox の式には配列コンストラクタが無いので、`[0, 0, ["get","bearing"]]` のような
  書き方は**定数として扱われて効かない**（要検証）

### 5-2. 地図用モデルの作り直し

新パイプラインで `MERGE_INTO_BODY = ("black",)` を指定して作る。

**なぜ black を倒すか**: 窓枠・グリル・モールは粗く減面すると**車体に細い黒い傷として散る**。
地図の表示サイズ（後述）ではグリルもモールも見えないし、窓の輪郭は glass 自身が担うので
形は保たれる。

目標の面数は §5-3 の通り。`PRE_COLLAPSE` を下げるより `PLANAR_ANGLE` を上げて調整する。

### 5-3. 地図上の表示サイズの前提

**車両は地図幅の約8% ＝ 110〜220 デバイスピクセル**。「数十px」ではない
（2026-08-20 にユーザーから実際の表示イメージの提示があって判明。それ以前の
「2,500三角形で十分」という結論は誤り）。

- 2,500 三角形 → 破綻する
- **12,000 前後** → 実用に耐える
- 画面に入るのは5〜10台程度なので、12,000 × 10台 = 12万三角形。負荷は問題にならない

ワイパーはこの大きさでは棘として見えるので**押し戻して**消す（削除すると穴が空く）。

### 5-4. 本番の地図画面への移植

`/admin/map` にはまだ2レイヤー方式もヘッドライト光も入っていない。
プレビュー（`apps/web/src/app/preview/vehicle/page.tsx`）の `MapCanvas` が参考実装。

### 5-5. `MODEL_SCALE` の補間範囲

いまは z17〜z21 で、それより引くとスケールが固定されるので**車が相対的に小さくなる**
（ユーザー指摘・未対応）。ただし単純に z12 まで延ばすと z12 で 384倍になり、
建物を突き抜ける巨大な物体になる。「ある程度まで一定、それ以上引いたら小さくする
（または点アイコンに切り替える）」という設計判断が要る。

---

## 6. ファイルの地図

### スクリプト

| | |
|---|---|
| `scripts/blender-mcp/models/build_vehicle.py` | **正本**。生成モデル → 実用モデルの通しパイプライン |
| `scripts/finish-glb-for-mapbox.mjs` | 幾何を動かさず Mapbox 対応だけ行う仕上げ |
| `scripts/glb-stats.mjs` | 三角形数・頂点数・マテリアルの実測 |
| `scripts/glb-textures.mjs` | glb からテクスチャを取り出す |
| `scripts/blender-mcp/render-studio.py` | 資料用スタジオ撮影（Cycles） |
| `scripts/blender-mcp/bridge.py` | Blender を TCP 越しに叩く（MCP 無しでも使える） |
| `scripts/blender-mcp/MATERIAL-GUIDE.md` | **用済み**。手作業の塗り分け手順。§4-7 の理由で動かない |

`scripts/prepare-vehicle-glb.mjs` は Meshy の生モデル向けで、**ファイルごとに実寸化・
原点合わせをする**。分割した複数ファイルを通すと重ねたときにズレるので、
分割後には使わないこと。

### web 側

| | |
|---|---|
| `apps/web/src/app/preview/vehicle/page.tsx` | 検証用プレビュー（認証不要・:3001） |
| `apps/web/src/lib/three/gltf-loader.ts` | Draco 対応のローダー。3D を読むときはこれを使う |
| `apps/web/public/draco/` | Draco デコーダ（three 同梱をコピー）。CDN は使わない |
| `apps/web/src/lib/components/VehicleModelPreview.tsx` | 車両編集画面の小さいビューア |
| `apps/web/src/app/(admin)/admin/(ops)/map/page.tsx` | **本番の地図**。移植先 |

### 資産（git 外）

`~/Developer/assets/hakotora-3d/` に `.blend` と原本 glb。
`acty/` の中は検証用の中間生成物が多い。

---

## 7. 進め方について（過去の反省）

- **確認用の画像は、確認したい対象がちゃんと写っているかを最初に検める。**
  画角が悪いだけなのを「機能が壊れている」と誤読して3回続けて的外れな対策を打った
- **地図の不具合はページ内から `queryRenderedFeatures` で「実際に何が描かれているか」を問う。**
  推測でパラメータをいじると往復が増える。診断用に `window.__previewMaps` を公開してある
- **「描画されない」ときは、モデルより先に環境を疑う。**
  WebGL コンテキストが生きているか、スタイルが本当にロード済みか。
  2026-08-20 は3回モデルを疑って、2回とも環境側だった
- **原因の特定は「識別色で塗って撮る」が速い。**
  車体の傷がどのマテリアル由来かは、マテリアルごとに極端な色を割り当てて
  1枚レンダリングしたら即座に分かった（それまで2回、推測で対策を外していた）
