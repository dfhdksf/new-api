#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
#作用是将旧new-api中的mysql数据库迁移到新new-api中, 迁移过程中不会停止旧new-api的运行,
#迁移过程中会在本地生成一个压缩的数据库备份文件, 以防万一.
#使用方式:(常用)将A服务器上项目名为new-api的名为mysql容器的的数据库迁移到B服务器上项目名为new-api-1的名为mysql(实际容器名为new-api-1-mysql-1)数据库new-api中(数据库名必须相同)
#  ./self-tools/new-api-mysql-migrate.sh \
#    --source root@154.219.106.58 \
#    --source-mysql-container mysql \
#    --target root@45.192.102.168 \
#    --target-dir /root/new-api-1 \
#    --target-project new-api-1 \
#    --database new-api \
#
#target-project new-api-1 用来指定 Docker Compose 项目的名称。Compose 会用它区分不同部署项目，并据此命名容器、网络和命名卷，避免同一台服务器上的实例互相冲突。
#需要保证新服务器上已经有一个运行中的 new-api-1 项目, 并且其数据库为空, 也就是没有任何表.
#脚本会先显示迁移计划并等待确认。旧服务器容器名默认使用你提供的 mysql 和 new-api；如果实际名称不同，可以加 --source-mysql-container 容器名 或 --source-app-container 容器名。
#数据库名也可以不传，脚本会尝试从旧 MySQL 容器的 MYSQL_DATABASE 读取。
#新服务器 /root/new-api-1 已有正确的 docker-compose.yml 和 .env。
#目标 MySQL 中没有已有数据；脚本会拒绝导入到已有数据的数据库。

#--source-mysql-container mysql：源服务器 MySQL 容器名，需要。你的源容器名是 mysql，而且这是默认值，可以省略。
#
#--source-app-container new-api：源服务器应用容器名。因为使用了 --stop-source-app，脚本需要知道停止哪个容器；你的容器名是默认的 new-api，也可以省略。
#
#--target-project new-api-1：需要。这是目标 Docker Compose 项目名，用来隔离网络、容器和卷，不是具体容器名。
#
#目标容器名：不需要。脚本会进入 /root/new-api-1，通过：
#docker compose -p new-api-1 exec mysql
#操作目标 Compose 中名为 mysql 的服务。
#
#--database new-api：可以省略，脚本会从源 MySQL 容器的 MYSQL_DATABASE 自动读取；但建议保留，便于校验。目标服务器 .env 中的 MYSQL_DATABASE 必须也是 new-api。





SCRIPT_NAME="$(basename "$0")"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
SOURCE_SERVER=""
TARGET_SERVER=""
SOURCE_MYSQL_CONTAINER="mysql"
SOURCE_APP_CONTAINER="new-api"
TARGET_DIR="/home/ubuntu/new-api-second"
TARGET_PROJECT="new-api-second"
TARGET_COMPOSE_FILE="docker-compose.yml"
DATABASE=""
BACKUP_DIR="./tmp/new-api-mysql-migration-${TIMESTAMP}"
STOP_SOURCE_APP=0
SOURCE_APP_STOPPED_BY_SCRIPT=0
CONFIRM=0
SSH_OPTIONS=(-o ConnectTimeout=15)

usage() {
  cat <<HELP
Usage:
  ${SCRIPT_NAME} --source user@old-server --target user@new-server [options]

Required:
  --source HOST             Old server SSH target.
  --target HOST             New server SSH target.

Options:
  --source-mysql-container NAME
                            Old MySQL container name (default: ${SOURCE_MYSQL_CONTAINER}).
  --source-app-container NAME
                            Old application container name (default: ${SOURCE_APP_CONTAINER}).
  --target-dir PATH         New deployment directory (default: ${TARGET_DIR}).
  --target-project NAME     New Docker Compose project (default: ${TARGET_PROJECT}).
  --target-compose-file PATH
                            Compose file relative to --target-dir (default: ${TARGET_COMPOSE_FILE}).
  --database NAME           Database name; default is read from the old MySQL container.
  --backup-dir PATH         Local dump directory (default: ${BACKUP_DIR}).
  --stop-source-app         Stop old app before export (recommended for final cutover).
  --yes                     Skip confirmation (required in non-interactive use).
  -h, --help                Show this help.

Example:
  ${SCRIPT_NAME} --source ubuntu@OLD_IP --target ubuntu@NEW_IP \\
    --target-dir /home/ubuntu/new-api-second \\
    --target-project new-api-second --database new-api \\
    --stop-source-app --yes

Run locally. SSH authentication must work to both hosts. The target directory
must already contain docker-compose.yml and .env. The target MYSQL_DATABASE must
match the source database, and the target database must not already contain tables.
HELP
}

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "missing local command: $1"
}

