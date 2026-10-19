#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="${SCRIPT_DIR}/new-api-mysql-migrate.sh"

help_output="$(bash "${SCRIPT}" --help)"
grep -Fq -- "--source" <<<"${help_output}"
grep -Fq -- "--target" <<<"${help_output}"

target_error="$(bash "${SCRIPT}" --source old@example.test 2>&1 || true)"
grep -Fq -- "--target is required" <<<"${target_error}"

database_error="$(bash "${SCRIPT}" --source old@example.test --target new@example.test --database 'db;drop' 2>&1 || true)"
grep -Fq -- "database contains unsupported characters" <<<"${database_error}"

project_error="$(bash "${SCRIPT}" --source old@example.test --target new@example.test --target-project '../other' 2>&1 || true)"
grep -Fq -- "target Compose project contains unsupported characters" <<<"${project_error}"

capture_file="$(mktemp)"
expected_file="$(mktemp)"
fake_bin="$(mktemp -d)"
trap 'rm -rf -- "${fake_bin}" "${capture_file}" "${expected_file}"' EXIT

cat >"${fake_bin}/ssh" <<'FAKE_SSH'
#!/usr/bin/env bash
remote_command="${!#}"
exec bash -c "${remote_command}"
FAKE_SSH

cat >"${fake_bin}/docker" <<'FAKE_DOCKER'
#!/usr/bin/env bash
printf '%s\n' "$@" >"${DOCKER_CAPTURE_FILE}"
FAKE_DOCKER
chmod +x "${fake_bin}/ssh" "${fake_bin}/docker"

DOCKER_CAPTURE_FILE="${capture_file}" PATH="${fake_bin}:${PATH}" bash -c '
  source "$1"
  SOURCE_SERVER="root@example.test"
  ssh_source docker inspect --format "{{range .Config.Env}}{{println .}}{{end}}" mysql
' _ "${SCRIPT}" >/dev/null

printf '%s\n' \
  inspect \
  --format \
  '{{range .Config.Env}}{{println .}}{{end}}' \
  mysql >"${expected_file}"
cmp -s "${expected_file}" "${capture_file}"

echo "new-api-mysql-migrate CLI safety tests passed"
