#!/bin/bash
# krx-readonly.mcpb 만들기 (manifest.json이 맨 위에 있는 zip)
set -euo pipefail
cd "$(dirname "$0")"
node test/offline.test.js
T=$(mktemp -d)
zip -q -r "$T/x.mcpb" manifest.json server README.md
cat "$T/x.mcpb" > krx-readonly.mcpb
echo "만들어짐: $(pwd)/krx-readonly.mcpb"
