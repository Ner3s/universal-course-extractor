# universal-course-extractor

CLI em Node.js + TypeScript que extrai conteúdo de plataformas de cursos online, resume transcrições e traduz o conteúdo para pt-BR com IA local (API compatível com OpenAI), gerando notas Markdown para Obsidian. Veja [spec.md](spec.md).

## Status

**Fase 1 — Fundação (primeira entrega, §22.2).** Implementado: estrutura, TypeScript, Vitest, modelos de domínio, contrato `CoursePlatformAdapter`, `AdapterRegistry`, configuração validada com Zod, logger Pino e CLI mínima.
Ainda **não** implementado: browser, adapter Skilljar, transcrição, IA, escrita Markdown, SQLite.

## Uso

```bash
npm install
cp .env.example .env
npm run typecheck
npm test
npm run scrape -- check-config
```

## Estrutura

- `src/types` — modelos de domínio independentes de plataforma.
- `src/platforms/contracts` — contrato do adapter e `AdapterRegistry`.
- `src/config` — schemas Zod, loader (.env / YAML) e logger.
- `tests/contracts` — suíte reutilizável de contrato; novos adapters devem chamá-la com `runAdapterContract`.

## Decisões

- A saída de compilação (`tsc`) vai para `build/`, pois `dist/` é o diretório padrão das notas geradas (§13.3).
- `AdapterRegistry.resolve` lança erro em caso de múltiplos matches e aceita um adapter de fallback (ex.: `generic`) usado apenas se nenhum específico casar.
- `TranscriptResult` é uma união discriminada por `status`; ausência de transcrição nunca é string vazia.
