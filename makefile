WEB_DIR = ./web/default
WEB_CLASSIC_DIR = ./web/classic
API_DIR = .
DEV_WEB_DEFAULT_PORT ?= 5173
DEV_WEB_CLASSIC_PORT ?= 5174
DEV_COMPOSE_FILE = docker-compose.dev.yml
DEV_POSTGRES_SERVICE = postgres
DEV_API_SERVICE = new-api
DEV_POSTGRES_DB = new-api
DEV_POSTGRES_USER = root
DEV_SQLITE_PATH ?= one-api.db

.PHONY: all build-web build-web-classic build-all-web start-api dev dev-api dev-api-rebuild dev-web dev-web-classic reset-setup

all: build-all-web start-api

build-web:
	@echo "Building default web..."
	@cd ./web && bun install --frozen-lockfile
	@cd $(WEB_DIR) && DISABLE_ESLINT_PLUGIN='true' VITE_REACT_APP_VERSION=$(cat ../../VERSION) bun run build

build-web-classic:
	@echo "Building classic web..."
	@cd ./web && bun install --frozen-lockfile
	@cd $(WEB_CLASSIC_DIR) && VITE_REACT_APP_VERSION=$(cat ../../VERSION) bun run build

build-all-web: build-web build-web-classic

start-api:
	@echo "Starting api dev server..."
	@cd $(API_DIR) && go run main.go &

dev-api:
	@echo "Starting api services (docker)..."
	@docker compose -f $(DEV_COMPOSE_FILE) up -d

dev-api-rebuild:
	@echo "Rebuilding and starting api service (docker)..."
	@docker compose -f $(DEV_COMPOSE_FILE) up -d --build $(DEV_API_SERVICE)

dev-web:
	@echo "Starting default web dev server..."
	@echo "Default web: http://localhost:$(DEV_WEB_DEFAULT_PORT)"
	@cd ./web && bun install --filter ./default
	@cd $(WEB_DIR) && bun run dev -- --host 0.0.0.0 --port $(DEV_WEB_DEFAULT_PORT)

dev-web-classic:
	@echo "Starting classic web dev server..."
	@cd ./web && bun install --filter ./classic
	@cd $(WEB_CLASSIC_DIR) && bun run dev -- --host 0.0.0.0 --port $(DEV_WEB_CLASSIC_PORT)

dev: dev-api dev-web

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

BINARY    := new-api
CONFIG    := config.yaml
PID_FILE  := .new-api.pid
LOG_FILE  := new-api.log

.PHONY: build start stop restart status logs clean air deploy \
        sync sync-main rebase pull push commit diff log branch

build:
	@echo ">>> Building $(BINARY)..."
	@go build -o $(BINARY) .
	@echo ">>> Build complete"

start: build
	@if [ -f $(PID_FILE) ] && kill -0 $$(cat $(PID_FILE)) 2>/dev/null; then \
	   echo ">>> Already running (PID: $$(cat $(PID_FILE)))"; \
	   exit 1; \
	fi
	@echo ">>> Starting $(BINARY) in background..."
	@nohup ./$(BINARY) -config $(CONFIG) > $(LOG_FILE) 2>&1 & echo $$! > $(PID_FILE)
	@sleep 1
	@if kill -0 $$(cat $(PID_FILE)) 2>/dev/null; then \
	   echo ">>> Started (PID: $$(cat $(PID_FILE)))"; \
	   echo ">>> Log: $(LOG_FILE)"; \
	else \
	   echo ">>> Failed to start, check $(LOG_FILE)"; \
	   rm -f $(PID_FILE); \
	   exit 1; \
	fi

stop:
	@if [ ! -f $(PID_FILE) ]; then \
	   PID=$$(pgrep -f "./$(BINARY)" 2>/dev/null); \
	   if [ -n "$$PID" ]; then \
	      echo ">>> Stopping (PID: $$PID)..."; \
	      kill $$PID; \
	      echo ">>> Stopped"; \
	   else \
	      echo ">>> Not running"; \
	   fi; \
	   exit 0; \
	fi
	@PID=$$(cat $(PID_FILE)); \
	if kill -0 $$PID 2>/dev/null; then \
	   echo ">>> Stopping (PID: $$PID)..."; \
	   kill $$PID; \
	   sleep 2; \
	   if kill -0 $$PID 2>/dev/null; then \
	      echo ">>> Force killing..."; \
	      kill -9 $$PID; \
	   fi; \
	   echo ">>> Stopped"; \
	else \
	   echo ">>> Process not running (stale PID file)"; \
	fi; \
	rm -f $(PID_FILE)

restart: stop
	@sleep 1
	@$(MAKE) start

status:
	@if [ -f $(PID_FILE) ] && kill -0 $$(cat $(PID_FILE)) 2>/dev/null; then \
	   echo ">>> Running (PID: $$(cat $(PID_FILE)))"; \
	else \
	   echo ">>> Not running"; \
	   rm -f $(PID_FILE) 2>/dev/null; \
	fi

