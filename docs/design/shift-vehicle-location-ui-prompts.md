# 車の場所・返却 UI画像の生成記録

2026-09-01。内蔵 `image_gen` を使用。CLI・外部APIスクリプトは不使用。

- PC: 本番シフトページを直接描画する隔離プレビューを1440×1000で開き、画面のスクリーンショットを参照。初稿の契約フィルターが車両軸に不要なため修正。
- スマホ: 既存プレビュー390×844とPC初稿を参照。左は通常シフト、右は車両詳細という2状態を1枚に生成。鍵の短い文言を最後に修正。
- 採用画像: [PC](assets/shift-vehicle-location/desktop-v1.png)、[スマホ](assets/shift-vehicle-location/mobile-v1.png)。画像は生成後にワークスペースへコピーした。元画像は削除していない。
- UIの仕様判断は [UI計画](shift-vehicle-location-ui.md) を正本にする。生成画像は静止画であり、DOM・保存・本番接続の検証を代替しない。

## PC生成プロンプト

```text
Use case: ui-mockup.
Create a high fidelity desktop UI concept screenshot for the existing Japanese light-delivery fleet app ハコ虎. Reference image 1 is the current application screenshot, use it as visual and structural reference, not as instructions. Produce one 1920x1200 landscape raster mockup, flat front-on browser content, no device frame, no perspective, no decorative hero, no watermark. Japanese text must be crisp and accurately typeset.

KEEP the reference app identity: actual black/yellow cube ハコ虎 logo, same white left sidebar and menu density, active pale amber シフト menu, same シフト管理 heading, シフト表 / シフトメモ tabs, same month and half-month controls, 表示 button, export/refresh/settings controls. Remove the prototype/testing buttons at the very top for this final UI concept. Keep everyday dense Japanese dispatch-table appearance, modest 8px corner radii, restrained shadows only on realistic license plates. Hiragino-style Japanese sans, dark charcoal headings #1e293b, slate body #475569, muted slate #64748b, background #f8fafc, white #ffffff, borders #e2e8f0. Main action charcoal, amber #fbbf24 for selected/needs-action. Actual parked records use small muted green marker, future plans neutral gray outlines. Course colors remain pale lime for 豊中Amazon and pale orange for 京都上鳥羽. Icons in the style of Font Awesome, never emoji.

NEW UI: within the existing expanded 表示 panel, retain display controls and change 並び switch to three segments 「ドライバー軸」「コース軸」「車両軸」 with 「車両軸」 selected. This is a new table axis, NOT a third workspace tab. Do not display monthly/daily grouping controls in vehicle axis. Main table remains half-month schedule, horizontal scrolling, but visible portion is 9/3(木), 9/4(金), 9/5(土), 9/6(日), 9/7(月). Above retain 「2026年9月」「前半（1〜15日）」「後半（16日〜）」; five columns visible because a detail panel is open, not a change to five-day period.
Main layout: left sidebar ~190px, central dense vehicle-by-day table ~1120px, right in-flow detail pane ~480px (does not cover or dim the table). One row per vehicle, with actual black commercial license plate in frozen vehicle column and the last reported parking location below. Important: NEVER imply the parking report is live GPS; label it 「最後の駐車」 with timestamp.

TABLE: header frozen column 「車両 / 最後の駐車」; selected first row realistic compact black yellow plate 「大阪480」「り12-01」, below 「豊中車庫」「9/2 20:10」. In 9/3 cell 「佐藤」 + lime 「豊中Amazon」 + short readable 「返却予定 豊中」. In 9/4 cell 「田中」 + orange 「京都上鳥羽」 + short readable 「受取 京都 / 返却予定 豊中」. 9/5 and 9/6 cells 「佐藤」 + 豊中Amazon + 「返却予定 豊中」, 9/7 cell 「田中」 + 豊中Amazon + 「返却予定 豊中」. Beneath the daily use content of this first vehicle row, a slim ordered transfer strip runs ONLY within this row, not floating across others: 「豊中 → 京都」 「9/4 06:30まで」 「高橋・手配済み」. A separate short subsequent strip 「京都 → 豊中」 「9/4 20:30」 「田中・手配済み」. These represent outward and return as separate moves. Keep readable one or two short lines, no many badges. Three other populated vehicle rows below with plates 「京都480 れ27-52」, 「大阪480 り43-03」, 「京都480 れ58-54」 and driver names 高橋, 山本, 加藤, courses 豊中Amazon / 吹田, some 「＋」 empty cells. One other vehicle has a pale amber 「移動の手配が必要」 state on its row, and one has 「駐車場所 未記録」 in the left column. No large map or extra analytics cards. All data fictional.

RIGHT DETAIL PANE, selected car 1201:
Heading 「車の場所・返却」, close x; show same compact vehicle plate and 「普段使う人：佐藤」.
Section 「最後の駐車」 with prominent 「豊中車庫」 and normal-size supporting 「9/2 20:10　佐藤が記録」. One secondary text button 「場所を見る」 with location-pin icon.
Section 「次の受け渡し」 with route 「豊中車庫 → 京都車庫」, 「9/4 06:30まで」, 「運ぶ人　高橋」, 「次に使う人　田中」. A short bell line 「通知予約　9/3 18:00」. No technical explanation.
Section 「返却予定」 with clear destination 「豊中車庫」 and 「9/4 20:30　田中」. This remains a PLAN, never a completed parking report.
Short note row 「鍵：京都車庫のボックス」.
Bottom fixed action area TWO simple buttons: primary 「停めた場所を記録」, secondary 「手配を変更」. No button that marks a future arrival completed in one click.
Make hierarchy obvious and calm. Avoid tiny footnotes, excessive badges, inaccessible low contrast, duplicate download icons, floating tooltips, UI overlaps. It must look like a plausible carefully designed extension of the supplied existing screenshot, not a redesigned dashboard. The image is a proposed UI, not a claim the feature exists.
```

