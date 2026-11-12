# ==============================================================================
# Universal Course Extractor - Makefile
# ==============================================================================

SHELL := /usr/bin/env bash
.DEFAULT_GOAL := help

# Garante que Node/NPM instalados via NVM sejam encontrados mesmo em shells não-interativos
NVM_NODE_BIN := $(firstword $(wildcard $(HOME)/.config/nvm/versions/node/*/bin $(HOME)/.nvm/versions/node/*/bin))
ifneq ($(NVM_NODE_BIN),)
  export PATH := $(NVM_NODE_BIN):$(PATH)
endif

NPM ?= npm
NPX ?= npx
NODE ?= node

# Opções dinâmicas para os comandos da CLI (scrape, dry-run, lessons, etc.)
CLI_FLAGS :=
ifdef URL
  CLI_FLAGS += --url "$(URL)"
endif
ifdef PLATFORM
  CLI_FLAGS += --platform "$(PLATFORM)"
endif
ifdef COURSE
  CLI_FLAGS += --course "$(COURSE)"
endif
ifdef LESSON
  CLI_FLAGS += --lesson $(LESSON)
endif
ifdef LESSONS
  CLI_FLAGS += --lessons "$(LESSONS)"
endif
ifdef FROM
  CLI_FLAGS += --from $(FROM)
endif
ifdef TO
  CLI_FLAGS += --to $(TO)
endif
ifeq ($(ALL),1)
  CLI_FLAGS += --all
endif
ifdef OUTPUT
  CLI_FLAGS += --output "$(OUTPUT)"
endif
ifeq ($(OVERWRITE),1)
  CLI_FLAGS += --overwrite
endif
ifeq ($(SKIP_EXISTING),1)
  CLI_FLAGS += --skip-existing
endif
ifeq ($(HEADED),1)
  CLI_FLAGS += --headed
endif
ifeq ($(HEADLESS),1)
  CLI_FLAGS += --headless
endif
ifeq ($(YES),1)
  CLI_FLAGS += --yes
endif
ifdef ARGS
  CLI_FLAGS += $(ARGS)
endif

.PHONY: help setup install install-hooks env check-config test-ai test-ai-vitest doctor \
        test test-watch test-integration typecheck check check-all build \
        auth courses lessons dry-run scrape resume inspect-lesson status logs clean clean-logs

# ------------------------------------------------------------------------------
# Ajuda
# ------------------------------------------------------------------------------

help: ## Mostra todos os comandos disponíveis e exemplos de uso
	@echo ""
	@echo "Universal Course Extractor — Comandos úteis"
	@echo "==========================================="
	@echo ""
	@echo "Setup & Ambiente:"
	@echo "  make setup              Faz o setup completo (dependências, Chromium, hooks, .env, config e validação)"
	@echo "  make install            Instala pacotes npm e o navegador Chromium do Playwright"
	@echo "  make install-hooks      Instala o hook Git de pre-commit (typecheck + testes unitários)"
	@echo "  make env                Cria .env e config/platforms.yaml a partir dos exemplos (sem sobrescrever)"
	@echo ""
	@echo "Configuração & Diagnóstico de IA:"
	@echo "  make check-config       Valida o .env e config/platforms.yaml e exibe o resumo"
	@echo "  make test-ai            Testa o modelo de IA ao vivo (conexão, resumo pt-BR e tradução Markdown)"
	@echo "  make test-ai-vitest     Executa a suíte Vitest de integração contra o modelo de IA configurado"
	@echo "  make doctor             Diagnóstico completo do ambiente (Node, arquivos, config e IA)"
	@echo ""
	@echo "Testes & Qualidade:"
	@echo "  make test               Roda os testes unitários e de contrato (Vitest)"
	@echo "  make test-watch         Roda os testes unitários em modo watch"
	@echo "  make test-integration   Roda os testes de integração com Chromium real e fixtures locais"
	@echo "  make typecheck          Verifica os tipos TypeScript (tsc --noEmit)"
	@echo "  make check              Executa typecheck + testes unitários + check-config"
	@echo "  make check-all          Executa typecheck + testes unitários + testes de integração + check-config"
	@echo "  make build              Compila o projeto TypeScript para build/"
	@echo ""
	@echo "Uso / Extração de Cursos:"
	@echo "  make auth URL=\"...\"     Abre o navegador para login manual e salva a sessão"
	@echo "  make courses URL=\"...\"  Descobre e lista os cursos disponíveis na URL"
	@echo "  make lessons URL=\"...\"  Lista as aulas do curso (opcional: COURSE=\"Nome\")"
	@echo "  make dry-run URL=\"...\"  Simula a extração sem chamar a IA e sem gravar arquivos"
	@echo "  make scrape URL=\"...\"   Extrai aulas (aceita LESSON, LESSONS, FROM, TO, ALL=1, OUTPUT, etc.)"
	@echo "  make resume             Retoma o processamento de aulas interrompidas ou com falha"
	@echo ""
	@echo "Inspeção & Manutenção:"
	@echo "  make inspect-lesson URL=\"...\" Inspeciona seletores DOM e JWPlayer de uma aula usando cookies salvos"
	@echo "  make status             Mostra o resumo do banco de progresso (SQLite), sessões e notas"
	@echo "  make logs               Exibe as últimas linhas do log da aplicação (data/logs/app.log)"
	@echo "  make clean              Remove o diretório de compilação (build/)"
	@echo "  make clean-logs         Remove logs e screenshots de erro em data/logs/"
	@echo ""
	@echo "Exemplos rápidos:"
	@echo "  make setup"
	@echo "  make test-ai"
	@echo "  make auth URL=\"https://anthropic-partners.skilljar.com/ meu-curso\""
	@echo "  make scrape URL=\"https://...\" LESSON=1 HEADED=1"
	@echo "  make scrape URL=\"https://...\" LESSONS=\"1,3,5-7\" SKIP_EXISTING=1 YES=1"
	@echo "  make scrape URL=\"https://...\" ALL=1 OUTPUT=\"/caminho/obsidian/Curso\""
	@echo ""

