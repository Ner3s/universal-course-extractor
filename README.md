# universal-course-extractor

CLI em Node.js + TypeScript que acessa plataformas de cursos online (Playwright), extrai transcrições e conteúdo das aulas, **resume** a transcrição e **traduz integralmente** o conteúdo para pt-BR usando IA local (API compatível com OpenAI), gerando uma nota Markdown por aula, pronta para o Obsidian. Especificação completa: [spec.md](spec.md).

Primeira plataforma: **Anthropic Partner Academy (Skilljar)**. Há também um `generic` experimental.

## Status e limitações (leia primeiro)

| Item | Estado |
| --- | --- |
| Núcleo, adapters, registry, IA, chunking, tradução validada, Markdown, SQLite, resume, CLI | Implementados, com testes unitários (`npm test`) |
| Skilljar contra Chromium real | Validado **apenas com HTML local de fixture** (`npm run test:integration`) |
| Skilljar contra a plataforma real (login, aula real, legendas reais) | **Não validado.** Requer sua conta e um servidor de IA; veja [Validação ponta a ponta](#validação-ponta-a-ponta) |
| Detecção de sessão autenticada | Usa o seletor opcional `logged_in`; sem ele, só detecta redirecionamento para `/login`, `/auth` ou `/sign_in`. Ajuste conforme a plataforma real |
| Descoberta de cursos (Skilljar) | Retorna apenas o curso da URL informada (nenhum seletor de catálogo foi fornecido; não inventamos) |
| Transcrição | Fontes: bloco nativo (seletor `transcript`, opcional), `video.textTracks` e API pública do JW Player. **Reconhecimento de fala não está implementado** (apenas sinalizado) |
| Transcrições sem duração do vídeo ou sem tempos | Nunca marcadas como completas; a nota recebe um aviso e a aula fica `partial` |
| Udemy | Fora do escopo; a arquitetura comporta um `UdemyAdapter` |

## Requisitos

- Node.js 24+ (usa `node:sqlite` embutido)
- Servidor de IA compatível com OpenAI (ex.: llama.cpp)

## Instalação

```bash
npm install
npx playwright install chromium
cp .env.example .env
cp config/platforms.example.yaml config/platforms.yaml   # opcional; sem ele usa o exemplo
npm run typecheck && npm test
npm run scrape -- check-config
```

## Configurar o llama.cpp

Qualquer servidor compatível serve. Com llama.cpp:

```bash
llama-server -m /caminho/modelo.gguf --host 127.0.0.1 --port 8080 -c 16384
```

No `.env`:

```env
AI_BASE_URL=http://127.0.0.1:8080/v1
AI_API_KEY=local
AI_MODEL=nome-do-modelo
AI_TEMPERATURE=0.2
AI_MAX_TOKENS=8192
AI_TIMEOUT=120000
AI_MAX_RETRIES=3
AI_CHUNK_CHARS=6000
```

- `AI_CHUNK_CHARS` define o tamanho (em caracteres) de cada trecho enviado ao modelo. Mantenha-o confortavelmente abaixo do contexto (`-c`) menos `AI_MAX_TOKENS`: ~3–4 caracteres por token, e a tradução precisa de espaço para a saída. Se a saída for truncada (`finish_reason=length`), reduza-o.
- `AI_MAX_RETRIES` limita as tentativas **por trecho** de tradução (e as tentativas HTTP do SDK).
- Antes de qualquer processamento a CLI valida o endpoint, lista modelos (se suportado) e faz uma requisição de teste. Se falhar, nada é iniciado.

## Autenticação

```bash
npm run auth -- --url "https://anthropic-partners.skilljar.com/<curso>"
```

Abre o navegador (modo `headed`), você faz login manualmente e pressiona Enter no terminal. O `storageState` é salvo em `data/browser/skilljar-storage.json` (permissão `0600`, fora do git) e reutilizado nas execuções seguintes. Senhas nunca passam pela aplicação. Se a sessão expirar, o login manual é solicitado de novo.

## Uso

```bash
npm run scrape -- courses --url "<url>"                    # descobrir cursos
npm run scrape -- lessons --url "<url>" --course "Nome"    # listar aulas
npm run scrape -- --url "<url>"                            # fluxo interativo
npm run scrape -- --url "<url>" --lesson 1                 # uma aula
npm run scrape -- --url "<url>" --lessons 1,3,5-7          # várias
npm run scrape -- --url "<url>" --from 1 --to 5            # intervalo
npm run scrape -- --url "<url>" --all                      # curso inteiro
npm run scrape -- resume                                   # retomar
```

Posições começam em 1 e seguem a ordem original do curso. Opções: `--output`, `--overwrite`, `--skip-existing`, `--dry-run`, `--headed`, `--headless`, `--platform`, `--course`, `-y/--yes` (não interativo). Combinações conflitantes geram erro (ex.: `--lesson` com `--all`, `--overwrite` com `--skip-existing`).

- **Saída:** `dist/<nome-do-curso>/NN-slug.md` por padrão; use `--output` para apontar para uma pasta de um vault do Obsidian. Prefixo numérico com 2+ dígitos pela posição original.
- **Conflitos:** nunca sobrescreve silenciosamente. Padrão: pergunta; `--skip-existing` pula (usa o registro no SQLite *e* o arquivo no destino); `--overwrite` reprocessa tudo.
- **`--dry-run`:** descobre e lista o plano (novas/existentes) sem IA nem escrita.
- **Ctrl+C:** termina a aula atual e salva o progresso; use `resume`.
- **Dados auxiliares** (fora da saída do Obsidian): `data/transcripts/<plataforma>/<aula>.txt` (+ `.meta.json`, `.segments.json`), `data/database/progress.sqlite`, `data/logs/app.log` (JSON estruturado; avisos e erros também no terminal).

### Formato da nota

Frontmatter YAML (título, plataforma, curso, `lesson_id`, posição, URL, estado/origem/completude da transcrição, data) seguido de: `# Título`, `## Resumo da transcrição`, `---`, `## Conteúdo da aula` (títulos do conteúdo rebaixados 2 níveis). Se a transcrição for parcial ou indisponível, a nota traz um aviso explícito.

## Como funciona

```
CLI → Orchestrator → PlatformResolver/AdapterRegistry → Adapter (Playwright)
    → LessonProcessor: transcrição → HTML→Markdown → resumo → tradução → composição → escrita
    → ProgressRepository (SQLite) guarda o resultado de cada etapa
```

- **Resumo** (`src/ai/summarizer.ts`) recebe somente a transcrição; hierárquico para textos longos (chunks → notas → consolidação).
- **Tradução** (`src/processors/markdown-translator.ts`) recebe somente o Markdown do conteúdo, em chunks semânticos. Blocos de código são trocados por placeholders e **nunca enviados ao modelo**. Cada chunk é validado (placeholders, links, títulos, tabelas, itens de lista, tamanho mínimo contra resumos) e **só o chunk com falha é repetido**, até `AI_MAX_RETRIES`.
- Prompts de resumo e tradução são independentes; o conteúdo é tratado como dado não confiável (delimitado e sinalizado no prompt). O HTML é sanitizado antes da conversão.
- **Retomada:** transcrição, conteúdo, resumo e tradução são persistidos por aula; ao retomar, etapas concluídas não são refeitas. Uma falha em uma aula não interrompe as demais.

## Validação ponta a ponta

Nunca foi executada uma aula real nesta base (exige login). Para validar:

1. Suba o llama.cpp e confirme com `npm run scrape -- check-config`.
2. `npm run auth -- --url "<url do curso>"` e faça login.
3. `npm run scrape -- lessons --url "<url do curso>"`. Se falhar com "selector not found", ajuste `selectors.lesson_links` em `config/platforms.yaml` (veja o log e os screenshots em `data/logs/screenshots`).
4. `npm run scrape -- --url "<url do curso>" --lesson 1 --headed`.
5. Confira em `data/transcripts/skilljar/*.meta.json` a origem, `complete` e `warnings`. Em aulas sem legendas acessíveis o resultado será `partial`/indisponível, por design.

Testes: `npm test` (unitários e de contrato) e `npm run test:integration` (Chromium real contra fixtures locais).

## Adicionando uma nova plataforma

Não é preciso alterar orquestrador, processador de aulas, chunker, resumo, tradução, composer, writer ou repositórios.

1. Crie `src/platforms/<nome>/<nome>.adapter.ts` implementando `CoursePlatformAdapter` ([contrato](src/platforms/contracts/course-platform-adapter.ts)). Métodos opcionais: `setStartUrl`, `getLessonTitle`. Ids de aula/curso devem ser estáveis (ex.: `host/path`) e `position` começar em 1 na ordem original.
2. Reutilize o motor de transcrição (`createDefaultTranscriptExtractor`) ou forneça estratégias próprias (`TranscriptStrategy`).
3. Registre-o em [src/platforms/runtime.ts](src/platforms/runtime.ts) (composition root) e adicione a seção em `config/platforms.yaml` (domínios, seletores, navegador).
4. Rode a suíte de contrato reutilizável:

```ts
import { runAdapterContract } from "../contracts/adapter-contract.js";
runAdapterContract("MeuAdapter", {
  create: () => new MeuAdapter(/* deps de teste */),
  supportedUrl: "https://minha.plataforma/curso",
  unsupportedUrl: "https://outra.com/x",
});
```

5. Adicione fixtures HTML em `tests/fixtures` e um teste de integração em `tests/integration`.

## Estrutura

```
src/core         orquestrador, processador de aulas, runner, fábrica do pipeline
src/platforms    contrato + registry, skilljar, generic, runtime (composition root)
src/browser      Playwright, sessão (storageState 0600), autenticação manual
src/extraction   motor de transcrição, estratégias, integridade/cobertura, armazenamento
src/processors   limpeza, chunking, HTML→Markdown, tradução validada, composição, nomes
src/ai           cliente OpenAI-compatível, prompts, resumo, tradução
src/storage      SQLite (node:sqlite), repositórios, writer seguro
src/discovery    seleção de aulas e de curso
src/cli          comandos, opções, prompts, progresso
```

A saída do `tsc` vai para `build/`, pois `dist/` é o diretório padrão das notas geradas.

## Segurança

Sem senhas/cookies/tokens em logs (redação no Pino); sessão fora do git e com `0600`; nenhum script da página é executado por nós além de leituras no navegador (`evaluate`); HTML sanitizado; sem contorno de DRM; escrita atômica e sem sobrescrita silenciosa; timeouts e tentativas limitadas; processamento sequencial.
