-- ============================================================
-- 山本 浦伊良 さんに名簿番号 26 を振る（2026-08-05）
--
-- 背景: 招待リンク（/api/join）経由の申請は list_no が null のまま入るが、
--   承認処理に採番が無かったため未採番のまま名簿に載っていた。
--   一覧UIが行番号（index+1）で代用していたため、既存の #22 と重複して見えていた。
--   コード側は修正済み（承認時に max+1 で採番／UIの行番号フォールバックは撤去）。
--   このファイルは、その修正より前に入った既存1件を手当てするもの。
--
-- ★本番DB操作。①で対象を目視確認 →②を実行 →③で結果を確認、の順に流すこと。
--   Supabase SQL Editor は実行ごとに自動コミットするので BEGIN/COMMIT は使わない。
-- ============================================================


-- ------------------------------------------------------------
-- ① 対象の確認（ここで1行だけ返ることを必ず確かめる）
--    26 が空いていること・山本さんが未採番であることを同時に見る。
-- ------------------------------------------------------------
SELECT id, name, status, works_as_driver, list_no, created_at
FROM drivers
WHERE name LIKE '山本%'
   OR list_no = 26
ORDER BY list_no NULLS LAST, created_at;


-- ------------------------------------------------------------
-- ② 採番（26 を付与）
--    ・list_no IS NULL を条件に入れているので、すでに番号がある行は絶対に書き換えない
--    ・NOT EXISTS で 26 が未使用であることを確認してからでないと更新されない
--    → 「0 rows」が返ったら①に戻って状況を確認すること（成功なら 1 row）
-- ------------------------------------------------------------
UPDATE drivers d
SET list_no = 26
WHERE d.name = '山本 浦伊良'
  AND d.list_no IS NULL
  AND d.works_as_driver = true
  AND NOT EXISTS (
    SELECT 1
    FROM drivers x
    WHERE x.org_id = d.org_id
      AND x.works_as_driver = true
      AND x.list_no = 26
  );


-- ------------------------------------------------------------
-- ③ 結果の確認（26 が1人だけ・他に未採番が残っていないか）
-- ------------------------------------------------------------
SELECT list_no, name, status
FROM drivers
WHERE works_as_driver = true
  AND (list_no >= 22 OR list_no IS NULL)
ORDER BY list_no NULLS LAST, created_at;
