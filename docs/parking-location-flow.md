# 駐車位置フロー 設計叩き台

ステータス: ドラフト（合意形成中）／最終更新: 2026-06-21
基盤設計: `docs/platform-design.md`（テナント/車両グローバルID §5）。連携: `docs/notification-flow.md`。
関連方針: `構成A`。位置は**駐車後の単発イベント**であり**ライブトラッキングではない → Realtime不使用**。

---

## 0. 目的

ドライバーが業務終了後に**車をどこに停めたか**を記録し、運営と翌日担当者が迷わず車両にたどり着けるようにする。翌日アサイン通知の「車は××に停まっています」を実体化する。

---

## 1. 中心方針

- **駐車後に1回送る単発イベント**（高頻度の追跡ではない）。DB書き込みも軽く、Realtime/常時GPSは不要。
- 車両は**グローバル一意ID（QR=vehicles.id）**（platform-design §5）。位置は車両に紐づくので、会社をまたいで貸し借りしても**所有会社が自車の最新位置を見られる**（=情報の自動反映）。
- **写真を伴う場合 Storage 容量が増える**（Supabase容量計画の要因。圧縮・解像度制限・保持期間を設計）。

---

## 2. キャプチャ方法（GPS＋写真＋メモ）

| 要素 | 手段 | 役割 |
|---|---|---|
| **GPS座標** | `expo-location`（ワンタップ「現在地で記録」） | 主データ。緯度経度＋精度 |
| **写真**（任意） | `expo-camera` → Storage | 視覚的な目印（立体Pの階・区画など、GPSが弱い場所で有効） |
| **メモ**（任意） | テキスト | 「〇〇コインP 3F B-12」等の補足 |
| **車両特定** | QR/NFCスキャン（vehicles.id） | どの車両を停めたかを確定（特に貸与車両・複数台運用時） |

- 既定はGPSワンタップ。写真・メモは任意で精度を補う。
- **QRスキャンは"どの車両か"の特定**に使う（§9のQR/NFC車両読み取りと共通プリミティブ）。普段同じ車なら当日アサインから既知だが、貸与・乗り換え時はスキャンで確実化。

---

## 3. トリガー（いつ記録するか）

- **返却（チェックアウト）シーケンスの最終ステップ**として記録（`vehicle-session-flow.md` §3）。稼働後点検→オドメーター→駐車位置→運営通知、の流れに統合。これによりチェックアウト必須ゲートで**送信忘れを防ぐ**。
- **単独クイックアクション**も併設：「ここに停めた」を即記録できる導線。
- **org設定で必須/任意**を切替（会社により運用が違う）。
- 返却完了は**車両QR（1車両=1QR=vehicles.id、`vehicle-session-flow.md` §8）**スキャンで確定。位置は**GPS＋写真**（屋内精度は写真/メモで補完）。場所QR/鍵ボックスで物理強制・屋内精度が欲しい会社は任意アドオン。

---

## 4. データモデル

```sql
-- org所有の名前付き駐車地点ライブラリ（停めた人/運営が追加、org内で再利用）
CREATE TABLE org_parking_places (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  name text NOT NULL,              -- 「〇〇駐車場」
  lat double precision, lng double precision,
  added_by uuid, created_at timestamptz DEFAULT now()
);
CREATE TABLE vehicle_parking_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES vehicles(id),
  org_id uuid NOT NULL,            -- 駐車時に使用していたorg（貸与中は借用org）
  recorded_by uuid,                -- membership（drivers行）
  place_id uuid REFERENCES org_parking_places(id),  -- 名前付き地点（任意）
  lat double precision, lng double precision, accuracy double precision,
  photo_path text, note text,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
-- 最新位置 = vehicle_id ごとの recorded_at 最大。履歴は保持（どこにあったかの監査）。
CREATE INDEX ON vehicle_parking_locations (vehicle_id, recorded_at DESC);
```

- 履歴を残す（最新だけでなく、いつどこにあったか追える）。
- `org_id` は**使用していた会社**。貸与中はその借用org。

