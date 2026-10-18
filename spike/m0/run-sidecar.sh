#!/bin/sh
# M0：起一个 sidecar。只监听 127.0.0.1 的随机端口；环境变量走白名单，
# 宿主的令牌、provider key、FORSION_* / TANGU_* 一律不传进去。
# 用法：run-sidecar.sh <node 目录> <runtime 目录> <DSH_HOME> [profile]
set -eu
NODE_DIR="$1"; RUNTIME_DIR="$2"; HOME_DIR="$3"; PROFILE="${4:-forsion}"
mkdir -p "$HOME_DIR"
exec env -i \
  PATH="$NODE_DIR/bin:/usr/bin:/bin" \
  HOME="${HOME:-/tmp}" LANG="${LANG:-C.UTF-8}" TMPDIR="${TMPDIR:-/tmp}" \
  HTTPS_PROXY="${HTTPS_PROXY:-}" HTTP_PROXY="${HTTP_PROXY:-}" NO_PROXY="${NO_PROXY:-}" \
  NODE_EXTRA_CA_CERTS="${NODE_EXTRA_CA_CERTS:-}" \
  DSH_HOME="$HOME_DIR" \
  DSH2FORSION_SECRET="${DSH2FORSION_SECRET:-}" \
  node "$RUNTIME_DIR/node_modules/@deepseek-ai/dsh/lib/bin.js" \
    --profile "$PROFILE" --host 127.0.0.1 --port 0 --no-open
