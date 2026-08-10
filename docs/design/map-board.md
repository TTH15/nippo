# 配車作戦盤 — 位置・時間軸・シミュレーションの設計

2026-08-06 起票。ユーザー要望:
①GPS が入る前の今から**ドラッグで車の現在地を示したい** ②**車移動のシミュレーションを動画で書き出したい**
③**「何月何日の車の位置」**を見たい。

現状は `/admin/map` が「打刻GPSの最終地点を出す可視化β」。位置は `vehicle_sessions` の
出勤/退勤の座標から**その場で導出**していて、位置そのものを保存するテーブルが無い。
①②③はいずれも「位置を時系列で持つ」ことが前提になるので、まずそこから設計する。

---

## 1. 中心となる考え方

**位置は「1車両につき1つの現在値」ではなく、「出どころ付きの時系列」として持つ。**

この1点で3つの要望が同じモデルに乗る:

| 要望 | モデル上の操作 |
|---|---|
| 現在地を出す | 各車両の最新行を取る |
| 何月何日◯時の位置 | `at <= T` の最新行を取る（as-of クエリ） |
| ドラッグで置く | `source='manual'` の行を**追記**する |
| GPS が入ったら | `source='gps'` を流し込むだけ。UI は変えない |

**上書きではなく追記**にするのが肝。上書きだと「置き直した経緯」が消える。追記なら
それ自体が履歴＝③の材料になり、後で AI に食わせるデータにもなる
（「誰がいつどの車をどこへ動かしたか」は既に残す方針）。

---

## 2. データモデル

### 2-1. 実績の位置（`vehicle_positions`）

```sql
CREATE TABLE vehicle_positions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL,
  vehicle_id   uuid NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  at           timestamptz NOT NULL,     -- 「いつの位置か」。記録時刻ではない
  lat          double precision NOT NULL,
  lng          double precision NOT NULL,
  heading      real,                     -- 進行方向（GPS のみ・任意）
  accuracy_m   real,                     -- 精度（GPS のみ・任意）
  source       text NOT NULL CHECK (source IN ('punch','manual','gps')),
  recorded_by  uuid REFERENCES drivers(id) ON DELETE SET NULL, -- manual では必須
  note         text,                     -- 「センター戻り」等の一言
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON vehicle_positions (org_id, vehicle_id, at DESC);
CREATE INDEX ON vehicle_positions (org_id, at DESC);
```

- `source` を**必ず持つ**。手動で置いた点と GPS を見た目でも集計でも混ぜない
- **集計（請求・稼働時間・走行距離）には `manual` を使わない**。あくまで「今どこにいるか共有するための付箋」
- `punch` は既存の `vehicle_sessions` から移行時に一括生成し、以後は打刻のたびに1行追記
- 保持期間は当面無期限（1日1台あたり数十行なら年間でも軽い）。GPS が入って秒間隔になったら
  「生ログは90日、以降は5分間隔へ間引き」を検討する

### 2-2. シミュレーション（`sim_scenarios` / `sim_moves`）

**実績とは絶対に同じテーブルに入れない。** 盤面で動かした「もしも」が実績として残ると、
地図の信頼性が根本から崩れる。

```sql
CREATE TABLE sim_scenarios (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL,
  name        text NOT NULL,            -- 「8/10 雨天想定」
  base_date   date NOT NULL,            -- 何日の配車を検討しているか
  created_by  uuid REFERENCES drivers(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sim_moves (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario_id  uuid NOT NULL REFERENCES sim_scenarios(id) ON DELETE CASCADE,
  vehicle_id   uuid NOT NULL,
  driver_id    uuid,                    -- 誰が乗る想定か（未定なら null）
  minute       int NOT NULL,            -- base_date 0:00 からの経過分。時刻を持たず相対で持つ
  lat          double precision NOT NULL,
  lng          double precision NOT NULL,
  kind         text NOT NULL CHECK (kind IN ('start','via','stop')),
  label        text                     -- 「センター」「◯◯様宅」
);
CREATE INDEX ON sim_moves (scenario_id, vehicle_id, minute);
```

