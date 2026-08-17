WEB_DIR = ./web
API_DIR = .
DEV_WEB_PORT ?= 5173
DEV_COMPOSE_FILE = docker-compose.dev.yml
DEV_POSTGRES_SERVICE = postgres
DEV_API_SERVICE = new-api
DEV_POSTGRES_DB = new-api
DEV_POSTGRES_USER = root
DEV_SQLITE_PATH ?= one-api.db
AIR_WEB_HASH_FILE = ./tmp/.air-web-inputs.sha256
DEPLOY_URL ?= http://localhost:3000

BINARY := new-api
CONFIG := config.yaml
PID_FILE := .new-api.pid
LOG_FILE := new-api.log

.PHONY: all build-web verify-web-assets build-all-web start-api dev dev-api dev-api-rebuild dev-web reset-setup test \
	build start stop restart status logs clean db air air-sync-web air-build deploy deploy-fresh \
	build-image upload release verify-deployment docker-clean

all: build-all-web start-api

build-web:
	@echo "Building web frontend..."
	@cd $(WEB_DIR) && bun install --frozen-lockfile
	@cd $(WEB_DIR) && DISABLE_ESLINT_PLUGIN='true' VITE_REACT_APP_VERSION=$$(cat ../VERSION) bun run build
	@make --no-print-directory verify-web-assets

verify-web-assets:
	@echo ">>> Verifying public assets were copied to the frontend dist..."
	@test -d $(WEB_DIR)/dist || { echo ">>> ERROR: $(WEB_DIR)/dist does not exist"; exit 1; }
	@cd $(WEB_DIR)/public && \
		find . -type f -print | LC_ALL=C sort | while IFS= read -r file; do \
			test -f "../dist/$$file" || { echo ">>> ERROR: missing dist asset: $$file"; exit 1; }; \
			cmp -s "$$file" "../dist/$$file" || { echo ">>> ERROR: stale dist asset: $$file"; exit 1; }; \
		done
	@echo ">>> Frontend public assets are up to date"

build-all-web: build-web

start-api:
	@echo "Starting api dev server..."
	@cd $(API_DIR) && GOWORK=off go run . &

dev-api:
	@echo "Starting api services (docker)..."
	@docker compose -f $(DEV_COMPOSE_FILE) up -d

dev-api-rebuild:
	@echo "Rebuilding and starting api service (docker)..."
	@docker compose -f $(DEV_COMPOSE_FILE) up -d --build $(DEV_API_SERVICE)

dev-web:
	@echo "Starting web frontend dev server..."
	@echo "Web frontend: http://localhost:$(DEV_WEB_PORT)"
	@cd $(WEB_DIR) && bun install
	@cd $(WEB_DIR) && bun run dev -- --host 0.0.0.0 --port $(DEV_WEB_PORT)

dev: dev-api dev-web

# The main package embeds the ignored web/dist output and is covered after build-web.
test:
	@echo "Testing root Go module..."
	@root_module=$$(GOWORK=off go list -m); \
		root_packages=$$(GOWORK=off go list -e ./... | grep -vxF "$$root_module"); \
		GOWORK=off go test $$root_packages
	@echo "Testing relaykit Go module..."
	@cd relaykit && GOWORK=off go test ./...

reset-setup:
	@echo "Resetting local setup wizard state..."
	@if docker compose -f $(DEV_COMPOSE_FILE) ps --services --status running | grep -qx "$(DEV_POSTGRES_SERVICE)"; then \
		echo "Detected running docker dev PostgreSQL. Removing setup record and root users..."; \
		docker compose -f $(DEV_COMPOSE_FILE) exec -T $(DEV_POSTGRES_SERVICE) \
			psql -U $(DEV_POSTGRES_USER) -d $(DEV_POSTGRES_DB) \
			-c 'DELETE FROM setups;' \
			-c 'DELETE FROM users WHERE role = 100;' \
			-c "DELETE FROM options WHERE key IN ('SelfUseModeEnabled', 'DemoSiteEnabled');"; \
		echo "Restarting docker dev api so setup status is recalculated..."; \
		docker compose -f $(DEV_COMPOSE_FILE) restart $(DEV_API_SERVICE); \
	elif db_path="$${SQLITE_PATH:-$(DEV_SQLITE_PATH)}"; db_path="$${db_path%%\?*}"; [ -f "$$db_path" ]; then \
		db_path="$${SQLITE_PATH:-$(DEV_SQLITE_PATH)}"; \
		db_path="$${db_path%%\?*}"; \
		echo "Detected local SQLite database: $$db_path"; \
		sqlite3 "$$db_path" \
			"DELETE FROM setups; DELETE FROM users WHERE role = 100; DELETE FROM options WHERE key IN ('SelfUseModeEnabled', 'DemoSiteEnabled');"; \
		echo "SQLite setup state reset. Restart the local api process before testing the setup wizard."; \
	else \
		echo "No running docker dev PostgreSQL or local SQLite database found."; \
		echo "Start the dev stack with 'make dev-api', or set SQLITE_PATH/DEV_SQLITE_PATH to your local SQLite database."; \
		exit 1; \
	fi