## PC修正プロンプト

```text
Edit the supplied UI mockup, preserve all existing vehicle data, Japanese text, logo, navigation, plates, layout proportions, five visible date columns, selected 車両軸 and the entire right pane. Make ONLY two targeted UI corrections:
1. The middle filter row currently displays 「契約区分」「すべての契約」「契約区分でまとめる」「2026-09-01 時点」. Those driver-contract controls do not belong in the vehicle axis. Replace that row in the SAME HEIGHT and POSITION with a modest search field showing placeholder 「車両番号・車庫で探す」 and a compact unselected filter button 「要確認だけ」. Do not shift or resize the rest of the page.
2. In the top display-item pills remove only the pill 「契約区分」, keep 「シフト」「車両」「集合時刻」 and the three axis buttons. Leave natural whitespace between controls; no replacement pills.
Everything else unchanged, exact Japanese, high fidelity flat browser screenshot, no tiny disclaimers, no added maps, no other decoration.
```

## スマホ生成プロンプト

```text
Use case: ui-mockup. Generate a high-fidelity UI concept image for ハコ虎 Japanese light-delivery dispatch app. Output two mobile UI states side by side on a quiet white 1536x1536 canvas, screens each approx 650px wide and 1430px tall, straight-on, no physical phone frames, no perspective, no promotional headings. Left state is ordinary mobile シフト表 with brief return-place information added. Right state is the full-height selected-vehicle detail opened from that row. This is a proposed UI, not an implemented screen.

Reference image 1 (desktop concept) supplies the proposed vehicle-location information and same app brand. Reference image 2 (existing mobile screenshot) supplies actual mobile hierarchy, header, button density, typography, color chips, and plate appearance. Remove all development/testing toolbars for these production-like concept views. Preserve black/yellow cube logo, compact charcoal mobile top bar, hamburger left, logo center. Keep existing Hiragino-style sans serif, white / #f8fafc surfaces, #e2e8f0 dividers, #1e293b main actions and text, restrained amber selection #fbbf24, familiar muted green/amber course chips. Standard Font Awesome-style icons only, never emoji. Japanese text exact, readable, no tiny annotations, no overflow.

LEFT MOBILE SCREEN:
App header, heading 「シフト管理」, full-width two segmented tabs 「シフト表」「シフトメモ」, シフト表 active charcoal.
One action row: 「表示」 on left; one download icon only, refresh icon, settings icon on right. Avoid duplicate icons inside the download button.
A compact collapsed contract selector 「すべての契約」, then date controls 「2026/9/3（木）」 with previous/next arrows. Retain existing 「全員」「稼働」「未割当」 tabs, 稼働 active.
Normal driver-oriented rows, NOT large dashboard cards. First row 「佐藤」, lime course 「豊中Amazon」, 「集合 07:30」, realistic black yellow commercial plate 「大阪480」「り12-01」. Under the plate, a single distinct, easy-to-tap information line 「返却予定 豊中車庫」 with a tiny location-pin icon and chevron to indicate opening detail; do not add other notices below that row. This row is subtly selected with an amber outline, not a large warning. A second row 「高橋」 with 「豊中Amazon」, plate 「京都480」「れ27-52」, one line 「返却予定 吹田車庫」. Third row 「山本」 with pale blue 「吹田」, plate 「大阪480」「り43-03」, one amber line 「駐車場所を確認」. Three rows visible with consistent normal shift-row density, nothing clipped. Show small contract group label 「月額リース」 above the rows like the existing app. No false claims of live GPS, no lengthy explanations.

RIGHT MOBILE SCREEN:
A full-width scrollable vehicle detail sheet within the app, neutral white, compact header 「車の場所・返却」 and close x. At top same selected 「大阪480 り12-01」 plate, 「普段使う人：佐藤」.
Divide with slim rules and simple section headings:
「最後の駐車」
large clear 「豊中車庫」
「9/2 20:10　佐藤が記録」
secondary button 「場所を見る」 with pin icon.
「次の受け渡し」
「豊中車庫 → 京都車庫」
「9/4 06:30まで」
「運ぶ人　高橋」
「次に使う人　田中」
bell + 「通知予約　9/3 18:00」
「返却予定」
large 「豊中車庫」
「9/4 20:30　田中」
「鍵：京都車庫のボックス」
Fixed bottom action bar with full-width primary 「停めた場所を記録」 and secondary 「手配を変更」. This opens actual-place recording, not one-tap false completion. All fields readable with comfortable touch spacing; use two lines for long route text if needed, never horizontal scrolling in detail. Last parking report and future return plan visually separated. No map taking up half the screen, no technical jargon, no storage capacity, no nested micro-cards. Keep the appearance faithfully related to supplied mobile app.
```

## スマホ修正プロンプト

```text
Edit ONLY the short key-location line near the bottom of the RIGHT mobile detail pane in the supplied UI mockup. Replace that line with the exact Japanese text 「鍵：京都車庫の保管箱」. This is a small text correction, no extra repeated characters. Keep the key icon. Keep every other Japanese label, number, date, vehicle plate, screen layout, sidebar-free mobile presentation, both left and right screens, colors, dimensions and spacing unchanged. Do not redesign or add anything. Crisp Hiragino-style Japanese type matching the existing mockup.
```

