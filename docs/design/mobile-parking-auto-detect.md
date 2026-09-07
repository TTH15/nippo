# モバイルの駐車位置 自動特定（端末の位置情報＋motion）

2026-09-08 起草。ユーザー方針: **モバイルの日報では Web のような「置き場所の候補を選ぶ」UI は出さない**。端末の位置情報と motion（停車・降車の検知）から駐車位置を自動で特定し、Web 日報と同じ保存口（`vehicle_positions` の申告行）へ流す。Web 側の Phase 1 は [daily-report-parking-foundation.md](daily-report-parking-foundation.md) を正本とし、本書はモバイル側の「特定→保存」の設計。

## 0. 守ること（既存の決定）

- **勤務時間外は位置情報を取らない**（ユーザー指示・[mobile 撮影フロー] 2026-08）。取るのは稼働セッション中（QR で稼働開始〜業務終了）だけ。
- 逆ジオコーディングはしない（[parking-location-flow.md](../parking-location-flow.md) §1）。名前は登録済みの `map_places`／`parking_slots` から引き、当たらなければ座標だけを保存する。
- 位置の正本は `vehicle_positions` に一本化する。別テーブルを増やさない（[map-board.md](map-board.md) §2-1）。
- 権限ダイアログは理由を先に自分の画面で説明してから出す（`references/principles.md` §1）。
- 日報の送信を位置の取得失敗で止めない。位置が取れなくても日報は保存し、位置は「未確定」として運営が地図で直せる（既存「車の位置を直す」）。

## 1. 何を「駐車」とみなすか

駐車＝「車が止まり、人が車を離れた」。モバイルで取れる信号は3つ。確実な順に使う。

| 信号 | 取り方 | 確度 | 使い方 |
|---|---|---|---|
| A. 業務終了の操作 | 業務終了ボタン→撮影フロー（メーター・点検）の最後 | 高（本人が「終わった」と言っている） | **Phase M1 の唯一の確定点**。ここで1回だけ高精度に位置を取る |
| B. 停車の継続 | 位置更新の速度が 1 m/s 未満のまま N 分続く（既定 3 分） | 中（信号待ち・荷下ろしと区別しにくい） | Phase M2。セッション中の「最後に止まった場所」の候補を保持する |
| C. motion の遷移 | `automotive`→`walking`（iOS CMMotionActivity／Android ActivityRecognition） | 中〜高（降車の直接証拠だが端末差が大きい） | Phase M3。B の候補を「降車済み」に格上げする |

**A だけで運用を始められる**。ドライバーは業務終了を車の横で押すのが普通で、押した場所＝駐車位置になる。B・C は「家に帰ってから業務終了を押す」「押し忘れて翌朝押す」を救うための補強で、A を置き換えない。

## 2. 精度と時刻をどう申告行へ落とすか

### 2-1. 取得

- Phase M1: `Location.getCurrentPositionAsync({ accuracy: Highest, timeout: 8s })` を業務終了の最終確認画面で1回。既存 `apps/mobile/src/location.ts` は `Balanced`（数十〜百 m）なので、駐車用に高精度の関数を足す。8 秒で取れなければ `Balanced` にフォールバックし、それも無理なら「位置なし」で送る。
- 取れた値のうち保存するのは `lat` `lng` `accuracy_m`（水平精度）`fix_at`（端末が測位した時刻）。`altitude`・`speed`・`heading` は保存しない（駐車には不要・PII を増やさない）。

### 2-2. 時刻

- `at`（駐車日時）＝ **停車の開始時刻**。M1 では測位時刻 `fix_at` をそのまま使う（業務終了時＝停車直後とみなす）。M2 以降で B の候補がある場合は、その停車の開始時刻を `at` に入れ、`fix_at` とは別に持つ。
- 送信時刻や日報の対象日 0 時へ機械的に置き換えない（[daily-report-parking-foundation.md](daily-report-parking-foundation.md) の駐車日時の原則）。`report_date` は稼働セッションの営業日。

### 2-3. 登録済みの場所へのスナップ（サーバーで行う）

端末は座標を送るだけにし、**どの車庫・区画かはサーバーが決める**（車庫マスタは会社ごとで、端末に配らない）。

1. 候補は自社の `map_places` のうち `allow_parking = true` のもの（給油所・客先など候補外の拠点には当てない）。
2. 中心からの距離 `d` と、拠点の半径 `r`（`shape='circle'` なら `radius_m`、点なら 60 m）で判定する。`d ≤ r + accuracy_m` なら当たり。複数当たれば `d` が最小の拠点。
3. 当たった拠点に `parking_slots` があり、`accuracy_m ≤ 25` のときだけ区画を判定する（`geometry` の多角形に点が入るか。入らなければ区画なし）。精度が粗いのに区画を決めない。
4. 当たらなければ `place_id = null`・`place_name = null` で座標だけを保存する。地図には点として出る（「登録外の場所」）。名前を推測しない。

スナップ結果は返却し、端末の終了サマリーに「車は 豊中センター A-1 に記録しました」と1行で出す。

### 2-4. 保存する行

`vehicle_positions` に `kind='parked'` の1行。既存列は Phase 1 のまま、次の2列を足す（migration 159・候補）。

| 列 | 型 | 意味 |
|---|---|---|
| `accuracy_m` | numeric null | 端末の水平精度（m）。Web の申告・手動配置は null |
| `detected_by` | text null | `session_end`／`stop`／`motion`。自動特定の根拠。Web 申告・手動配置は null |