- キーフレーム方式。点と点の間は再生時に補間する（既定は等速直線。道路追従は将来 Directions API）
- `minute` を相対で持つので、同じシナリオを別日に流用できる

---

## 3. 画面設計

### 3-1. 3つのモード（画面上部で切替）

```
┌─────────────────────────────────────────────┐
│ [ライブ] [履歴] [シミュレーション]      2026年8月6日 ▾ │
├─────────────────────────────────────────────┤
│                                              │
│              （地図・全画面）                    │
│                                              │
├─────────────────────────────────────────────┤
│ 0:00 ├────────●──────────────────┤ 24:00  ▶ │  ← 履歴/シミュ時のみ
└─────────────────────────────────────────────┘
```

- **ライブ**: 各車両の最新位置。いま実装されているもの＋手動ドラッグ
- **履歴**: 日付を選び、タイムラインをスクラブ。その時刻の as-of 位置を出す
- **シミュレーション**: シナリオを選び、ドラッグでキーフレームを置いて再生・書き出し

### 3-2. ドラッグで置く（要望①）

- プレートピンを `draggable` にし、drop で `vehicle_positions` に `source='manual'` を**追記**
- 表示で必ず区別する:
  - `gps` — 実線リング・「◯分前」
  - `punch` — 実線グレー・「出勤時の位置」
  - `manual` — **破線リング＋「手動」バッジ**・「◯◯が◯分前に配置」
- 権限は `can_dispatch`。置いた人を `recorded_by` に必ず入れる
- 共有ビュー（Stage 1 の Realtime broadcast）に乗せ、**他の参加者の画面でも即座に動く**。
  これがあると「電話しながらみんなで盤面を動かす」が成立する
- 元に戻す: 追記モデルなので「1つ前の位置に戻す」は直前行の復元＝もう1行追記で表現する

### 3-3. 時間軸（要望③）

- 日付を選ぶとその日の `vehicle_positions` を1回だけ取得（1日分は数百行で軽い）
- スクラブ中はサーバーに問い合わせず、クライアントで as-of を解決する
- **点の間を勝手に繋がない**。打刻や手動配置は離散的な事実なので、既定は
  「その時刻時点の最後の位置にスナップ」。GPS が入って点が密になったら
  `interpolate: true` で軌跡として線を引く（設定で切替）
- 副産物: 「この日この時間、この車はどこにいたか」が答えられる。
  事故・遅延の振り返り、請求の根拠、AI の学習データになる

### 3-4. シミュレーション（要望②の前半）

- シナリオを作る → 車両を選ぶ → 地図をクリックしてキーフレームを置く → 時刻を割り当てる
- 実績レイヤーと**重ねて**表示（実績＝実線、シミュ＝点線・別色）。「いつもの動き」と比べられることが価値
- 再生速度は 1分/秒（24時間＝24分）〜 60分/秒（24時間＝24秒）。既定は 30分/秒（＝48秒）
- 確定すると割当ドラフトとしてシフトへ反映（roadmap トラック K Stage 2 の既定路線に接続）

---

## 4. 動画エクスポート（要望②の後半）

### 案A: クライアント録画（推奨・まずこれ）

```ts
const stream = map.getCanvas().captureStream(30);
const rec = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp9", videoBitsPerSecond: 8_000_000 });
// 再生を走らせながら録画 → stop() で Blob → ダウンロード
```

