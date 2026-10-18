#!/bin/sh
# M0：把 sidecar 运行时装到 $DSH2FORSION_ROOT（缺省 ~/.forsion/dsh2forsion）。
#   node/<版本>/      官方 Node 24，按 SHASUMS256 校验
#   runtime/<版本>/   钉死的 @deepseek-ai/dsh，安装时不跑任何脚本，
#                     再只对 DSH 自己的三个原生依赖跑构建脚本
# 可重复跑：已装好的版本直接跳过。
set -eu
ROOT="${DSH2FORSION_ROOT:-$HOME/.forsion/dsh2forsion}"
NODE_MAJOR="${NODE_MAJOR:-24}"
DSH_VERSION="${DSH_VERSION:-0.2.1-rc.2}"

case "$(uname -s)-$(uname -m)" in
  Linux-x86_64) plat=linux-x64; ext=tar.xz ;;
  Linux-aarch64) plat=linux-arm64; ext=tar.xz ;;
  Darwin-arm64) plat=darwin-arm64; ext=tar.gz ;;
  Darwin-x86_64) plat=darwin-x64; ext=tar.gz ;;
  *) echo "unsupported platform $(uname -s)-$(uname -m)" >&2; exit 1 ;;
esac

NODE_VERSION="${NODE_VERSION:-$(curl -fsS https://nodejs.org/dist/index.json | node -e '
  let s = ""; process.stdin.on("data", d => s += d).on("end", () => {
    const v = JSON.parse(s).find(r => r.version.startsWith("v" + process.argv[1] + "."))
    process.stdout.write(v.version)
  })' "$NODE_MAJOR")}"
NODE_DIR="$ROOT/node/$NODE_VERSION"
if [ ! -x "$NODE_DIR/bin/node" ]; then
  tmp="$(mktemp -d)"
  file="node-$NODE_VERSION-$plat.$ext"
  curl -fsS -o "$tmp/$file" "https://nodejs.org/dist/$NODE_VERSION/$file"
  curl -fsS -o "$tmp/SHASUMS256.txt" "https://nodejs.org/dist/$NODE_VERSION/SHASUMS256.txt"
  (cd "$tmp" && grep " $file\$" SHASUMS256.txt | sha256sum -c -)
  mkdir -p "$NODE_DIR"
  tar -xf "$tmp/$file" -C "$NODE_DIR" --strip-components 1
  rm -rf "$tmp"
fi

RUNTIME_DIR="$ROOT/runtime/$DSH_VERSION"
if [ ! -f "$RUNTIME_DIR/node_modules/@deepseek-ai/dsh/package.json" ]; then
  mkdir -p "$RUNTIME_DIR"
  printf '{ "name": "dsh2forsion-runtime", "private": true }\n' > "$RUNTIME_DIR/package.json"
  PATH="$NODE_DIR/bin:$PATH"
  (cd "$RUNTIME_DIR" \
    && npm install --ignore-scripts --no-audit --no-fund --registry https://registry.npmjs.org/ "@deepseek-ai/dsh@$DSH_VERSION" \
    && npm rebuild koffi node-pty @deepseek-ai/dsh-subprocess-local)
fi

printf 'node=%s\nruntime=%s\n' "$NODE_DIR" "$RUNTIME_DIR"
