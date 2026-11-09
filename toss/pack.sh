#!/bin/bash
# toss-readonly.mcpb 만들기 (mcpb = manifest.json이 맨 위에 있는 zip)
set -euo pipefail
cd "$(dirname "$0")"
node test/test.js
rm -f toss-readonly.mcpb
zip -q -r toss-readonly.mcpb manifest.json server README.md
echo "만들어짐: $(pwd)/toss-readonly.mcpb"