build: build-web
	@echo ">>> Building $(BINARY) with the latest embedded frontend..."
	@GOWORK=off go build -o $(BINARY) .
	@echo ">>> Build complete"

start: build
	@if [ -f $(PID_FILE) ] && kill -0 $$(cat $(PID_FILE)) 2>/dev/null; then \
		echo ">>> Already running (PID: $$(cat $(PID_FILE)))"; \
		exit 1; \
	fi
	@echo ">>> Starting $(BINARY) in background..."
	@nohup ./$(BINARY) -config $(CONFIG) > $(LOG_FILE) 2>&1 & echo $$! > $(PID_FILE)

stop:
	@if [ -f $(PID_FILE) ] && kill -0 $$(cat $(PID_FILE)) 2>/dev/null; then \
		echo ">>> Stopping (PID: $$(cat $(PID_FILE)))..."; \
		kill $$(cat $(PID_FILE)); \
		else echo ">>> Not running"; \
	fi
	@rm -f $(PID_FILE)

restart: stop
	@make --no-print-directory start

status:
	@if [ -f $(PID_FILE) ] && kill -0 $$(cat $(PID_FILE)) 2>/dev/null; then \
		echo ">>> Running (PID: $$(cat $(PID_FILE)))"; \
		else echo ">>> Not running"; \
	fi

logs:
	@tail -f $(LOG_FILE)

db:
	@docker compose -f docker-compose.local.yml up -d
	@echo ">>> MySQL: localhost:3306, Redis: localhost:6379"

# Air checks the frontend source hash before rebuilding Go. Frontend-only changes
# are rebuilt once; backend-only changes reuse web/dist.
air-sync-web:
	@mkdir -p ./tmp
	@if [ ! -d $(WEB_DIR)/node_modules ]; then cd $(WEB_DIR) && bun install --frozen-lockfile; fi
	@CURRENT_HASH=$$(git ls-files -co --exclude-standard -z -- $(WEB_DIR) VERSION | xargs -0 shasum -a 256 | LC_ALL=C sort | shasum -a 256 | awk '{print $$1}'); \
	PREVIOUS_HASH=$$(cat $(AIR_WEB_HASH_FILE) 2>/dev/null || true); \
	if [ ! -f $(WEB_DIR)/dist/index.html ] || [ "$$CURRENT_HASH" != "$$PREVIOUS_HASH" ]; then \
		echo ">>> Frontend changes detected; rebuilding embedded frontend..."; \
		(cd $(WEB_DIR) && DISABLE_ESLINT_PLUGIN='true' VITE_REACT_APP_VERSION=$$(cat ../VERSION) bun run build) || exit 1; \
		make --no-print-directory verify-web-assets || exit 1; \
		echo "$$CURRENT_HASH" > $(AIR_WEB_HASH_FILE); \
	else \
		echo ">>> Frontend unchanged; reusing current dist"; \
	fi

air-build: air-sync-web
	@GOWORK=off go build -o ./tmp/new-api .

air: db
	@make --no-print-directory air-sync-web
	@AIR=$$(go env GOPATH)/bin/air; \
	if [ ! -f "$$AIR" ]; then go install github.com/air-verse/air@latest; fi; \
	exec "$$AIR"

verify-deployment:
	@echo ">>> Verifying deployed documentation at $(DEPLOY_URL)..."
	@curl --retry 30 --retry-delay 1 --retry-connrefused --retry-all-errors -fsS "$(DEPLOY_URL)/guide.html" | cmp - $(WEB_DIR)/public/guide.html
	@curl --retry 5 --retry-delay 1 --retry-all-errors -fsS "$(DEPLOY_URL)/docs/guide.md" | cmp - $(WEB_DIR)/public/docs/guide.md
	@echo ">>> Deployment serves the exact current documentation files"

