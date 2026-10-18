#!/usr/bin/env bash
# 用 tangu-agent 的真加载器跑 dsh2forsion.loader.test.ts。
#   tests/tangu/run.sh <Forsion 检出>/tangu-agent <已装好运行时的根目录>
# 测试文件临时拷进 tangu-agent/src/plugins/，跑完删掉，不留在 Forsion 检出里。
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
agent="${1:?tangu-agent dir}"
root="${2:?runtime root (contains node/ and runtime/)}"
dest="$agent/src/plugins/dsh2forsion.loader.test.ts"
cp "$here/dsh2forsion.loader.test.ts" "$dest"
trap 'rm -f "$dest"' EXIT
(cd "$repo" && npm run build >/dev/null)
cd "$agent"
DSH2FORSION_BUNDLE="$repo/plugin" DSH2FORSION_ROOT="$root" DSH2FORSION_FIXTURE="$repo/tests/fixtures/fixture-tool" \
  npx vitest run src/plugins/dsh2forsion.loader.test.ts
