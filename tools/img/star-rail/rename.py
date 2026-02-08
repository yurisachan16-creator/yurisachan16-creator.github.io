import os
import re
from PIL import Image

folder_path = r"D:\BlogFlie\Yurisachan.github.io\source\img\star-rail"


def natural_sort_key(s):
    return [int(text) if text.isdigit() else text.lower() for text in re.split(r"(\d+)", s)]


def batch_process_images():
    if not os.path.exists(folder_path):
        print(f"错误：找不到文件夹 {folder_path}")
        return

    print(f"正在扫描文件夹: {folder_path} ...")

    files = [
        f
        for f in os.listdir(folder_path)
        if f.lower().endswith((".png", ".jpg", ".jpeg", ".bmp"))
    ]
    files.sort(key=natural_sort_key)

    if not files:
        print("文件夹里没有找到图片！")
        return

    print(f"找到 {len(files)} 张图片，准备处理...")

    count = 0
    for index, filename in enumerate(files, 1):
        old_path = os.path.join(folder_path, filename)
        new_filename = f"sr{index}.png"
        new_path = os.path.join(folder_path, new_filename)

        try:
            with Image.open(old_path) as img:
                if img.mode != "RGB" and img.mode != "RGBA":
                    img = img.convert("RGBA")

                img.save(new_path, "PNG")

            if old_path.lower() != new_path.lower():
                os.remove(old_path)

            print(f"处理成功: {filename} -> {new_filename}")
            count += 1

        except Exception as e:
            print(f"处理失败: {filename}, 错误原因: {e}")

    print("-" * 30)
    print(f"全部完成！共处理了 {count} 张图片。")
    print("现在的图片顺序是连贯的：sr1.png, sr2.png, sr3.png ...")


if __name__ == "__main__":
    batch_process_images()
    input("\n按回车键退出...")
