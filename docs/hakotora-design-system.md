ハコ虎 Design System v1.0

Design Principles

1. 最短で仕事を始める

配送員の時間を奪わない。

最短操作を最優先。

⸻

2. 他アプリと馴染む

Amazon

Google Maps

LINE

などと違和感なく使えるUI。

⸻

3. ブランドは静かに感じる

ブランドは

色ではなく

体験で伝える。

⸻

Layout

背景

White

余白を多く使う。

カードUIを基本とする。

⸻

Radius

中程度。

Apple Human Interface Guidelinesに近い印象。

⸻

Typography

可読性最優先。

数字を大きく。

重要情報を瞬時に読めること。

⸻

Buttons

Primary

Amber

Secondary

White

Danger

Red

⸻

Home Screen

中央に

大きな円形ボタン。

状態

稼働開始

↓

QR読み取り

↓

読み取り完了

↓

稼働終了

すべて同じ円形オブジェクトが変化する。

⸻

QR Reading

画面遷移しない。

ホーム画面上で

円形領域だけ

カメラへ変形。

読み取り時間

約0.2〜0.5秒。

⸻

Bottom Sheet

QR読み取り完了後

自動表示。

ユーザーが押すボタンは不要。

Bottom Navigationは隠す。

メルカリ購入画面のような挙動。

⸻

Confirmation Flow

順番

①免許証確認

↓

②オドメーターOCR

↓

③車両撮影

↓

完了

すべて自動で進行。

⸻

License Check

通常

文字確認のみ。

抜き打ちで

カメラ撮影。

⸻

Odometer

OCR。

画面中央に

ガイドライン表示。

数字枠を認識。

必要なら手修正可能。

⸻

Vehicle Inspection

撮影順

前

↓

右

↓

後

↓

左

各画面に

半透明ガイドラインを表示。

AI判定を見据えた構図に統一する。

⸻

Loading

四角が

集まる。

箱になる。

同期が終わる。

⸻

Success Animation

円形ボタン

↓

チェックマーク

↓

ボトムシート表示

↓

確認開始

一連を約1秒以内で完了。

⸻

Motion

アニメーションは

短く

軽く

意味があるものだけ。

装飾目的では使わない。

⸻

Icons

線画。

四角モチーフ。

ブランドカラーは最低限。

⸻

Navigation

Bottom Navigation

4項目程度。

確認フロー中は非表示。

⸻

Accessibility

片手操作前提。

タップ領域44pt以上。

片手で届く位置に主要操作を配置。

⸻

Future Components

* NFC読み取り
* Dynamic Island通知
* Live Activity
* ロック画面ウィジェット
* Apple Watch対応
* AI車両点検
* AI画像認識
* AI異常検知

これらを追加しても、一貫したデザインを維持できるコンポーネント設計とする。