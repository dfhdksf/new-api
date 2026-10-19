#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="${SCRIPT_DIR}/new-api-backup.sh"
TEST_ROOT="$(mktemp -d)"
trap 'rm -rf -- "$TEST_ROOT"' EXIT

APP_DIR="${TEST_ROOT}/app"
BACKUP_ROOT="${TEST_ROOT}/backups"
MOCK_BIN="${TEST_ROOT}/bin"
mkdir -p "${APP_DIR}" "${MOCK_BIN}"
touch "${APP_DIR}/docker-compose.yml" "${APP_DIR}/.env"

cat > "${MOCK_BIN}/docker" <<'MOCK'
#!/usr/bin/env bash
set -Eeuo pipefail
if [[ "$1" == "inspect" ]]; then
  printf 'new-api:test\n'
else
  printf 'mock database dump\n'
fi
MOCK

cat > "${MOCK_BIN}/flock" <<'MOCK'
#!/usr/bin/env bash
exit 0
MOCK

cat > "${MOCK_BIN}/rsync" <<'MOCK'
#!/usr/bin/env bash
set -Eeuo pipefail
printf 'rsync %s\n' "$*" >> "$CALL_LOG"
exit "${RSYNC_EXIT_CODE:-0}"
MOCK

cat > "${MOCK_BIN}/ssh" <<'MOCK'
#!/usr/bin/env bash
set -Eeuo pipefail
printf 'ssh %s\n' "$*" >> "$CALL_LOG"
MOCK

cat > "${MOCK_BIN}/find" <<'MOCK'
#!/usr/bin/env bash
set -Eeuo pipefail
if [[ " $* " == *" -printf "* ]]; then
  printf 'find %s\n' "$*" >> "$CALL_LOG"
  exit 0
fi
exec "$REAL_FIND" "$@"
MOCK

chmod +x "${MOCK_BIN}"/*
export APP_DIR BACKUP_ROOT CALL_LOG="${TEST_ROOT}/calls.log"
export BACKUP_REMOTE="backup@example.test"
export BACKUP_REMOTE_DIR="/srv/backups/new-api"
export REAL_FIND="$(command -v find)"
export PATH="${MOCK_BIN}:${PATH}"

bash "${SCRIPT}"

BACKUP_PATH="$(find "${BACKUP_ROOT}" -mindepth 1 -maxdepth 1 -type d -name 'new-api-*' ! -name '.*' | head -n 1)"
test -n "${BACKUP_PATH}"
test -s "${BACKUP_PATH}/database.sql.gz"
test -s "${BACKUP_PATH}/config.tar.gz"
grep -Fq "${BACKUP_REMOTE}:${BACKUP_REMOTE_DIR}/.new-api-" "${CALL_LOG}"
grep -Fq "mv -- '${BACKUP_REMOTE_DIR}/.new-api-" "${CALL_LOG}"

rm -f "${CALL_LOG}"
if RSYNC_EXIT_CODE=23 bash "${SCRIPT}"; then
  printf 'Expected backup script to fail when remote transfer fails.\n' >&2
  exit 1
fi

test -n "$(find "${BACKUP_ROOT}" -mindepth 1 -maxdepth 1 -type d -name 'new-api-*' ! -name '.*' | head -n 1)"
if grep -Fq 'find ' "${CALL_LOG}"; then
  printf 'Local retention must not run after a failed remote transfer.\n' >&2
  exit 1
fi
