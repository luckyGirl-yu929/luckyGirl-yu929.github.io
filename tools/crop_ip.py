# -*- coding: utf-8 -*-
"""IP 三视图处理：裁切三个视角 + 白底转透明 + 生成 favicon"""
from PIL import Image, ImageDraw
import numpy as np
import os

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(BASE, "assets", "ip-threeview.jpg")
OUT = os.path.join(BASE, "assets")
FILL = (255, 0, 255)  # 洋红作为“已删除背景”标记


def crop_and_transparent(img):
    """从四角 floodfill 清除白色背景，返回 RGBA 图"""
    im = img.convert("RGB")
    w, h = im.size
    corners = [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1),
               (w // 2, 0), (w // 2, h - 1)]
    for xy in corners:
        try:
            ImageDraw.floodfill(im, xy, FILL, thresh=45)
        except Exception:
            pass
    rgba = im.convert("RGBA")
    arr = np.array(rgba)
    mask = (arr[:, :, 0] == 255) & (arr[:, :, 1] == 0) & (arr[:, :, 2] == 255)
    arr[mask, 3] = 0
    out = Image.fromarray(arr, "RGBA")
    # 按非透明区域裁紧
    alpha = out.split()[3]
    bbox = alpha.point(lambda p: 255 if p > 10 else 0).getbbox()
    if bbox:
        out = out.crop(bbox)
    return out


def save_favicon(front):
    """取头部区域做方形 favicon"""
    w, h = front.size
    head_h = int(h * 0.42)
    head = front.crop((0, 0, w, head_h))
    hw, hh = head.size
    side = min(hw, hh)
    left = (hw - side) // 2
    head = head.crop((left, 0, left + side, side)).resize((128, 128), Image.LANCZOS)
    head.save(os.path.join(OUT, "favicon.png"))


def main():
    img = Image.open(SRC)
    w, h = img.size
    print("source size:", w, h)

    thirds = [
        ("ip-front.png", img.crop((0, 0, w // 3, h))),
        ("ip-side.png", img.crop((w // 3, 0, 2 * w // 3, h))),
        ("ip-back.png", img.crop((2 * w // 3, 0, w, h))),
    ]
    results = {}
    for name, piece in thirds:
        cut = crop_and_transparent(piece)
        # 统一缩放到高 760px
        scale = 760 / cut.height
        cut = cut.resize((int(cut.width * scale), 760), Image.LANCZOS)
        cut.save(os.path.join(OUT, name))
        results[name] = cut.size
        print(name, "->", cut.size)

    save_favicon(Image.open(os.path.join(OUT, "ip-front.png")))
    print("favicon.png saved")


if __name__ == "__main__":
    main()