- `source` は既存の `report` を使う（日報と一緒に出す申告）。GPS の連続追跡が入ったら `gps` は観測（`kind='observation'`）で別に流れるので、混ざらない。
- `driver_id`・`recorded_by` は本人。`client_key` は **稼働セッション ID＋`:parked`** にして、再送・遅延送信で上書きする（Phase 1 の `(org_id, vehicle_id, client_key)` 一意制約をそのまま使う）。
- `note` は端末では付けない（メモを打たせない）。

### 2-5. 信頼できない位置の扱い

| 状況 | 扱い |
|---|---|
| 位置権限なし・測位タイムアウト | 位置なしで送る。日報は保存。地図は「位置なし」に載り、運営が直す。端末には「車の場所は記録できませんでした」と1行 |
| `accuracy_m > 150` | 保存はするが拠点にスナップしない（座標だけ）。運営の地図では精度円を薄く描く |
| 前回位置から 200 km 超の移動 | 保存はする。運営の地図で「要確認」を付ける（`detected_by` と距離から表示側で判定。DB には持たない） |
| 車両なしの日報 | 位置を取らない（Phase 1 と同じ） |

## 3. 端末側の流れ（Phase M1）

```
業務終了ボタン → CaptureFlow（メーター → 点検 → 日報フォーム）
                                                  │
                                    送信の直前に測位（8 秒・裏で）
                                                  │
                    POST /api/reports/v2 { items, parking: { vehicleId, status:"parked",
                       coords:{lat,lng,accuracyM,fixAt}, detectedBy:"session_end", clientKey } }
                                                  │
                          サーバーがスナップ → 応答 { parking: { placeName, slotLabel } }
                                                  │
                     終了サマリー「車は 豊中センター A-1 に記録しました」  [ 違う ]
```

- 測位は日報フォームの表示と同時に裏で始め、送信時に結果を添える（待たせない）。
- **[ 違う ]** は候補一覧ではなく、地図で現在地ピンをドラッグして置き直す1画面（Web の「車の位置を直す」と同じ保存口 `POST /api/reports/v2` の再送・同じ `client_key` で上書き）。ここでも名前は付けさせない。
- 権限は初回だけ、業務終了の直前に「車の場所を自動で記録するために、業務終了のときだけ位置情報を使います」を自分の画面で出してから OS ダイアログを出す。拒否されても業務終了は続く。

## 4. Phase M2・M3（補強）

- **M2 停車の保持**: セッション中だけ `startLocationUpdatesAsync`（`distanceInterval: 50 m`・`deferredUpdatesInterval: 60 s`・バックグラウンド許可は求めない＝前景＋一時停止中のみ）。速度 1 m/s 未満が 3 分続いた点を「最後の停車」として端末に保持し、業務終了時の測位が取れない・精度が粗い場合の代替に使う。`detected_by='stop'`、`at`＝停車開始。セッション終了で必ず止める。
- **M3 降車の検知**: `expo-sensors` の `DeviceMotion` は生の加速度しか取れず、OS の活動認識（`CMMotionActivity`／`ActivityRecognition`）は Expo 標準モジュールに無い。M2 の運用で「業務終了を車の外で押す」率が高ければ M3 は不要。必要になった時点で config plugin か `react-native-background-geolocation` 系を評価する。**先に入れない**。
- どの段階でも、勤務時間外・セッション外では位置を取らない。

## 5. サーバー側の変更点

- `server/reports/parking.ts` の `parseParkingReport` に `coords`（`lat` `lng` `accuracyM` `fixAt`）と `detectedBy` を追加。`placeId`／`placeName` と `coords` は排他ではなく、`coords` だけの申告を許す（`kind='parked'` は「登録車庫か場所名」必須だったので、**座標だけの申告**も有効にする。migration 159 で CHECK を「車庫・場所名・座標のいずれか」に緩める）。
- `saveParkingReport` にスナップ（§2-3）を追加。純粋関数 `snapToPlaces(coords, places, slots)` を `server/reports/parkingSnap.ts` に切り出してテストする（当たる／半径外／精度で区画を決めない／`allow_parking=false` は無視／複数拠点で最寄り）。
- 応答に `parking: { placeName, slotLabel, snapped: boolean }` を返す。
- 地図 API（`/api/admin/map/vehicles`）は既に `kind`／`place_name` を返す。`accuracy_m`・`detected_by` を追加し、運営の地図の詳細に「自動記録（精度 12 m）」と出す。

## 6. 検証

- 単体: `snapToPlaces` の表（§2-3 の各条件）、`parseParkingReport` の座標だけの申告、`client_key` 上書き。
- 隔離プレビュー: `/preview/admin/map` の fixture に `detected_by='session_end'`・粗い精度の車を足し、詳細の表示を確認。
- 実機: 屋内（精度 50〜150 m）、権限拒否、機内モード、8 秒タイムアウト、業務終了を自宅で押す（M1 では自宅が記録される＝M2 の動機付け）。
- 本番: 日報側の保存が先、位置は後（Phase 1 と同じ順）。位置の失敗で日報を落とさないことをログで確認。

## 7. 決めておきたいこと

1. 点の拠点の既定半径 60 m でよいか（センターの敷地は円で登録してもらう前提）。
2. 区画の判定に使う精度の上限 25 m（iPhone 屋外で 5〜15 m、屋根下で 30 m 超）。
3. M1 の [ 違う ] を地図ドラッグにするか、当面は「運営に伝える」（何もしない）にするか。
4. `detected_by` を DB に持つか、`source='device'` を新設して区別するか。本書は既存 `source='report'`＋`detected_by` 列の案。
