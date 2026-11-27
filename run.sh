#!/usr/bin/env bash
# 项目统一入口。不带参数 = 构建网页版并打开试玩。
set -euo pipefail
cd "$(dirname "$0")"
# 原样留一份参数：拉到新代码后用新的 run.sh 重跑一遍
ORIG_ARGS=("$@")

source tools/cocos/creator.sh
# 记下有没有手动指定端口：没指定时，8080 被占就自动往后换一个（web_serve 里的 pick_web_port）
WEB_PORT_SET="${WEB_PORT:+1}"
WEB_PORT="${WEB_PORT:-8080}"
# 试玩 Chrome 的调试端口（./run.sh cdp 连它）；同时试玩两款游戏时各用各的端口，如 WEB_PORT=8081 CDP_PORT=9334
CDP_PORT_SET="${CDP_PORT:+1}"
export CDP_PORT="${CDP_PORT:-9333}"
# 试玩 Chrome 的独立配置目录按游戏代号区分，两款游戏的存档（localStorage）互不干扰
GAME_CODE="$(sed -nE 's/^ *"codeName": *"([^"]+)".*/\1/p' game.json | head -1)"

usage() {
  cat <<'EOF'
用法: ./run.sh [命令]
打包: ./package.sh（启动后输入编号）

试玩（在装了 Cocos Creator 3.8.8 的 Mac 上）：
  (无)                  构建网页版并在浏览器里打开。试玩模式：金币、技能已加满，所有关卡都能点开
  level <N>             同上，直接进第 N 关
  auto [起] [止]        同上，由机器人代打：过关自动进下一关、输了重打，一直打到最后一关（看连击、结算、宝箱等画面用）；
                        给了起就从第几关开始，否则从当前关；再给止就打到第几关为止
  page <名字>           同上，启动后直接打开某一页（levels、shop、wheel、daily、tasks…）
  real                  按真实存档进度玩，不加资源
                        以上参数可以连着写：./run.sh real level 65 auto
  serve [同上的参数]    不重新构建，直接打开上次的构建
  lan [同上的参数]      给别的设备测：构建后服务开在内网（0.0.0.0），打印 http://<本机内网 IP>:端口/ ，不开本机的 Chrome；
                        手机、别的电脑连同一个网络就能打开。lan serve = 不重新构建
  native-apply          按 game.json 改写各平台的构建配置和原生工程（打包命令会自动跑）
  native-icons          从图标和背景生成各平台的应用图标、iOS 启动屏、商店图标（换了图标后在 Linux 上跑，结果要提交）
  editor                用 Cocos Creator 打开 client/
  clean                 清掉 Cocos 的缓存（client/library、temp、build、local），资源导入出错时用
  record <关卡> [秒数] [语言] [slow] [ads] [serve]
                        录视频（做广告素材）：构建后另开一个 Chrome（临时配置、新存档），从第 N 关起机器人代打，
                        点得比平时快，录画面和游戏声音 [秒数]（默认 60）秒，存成 recordings/ 下的 1080×1920 mp4（不进仓库），
                        录完自己关掉。语言写 es、ja、zh_TW 这样（默认 en）；slow = 按平时的速度点；ads = 出横幅和插屏
                        （默认不出）；serve = 不重新构建。例：./run.sh record 12 60 es
  cdp logs [秒] | eval '<表达式>' | shot <图> | burst <目录> <张数> <间隔毫秒> '<JS>'
                        调试：读试玩浏览器的控制台、在页面里求值、截图、连拍

开发（Linux 或 CI，只需要 Node 22 以上）：
  check                 类型检查 + 单元测试 + .meta 与图片压缩检查（与 CI 相同）
  test                  只跑单元测试
  level-verify [起] [止] 校验关卡：每一关都生成得出来、参考解能过（示例玩法；换玩法时改 client/tools/level/verify.ts）
  level-pick [起] [止]   挑候选：每关生成十几个候选、用机器人量，挑最接近目标的写进 config/level_seeds.json（--probe 只量现状，--dry 不写；docs/02 第 5.8 节）
  eco-sim [--from=130]  金币的账：按活跃玩家每天过几关跑若干天，看一天挣多少、要花多少、要看几次广告（参数见 tools/economy/sim.ts）
  meta                  给 client/assets 里缺 .meta 的资源补 .meta（结果要提交）
  art-compress          包体压缩：PNG 调色板量化、背景音乐转 mp3（改了图后跑）
  font-subset           重新裁剪字体（需要 python3 与 fonttools、brotli）

试玩、serve、record、editor 运行前会先拉当前分支的最新代码（git pull --ff-only；Mac 上先还原 client/ 下
编辑器写的改动）。拉不下来只提示、用当前代码继续。

环境变量：WEB_PORT（本地服务端口，默认 8080，被占时自动往后换；手动指定的被占就报错）、CDP_PORT（试玩 Chrome 的调试端口，默认 9333，被别的游戏占着就自动往后换并记下来，./run.sh cdp 自动连它）、COCOS_CREATOR（Cocos Creator 可执行文件的路径）、NO_PULL=1（不自动拉代码）
EOF
}

# 丢掉 client/ 下已跟踪文件的改动之前，先把改动存成补丁（.git/scaffold-discarded/，留最近 20 份）：
# 多半是编辑器写的 .meta，但万一有人在 Mac 上手改了，还能 git apply 找回来
discard_changes() {
  local path="$1" dir patch
  [ -n "$(git status --porcelain --untracked-files=no -- "$path")" ] || return 0
  dir="$(git rev-parse --git-dir)/scaffold-discarded"
  mkdir -p "$dir"
  patch="${dir}/$(date +%Y%m%d-%H%M%S)-$$.patch"
  git diff --binary -- "$path" > "$patch"
  echo "  改动先存了一份：${patch}（要找回：git apply ${patch}）"
  ls -1t "$dir"/*.patch 2>/dev/null | tail -n +21 | while IFS= read -r old; do rm -f "$old"; done
  git checkout -- "$path"
}

cocos_build() {
  local platform="$1" code=0 try
  need_cocos
  for try in 1 2 3; do
    code=0
    cocos_build_once "$platform" || code=$?
    if [ "$code" -eq 36 ] && ! import_broken; then break; fi
    if import_broken; then
      echo "! 第 $try 次构建资源导入坏了（importer \"*\"），还原 .meta 后清缓存重来"
      discard_changes "$CLIENT/assets"
      code=1
    fi
  done
  [ "$code" -eq 36 ] || die "Cocos 构建 ${platform} 失败（退出码 ${code}）"
  echo "✓ 已构建 $platform → client/build/$platform"
  # Cocos 可能改写 .meta；Mac 上不提交这些改动，下次拉代码前用 git checkout -- client 还原
  if [ -n "$(git status --porcelain -- client 2>/dev/null)" ]; then
    echo "! Cocos 改动了 client/ 下的文件（多半是 .meta），不要在这台机器上提交："
    # 改动的文件很多时（比如刚生成完关卡还没提交）head 先收工，git 会收到 SIGPIPE；开着 pipefail 整个脚本就退了，服务起不来
    git status --short -- client | head -20 || true
  fi
}

# 试玩参数 → 地址栏参数（client/assets/scripts/services/launch.ts 读）：real、level <N>、auto [起] [止]、page <名字>
web_url() {
  local q=""
  while [ $# -gt 0 ]; do
    case "$1" in
      real) q="${q}&real=1" ;;
      level)
        [[ "${2:-}" =~ ^[0-9]+$ ]] || die "用法: ./run.sh level <关卡号>"
        q="${q}&level=$2&play=1"; shift ;;
      auto)
        q="${q}&autoplay=1"
        if [[ "${2:-}" =~ ^[0-9]+$ ]]; then q="${q}&level=$2"; shift; fi
        if [[ "${2:-}" =~ ^[0-9]+$ ]]; then q="${q}&autoTo=$2"; shift; fi ;;
      page)
        [ -n "${2:-}" ] || die "用法: ./run.sh page <页面名>"
        q="${q}&page=$2"; shift ;;
      *) die "不认识的试玩参数：$1（可用 real、level <N>、auto [起] [止]、page <名字>）" ;;
    esac
    shift
  done
  echo "http://localhost:${WEB_PORT}/${q:+?${q#&}}"
}

# 端口有没有被占：0.0.0.0 和 127.0.0.1 都试着占一下，占不上就是有别的服务（常见是别的游戏的试玩服务）用着
port_busy() {
  python3 -c '
import socket, sys
port = int(sys.argv[1])
for host in ("0.0.0.0", "127.0.0.1"):
    s = socket.socket()
    try:
        s.bind((host, port))
    except OSError:
        sys.exit(0)
    finally:
        s.close()
sys.exit(1)
' "$1"
}

# 默认端口被占就往后找 20 个，用第一个空的；手动指定的端口被占直接报错，不偷偷换
pick_web_port() {
  port_busy "$WEB_PORT" || return 0
  [ -z "$WEB_PORT_SET" ] || die "端口 ${WEB_PORT} 已被占用（可能是别的游戏的试玩服务还开着），换一个：WEB_PORT=<端口> ./run.sh …"
  local p
  for p in $(seq $((WEB_PORT + 1)) $((WEB_PORT + 20))); do
    if ! port_busy "$p"; then
      echo "→ 端口 ${WEB_PORT} 被占用（多半是别的游戏的试玩服务），改用 ${p}"
      WEB_PORT="$p"
      return 0
    fi
  done
  die "端口 ${WEB_PORT}–$((WEB_PORT + 20)) 都被占用了，用 WEB_PORT=<端口> 指定一个空的"
}

# 试玩 Chrome 的调试端口：指定了 CDP_PORT 就用它；没指定时，这个游戏的试玩 Chrome 还开着就沿用它的端口
# （同一个配置目录的 Chrome 只会交给原来那个进程，新给的端口不生效），否则从 9333 往后找空的（别的游戏的试玩 Chrome 可能占着 9333，#191）。
# 用的端口记在「配置目录.port」，./run.sh cdp 没指定端口时读它
chrome_profile() {
  echo "${TMPDIR:-/tmp}/${GAME_CODE:-game}-chrome"
}
pick_cdp_port() {
  [ -z "$CDP_PORT_SET" ] || return 0
  local prof p
  prof="$(chrome_profile)"
  if [ -f "${prof}.port" ]; then
    p="$(cat "${prof}.port")"
    if [ -n "$p" ] && ps -Aww -o command 2>/dev/null | grep -F -- "--user-data-dir=${prof}" | grep -qF -- "--remote-debugging-port=${p}"; then
      CDP_PORT="$p"
      return 0
    fi
  fi
  p=9333
  while port_busy "$p" && [ "$p" -lt 9353 ]; do p=$((p + 1)); done
  CDP_PORT="$p"
}

web_serve() {
  local dir="$CLIENT/build/web-mobile" url
  pick_web_port
  url="$(web_url "$@")"
  need_file "$dir/index.html" "请在 ./package.sh 选择 4（网页版）"
  # 内网模式（./run.sh lan）：绑到所有网卡，把本机的内网地址打出来，不开本机浏览器
  if [ "${WEB_LAN:-}" = "1" ]; then
    local ip=""
    if command -v ipconfig >/dev/null 2>&1; then ip="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"; fi
    if [ -z "$ip" ] && command -v hostname >/dev/null 2>&1; then ip="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"; fi
    [ -n "$ip" ] || ip="<本机内网 IP>"
    echo "→ 内网地址：${url/localhost/${ip}}（同一个网络里的手机、电脑都能开；Ctrl+C 停止）"
    # 不用 python 的 http.server：它排队只有 5 个，别的设备一次要几十个文件会被重置连接、缺图
    exec node tools/web/serve.mjs "$dir" "$WEB_PORT" 0.0.0.0
  fi
  echo "→ ${url}（Ctrl+C 停止）"
  # macOS：用独立的临时 Chrome 配置开一个手机大小的应用窗口，不打扰平时用的浏览器，截图也只截到游戏。
  # 后三个参数：窗口被别的窗口挡住时也照常跑（不然远程截图、连拍时画面是停的）
  local chrome=/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome
  if [ -x "$chrome" ]; then
    pick_cdp_port
    echo "$CDP_PORT" > "$(chrome_profile).port"
    echo "→ 调试端口 ${CDP_PORT}（./run.sh cdp 自动连它）"
    (sleep 1; "$chrome" --user-data-dir="$(chrome_profile)" --no-first-run --remote-debugging-port="${CDP_PORT}" \
      --no-default-browser-check --app="$url" --window-size=450,832 \
      --disable-backgrounding-occluded-windows --disable-renderer-backgrounding --disable-background-timer-throttling >/dev/null 2>&1) &
  elif command -v open >/dev/null; then
    (sleep 1; open "$url") &
  fi
  exec python3 -m http.server "$WEB_PORT" --bind 127.0.0.1 --directory "$dir"
}

# ./run.sh record：单独起一个服务和一个 Chrome（临时配置目录 = 新存档、不受平时试玩的设置影响），机器人代打录一段，
# 录完关掉自己起的这两个进程、删掉临时配置（docs/10 第 9 节）。录屏脚本在 tools/record/rec.mjs
REC_PIDS=()
REC_PROF=""
rec_cleanup() {
  [ ${#REC_PIDS[@]} -gt 0 ] && { kill "${REC_PIDS[@]}" 2>/dev/null || true; wait "${REC_PIDS[@]}" 2>/dev/null || true; }
  [ -n "$REC_PROF" ] && rm -rf "$REC_PROF"
  return 0
}
record() {
  local lv="" secs=60 lang=en fast=1 ads=0 build=1 a
  for a in "$@"; do
    case "$a" in
      slow) fast=0 ;;
      ads) ads=1 ;;
      serve) build=0 ;;
      *)
        if [[ "$a" =~ ^[0-9]+$ ]]; then
          if [ -z "$lv" ]; then lv="$a"; else secs="$a"; fi
        elif [[ "$a" =~ ^[a-z]{2}(_[A-Z]{2})?$ ]]; then
          lang="$a"
        else
          die "不认识的录屏参数：${a}（用法: ./run.sh record <关卡> [秒数] [语言] [slow] [ads] [serve]）"
        fi ;;
    esac
  done
  [ -n "$lv" ] || die "用法: ./run.sh record <关卡> [秒数] [语言] [slow] [ads] [serve]"
  local chrome=/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome
  [ -x "$chrome" ] || die "录屏要用 Mac 上的 Google Chrome"
  [ "$build" = 1 ] && cocos_build web-mobile
  local dir="$CLIENT/build/web-mobile" cdp=9360 out url
  need_file "$dir/index.html" "去掉 serve 重新构建一次"
  pick_web_port
  while port_busy "$cdp" && [ "$cdp" -lt 9380 ]; do cdp=$((cdp + 1)); done
  mkdir -p recordings
  out="recordings/L${lv}_${lang}_$(date +%Y%m%d-%H%M%S)"
  url="http://localhost:${WEB_PORT}/?autoplay=1&level=${lv}&lang=${lang}&ads=${ads}"
  [ "$fast" = 1 ] && url="${url}&fast=1"
  REC_PROF="$(mktemp -d "${TMPDIR:-/tmp}/fishsort-rec.XXXXXX")"
  trap rec_cleanup EXIT
  node tools/web/serve.mjs "$dir" "$WEB_PORT" 127.0.0.1 >/dev/null 2>&1 &
  REC_PIDS+=($!)
  # 声音不用点一下才响（--autoplay-policy）；窗口被挡住也照常跑（后三个参数）
  "$chrome" --user-data-dir="$REC_PROF" --no-first-run --no-default-browser-check --remote-debugging-port="$cdp" \
    --autoplay-policy=no-user-gesture-required --app=about:blank --window-size=450,832 \
    --disable-backgrounding-occluded-windows --disable-renderer-backgrounding --disable-background-timer-throttling >/dev/null 2>&1 &
  REC_PIDS+=($!)
  CDP_PORT="$cdp" URL="$url" SECS="$secs" OUT="$out" node tools/record/rec.mjs
  # MediaRecorder 写的 mp4 没有时长索引，有的播放器、剪辑软件拖不动：有 ffmpeg 就原样转封装一遍（不重新压缩）
  if [ -f "$out.mp4" ] && command -v ffmpeg >/dev/null 2>&1; then
    ffmpeg -loglevel error -y -i "$out.mp4" -c copy -movflags +faststart "$out.fixed.mp4" && mv "$out.fixed.mp4" "$out.mp4"
  fi
}

need_node_modules() {
  command -v node >/dev/null || die "找不到 node（需要 Node 22 以上）"
  [ -d client/node_modules ] || (cd client && npm ci)
}

need_file() { [ -e "$1" ] || die "还没有 $1：$2"; }

# 试玩、构建、开编辑器之前先拉当前分支的最新代码。NO_PULL=1 ./run.sh … 跳过。
# Mac 上只试玩、不改文件（CLAUDE.md 第 13 条）：client/ 下已跟踪文件的改动是 Cocos 编辑器 / 构建自己写的（.meta、设置），
# 先丢掉再拉，和手动同步的 git checkout -- client && git pull --ff-only 一样；Linux 上不丢任何改动，拉不下来就提示一句照常运行。
# 没网、本地有自己的提交、不在分支上、分支没有远程，都只提示，用当前代码继续
PULLED_NEW=0
pull_latest() {
  [ "${NO_PULL:-}" = "1" ] && return 0
  git rev-parse --is-inside-work-tree >/dev/null 2>&1 || return 0
  local branch before after
  branch="$(git symbolic-ref --short -q HEAD)" || { echo "（不在分支上，不拉取）"; return 0; }
  git rev-parse -q --verify '@{u}' >/dev/null 2>&1 || { echo "（$branch 没有对应的远程分支，不拉取）"; return 0; }
  before="$(git rev-parse HEAD)"
  echo "→ 拉取最新代码（${branch}）"
  if [ "$(uname)" = "Darwin" ] && [ -n "$(git status --porcelain --untracked-files=no -- client)" ]; then
    echo "  先还原 client/ 下编辑器写的改动："
    git status --porcelain --untracked-files=no -- client | head -5 | sed 's/^/    /' || true
    discard_changes client
  fi
  if ! git pull --ff-only -q; then
    echo "⚠ 拉取失败（没网、或本地有改动 / 自己的提交），用当前代码继续" >&2
    return 0
  fi
  after="$(git rev-parse HEAD)"
  if [ "$before" = "$after" ]; then
    echo "  已经是最新"
  else
    git log --oneline "$before..$after" | head -10 | sed 's/^/  /'
    PULLED_NEW=1
  fi
}

# lan：服务开在内网给别的设备测（见 web_serve）；后面照常跟试玩参数或 serve
if [ "${1:-}" = "lan" ]; then
  export WEB_LAN=1
  shift
fi
cmd="${1:-play}"
case "$cmd" in
  # 试玩参数直接跟在 ./run.sh 后面：整串都交给 play
  real|level|auto|page) cmd=play ;;
  *) if [ $# -gt 0 ]; then shift; fi ;;
esac

case "$cmd" in
  play|serve|editor|record)
    if [ "${RUN_SH_PULLED:-}" != "1" ]; then
      pull_latest
      # 拉到了新代码：用新的 run.sh 重跑（run.sh 自己也可能改了）
      if [ "$PULLED_NEW" = "1" ]; then RUN_SH_PULLED=1 exec ./run.sh ${ORIG_ARGS[@]+"${ORIG_ARGS[@]}"}; fi
    fi
    ;;
esac

case "$cmd" in
  play)
    # 先把参数检查一遍，写错了不用等构建完才知道
    web_url "$@" >/dev/null
    cocos_build web-mobile
    web_serve "$@"
    ;;
  serve)        web_serve "$@" ;;
  record)       record "$@" ;;
  native-apply) node tools/native/apply.mjs ;;
  native-icons) python3 tools/native/icons.py "$@" ;;
  editor)
    need_cocos
    exec "$COCOS" --project "$CLIENT" "$@"
    ;;
  clean)
    # 都是 Cocos 生成的缓存，不进仓库；导入状态坏了（资源被标成 importer "*"、黑屏）时清掉重来
    rm -rf client/library client/temp client/build client/local
    echo "✓ 已清掉 client/library、temp、build、local"
    ;;
  cdp)
    # 没指定 CDP_PORT：连这个游戏的试玩 Chrome 记下的端口（pick_cdp_port）
    [ -n "$CDP_PORT_SET" ] || CDP_PORT="$(cat "$(chrome_profile).port" 2>/dev/null || echo 9333)"
    export CDP_PORT
    node tools/cocos/cdp.mjs "$@"
    ;;
  check)
    need_node_modules
    node tools/cocos/meta.mjs --check
    (cd client && node tools/art/compress.mjs --check)
    # Cocos 3.8 构建用的 Babel 不认「as 后面跟联合类型」，打包脚本会失败，Linux 上的 tsc 查不出来
    if grep -rnE '^[^/]*[^/]\bas [^;,)=]*\|' client/assets/scripts --include='*.ts'; then
      die "上面几处是 as X | Y 的写法，Cocos 构建会失败，换成函数收窄"
    fi
    # Cocos 的 Babel（松散模式）把 [...迭代器] 编成 [].concat(迭代器)：Map / Set 展开出来是错的，用 Array.from
    if grep -rnE '\[\.\.\.(new (Set|Map)|[A-Za-z_.]*\.(values|keys|entries)\(\))' client/assets/scripts --include='*.ts'; then
      die "上面几处展开了 Map / Set / 迭代器，Cocos 构建后结果不对，换成 Array.from(...)"
    fi
    # macOS 自带的 bash 3.2 会把紧跟在 $变量 后面的中文（全角括号、冒号）当成变量名的一部分，报 unbound variable；要写成 ${变量}
    if git ls-files -z '*.sh' | xargs -0 env LC_ALL=C grep -nE '[$][A-Za-z_][A-Za-z0-9_]*[^ -~[:space:]]'; then
      die "上面几处 \$变量 后面直接跟了中文，Mac 上的 bash 3.2 会报错，写成 \${变量}"
    fi
    # 存档键前缀要和 game.json 的 codeName 一致（同一台设备、同一个网址上两款游戏的存档不串）
    code="$(node -p "require('./game.json').codeName")"
    if grep -rLE "const PREFIX = '${code}\\.'" client/assets/scripts/platform/platform{Debug,Wechat,Native}.ts | grep .; then
      die "上面几个文件的存档前缀 PREFIX 不是 '${code}.'（game.json 的 codeName），改成一致"
    fi
    (cd client && npx tsc -p tsconfig.core.json && npx tsc -p tsconfig.tools.json)
    # 用到 cc 的脚本要 Cocos 的类型声明（client/.cc-types，从 Mac 的 Cocos 取，不进仓库）；没有就跳过
    if [ -f client/.cc-types/cc.d.ts ]; then (cd client && npx tsc -p tsconfig.client.json); else echo "（没有 client/.cc-types，跳过界面层类型检查）"; fi
    (cd client && npx tsx --test tests/*.test.ts)
    ;;
  test)
    need_node_modules
    (cd client && npx tsx --test tests/*.test.ts "$@")
    ;;
  level-verify)
    need_node_modules
    (cd client && npx tsx tools/level/verify.ts "$@")
    ;;
  level-pick)
    need_node_modules
    (cd client && npx tsx tools/level/pick.ts "$@")
    ;;
  eco-sim)
    need_node_modules
    (cd client && npx tsx tools/economy/sim.ts "$@")
    ;;
  meta)
    node tools/cocos/meta.mjs "$@"
    ;;
  art-compress)
    # 包体：PNG 量化成调色板、背景音乐转 mp3；之后补 .meta
    need_node_modules
    (cd client && node tools/art/compress.mjs && node tools/audio/bgm_mp3.mjs)
    node tools/cocos/meta.mjs
    ;;
  font-subset)
    python3 client/tools/font_subset.py "$@"
    ;;
  -h|--help|help) usage ;;
  *) usage; exit 1 ;;
esac
