#!/bin/sh
# M0 装载矩阵的外壳：install 段带网络、以非 root 用户跑；probe 段进无网络的命名空间，
# 同样以非 root 用户跑（第三方插件代码只在这一段执行）。
# 用法：run-matrix.sh install|probe [--only=1,2]
# 环境：M0_USER（缺省 dshm0）、M0_ROOT（缺省 /srv/dsh2forsion）、CHROMIUM（probe 用）
set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="${M0_ROOT:-/srv/dsh2forsion}"
USER_NAME="${M0_USER:-dshm0}"
NODE_DIR="$ROOT/node/$(ls "$ROOT/node" | head -1)"
RUNTIME_DIR="$ROOT/runtime/$(ls "$ROOT/runtime" | head -1)"
WORK="${M0_WORK:-$ROOT/matrix}"
CORPUS="${M0_CORPUS:-$HERE/corpus.json}"
mode="$1"; shift
run_as() {
  setpriv --reuid "$USER_NAME" --regid "$USER_NAME" --init-groups env -i \
    PATH="$NODE_DIR/bin:/usr/bin:/bin" HOME="/home/$USER_NAME" LANG=C.UTF-8 TMPDIR=/tmp \
    NODE_EXTRA_CA_CERTS="$ROOT/ca.crt" HTTPS_PROXY="${HTTPS_PROXY:-}" HTTP_PROXY="${HTTP_PROXY:-}" \
    PLAYWRIGHT_CORE="$ROOT/tools/node_modules/playwright-core/index.mjs" CHROMIUM="${CHROMIUM:-}" M0_DEBUG="${M0_DEBUG:-}" \
    "$@"
}
case "$mode" in
  install) run_as node "$HERE/matrix.mjs" install "$CORPUS" "$WORK" "$RUNTIME_DIR" "$HERE/../dsh-bridge" "$@" ;;
  probe)
    # 新网络命名空间：只有 lo，没有出网
    unshare -n sh -c "python3 -I '$HERE/lo-up.py' && exec \"\$0\" \"\$@\"" \
      setpriv --reuid "$USER_NAME" --regid "$USER_NAME" --init-groups env -i \
        PATH="$NODE_DIR/bin:/usr/bin:/bin" HOME="/home/$USER_NAME" LANG=C.UTF-8 TMPDIR=/tmp \
        PLAYWRIGHT_CORE="$ROOT/tools/node_modules/playwright-core/index.mjs" CHROMIUM="${CHROMIUM:-}" M0_DEBUG="${M0_DEBUG:-}" \
        node "$HERE/matrix.mjs" probe "$CORPUS" "$WORK" "$RUNTIME_DIR" "$HERE/../dsh-bridge" "$@" ;;
  *) echo "usage: run-matrix.sh install|probe" >&2; exit 2 ;;
esac
