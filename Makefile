##
## Makefile — convenience wrapper for docker compose commands
## Usage: make <target>
##

COMPOSE_BASE := docker compose -f infra/docker/docker-compose.yml
COMPOSE_DEV  := $(COMPOSE_BASE) -f infra/docker/docker-compose.dev.yml
COMPOSE_PROD := $(COMPOSE_BASE) -f infra/docker/docker-compose.prod.yml

.PHONY: help dev dev-build dev-down prod prod-build prod-down \
        logs logs-backend logs-frontend logs-nginx \
        shell-backend shell-mongo shell-redis \
        clean nuke ps health

## ── Help ─────────────────────────────────────────────────────────────────────
help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
	  | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

## ── Development ──────────────────────────────────────────────────────────────
dev: ## Start dev stack (hot-reload, ports exposed)
	$(COMPOSE_DEV) up

dev-build: ## Rebuild images and start dev stack
	$(COMPOSE_DEV) up --build

dev-down: ## Stop and remove dev containers
	$(COMPOSE_DEV) down

## ── Production ───────────────────────────────────────────────────────────────
prod: ## Start production stack in background
	$(COMPOSE_PROD) up -d

prod-build: ## Rebuild images and start production stack
	$(COMPOSE_PROD) up -d --build

prod-down: ## Stop and remove production containers
	$(COMPOSE_PROD) down

## ── Logs ─────────────────────────────────────────────────────────────────────
logs: ## Tail all logs
	$(COMPOSE_DEV) logs -f

logs-backend: ## Tail backend logs
	$(COMPOSE_DEV) logs -f backend

logs-frontend: ## Tail frontend logs
	$(COMPOSE_DEV) logs -f frontend

logs-nginx: ## Tail nginx logs
	$(COMPOSE_BASE) logs -f nginx

## ── Shells ───────────────────────────────────────────────────────────────────
shell-backend: ## Open shell in running backend container
	$(COMPOSE_DEV) exec backend sh

shell-mongo: ## Open mongosh in running mongo container
	$(COMPOSE_DEV) exec mongo mongosh auth

shell-redis: ## Open redis-cli in running redis container
	$(COMPOSE_DEV) exec redis redis-cli

## ── Status & Health ──────────────────────────────────────────────────────────
ps: ## Show running containers and their status
	$(COMPOSE_DEV) ps

health: ## Check health of all services
	@echo "=== Backend ===" && curl -sf http://localhost:3000/api/v1/auth/health || echo "DOWN"
	@echo "=== Frontend ===" && curl -sf http://localhost:3001/ -o /dev/null && echo "UP" || echo "DOWN"
	@echo "=== Redis ===" && docker compose -f infra/docker/docker-compose.yml exec redis redis-cli ping

## ── Cleanup ──────────────────────────────────────────────────────────────────
clean: ## Stop containers and remove images built by compose
	$(COMPOSE_DEV) down --rmi local

nuke: ## ⚠️  Remove ALL containers, volumes, images (destructive!)
	$(COMPOSE_DEV) down -v --rmi all --remove-orphans
	@echo "All containers, volumes and images removed."
