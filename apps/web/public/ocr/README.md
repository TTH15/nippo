# 車検証の端末内読取

写真の読取はTesseract.js、PDFの描画・テキスト取得はPDF.jsを使う。画像・書類・OCR本文をAPI、Storage、ログへ送らない。言語データのみブラウザにキャッシュする。

`lang/` は公式 `tesseract-ocr/tessdata_fast` から2026年9月14日に取得した固定ファイル。Apache-2.0、同梱LICENSEを参照。

- https://github.com/tesseract-ocr/tessdata_fast/blob/main/jpn.traineddata
- https://github.com/tesseract-ocr/tessdata_fast/blob/main/eng.traineddata
- 日本語 SHA-256: `1f5de9236d2e85f5fdf4b3c500f2d4926f8d9449f28f5394472d9e8d83b91b4d`
- 英語 SHA-256: `7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2`

`runtime/` はGit管理外。`npm -w @repo/web run dev` / `build` と隔離プレビュー起動時に `scripts/prepare-vehicle-reader.mjs` がpackage-lockの固定版から作る。worker・WASM・PDFフォント類は同じサイトから配信する。言語版を更新する際は `readVehicleCertificate.ts` のcachePathも更新する。