# ------------------------------------------------------------------------------
# Setup & Ambiente
# ------------------------------------------------------------------------------

env: ## Cria .env e config/platforms.yaml se não existirem
	@if [ ! -f .env ]; then \
		cp .env.example .env; \
		echo "[OK] Arquivo .env criado a partir de .env.example"; \
	else \
		echo "[--] Arquivo .env já existe (mantido)"; \
	fi
	@if [ ! -f config/platforms.yaml ]; then \
		cp config/platforms.example.yaml config/platforms.yaml; \
		echo "[OK] Arquivo config/platforms.yaml criado a partir de config/platforms.example.yaml"; \
	else \
		echo "[--] Arquivo config/platforms.yaml já existe (mantido)"; \
	fi

install: ## Instala dependências npm e o navegador Chromium do Playwright
	$(NPM) install
	$(NPX) playwright install chromium

install-hooks: ## Instala o hook Git de pre-commit (typecheck + testes unitários)
	chmod +x scripts/pre-commit.sh
	cp scripts/pre-commit.sh .git/hooks/pre-commit
	chmod +x .git/hooks/pre-commit
	@echo "[OK] Hook pre-commit instalado em .git/hooks/pre-commit"

setup: env install install-hooks check-config ## Faz o setup completo do projeto
	@echo ""
	@echo "Setup concluído! Próximos passos:"
	@echo "  1. Ajuste o arquivo .env com a URL e nome do seu modelo de IA"
	@echo "  2. Rode 'make test-ai' para testar se o modelo de IA está funcionando"
	@echo "  3. Rode 'make auth URL=\"<url-do-curso>\"' para autenticar na plataforma"

# ------------------------------------------------------------------------------
# Configuração & Diagnóstico de IA
# ------------------------------------------------------------------------------

check-config: ## Valida .env e config/platforms.yaml
	$(NPM) run check-config

test-ai: ## Testa se o modelo de IA configurado está respondendo, resumindo e traduzindo
	$(NPM) run test:ai

test-ai-vitest: ## Roda os testes de integração Vitest contra o modelo de IA ao vivo
	$(NPM) run test:ai:vitest

doctor: ## Verifica Node.js, arquivos de configuração, tipagem e modelo de IA
	@echo "==> Verificando versão do Node.js..."
	@$(NODE) -v
	@echo "==> Verificando arquivos de configuração..."
	@$(MAKE) --no-print-directory env
	@$(MAKE) --no-print-directory check-config
	@echo "==> Testando conexão e funcionamento do modelo de IA..."
	@$(MAKE) --no-print-directory test-ai

# ------------------------------------------------------------------------------
# Testes & Qualidade
# ------------------------------------------------------------------------------

