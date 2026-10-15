#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

APP_DIR="/root/new-api"
BACKUP_ROOT="/var/backups/new-api"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_NAME="new-api-${TIMESTAMP}"
TEMP_DIR="${BACKUP_ROOT}/.${BACKUP_NAME}.tmp"
FINAL_DIR="${BACKUP_ROOT}/${BACKUP_NAME}"

mkdir -p "${BACKUP_ROOT}"
mkdir -p "${TEMP_DIR}"

# 防止上一次备份尚未结束时再次并发执行。
exec 9>"${BACKUP_ROOT}/backup.lock"
flock -n 9 || {
          echo "Another new-api backup is already running."
  exit 0
}

cd "${APP_DIR}"

# 导出 MySQL 数据库。
docker compose exec -T mysql sh -c \
          'exec mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" \
              --single-transaction \
                  --routines \
                      --events \
                          --triggers \
                              --set-gtid-purged=OFF \
                                  "$MYSQL_DATABASE"' \
                                    | gzip -c > "${TEMP_DIR}/database.sql.gz"

# 验证压缩数据库备份可读。
gzip -t "${TEMP_DIR}/database.sql.gz"
test -s "${TEMP_DIR}/database.sql.gz"

# 保存部署配置快照。
CONFIG_FILES=(docker-compose.yml .env)

if [ -f docker-compose.release.yml ]; then
          CONFIG_FILES+=(docker-compose.release.yml)
fi

tar -C "${APP_DIR}" -czf "${TEMP_DIR}/config.tar.gz" "${CONFIG_FILES[@]}"

# 记录备份元信息。
{
          echo "backup_time=${TIMESTAMP}"
            echo "database_file=database.sql.gz"
              echo "database_sha256=$(sha256sum "${TEMP_DIR}/database.sql.gz" | awk '{print $1}')"
                echo "config_sha256=$(sha256sum "${TEMP_DIR}/config.tar.gz" | awk '{print $1}')"
                  echo "running_image=$(docker inspect -f '{{.Config.Image}}' new-api 2>/dev/null || echo unknown)"
          } > "${TEMP_DIR}/manifest.txt"

          # 仅在完整成功后再原子地把临时目录变为正式备份。
          mv "${TEMP_DIR}" "${FINAL_DIR}"

          # 只保留最新两份备份集。
          find "${BACKUP_ROOT}" \
                    -mindepth 1 \
                      -maxdepth 1 \
                        -type d \
                          -name 'new-api-*' \
                            -printf '%f\n' \
                              | sort -r \
                                | tail -n +3 \
                                  | while IFS= read -r old_backup; do
                rm -rf -- "${BACKUP_ROOT}/${old_backup}"
                    done

                    echo "Backup completed: ${FINAL_DIR}"

