import os
import re
from PIL import Image

# ================= 配置区域 =================
# 1. 图片所在的文件夹路径
image_folder = r"D:\社团练习\美术资源\美术\Free Sky Backgrounds\free-sky-with-clouds-background-pixel-art-set\Clouds" 

# 2. 生成的 GIF 保存路径和名字
output_gif_path = r"D:\BlogFlie\Yurisachan.github.io\source\img\pixel-sky.gif"

# 3. 动画速度 (每帧停留的毫秒数，越小越快)
# 100ms = 0.1秒，大概是 10fps。如果不流畅可以调小到 50-80
duration = 100 

# 4. 缩放倍数 (像素图原图通常很小，建议放大 2-3 倍，否则在 4K 屏会糊)
scale_factor = 3 
# ===========================================

def natural_sort_key(s):
    return [int(text) if text.isdigit() else text.lower()
            for text in re.split(r'(\d+)', s)]

def create_gif():
    if not os.path.exists(image_folder):
        print("错误：找不到文件夹")
        return

    # 获取所有图片
    images = [img for img in os.listdir(image_folder) if img.endswith((".png", ".jpg"))]
    images.sort(key=natural_sort_key) # 排序

    if not images:
        print("文件夹里没图！")
        return

    frames = []
    print(f"找到 {len(images)} 帧，正在处理...")

    for image_name in images:
        image_path = os.path.join(image_folder, image_name)
        with Image.open(image_path) as img:
            # 1. 转换为 RGBA (防止格式问题)
            frame = img.convert("RGBA")
            
            # 2. 像素风无损放大 (Nearest Neighbor)
            if scale_factor > 1:
                new_size = (frame.width * scale_factor, frame.height * scale_factor)
                frame = frame.resize(new_size, Image.Resampling.NEAREST)
            
            frames.append(frame)

    # 保存 GIF
    print("正在生成 GIF，请稍候...")
    frames[0].save(
        output_gif_path,
        format="GIF",
        append_images=frames[1:], # 把剩下的帧接在第一帧后面
        save_all=True,
        duration=duration,
        loop=0, # 0 代表无限循环
        optimize=False, # 像素风不建议开启压缩优化，可能会导致色块
        disposal=2 
    )
    print(f"🎉 成功！文件已保存到: {output_gif_path}")

if __name__ == "__main__":
    create_gif()