validate_name() {
  case "$1" in
    ''|*[!A-Za-z0-9_.-]*) fail "$2 contains unsupported characters: $1" ;;
  esac
}

sha256_file() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    sha256sum "$1" | awk '{print $1}'
  fi
}

parse_args() {
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --source) [ "$#" -ge 2 ] || fail "--source requires a value"; SOURCE_SERVER="$2"; shift 2 ;;
      --target) [ "$#" -ge 2 ] || fail "--target requires a value"; TARGET_SERVER="$2"; shift 2 ;;
      --source-mysql-container) [ "$#" -ge 2 ] || fail "--source-mysql-container requires a value"; SOURCE_MYSQL_CONTAINER="$2"; shift 2 ;;
      --source-app-container) [ "$#" -ge 2 ] || fail "--source-app-container requires a value"; SOURCE_APP_CONTAINER="$2"; shift 2 ;;
      --target-dir) [ "$#" -ge 2 ] || fail "--target-dir requires a value"; TARGET_DIR="$2"; shift 2 ;;
      --target-project) [ "$#" -ge 2 ] || fail "--target-project requires a value"; TARGET_PROJECT="$2"; shift 2 ;;
      --target-compose-file) [ "$#" -ge 2 ] || fail "--target-compose-file requires a value"; TARGET_COMPOSE_FILE="$2"; shift 2 ;;
      --database) [ "$#" -ge 2 ] || fail "--database requires a value"; DATABASE="$2"; shift 2 ;;
      --backup-dir) [ "$#" -ge 2 ] || fail "--backup-dir requires a value"; BACKUP_DIR="$2"; shift 2 ;;
      --stop-source-app) STOP_SOURCE_APP=1; shift ;;
      --yes) CONFIRM=1; shift ;;
      -h|--help) usage; exit 0 ;;
      *) fail "unknown argument: $1; use --help for usage" ;;
    esac
  done
}

check_args() {
  [ -n "$SOURCE_SERVER" ] || fail "--source is required"
  [ -n "$TARGET_SERVER" ] || fail "--target is required"
  validate_name "$SOURCE_MYSQL_CONTAINER" "source MySQL container"
  validate_name "$SOURCE_APP_CONTAINER" "source app container"
  validate_name "$TARGET_PROJECT" "target Compose project"
  if [ -n "$DATABASE" ]; then
    validate_name "$DATABASE" "database"
  fi
}

ssh_source() {
  local remote_command
  remote_command="$(build_remote_command "$@")"
  ssh "${SSH_OPTIONS[@]}" "$SOURCE_SERVER" "$remote_command"
}

ssh_target() {
  local remote_command
  remote_command="$(build_remote_command "$@")"
  ssh "${SSH_OPTIONS[@]}" "$TARGET_SERVER" "$remote_command"
}

