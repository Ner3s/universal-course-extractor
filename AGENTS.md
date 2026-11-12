## Environment

- **Node.js (NVM in non-interactive shells)**: When `node`/`npm` are missing from `PATH`, prepend `export PATH="$(ls -d $HOME/.config/nvm/versions/node/*/bin $HOME/.nvm/versions/node/*/bin 2>/dev/null | tail -n 1):$PATH"` or run targets via `make`.
- **Coding standards & architectural invariants**: Read `CODING_STANDARDS.md` before modifying `src/`.
- **Skilljar DOM & JWPlayer captions**: When modifying `src/platforms/skilljar/` or `src/extraction/`, read `docs/platforms/skilljar.md` for the 3 lesson layouts (`#details-pane-summary-content`, `.course-text-content`, `video-only`) and JWPlayer v2 manifest extraction (`<sjwc-video>`, `videoJsArgs`, `.srt` tracks).
- **Inspecting a live lesson DOM**: Run `make inspect-lesson URL="<lesson-url>"` to inspect selectors and video metadata using the saved session in `data/browser/skilljar-storage.json`.

## Agent skills

### Issue tracker

Issues and specs are tracked as local markdown files under `.scratch/<feature>/`.

### Triage labels

Uses the default canonical triage labels (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`).

### Domain docs

Single-context layout: read `GLOSSARY.md` for canonical domain terminology and `docs/adr/` for architectural decision records.
