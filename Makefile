.PHONY: help deploy-control-plane deploy-dashboard deploy-worker smoke-health build-control-plane build-dashboard

ROOT := $(shell pwd)
DEPLOY := $(ROOT)/deploy/scripts

help:
	@echo "Wasup monorepo — common targets"
	@echo ""
	@echo "  make build-control-plane   npm install + build apps/control-plane"
	@echo "  make build-dashboard       npm install + build apps/dashboard"
	@echo "  make deploy-control-plane  deploy Next.js control plane to Azure App Service"
	@echo "  make deploy-dashboard      deploy Vite dashboard to Azure Storage (+ optional AFD purge)"
	@echo "  make deploy-worker VM=ip   rsync worker to VM and restart PM2"
	@echo "  make smoke-health URL=…    curl /api/health (+ optional API_KEY=…)"
	@echo ""
	@echo "Env for deploy-dashboard: DASHBOARD_STORAGE_ACCOUNT (required), FRONTDOOR_PROFILE, FRONTDOOR_ENDPOINT"

build-control-plane:
	cd apps/control-plane && npm install && npm run build

build-dashboard:
	cd apps/dashboard && npm install && npm run build

deploy-control-plane:
	bash $(DEPLOY)/deploy-control-plane-appservice.sh

deploy-dashboard:
	bash $(DEPLOY)/deploy-dashboard-frontend.sh

deploy-worker:
	@test -n "$(VM)" || (echo "Usage: make deploy-worker VM=<ip>" && exit 1)
	bash $(DEPLOY)/deploy-to-vm.sh $(VM)

smoke-health:
	@test -n "$(URL)" || (echo "Usage: make smoke-health URL=https://…" && exit 1)
	bash $(DEPLOY)/smoke-graceful-reload.sh $(URL)