logs:
	@if [ -f $(LOG_FILE) ]; then \
	   tail -f $(LOG_FILE); \
	else \
	   echo ">>> No log file found"; \
	fi

## 启动本地数据库（MySQL + Redis 容器，端口映射到 localhost）
db:
	@docker compose -f docker-compose.local.yml up -d
	@echo ">>> MySQL: localhost:3306, Redis: localhost:6379"
	@echo ">>> 停止: docker compose -f docker-compose.local.yml down"

## 热加载开发模式（自动启动 MySQL + Redis，需要 air: go install github.com/air-verse/air@latest）
air: db
	@AIR=$$(go env GOPATH)/bin/air; \
	if [ ! -f "$$AIR" ]; then \
	   echo ">>> Installing air..."; \
	   go install github.com/air-verse/air@latest; \
	fi; \
	echo ">>> Starting hot-reload dev mode..."; \
	exec "$$AIR"

## ─── Fork 同步工作流 ──────────────────────────────────────────

## 合并上游 main 到当前分支（安全合并，不自动切分支）
## 可以直接在dev分支上接受上游
sync:
	@if ! git diff --quiet; then \
	   echo ">>> ERROR: Working tree is dirty. Commit or stash first."; \
	   exit 1; \
	fi
	@echo ">>> Fetching upstream..."
	@git fetch upstream
	@CURRENT=$$(git branch --show-current); \
	echo ">>> Merging upstream/main into $$CURRENT..."; \
	git merge upstream/main --no-edit || { \
	   echo ">>> CONFLICT: resolve manually, then: git add . && git commit"; \
	   exit 1; \
	}
	@echo ">>> Sync complete"

## 强制同步 fork 的 main 分支与上游一致（丢弃 fork main 的本地改动）
sync-main:
	@echo ">>> WARNING: This will overwrite your fork's main branch with upstream/main!"
	@echo ">>> Press Ctrl+C within 3s to cancel..."
	@sleep 3
	@git fetch upstream
	@git branch -f main refs/remotes/upstream/main
	@git push origin main --force
	@echo ">>> origin/main synced to upstream/main"

## 基于上游 main 变基（保持线性历史，适合 dev 分支）
rebase:
	@if ! git diff --quiet; then \
	   echo ">>> ERROR: Working tree is dirty. Commit or stash first."; \
	   exit 1; \
	fi
	@echo ">>> Fetching upstream..."
	@git fetch upstream
	@echo ">>> Rebasing current branch onto upstream/main..."
	@git rebase upstream/main || { \
	   echo ">>> CONFLICT: resolve manually, then: git rebase --continue"; \
	   exit 1; \
	}
	@echo ">>> Rebase complete"

## 推送当前分支到 origin
push:
	@CURRENT=$$(git branch --show-current); \
	echo ">>> Pushing $$CURRENT to origin..."; \
	git push -u origin $$CURRENT; \
	echo ">>> Push complete"

## 拉取 origin 当前分支的更新
pull:
	@CURRENT=$$(git branch --show-current); \
	echo ">>> Pulling $$CURRENT from origin..."; \
	git pull origin $$CURRENT; \
	echo ">>> Pull complete"

## 快速提交（用法：make commit m="提交信息"）
commit:
	@if [ -z "$(m)" ]; then \
	   echo ">>> Usage: make commit m=\"your commit message\""; \
	   exit 1; \
	fi
	@git add -A
	@git commit -m "$(m)"
	@echo ">>> Committed: $(m)"

## 查看当前改动
diff:
	@git diff --stat
	@echo ""
	@git status -s

## 查看当前分支领先上游的提交
log:
	@CURRENT=$$(git branch --show-current); \
	echo ">>> Commits on $$CURRENT ahead of upstream/main:"; \
	git log --oneline upstream/main..$$CURRENT

## 查看上游最新提交（便于了解有哪些更新可合并）
upstream-log:
	@echo ">>> Latest upstream/main commits (last 10):"
	@git log --oneline -10 upstream/main

## 查看分支状态总览
branch:
	@CURRENT=$$(git branch --show-current); \
	echo ">>> Current branch: $$CURRENT"; \
	echo ""; \
	echo ">>> Branch status:"; \
	git branch -vv; \
	echo ""; \
	echo ">>> Ahead of upstream/main: $$(git rev-list --count upstream/main..HEAD 2>/dev/null || echo 'unknown') commits"; \
	echo ">>> Behind upstream/main:   $$(git rev-list --count HEAD..upstream/main 2>/dev/null || echo 'unknown') commits"

## 服务器本地构建部署（不推荐，4C4G 服务器可能 OOM）
deploy:
	@echo ">>> Building and deploying new-api (on server)..."
	@docker compose build new-api
	@docker compose up -d new-api
	@echo ">>> Deploy complete. Check: docker compose ps"

