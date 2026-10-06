#!/usr/bin/env bash
# 从 assets/icons/icon-512.png 生成安卓启动图标与启动图（需 ImageMagick）
# 运行: bash tools/make-android-icons.sh
#
# 图标策略：自适应图标 = 背景层（图标自身的模糊放大版）+ 缩到 66% 的前景。
# 不能直接把整张方图当前景——自适应图标安全区只有中间 66%，四角棋子会被遮罩裁掉；
# 背景层用模糊放大的自身而非纯色，是为了让外圈和图标木纹同调，不出现"贴纸"感。
# 启动图用纯色位图：纯色被窗口拉伸也不变形，且与图标底色一致，Android 12+ 上过渡自然。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/assets/icons/icon-512.png"
RES="$ROOT/android/app/src/main/res"
WOOD="#8B6243"

# 密度:传统图标边长:自适应前景边长(108dp 基准)
DENSITIES=("mdpi:48:108" "hdpi:72:162" "xhdpi:96:216" "xxhdpi:144:324" "xxxhdpi:192:432")

for spec in "${DENSITIES[@]}"; do
  IFS=: read -r d lg fg <<<"$spec"
  mkdir -p "$RES/mipmap-$d"
  r=$((lg / 5))
  inner=$((fg * 66 / 100))

  # 传统图标（API 26 以下 / 部分启动器）：圆角矩形
  magick "$SRC" -resize "${lg}x${lg}" -alpha set \
    \( -size "${lg}x${lg}" xc:none -fill white -draw "roundrectangle 0,0 $((lg - 1)),$((lg - 1)) $r,$r" \) \
    -compose DstIn -composite "$RES/mipmap-$d/ic_launcher.png"

  # 圆形图标
  magick "$SRC" -resize "${lg}x${lg}" -alpha set \
    \( -size "${lg}x${lg}" xc:none -fill white -draw "circle $((lg / 2)),$((lg / 2)) $((lg / 2)),0" \) \
    -compose DstIn -composite "$RES/mipmap-$d/ic_launcher_round.png"

  # 自适应图标背景层：整图模糊放大
  magick "$SRC" -resize "${fg}x${fg}" -blur 0x$((fg / 18)) "$RES/mipmap-$d/ic_launcher_background.png"

  # 自适应图标前景层：居中缩到 66%，四周留透明
  magick -size "${fg}x${fg}" xc:none \( "$SRC" -resize "${inner}x${inner}" \) \
    -gravity center -composite "$RES/mipmap-$d/ic_launcher_foreground.png"

  echo "mipmap-$d: 图标 ${lg}px / 前景 ${fg}px"
done

# 启动图：纯品牌色，按模板既有的各密度画布尺寸生成
splash() { magick -size "$2" xc:"$WOOD" "$RES/$1"; }
splash drawable/splash.png 480x320
for spec in "mdpi:320x480:480x320" "hdpi:480x800:800x480" "xhdpi:720x1280:1280x720" \
            "xxhdpi:960x1600:1600x960" "xxxhdpi:1280x1920:1920x1280"; do
  IFS=: read -r d port land <<<"$spec"
  splash "drawable-port-$d/splash.png" "$port"
  splash "drawable-land-$d/splash.png" "$land"
done

echo "完成：图标 + 启动图已写入 $RES"
