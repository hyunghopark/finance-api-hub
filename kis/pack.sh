#!/bin/bash
# kis-readonly.mcpb 만들기 (mcpb = manifest.json이 맨 위에 있는 zip)
set -euo pipefail
cd "$(dirname "$0")"
node test/offline.test.js
rm -f kis-readonly.mcpb
zip -q -r kis-readonly.mcpb manifest.json server README.md
echo "만들어짐: $(pwd)/kis-readonly.mcpb"
