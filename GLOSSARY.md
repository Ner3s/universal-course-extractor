# Universal Course Extractor

Ferramenta que extrai cursos online autenticados (aulas em texto e vídeo), traduz o material didático para português (pt-BR), resume e transcreve as vídeo-aulas e publica notas estruturadas para estudo no Obsidian.

## Language

### Curso e Navegação

**Course (Curso)**:
Conjunto ordenado de aulas publicado em uma plataforma de ensino sob um identificador e URL próprios.
_Avoid_: Module, training, playlist, track

**Lesson (Aula)**:
Unidade individual de estudo dentro de um curso, identificada por sua posição sequencial (`position`) e URL própria, podendo conter vídeo, conteúdo escrito ou ambos.
_Avoid_: Class, lecture, page, item, step

**Lesson Modality (Modalidade da Aula)**:
Classificação da aula conforme os insumos didáticos presentes na página: **Hybrid Lesson** (possui vídeo-aula e conteúdo escrito), **Video-Only Lesson** (possui apenas vídeo-aula, sem guia textual) ou **Text-Only Lesson** (guia escrito ou exercício sem vídeo).
_Avoid_: Lesson type, layout mode, template, format

**Platform Adapter (Adaptador de Plataforma)**:
Contrato específico de um provedor de cursos (como Skilljar) responsável por autenticar, descobrir cursos/aulas e capturar o estado bruto de uma aula sem conhecer regras de resumo, tradução ou formatação de saída.
_Avoid_: Scraper, crawler, connector, plugin

**Browser Session (Sessão do Navegador)**:
Estado autenticado persistido do aluno em uma plataforma (cookies e armazenamento local), reutilizado em execuções futuras para acessar aulas restritas sem novo login manual.
_Avoid_: Auth token, credentials, profile, cookie jar

### Conteúdo Extraído

**Lesson Content (Conteúdo da Aula)**:
Material didático escrito presente na página da aula (guias passo a passo, explicações, blocos de código, links e imagens), distinto da fala do vídeo.
_Avoid_: Lesson body, article, description, summary pane, page text

**Transcript (Transcrição)**:
Texto temporalmente ordenado das falas de uma vídeo-aula, obtido de transcrição oficial na página, faixas de legenda (CC) ou reconhecimento de fala.
_Avoid_: Subtitles, closed captions, video text, script

**Transcript Source (Origem da Transcrição)**:
Canal pelo qual a transcrição foi obtida, em ordem de preferência: **Native Transcript** (`native`, painel de transcrição oficial na página), **Player Captions** (`captions`, legendas fechadas expostas pelo player ou manifesto de vídeo), **Text Track** (`text-track`, arquivo de faixa temporal `.vtt`/`.srt` anexado à mídia) ou **Speech Recognition** (`speech-to-text`, transcrição acústica de último recurso).
_Avoid_: Strategy name, extractor type, caption format

**Transcript Segment (Segmento de Transcrição)**:
Trecho individual de uma transcrição associado a um intervalo de tempo (`start` e `end` em segundos) no vídeo.
_Avoid_: Cue, line, chunk, caption block

**Transcript Coverage (Cobertura da Transcrição)**:
Evidência verificável de que a transcrição cobre a extensão real da vídeo-aula do início ao fim, distinguindo uma transcrição completa (`found`) de uma captura parcial (`partial`).
_Avoid_: Completeness score, transcript length, validation

### Processamento e Saída

**Transcript Summary (Resumo da Vídeo-Aula)**:
Síntese estruturada em português (pt-BR) gerada por IA exclusivamente a partir da transcrição do vídeo, contendo visão geral, pontos-chave, exemplos práticos e trechos notáveis.
_Avoid_: Lesson summary, AI output, abstract, overview

**Lesson Note (Nota da Aula)**:
Documento Markdown final gravado no cofre do Obsidian que combina metadados da aula (frontmatter), o resumo da vídeo-aula, a transcrição completa colapsável e o conteúdo da aula traduzido.
_Avoid_: Output file, markdown dump, exported lesson, report