## 无缓存构建部署（不推荐，仅服务器资源充足时使用）
deploy-fresh:
	@echo ">>> Building new-api without cache..."
	@docker compose build --no-cache new-api
	@docker compose up -d new-api
	@echo ">>> Deploy complete. Check: docker compose ps"

## ─── 部署流程（本地 Mac 构建 → 远程服务器上线）(推荐)────────────────────
##
## 使用方式：
##   make release SERVER=root@1.2.3.4        # 一键：构建+传输+上线
##   make release SERVER=root@1.2.3.4 PATH=/opt/new-api
##   make build-image                         # 仅构建镜像（不传输）
##   make upload SERVER=root@1.2.3.4          # 仅传输+上线（已有镜像）
##
## 前提：服务器上已有 docker-compose.yml 和 .env（首次部署手动配置）
## 服务器 docker-compose.yml 中 new-api 服务使用 image: new-api:latest

SERVER ?= ubuntu@82.156.124.82
REMOTE_PATH ?= /home/ubuntu/new-api
IMAGE_FILE = new-api-image.tar.gz

## 构建生产镜像（本地 Mac 交叉编译，~60s）
## 用法：make build-image              — 自动递增 patch 版本
##       make build-image version=1.0.0 — 指定版本号
build-image:
	@if [ -n "$(version)" ]; then \
		echo "$(version)" > VERSION; \
	else \
		VERSION=$$(cat VERSION); \
		MAJOR=$$(echo $$VERSION | cut -d. -f1); \
		MINOR=$$(echo $$VERSION | cut -d. -f2); \
		PATCH=$$(echo $$VERSION | cut -d. -f3); \
		NEW_PATCH=$$((PATCH + 1)); \
		echo "$$MAJOR.$$MINOR.$$NEW_PATCH" > VERSION; \
	fi
	@echo ">>> Version: $$(cat VERSION)"
	@echo ">>> [1/4] Building frontend..."
	@cd ./web && bun install --frozen-lockfile
	@cd $(WEB_DIR) && DISABLE_ESLINT_PLUGIN='true' VITE_REACT_APP_VERSION=$$(cat ../../VERSION) bun run build
	@mkdir -p $(WEB_CLASSIC_DIR)/dist && \
		[ -f $(WEB_CLASSIC_DIR)/dist/index.html ] || \
		echo '<!DOCTYPE html><html><head><title>Classic</title></head><body></body></html>' > $(WEB_CLASSIC_DIR)/dist/index.html
	@echo ">>> [2/4] Cross-compiling Go binary (linux/amd64)..."
	@GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -ldflags "-s -w" -o new-api-linux-amd64 .
	@echo ">>> [3/4] Packaging Docker image..."
	@VERSION=$$(cat VERSION); \
	docker build --platform linux/amd64 \
		--label "org.opencontainers.image.version=$$VERSION" \
		-t new-api:latest -t new-api:$$VERSION \
		-f Dockerfile.local .
	@echo ">>> [4/4] Exporting image..."
	@docker save new-api:latest | gzip > $(IMAGE_FILE)
	@rm -f new-api-linux-amd64
	@echo ">>> Done: $(IMAGE_FILE) ($$(du -h $(IMAGE_FILE) | cut -f1)) — v$$(cat VERSION)"

## 传输镜像到服务器并重启服务
upload:
	@if [ -z "$(SERVER)" ]; then echo ">>> ERROR: 需要指定 SERVER=user@host"; exit 1; fi
	@if [ ! -f $(IMAGE_FILE) ]; then echo ">>> ERROR: $(IMAGE_FILE) 不存在，先运行 make build-image"; exit 1; fi
	@echo ">>> Uploading $(IMAGE_FILE) to $(SERVER):$(REMOTE_PATH)/"
	@scp $(IMAGE_FILE) $(SERVER):$(REMOTE_PATH)/
	@echo ">>> Loading image and restarting..."
	@ssh $(SERVER) "cd $(REMOTE_PATH) && docker load -i $(IMAGE_FILE) && docker compose up -d new-api && rm -f $(IMAGE_FILE)"
	@echo ">>> Deployed v$$(cat VERSION)! Verify: curl -s http://$$(echo $(SERVER) | cut -d@ -f2):3000/api/status | grep version"

## 一键发布：构建 + 传输 + 上线
release: build-image upload

## 清理 Docker 构建缓存（保留最近 5GB）
docker-clean:
	@echo ">>> Pruning Docker build cache..."
	@docker builder prune --keep-storage 5GB -f
	@docker image prune -f
	@echo ">>> Clean complete"

clean:
	@rm -f $(BINARY) $(PID_FILE) $(LOG_FILE)
	@rm -rf tmp
	@echo ">>> Cleaned"