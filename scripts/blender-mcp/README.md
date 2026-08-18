# Blender ブリッジ

```
Claude Code → MCP サーバー(server.py) → [TCP 127.0.0.1:9876] → アドオン(addon.py) → bpy → Blender
```

地図に載せる車両モデル（様式化ローポリ）を Blender で作るための足回り。

## ファイル

| | 役割 |
|---|---|
| `addon.py` | Blender 側。TCP で JSON を受けて bpy を叩く。アドオンとしても、`--python` で渡すスクリプトとしても動く |
| `bridge.py` | クライアント（標準ライブラリのみ）。MCP に依存しないので CLI からも使える |
| `server.py` | MCP サーバー。`bridge.py` を MCP のツールとして公開するだけの薄い層 |
| `launch.sh` | Blender をブリッジ付きで起動する |
| `export-keivan.sh` | 軽バンを組み立て直して .blend と glb を書き出す |
| `models/keivan.py` | **軽バンモデルの正本**（パラメトリック） |
| `models/_export_epilogue.py` | 書き出し手順。`keivan.py` の後ろに連結して実行する |

## 使い方

```bash
scripts/blender-mcp/launch.sh          # GUI で起動（目で見ながら作業する場合）
scripts/blender-mcp/launch.sh --bg     # ヘッドレス
```

起動後、MCP ツール（`blender_status` / `get_scene` / `run_python` / `render_preview` /
`export_glb` / `save_file` / `open_file`）が使える。MCP を使わない場合は直接:

```bash
python3 scripts/blender-mcp/bridge.py ping
python3 scripts/blender-mcp/bridge.py scene
python3 scripts/blender-mcp/bridge.py exec model.py
python3 scripts/blender-mcp/bridge.py render iso 640 /tmp/out.png
python3 scripts/blender-mcp/bridge.py export /tmp/out.glb
```

## 設計上の注意（踏んだもの）

- **bpy はメインスレッド以外から触ると落ちる。** GUI ではワーカースレッドで受けて
  `bpy.app.timers` のポンプがメインスレッドで実行する
- **`blender -b` ではイベントループが無く `bpy.app.timers` が発火しない。**
  背景実行時は `bpy.app.background` を見て、メインスレッドで待ち受ける別経路に切り替える
- **プレビューのカメラは外接球で合わせる。** 最大辺で合わせると斜め視点で対角がはみ出して見切れる
- **mcp 2.0 で `FastMCP` は `MCPServer` に改名された。** `mcp.server.fastmcp` は存在しない

## モデルの部品構成と、分ける層

部品を分ける目的ごとに、効く層が違う。混同すると狙った結果にならない。

| 目的 | 効く層 |
|---|---|
| 色を変える | **マテリアル**。Mapbox の `model-color` はモデル全体に掛かるので、オブジェクトを分けても部品別の着色にはならない。白い面が着色され、暗い面（窓・タイヤ）は残る |
| 部品を使い回す | **メッシュデータの共有**。ホイール4個・ミラー2個・プレート2枚は同じメッシュを参照している。1つ直せば全部に効く |
| 書き出しを軽くする | **マテリアル単位の結合**（`join_by_material()`）。20オブジェクト → 6プリミティブ |

## 書き出しの決まり

- **Draco 圧縮は使わない。** Mapbox の model レイヤーが `KHR_draco_mesh_compression` を読めない
- 地図に載せる前に仕上げを通す:
  `node scripts/prepare-vehicle-glb.mjs <入力.glb> <出力.glb> [全長m] [目標三角形数]`
  （頂点属性のインターリーブ解除・実寸化・原点を底面中心へ）
- 生の .blend / .glb は git に入れない。`~/Developer/assets/hakotora-3d/` に置く
