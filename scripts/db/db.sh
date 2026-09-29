#!/usr/bin/env bash
# Supabase の Postgres に psql で直接つなぐラッパ。
#
#   既定はすべて読み取り専用セッション（default_transaction_read_only=on）で、
#   書き込みはサーバー側で弾かれる。書き込みは apply / write サブコマンドだけが行い、
#   本番に対しては --confirm= の一致を要求する。
#
#   接続先は apps/web/.env.dbadmin（gitignore 済）に置く:
#     DB_URL_PROD=postgresql://postgres.<ref>:<password>@aws-1-<region>.pooler.supabase.com:5432/postgres
#     DB_URL_DEV=postgresql://...            # 任意（ローカル supabase 等）
#
#   使い方は docs/development/db-access.md を参照。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${HAKOTORA_DB_ENV:-$ROOT/apps/web/.env.dbadmin}"
MIGRATIONS_DIR="$ROOT/supabase/migrations"
TARGET="${HAKOTORA_DB_TARGET:-prod}"

usage() {
  cat <<'EOS'
使い方: scripts/db/db.sh <コマンド> [引数]

読み取り（読み取り専用セッション）
  q "<SQL>"            SQL を1つ実行して表で表示
  qcsv "<SQL>"         同上・CSV で出力（ファイルに落としたいとき）
  qf <file.sql>        SQL ファイルを実行
  psql [psql の引数]    対話 psql（読み取り専用）
  status               supabase/migrations と _migrations 台帳の差分

書き込み（明示的な確認が要る）
  apply <file.sql> --confirm=<ファイル名>   1トランザクションで適用し台帳に記録
  dryrun <file.sql>                        BEGIN … ROLLBACK で流して失敗しないか見る
  write "<SQL>" --confirm=write             読み書きセッションで単発 SQL

接続先の切り替え
  HAKOTORA_DB_TARGET=dev scripts/db/db.sh q "select 1"   （既定は prod）
EOS
}

die() { echo "エラー: $*" >&2; exit 1; }

load_url() {
  [ -f "$ENV_FILE" ] || die "接続情報のファイルがない: $ENV_FILE
  docs/development/db-access.md の手順で DB_URL_PROD を書いてください。"
  # shellcheck disable=SC1090
  set -a; . "$ENV_FILE"; set +a
  case "$TARGET" in
    prod) DB_URL="${DB_URL_PROD:-}" ;;
    dev)  DB_URL="${DB_URL_DEV:-}" ;;
    *) die "HAKOTORA_DB_TARGET は prod か dev: $TARGET" ;;
  esac
  [ -n "$DB_URL" ] && export DB_URL || die "$ENV_FILE に $( [ "$TARGET" = prod ] && echo DB_URL_PROD || echo DB_URL_DEV ) がない"
}

masked() { echo "$DB_URL" | sed -E 's#(://[^:]+):[^@]*@#\1:***@#'; }

banner() { echo "[db] 接続先=$TARGET $(masked)" >&2; }

ro()  { PGOPTIONS="-c default_transaction_read_only=on -c statement_timeout=120000" psql "$DB_URL" -v ON_ERROR_STOP=1 "$@"; }
rw()  { PGOPTIONS="-c statement_timeout=300000" psql "$DB_URL" -v ON_ERROR_STOP=1 "$@"; }

require_confirm() {
  want="$1"; shift
  for a in "$@"; do
    [ "$a" = "--confirm=$want" ] && return 0
  done
  die "書き込みには --confirm=$want が要ります（接続先=$TARGET）"
}

