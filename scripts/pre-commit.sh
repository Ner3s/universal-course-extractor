#!/usr/bin/env bash
set -euo pipefail

NVM_BIN="$(ls -d "$HOME"/.config/nvm/versions/node/*/bin "$HOME"/.nvm/versions/node/*/bin 2>/dev/null | tail -n 1 || true)"
if [ -n "$NVM_BIN" ]; then
  export PATH="$NVM_BIN:$PATH"
fi

npm run typecheck
npm test