quote_remote_argument() {
  local value="$1"
  value=${value//\'/\'\\\'\'}
  printf "'%s'" "$value"
}

build_remote_command() {
  local remote_command=""
  local argument quoted
  for argument in "$@"; do
    quoted="$(quote_remote_argument "$argument")"
    if [ -n "$remote_command" ]; then
      remote_command+=" "
    fi
    remote_command+="${quoted}"
  done
  printf '%s' "$remote_command"
}

ssh_source_script() {
  local remote_command
  remote_command="$(build_remote_command bash -s -- "$@")"
  ssh "${SSH_OPTIONS[@]}" "$SOURCE_SERVER" "$remote_command"
}

ssh_target_script() {
  local remote_command
  remote_command="$(build_remote_command bash -s -- "$@")"
  ssh "${SSH_OPTIONS[@]}" "$TARGET_SERVER" "$remote_command"
}

read_source_database() {
  local env_dump
  env_dump="$(ssh_source docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$SOURCE_MYSQL_CONTAINER")" \
    || fail "cannot inspect source MySQL container: ${SOURCE_MYSQL_CONTAINER}"

  if [ -z "$DATABASE" ]; then
    DATABASE="$(printf '%s\n' "$env_dump" | awk -F= '$1 == "MYSQL_DATABASE" {print substr($0, index($0, "=") + 1); exit}')"
  fi
  [ -n "$DATABASE" ] || fail "cannot determine database name; pass --database explicitly"
  validate_name "$DATABASE" "database"
}

confirm_migration() {
  printf '\nMigration plan:\n'
  printf '  source: %s, MySQL container=%s, database=%s\n' "$SOURCE_SERVER" "$SOURCE_MYSQL_CONTAINER" "$DATABASE"
  printf '  target: %s, Compose project=%s, directory=%s\n' "$TARGET_SERVER" "$TARGET_PROJECT" "$TARGET_DIR"
  printf '  local compressed backup: %s/database.sql.gz\n' "$BACKUP_DIR"
  if [ "$STOP_SOURCE_APP" -eq 1 ]; then
    printf '  old application: stop before export\n'
  else
    printf '  old application: remains running during export\n'
  fi
  [ "$CONFIRM" -eq 1 ] && return
  [ -t 0 ] || fail "non-interactive execution requires --yes"
  printf 'Continue? [y/N] '
  read -r answer
  case "$answer" in
    y|Y|yes|YES) ;;
    *) fail "migration cancelled" ;;
  esac
}

stop_source_app() {
  [ "$STOP_SOURCE_APP" -eq 1 ] || return 0
  local is_running
  is_running="$(ssh_source docker inspect --format '{{.State.Running}}' "$SOURCE_APP_CONTAINER")" \
    || fail "cannot inspect source app container: ${SOURCE_APP_CONTAINER}"
  if [ "$is_running" = true ]; then
    printf 'Stopping source application container...\n'
    ssh_source docker stop "$SOURCE_APP_CONTAINER" >/dev/null
    SOURCE_APP_STOPPED_BY_SCRIPT=1
  else
    printf 'Source application is already stopped.\n'
  fi
}

dump_source_database() {
  local dump_file="$BACKUP_DIR/database.sql.gz"
  mkdir -p "$BACKUP_DIR"
  chmod 700 "$BACKUP_DIR"

  printf 'Exporting source database...\n'
  ssh_source_script "$SOURCE_MYSQL_CONTAINER" "$DATABASE" <<'REMOTE_DUMP' | gzip -1 >"$dump_file"
set -Eeuo pipefail
container="$1"
database="$2"
docker exec -e "MIGRATION_DATABASE=${database}" "$container" sh -c '
  MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysqldump -uroot \
    --single-transaction --quick --routines --events --triggers --hex-blob \
    --set-gtid-purged=OFF --databases "$MIGRATION_DATABASE"
'
REMOTE_DUMP

  gzip -t "$dump_file"
  [ -s "$dump_file" ] || fail "source dump is empty"
  printf '%s  %s\n' "$(sha256_file "$dump_file")" "$(basename "$dump_file")" >"$BACKUP_DIR/SHA256SUMS"
  chmod 600 "$dump_file" "$BACKUP_DIR/SHA256SUMS"
  printf 'Local dump ready: %s\n' "$dump_file"
}