deploy:
	@docker build -t new-api:latest .
	@docker compose up -d --force-recreate new-api
	@make --no-print-directory verify-deployment

deploy-fresh:
	@docker build --no-cache -t new-api:latest .
	@docker compose up -d --force-recreate new-api
	@make --no-print-directory verify-deployment

SERVER ?= ubuntu@82.156.124.82
REMOTE_PATH ?= /home/ubuntu/new-api
VERIFY_URL ?=
RELEASE_VERSION ?= $(if $(version),$(version),$(shell cat VERSION))
IMAGE_FILE = new-api-image.tar.gz
IMAGE_TAR = $(basename $(IMAGE_FILE))

build-image:
	@set -eu; \
	if [ -n "$$(git status --porcelain)" ]; then \
		echo ">>> ERROR: working tree is not clean; commit or stash changes before release"; \
		git status --short; \
		exit 1; \
	fi; \
	version="$(RELEASE_VERSION)"; \
	test -n "$$version"; \
	echo ">>> Building frontend and Linux image v$$version..."; \
	trap 'rm -f new-api-linux-amd64' EXIT; \
	make --no-print-directory build-web; \
	GOWORK=off GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -ldflags "-s -w -X github.com/QuantumNous/new-api/common.Version=$$version" -o new-api-linux-amd64 .; \
	docker build --platform linux/amd64 --build-arg "APP_VERSION=$$version" --label "org.opencontainers.image.version=$$version" -t new-api:latest -t new-api:$$version -f Dockerfile.local .; \
	docker save -o $(IMAGE_TAR) new-api:$$version; \
	gzip -f $(IMAGE_TAR); \
	test -s $(IMAGE_FILE); \
	echo ">>> Image ready: new-api:$$version ($$(du -h $(IMAGE_FILE) | cut -f1))"

upload:
	@set -eu; \
	if [ -z "$(VERIFY_URL)" ]; then echo ">>> ERROR: VERIFY_URL is required for external health verification"; exit 1; fi; \
	test -s $(IMAGE_FILE); \
	echo ">>> Uploading $(IMAGE_FILE) to $(SERVER):$(REMOTE_PATH)/"; \
	ssh $(SERVER) 'test -d "$(REMOTE_PATH)" && test -f "$(REMOTE_PATH)/docker-compose.yml"'; \
	scp $(IMAGE_FILE) $(SERVER):$(REMOTE_PATH)/
	@ssh $(SERVER) 'set -eu; \
		cd "$(REMOTE_PATH)"; \
		docker compose config -q; \
		docker load -i $(IMAGE_FILE); \
		docker image inspect new-api:$(RELEASE_VERSION) >/dev/null; \
		docker tag new-api:$(RELEASE_VERSION) new-api:latest; \
		docker compose up -d --force-recreate new-api; \
		for attempt in $$(seq 1 30); do \
			status=$$(docker inspect --format "{{.State.Health.Status}}" new-api 2>/dev/null || true); \
			[ "$$status" = healthy ] && break; \
			sleep 2; \
		done; \
		[ "$$(docker inspect --format "{{.State.Health.Status}}" new-api 2>/dev/null || true)" = healthy ]; \
		docker compose exec -T new-api wget -q -O - http://localhost:3000/api/status | grep -Eq "\"success\"[[:space:]]*:[[:space:]]*true"; \
		rm -f $(IMAGE_FILE)'
	@echo ">>> Verifying externally at $(VERIFY_URL)/api/status..."
	@curl --retry 30 --retry-delay 1 --retry-connrefused --retry-all-errors -fsS "$(VERIFY_URL)/api/status" | grep -Eq '"success"[[:space:]]*:[[:space:]]*true'
	@echo ">>> Deployed and verified v$(RELEASE_VERSION)"

release: build-image upload

docker-clean:
	@docker builder prune --keep-storage 5GB -f
	@docker image prune -f

clean:
	@rm -f $(BINARY) $(PID_FILE) $(LOG_FILE) new-api-linux-amd64 $(IMAGE_FILE)
	@rm -rf tmp