test: ## Roda os testes unitários e de contrato
	$(NPM) test

test-watch: ## Roda os testes unitários em modo contínuo (watch)
	$(NPM) run test:watch

test-integration: ## Roda os testes de integração com Chromium real (fixtures locais)
	$(NPM) run test:integration

typecheck: ## Verifica a tipagem TypeScript
	$(NPM) run typecheck

check: typecheck test check-config ## Roda typecheck, testes unitários e check-config

check-all: typecheck test test-integration check-config ## Roda toda a validação offline

build: ## Compila o TypeScript para a pasta build/
	$(NPM) run build

# ------------------------------------------------------------------------------
# Uso / Extração de Cursos
# ------------------------------------------------------------------------------

auth: ## Autentica manualmente na plataforma (use URL="...")
	@if [ -z "$(URL)" ]; then echo "Erro: informe a URL. Exemplo: make auth URL=\"https://...\""; exit 2; fi
	$(NPM) run scrape -- auth $(CLI_FLAGS)

courses: ## Lista os cursos disponíveis (use URL="...")
	@if [ -z "$(URL)" ]; then echo "Erro: informe a URL. Exemplo: make courses URL=\"https://...\""; exit 2; fi
	$(NPM) run scrape -- courses $(CLI_FLAGS)

lessons: ## Lista as aulas de um curso (use URL="..." [COURSE="..."])
	@if [ -z "$(URL)" ]; then echo "Erro: informe a URL. Exemplo: make lessons URL=\"https://...\""; exit 2; fi
	$(NPM) run scrape -- lessons $(CLI_FLAGS)

dry-run: ## Simula a extração sem chamar a IA nem gravar arquivos
	@if [ -z "$(URL)" ]; then echo "Erro: informe a URL. Exemplo: make dry-run URL=\"https://...\" ALL=1"; exit 2; fi
	$(NPM) run scrape -- --dry-run $(CLI_FLAGS)

scrape: ## Executa a extração de aulas
	$(NPM) run scrape -- $(CLI_FLAGS)

resume: ## Retoma aulas interrompidas ou que falharam anteriormente
	$(NPM) run scrape -- resume $(CLI_FLAGS)

# ------------------------------------------------------------------------------
# Inspeção & Manutenção
# ------------------------------------------------------------------------------

inspect-lesson: ## Inspeciona seletores DOM e vídeo de uma aula usando cookies salvos (use URL="...")
	@if [ -z "$(URL)" ]; then echo "Erro: informe a URL. Exemplo: make inspect-lesson URL=\"https://...\""; exit 2; fi
	$(NODE) scripts/inspect-lesson.mjs "$(URL)"

status: ## Mostra o resumo de progresso no SQLite, sessões salvas e notas geradas
	@$(NODE) -e '\
		const fs = require("node:fs"); \
		console.log("=== Sessões de navegador (data/browser) ==="); \
		if (fs.existsSync("data/browser")) { \
			const files = fs.readdirSync("data/browser").filter(f => f.endsWith(".json")); \
			console.log(files.length ? files.map(f => "  - " + f).join("\n") : "  Nenhuma sessão salva."); \
		} else { console.log("  Nenhuma sessão salva."); } \
		console.log("\n=== Banco de progresso (data/database/progress.sqlite) ==="); \
		if (fs.existsSync("data/database/progress.sqlite")) { \
			const { DatabaseSync } = require("node:sqlite"); \
			const db = new DatabaseSync("data/database/progress.sqlite"); \
			const rows = db.prepare("SELECT status, COUNT(*) as count FROM lessons GROUP BY status").all(); \
			if (rows.length === 0) console.log("  Nenhuma aula registrada ainda."); \
			else rows.forEach(r => console.log("  " + r.status + ": " + r.count)); \
			db.close(); \
		} else { console.log("  Banco ainda não criado."); } \
	'

logs: ## Exibe as últimas 50 linhas do log da aplicação
	@if [ -f data/logs/app.log ]; then \
		tail -n 50 data/logs/app.log | $(NPX) pino-pretty; \
	else \
		echo "Nenhum arquivo de log encontrado em data/logs/app.log"; \
	fi

clean: ## Remove o diretório build/
	rm -rf build

clean-logs: ## Remove logs e screenshots de erro em data/logs/
	rm -rf data/logs/*.log data/logs/screenshots/*
	@echo "[OK] Logs limpos."
