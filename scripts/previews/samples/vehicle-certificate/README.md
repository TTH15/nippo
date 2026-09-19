# 車検証読取の架空サンプル

`table.png` と `table.pdf` は同じ架空の記録事項。メーカーはスズキ、型式HBD-DA17V、ナンバー大阪480り5678、満了日2026/11/20。車台番号と検査時の走行距離は読取対象に採用しない確認用の欄。

`sample.png` / `sample.pdf` は罫線のない初期確認用（大阪480り1234）。`broken.pdf` は失敗後の復帰確認用の壊れたPDF。

`npm run preview:admin -- admin --port 3197` で車両ページを開き、新規追加の「写真例」「PDF例」「失敗例」で試せる。全ファイルは架空データで、通常のWeb publicディレクトリへは配信しない。

表形式サンプルの再生成は `python3 generate.py`。ReportLab、日本語CIDフォント、`pdftoppm` が必要。読取候補は実際のOCR／PDF文字抽出で生成する。
