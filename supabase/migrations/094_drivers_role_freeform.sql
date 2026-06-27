-- ============================================================
-- Phase 9 — カスタムロールのメンバー割当を可能にする
-- drivers.role は固定4値の CHECK だったが、org が作るカスタムロール(roles.key=CUSTOM_xxxxx)を
-- 割り当てられるよう CHECK を撤廃する。以後 role はラベル、権限の正本は role_id→role_capabilities。
-- 追加のみ・挙動不変（既存値はそのまま有効）。冪等。
--   設計: docs/platform-design.md §2-6
-- ============================================================

ALTER TABLE drivers DROP CONSTRAINT IF EXISTS drivers_role_check;
