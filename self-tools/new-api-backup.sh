#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

# 备份数据库文件到本地；设置 BACKUP_REMOTE 后，同时通过已有 SSH 账号上传。
APP_DIR="${APP_DIR:-/root/new-api-1}"
BACKUP_ROOT="${BACKUP_ROOT:-/var/backups/new-api-1}"
COMPOSE_PROJECT="${COMPOSE_PROJECT:-new-api-1}"
APP_CONTAINER="${APP_CONTAINER:-new-api-1-new-api-1}"
BACKUP_KEEP_COUNT="${BACKUP_KEEP_COUNT:-2}"
BACKUP_REMOTE="${BACKUP_REMOTE:-}"
BACKUP_REMOTE_DIR="${BACKUP_REMOTE_DIR:-}"
BACKUP_SSH_PORT="${BACKUP_SSH_PORT:-22}"

if [[ ! "${BACKUP_KEEP_COUNT}" =~ ^[1-9][0-9]*$ ]]; then
  echo "BACKUP_KEEP_COUNT must be a positive integer." >&2
  exit 1
fi

if [[ -n "${BACKUP_REMOTE}" ]]; then
  # 远端路径会传给远端 shell；仅允许不需要额外转义的绝对路径。
  if [[ ! "${BACKUP_REMOTE}" =~ ^[a-zA-Z0-9_][a-zA-Z0-9_.@-]*$ ]] ||
     [[ ! "${BACKUP_REMOTE_DIR}" =~ ^/[a-zA-Z0-9_./-]+$ ]] ||
     [[ ! "${BACKUP_SSH_PORT}" =~ ^[0-9]+$ ]]; then
    echo "Set BACKUP_REMOTE=user@host, BACKUP_REMOTE_DIR to an absolute path without spaces, and BACKUP_SSH_PORT to a port number." >&2
    exit 1
  fi
  command -v rsync >/dev/null
  command -v ssh >/dev/null
elif [[ -n "${BACKUP_REMOTE_DIR}" ]]; then
  echo "BACKUP_REMOTE is required when BACKUP_REMOTE_DIR is set." >&2
  exit 1
fi

mkdir -p "${BACKUP_ROOT}"

# 防止上一次备份尚未结束时再次并发执行；锁覆盖备份和上传全过程。
exec 9>"${BACKUP_ROOT}/backup.lock"
flock -n 9 || {
  echo "Another new-api backup is already running."
  exit 0
}

TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_NAME="new-api-${TIMESTAMP}-$$"
TEMP_DIR="${BACKUP_ROOT}/.${BACKUP_NAME}.tmp"
FINAL_DIR="${BACKUP_ROOT}/${BACKUP_NAME}"
mkdir -p "${TEMP_DIR}"
trap 'rm -rf -- "${TEMP_DIR}"' EXIT

cd "${APP_DIR}"
CONFIG_FILES=(docker-compose.yml .env)
COMPOSE_ARGS=(-p "${COMPOSE_PROJECT}" -f "${APP_DIR}/docker-compose.yml")
if [[ -f docker-compose.release.yml ]]; then
  CONFIG_FILES+=(docker-compose.release.yml)
  COMPOSE_ARGS+=(-f "${APP_DIR}/docker-compose.release.yml")
fi

# 导出指定 Compose 项目中 mysql 服务的数据库。
docker compose "${COMPOSE_ARGS[@]}" exec -T mysql sh -c \
  'exec mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" \
    --single-transaction \
    --routines \
    --events \
    --triggers \
    --set-gtid-purged=OFF \
    "$MYSQL_DATABASE"' \
  | gzip -c > "${TEMP_DIR}/database.sql.gz"

gzip -t "${TEMP_DIR}/database.sql.gz"
test -s "${TEMP_DIR}/database.sql.gz"
tar -C "${APP_DIR}" -czf "${TEMP_DIR}/config.tar.gz" "${CONFIG_FILES[@]}"

{
  echo "backup_time=${TIMESTAMP}"
  echo "database_file=database.sql.gz"
  echo "database_sha256=$(sha256sum "${TEMP_DIR}/database.sql.gz" | awk '{print $1}')"
  echo "config_sha256=$(sha256sum "${TEMP_DIR}/config.tar.gz" | awk '{print $1}')"
  echo "running_image=$(docker inspect -f '{{.Config.Image}}' "${APP_CONTAINER}" 2>/dev/null || echo unknown)"
} > "${TEMP_DIR}/manifest.txt"

(
  cd "${TEMP_DIR}"
  sha256sum database.sql.gz config.tar.gz manifest.txt > SHA256SUMS
)

# 本地完整备份先落盘，上传失败时也保留这一份。
mv "${TEMP_DIR}" "${FINAL_DIR}"
echo "Local backup completed: ${FINAL_DIR}"

if [[ -n "${BACKUP_REMOTE}" ]]; then
  SSH_ARGS=(-p "${BACKUP_SSH_PORT}" -o BatchMode=yes -o ConnectTimeout=15 -o ServerAliveInterval=30 -o ServerAliveCountMax=3)
  REMOTE_TEMP="${BACKUP_REMOTE_DIR}/.${BACKUP_NAME}.tmp"
  REMOTE_FINAL="${BACKUP_REMOTE_DIR}/${BACKUP_NAME}"

  # 先上传到隐藏目录，校验成功后再发布为正式备份目录。
  ssh "${SSH_ARGS[@]}" "${BACKUP_REMOTE}" \
    "umask 077; mkdir -p -- '${REMOTE_TEMP}'"
  rsync -rt --chmod=D700,F600 --timeout=120 \
    -e "ssh -p ${BACKUP_SSH_PORT} -o BatchMode=yes -o ConnectTimeout=15 -o ServerAliveInterval=30 -o ServerAliveCountMax=3" \
    "${FINAL_DIR}/" "${BACKUP_REMOTE}:${REMOTE_TEMP}/"
  ssh "${SSH_ARGS[@]}" "${BACKUP_REMOTE}" \
    "cd '${REMOTE_TEMP}' && sha256sum -c SHA256SUMS && test ! -e '${REMOTE_FINAL}' && mv -- '${REMOTE_TEMP}' '${REMOTE_FINAL}'"
  echo "Upload completed: ${BACKUP_REMOTE}:${REMOTE_FINAL}"
fi

# 上传失败会提前退出，不执行本地清理；远端备份不自动删除。
find "${BACKUP_ROOT}" \
  -mindepth 1 -maxdepth 1 -type d -name 'new-api-*' -printf '%f\n' \
  | sort -r \
  | tail -n "+$((BACKUP_KEEP_COUNT + 1))" \
  | while IFS= read -r old_backup; do
      rm -rf -- "${BACKUP_ROOT}/${old_backup}"
    done

echo "Backup completed: ${FINAL_DIR}"