import_target_database() {
  local remote_dump="/tmp/new-api-mysql-migration-${TIMESTAMP}.sql.gz"

  printf 'Uploading dump to target server...\n'
  ssh_target_script "$remote_dump" <<'REMOTE_PREPARE_UPLOAD'
set -Eeuo pipefail
umask 077
install -m 600 /dev/null "$1"
REMOTE_PREPARE_UPLOAD
  scp "${SSH_OPTIONS[@]}" "$BACKUP_DIR/database.sql.gz" "$TARGET_SERVER:${remote_dump}"

  printf 'Starting target MySQL and importing database...\n'
  ssh_target_script \
    "$TARGET_DIR" "$TARGET_PROJECT" "$TARGET_COMPOSE_FILE" "$DATABASE" "$remote_dump" <<'REMOTE_IMPORT'
set -Eeuo pipefail
target_dir="$1"
project="$2"
compose_file="$3"
database="$4"
remote_dump="$5"
cd "$target_dir"
compose=(docker compose -p "$project" -f "$compose_file")
trap 'rm -f -- "$remote_dump"' EXIT

test -f .env || { echo "target .env is missing" >&2; exit 1; }
"${compose[@]}" config -q
"${compose[@]}" up -d mysql >/dev/null

container_id=""
for attempt in $(seq 1 60); do
  container_id="$("${compose[@]}" ps -q mysql)"
  status="$(docker inspect --format '{{.State.Health.Status}}' "$container_id" 2>/dev/null || true)"
  [ "$status" = healthy ] && break
  sleep 2
done
[ -n "$container_id" ] || { echo "target MySQL container was not created" >&2; exit 1; }
[ "$(docker inspect --format '{{.State.Health.Status}}' "$container_id" 2>/dev/null || true)" = healthy ] || {
  echo "target MySQL did not become healthy" >&2
  exit 1
}

target_database="$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$container_id" | awk -F= '$1 == "MYSQL_DATABASE" {print substr($0, index($0, "=") + 1); exit}')"
[ "$target_database" = "$database" ] || {
  echo "target MYSQL_DATABASE (${target_database:-unset}) does not match source database (${database})" >&2
  exit 1
}

# Read-only checks must not inherit the bash -s stdin. That stdin contains the
# remainder of this remote script and can otherwise be consumed by mysql.
database_exists="$("${compose[@]}" exec -T mysql sh -c \
  'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot -Nse "SHOW DATABASES"' </dev/null | awk -v db="$database" '$0 == db {found=1} END {print found+0}')"
if [ "$database_exists" -eq 1 ]; then
  table_count="$("${compose[@]}" exec -T -e "MIGRATION_DATABASE=${database}" mysql sh -c \
    'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot --database="$MIGRATION_DATABASE" -Nse "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE()"' </dev/null)"
  case "$table_count" in
    ''|*[!0-9]*) echo "could not determine target table count" >&2; exit 1 ;;
  esac
  if [ "$table_count" -gt 0 ]; then
    echo "target database ${database} already contains ${table_count} tables; refusing import" >&2
    exit 20
  fi
fi

gzip -t "$remote_dump"
gzip -dc "$remote_dump" | "${compose[@]}" exec -T mysql sh -c \
  'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot'

table_count="$("${compose[@]}" exec -T -e "MIGRATION_DATABASE=${database}" mysql sh -c \
  'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot --database="$MIGRATION_DATABASE" -Nse "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE()"' </dev/null)"
printf 'Target import completed; tables in %s: %s\n' "$database" "$table_count"
REMOTE_IMPORT
}

cleanup_source_app_on_failure() {
  local status=$?
  if [ "$status" -ne 0 ] && [ "$SOURCE_APP_STOPPED_BY_SCRIPT" -eq 1 ]; then
    printf 'Migration failed; restarting the old application...\n' >&2
    ssh_source docker start "$SOURCE_APP_CONTAINER" >/dev/null || \
      printf 'WARNING: could not restart the old application; start it manually.\n' >&2
  fi
  return "$status"
}

main() {
  trap cleanup_source_app_on_failure EXIT
  parse_args "$@"
  check_args
  require_command ssh
  require_command scp
  require_command gzip
  require_command awk
  if ! command -v shasum >/dev/null 2>&1 && ! command -v sha256sum >/dev/null 2>&1; then
    fail "missing local command: shasum or sha256sum"
  fi

  read_source_database
  confirm_migration
  stop_source_app
  dump_source_database
  import_target_database

  printf '\nMigration finished successfully.\n'
  printf 'Keep the old server unchanged until the new application and DNS cutover have been verified.\n'
  printf 'Local backup: %s\n' "$BACKUP_DIR"
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  main "$@"
fi
