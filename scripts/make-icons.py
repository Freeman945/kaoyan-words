"""
生成 PWA 图标。

为什么用脚本而不是手画：图标要出好几个尺寸（192 / 512 / 180 / maskable），
手动画一遍以后想换颜色或换字就得重来。脚本跑一次全能出。

运行方式（用工作区自带的 Python，已含 Pillow）：
    python scripts/make-icons.py

设计刻意做得安静：深灰底 + 白色「词」字，和网站本身一个调子。
不用渐变、不用彩色、不加装饰 —— 主屏上的图标小，越简单越清楚。
"""

import os
import sys

from PIL import Image, ImageDraw, ImageFont

# 输出到 public/，Next.js 会原样发布这些文件
OUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "public")

BG = (24, 24, 27)      # zinc-900  #18181b
FG = (250, 250, 250)   # zinc-50   #fafafa

GLYPH = "词"

# 优先用黑体，找不到就退回雅黑
FONT_CANDIDATES = [
    r"C:\Windows\Fonts\msyhbd.ttc",   # 微软雅黑 Bold
    r"C:\Windows\Fonts\msyh.ttc",     # 微软雅黑
    r"C:\Windows\Fonts\simhei.ttf",   # 黑体
]


def load_font(size: int) -> ImageFont.FreeTypeFont:
    for path in FONT_CANDIDATES:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except OSError:
                continue
    raise SystemExit(
        "找不到可用的中文字体，无法生成带「词」字的图标。"
        "请确认 C:\\Windows\\Fonts 下有 msyh.ttc 或 simhei.ttf。"
    )


def make_icon(px: int, glyph_ratio: float, path: str) -> None:
    """
    画一个正方形图标。

    glyph_ratio 是「字高占整个图标的比例」。
    普通图标用 0.52 左右；maskable 图标必须用更小的值，
    因为 Android 会把图标裁成圆形/水滴形，只有中间约 80% 是安全区。
    """
    img = Image.new("RGB", (px, px), BG)
    draw = ImageDraw.Draw(img)

    font = load_font(int(px * glyph_ratio))
    # 用实际渲染出来的包围盒居中，比按字号估算准得多
    left, top, right, bottom = draw.textbbox((0, 0), GLYPH, font=font)
    x = (px - (right - left)) / 2 - left
    y = (px - (bottom - top)) / 2 - top

    draw.text((x, y), GLYPH, font=font, fill=FG)
    img.save(path, "PNG", optimize=True)
    print(f"  {os.path.basename(path):<28} {px}x{px}  ({os.path.getsize(path):,} 字节)")


def main() -> None:
    os.makedirs(OUT_DIR, exist_ok=True)
    print("生成图标：")

    # 浏览器读 manifest 时要用的两个标准尺寸
    make_icon(192, 0.52, os.path.join(OUT_DIR, "icon-192.png"))
    make_icon(512, 0.52, os.path.join(OUT_DIR, "icon-512.png"))

    # Android 自适应图标：字要缩到安全区以内，否则圆形裁切会切掉笔画
    make_icon(512, 0.34, os.path.join(OUT_DIR, "icon-maskable-512.png"))

    # iOS 的 apple-touch-icon。iOS 会自己加圆角，
    # 所以这里必须给不透明的满幅底色 —— 透明底在 iOS 上会变成黑块。
    make_icon(180, 0.52, os.path.join(OUT_DIR, "apple-icon.png"))

    # 浏览器标签页用的小图标
    make_icon(32, 0.60, os.path.join(OUT_DIR, "icon-32.png"))

    print("完成。")


if __name__ == "__main__":
    sys.exit(main())