---

## 5. 可視性・テナント／貸借

- **使用org**（記録した会社）：自社の運営・次の担当ドライバーが閲覧。
- **所有org**（platform-design §5 owner_org_id）：貸与中でも**自社所有車両の最新位置のみ**閲覧可（位置だけ。借用orgの他データは見えない＝スコープ限定）。
- テナント分離: 通常クエリは `org_id` スコープ＋「所有車両の位置」例外をサーバー側で明示的に広げる（report共有・貸借と同じパターン）。
- 位置情報は車両中心で個人PIIではないが、記録者(membership)に紐づくので最小権限で扱う。

---

## 6. 通知連携

- 翌日アサイン通知は、割当車両の**最新 parking record** を引いて「車は〇〇駐車場に停まっています」を生成。
- **逆ジオコーディングは使わない（決定）**。代わりに **org所有の名前付き駐車地点（`org_parking_places`）** を使う：停めた人 or 運営が「〇〇駐車場」等の名前を付けて保存し、org内で再利用（地点ライブラリが育つ）。通知は地点名を表示。
- 地図ピン＋写真も併用可（座標→地図、写真は短命署名URL）。記録が無い/古い場合は degrade（`recorded_at` 併記で鮮度表示）。

---

## 7. 運営の地図ビュー

- 自社車両の**最新位置を地図にピン表示**（静的・最新スナップショット。ライブ追跡ではない）。各ピンに地点名・`recorded_at`（鮮度）・写真・記録者。
- **地図UIデータ（地図SDK）は購入が必要な外部依存**（コスト・キー管理）。地点名は `org_parking_places` から出すため逆ジオコーディングは不要。

---

## 8. エッジケース

| ケース | 挙動（案） |
|---|---|
| GPS拒否/取得不可 | 写真＋メモのみで記録可（座標なし） |
| 屋内・地下で精度低 | 写真＋メモで補完。accuracy を保存し低精度を明示 |
| 移動したのに未更新 | 最新レコードの `recorded_at` を必ず表示し鮮度を可視化 |
| 複数人で乗継ぎ | 最新レコード優先＋履歴保持 |
| 貸与車両 | org_id=借用org。所有orgは最新位置のみ閲覧 |

---

## 9. QR/NFC車両読み取りとの関係（共通プリミティブ）

- 車両QR/NFC（=vehicles.id）スキャンは「**どの車両か**を特定する共通部品」。駐車記録・乗車開始・車両への各種報告で再利用。
- 駐車記録フロー: （任意で）QRスキャンで車両確定 → GPS取得 → 写真/メモ → 保存。
- 貸借時の引き取りも同じスキャンで「この車両を今from借りる」を起点にできる（platform-design §5 の vehicle_loans と接続）。

---

## 10. 未確定・要確認

1. キャプチャ既定: GPSワンタップ＋写真/メモ任意、でよいか。写真は必須にするか。
2. トリガー: 日報提出に統合＋単独アクション併設、でよいか。記録は必須/任意（org設定）。
3. 車両特定にQRスキャンを必須にするか（普段は当日アサインから既知で省略可とするか）。
4. ~~通知の位置表示~~ → **決定: 逆ジオコーディング廃止、`org_parking_places`(名前付き地点)を表示**。停めた人/運営が命名し再利用。
5. 運営地図ビュー: 地図SDK（購入依存）。地点名はorg_parking_placesから。
6. 写真の保持期間・解像度制限（Storage容量対策）。

---

## 11. 次アクション（合意後）

1. §10 を確定。
2. `vehicle_parking_locations` マイグレーション＋インデックス。
3. キャプチャUI（expo-location/-camera）＋記録API（org/membershipスコープ）。
4. 最新位置取得ヘルパー → 通知（notification-flow §5）へ接続。
5. 運営地図ビュー（最新位置・静的）。
6. 所有org向け「貸与中車両の最新位置」閲覧（貸借スコープ拡張）。
