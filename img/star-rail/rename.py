import os
import re
from PIL import Image

# 1. 设置你的图片文件夹路径 (根据你的截图填写的)
folder_path = r"D:\BlogFlie\Yurisachan.github.io\source\img\star-rail"

def natural_sort_key(s):
    """
    自然排序函数：确保 image2.png 排在 image10.png 前面
    """
    return [int(text) if text.isdigit() else text.lower()
            for text in re.split(r'(\d+)', s)]

def batch_process_images():
    # 检查路径是否存在
    if not os.path.exists(folder_path):
        print(f"错误：找不到文件夹 {folder_path}")
        return

    print(f"正在扫描文件夹: {folder_path} ...")

    # 获取文件夹内所有图片文件
    files = [f for f in os.listdir(folder_path) if f.lower().endswith(('.png', '.jpg', '.jpeg', '.bmp'))]
    
    # 关键步骤：按照文件名中的数字进行自然排序
    # 这样能保证 image1 -> image2 -> ... -> image10 -> ... image39 的顺序
    files.sort(key=natural_sort_key)

    if not files:
        print("文件夹里没有找到图片！")
        return

    print(f"找到 {len(files)} 张图片，准备处理...")

    count = 0
    # 开始循环处理
    for index, filename in enumerate(files, 1): # index 从 1 开始
        old_path = os.path.join(folder_path, filename)
        
        # 设定新名字：前缀 sr + 序号 + 后缀 .png
        new_filename = f"sr{index}.png"
        new_path = os.path.join(folder_path, new_filename)

        try:
            # 1. 打开旧图片
            with Image.open(old_path) as img:
                # 2. 如果是 JPG，转换为 RGBA 或 RGB 模式以保存为 PNG
                if img.mode != 'RGB' and img.mode != 'RGBA':
                    img = img.convert('RGBA')
                
                # 3. 保存为新图片 (格式强制为 PNG)
                # 注意：如果原图就是 sr1.png (比如你之前改过一部分)，这里会直接覆盖，很安全
                img.save(new_path, 'PNG')
            
            # 4. 如果新旧文件名不同（说明发生过改名或格式转换），则删除旧文件
            # 比如从 image5.jpeg 变成了 sr2.png，旧的 jpeg 需要删掉
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