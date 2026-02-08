import os
import re
from PIL import Image

image_folder = r"D:\社团练习\美术资源\美术\Free Sky Backgrounds\free-sky-with-clouds-background-pixel-art-set\Clouds"
output_gif_path = r"D:\BlogFlie\Yurisachan.github.io\source\img\pixel-sky.gif"
duration = 100
scale_factor = 3


def natural_sort_key(s):
    return [int(text) if text.isdigit() else text.lower() for text in re.split(r"(\d+)", s)]


def create_gif():
    if not os.path.exists(image_folder):
        print("错误：找不到文件夹")
        return

    images = [img for img in os.listdir(image_folder) if img.endswith((".png", ".jpg"))]
    images.sort(key=natural_sort_key)

    if not images:
        print("文件夹里没图！")
        return

    frames = []
    print(f"找到 {len(images)} 帧，正在处理...")

    for image_name in images:
        image_path = os.path.join(image_folder, image_name)
        with Image.open(image_path) as img:
            frame = img.convert("RGBA")
            if scale_factor > 1:
                new_size = (frame.width * scale_factor, frame.height * scale_factor)
                frame = frame.resize(new_size, Image.Resampling.NEAREST)

            frames.append(frame)

    print("正在生成 GIF，请稍候...")
    frames[0].save(
        output_gif_path,
        format="GIF",
        append_images=frames[1:],
        save_all=True,
        duration=duration,
        loop=0,
        optimize=False,
        disposal=2,
    )
    print(f"🎉 成功！文件已保存到: {output_gif_path}")


if __name__ == "__main__":
    create_gif()