- **長所**: 追加インフラ不要。見たままが撮れる（3D建物・ライティング・カーソルも入る）。今日から作れる
- **短所**:
  - **実時間かかる**（48秒の動画なら48秒待つ）。再生速度で尺を決める設計にしておく
  - タブを裏に回すとフレームが落ちる → 録画中は「このタブを表示したままにしてください」と出す
  - 出力は webm。**LINE で配るなら mp4 が要る** → `ffmpeg.wasm` でブラウザ内変換（数十秒・重い）か、
    当面は「webm のままダウンロード＋PCで再生」で運用する
  - Mapbox の canvas は `preserveDrawingBuffer` 無しでも captureStream は取れるが、
    描画が止まっているとフレームが出ないので再生中は `map.triggerRepaint()` を回す

### 案B: サーバーで決定的にレンダリング（将来）

headless Chrome + Mapbox GL でフレームを吐き、ffmpeg で mp4 化。

- **長所**: 尺・解像度・fps が正確。実時間を待たない。4K も出せる
- **短所**: Vercel の関数では重すぎる（別ワーカー／コンテナが要る）。Mapbox のトークン利用条件も要確認
- **判断**: 「取引先や社内へ配る資料として使う」段階になったら着手。最初から作らない

### 案C: GIF

画質とサイズで不利。採用しない。

---

## 5. 段階（roadmap トラック K への接続）

| 段階 | 内容 | GPS 依存 | 見積り感 |
|---|---|---|---|
| **0.5** | `vehicle_positions` 新設＋既存打刻からの移行＋**ドラッグ配置**＋出どころ表示 | 不要 | 中 |
| **0.6** | **日付スクラブ（履歴）** | 不要 | 小〜中 |
| 0 | mobile P2 の GPS を `source='gps'` で流し込む（**勤務時間外は取得しない**） | — | 別トラック |
| **2a** | シナリオのドラッグ＋再生 | 不要 | 中 |
| **2b** | **動画エクスポート（案A）** | 不要 | 小 |
| 3 | AI 合流（音声→制約、AI 提案を盤面に置く） | — | 大 |

**0.5 と 0.6 は GPS を待たずに今すぐ着手できる**。しかも GPS が入った時に作り直しが要らない
（`source` が増えるだけ）。ここから始めるのが順当。

---

## 6. 決めておきたいこと

1. **手動配置を「実績」テーブルに入れてよいか**
   本設計は `source` で区別したうえで同じテーブルに入れる案（現在地の解決が1本のクエリで済む）。
   完全に別テーブルにする案もあるが、「最新位置を引く」処理が二重になる。
   → **集計には絶対使わない**という運用で担保する想定。
2. **履歴の点を線で繋ぐか**
   既定は繋がない（離散の事実として扱う）。GPS が入ってからの切替とする。
3. **動画の出力形式**
   まず webm で始めてよいか。mp4 必須なら `ffmpeg.wasm` を最初から入れる（重い）。
4. **シミュレーションの経路**
   直線補間で始めてよいか。道路に沿わせるなら Mapbox Directions API を使う（コストと精度の話になる）。

---

## 7. 車両3Dモデル（2026-08-10 追記）

ユーザー方針: **NISSAN クリッパー / スズキ エブリイ など代表的な軽バンを、色を変えられる形で
用意して選べるようにする**。

- DB: `vehicles.model_key`（どのモデルで描くか）/ `vehicles.body_color`（#RRGGBB）— migration 123
- 地図は Mapbox の `model-color` で着色する。**着色を効かせるにはモデル側の車体マテリアルを
  無彩色（白〜薄グレー）**にしておく必要がある。濃色やテクスチャを焼き込むと色が乗らない
- 窓・タイヤ・ライトは車体と別マテリアルにしておくと、車体だけを着色できる
- 車種の出し分け（`model-id` の切替）はモデルが2種類以上揃ってから実装する

## 8. 「積み込み中」の推定（2026-08-10 追記）

積み込みを直接記録する仕組みは無いので、**拠点（`map_places` の倉庫・拠点）から
120m 以内に停まっている稼働中**を積み込み中と見なす。あくまで推定であり、
将来ちゃんと記録する手段（センターでの打刻・ビーコン等）が入ったら置き換える。