# Outer BEGIN/COMMIT in migration files must be removed before psql wraps them.
# Keep PL/pgSQL bodies intact and reject any remaining transaction command.
prepare_migration() {
  local input="$1" output="$2" scan="$3"
  awk '
    at_start && (/^[[:space:]]*$/ || /^[[:space:]]*--/) { prefix[++p] = $0; next }
    at_start && /^[[:space:]]*BEGIN[[:space:]]*;[[:space:]]*$/ { outer = 1; at_start = 0; next }
    { at_start = 0; lines[++n] = $0 }
    END {
      for (i = 1; i <= p; i++) print prefix[i]
      if (outer) {
        while (n > 0 && lines[n] ~ /^[[:space:]]*$/) n--
        if (n > 0 && lines[n] ~ /^[[:space:]]*COMMIT[[:space:]]*;[[:space:]]*$/) n--
        else exit 2
      }
      for (i = 1; i <= n; i++) print lines[i]
    }
  ' at_start=1 "$input" > "$output" || die '外側の COMMIT が見つかりません'
  # A BEGIN inside a $$ PL/pgSQL body is not a SQL transaction command.
  awk '{ n = split($0, parts, /\$\$/); for (i = 1; i <= n; i++) {
    if (!in_body) printf "%s", parts[i];
    if (i < n) in_body = !in_body;
  } print "" } END { if (in_body) exit 2 }' "$output" > "$scan" || die 'SQL の $$ が閉じられていません'
  sed -E 's/--.*$//' "$scan" > "${scan}.clean"
  if grep -qEi '(^|[[:space:];])(COMMIT|ROLLBACK|BEGIN|SAVEPOINT|START[[:space:]]+TRANSACTION)([[:space:];]|$)' "${scan}.clean"; then
    die "この SQL は行の途中でトランザクションを操作しています:
  $(grep -nEi '(^|[[:space:];])(COMMIT|ROLLBACK|BEGIN|SAVEPOINT|START[[:space:]]+TRANSACTION)([[:space:];]|$)' "${scan}.clean" | head -3)"
  fi
}

cmd="${1:-}"; [ $# -gt 0 ] && shift || true

case "$cmd" in
  q)     load_url; banner; ro -P pager=off -c "${1:?SQL を渡してください}" ;;
  qcsv)  load_url; banner; ro -A -F, -P pager=off --csv -c "${1:?SQL を渡してください}" ;;
  qf)    load_url; banner; ro -P pager=off -f "${1:?SQL ファイルを渡してください}" ;;
  psql)  load_url; banner; ro "$@" ;;

  status)
    load_url; banner
    applied="$(ro -At -c "select name from _migrations order by name" 2>/dev/null || true)"
    if [ -z "$applied" ]; then
      echo "台帳 _migrations が無いか空です（本番は SQL Editor 手動適用の履歴があるため、"
      echo "初回は scripts/db/audit/backfill-migrations.sql で実状に合わせて埋めてください）"
    fi
    echo "--- 未記録の migration ---"
    for f in "$MIGRATIONS_DIR"/*.sql; do
      b="$(basename "$f")"
      echo "$applied" | grep -qx "$b" || echo "  $b"
    done
    ;;

  dryrun)
    file="${1:?SQL ファイルを渡してください}"; load_url; banner
    stripped="$(mktemp)"; transaction_scan="$(mktemp)"
    trap 'rm -f "$stripped" "$transaction_scan" "${transaction_scan}.clean"' EXIT
    prepare_migration "$file" "$stripped" "$transaction_scan"
    echo "[db] BEGIN … ROLLBACK で試し流しします（変更は残りません）" >&2
    { echo "BEGIN;"; cat "$stripped"; echo "ROLLBACK;"; } | rw -P pager=off -f -
    ;;

  apply)
    file="${1:?SQL ファイルを渡してください}"; shift
    base="$(basename "$file")"
    require_confirm "$base" "$@"
    load_url; banner
    echo "[db] $base を1トランザクションで適用します" >&2
    tmp="$(mktemp)"; stripped="$(mktemp)"; transaction_scan="$(mktemp)"
    trap 'rm -f "$tmp" "$stripped" "$transaction_scan" "${transaction_scan}.clean"' EXIT
    prepare_migration "$file" "$stripped" "$transaction_scan"
    cat >"$tmp" <<EOS
CREATE TABLE IF NOT EXISTS _migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
INSERT INTO _migrations(name) VALUES ('$base') ON CONFLICT DO NOTHING;
EOS
    rw --single-transaction -P pager=off -f "$stripped" -f "$tmp"
    echo "[db] 適用完了: $base" >&2
    ;;

  write)
    sql="${1:?SQL を渡してください}"; shift
    require_confirm "write" "$@"
    load_url; banner
    rw --single-transaction -P pager=off -c "$sql"
    ;;

  ""|-h|--help|help) usage ;;
  *) usage; die "不明なコマンド: $cmd" ;;
esac
