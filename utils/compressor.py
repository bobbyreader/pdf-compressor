# -*- coding: utf-8 -*-
"""PDF 压缩核心逻辑"""

import subprocess
import os
import uuid
import shutil
from utils.env_checker import get_gs_command


# 三档压缩对应的 Ghostscript 参数
QUALITY_SETTINGS = {
    "light": {
        "label": "轻度压缩",
        "pdf_settings": "/prepress",
        "description": "高质量，较小压缩",
    },
    "standard": {
        "label": "标准压缩",
        "pdf_settings": "/ebook",
        "description": "中等质量和大小",
    },
    "extreme": {
        "label": "极限压缩",
        "pdf_settings": "/screen",
        "description": "最低质量，最大压缩",
    },
}


def compress_pdf(input_path, output_path, quality="standard"):
    """
    使用 Ghostscript 压缩单个 PDF 文件

    Args:
        input_path: 输入 PDF 文件路径
        output_path: 输出 PDF 文件路径
        quality: 压缩级别 (light / standard / extreme)

    Returns:
        dict: {"original_size": int, "compressed_size": int, "ratio": float, "success": bool, "error": str}
    """
    gs_cmd = get_gs_command()
    if not gs_cmd:
        return {
            "success": False,
            "error": "Ghostscript 未安装，无法压缩",
            "original_size": 0,
            "compressed_size": 0,
            "ratio": 0,
        }

    settings = QUALITY_SETTINGS.get(quality, QUALITY_SETTINGS["standard"])

    original_size = os.path.getsize(input_path)

    try:
        # 构建 Ghostscript 命令
        cmd = [
            gs_cmd,
            "-dBATCH",
            "-dNOPAUSE",
            "-dQUIET",
            f"-dPDFSETTINGS={settings['pdf_settings']}",
            "-dCompatibilityLevel=1.4",
            "-dCompressFonts=true",
            "-dSubsetFonts=true",
            "-dEmbedAllFonts=true",
            "-sDEVICE=pdfwrite",
            f"-sOutputFile={output_path}",
            input_path,
        ]

        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=120,
        )

        if result.returncode != 0:
            return {
                "success": False,
                "error": f"Ghostscript 执行失败: {result.stderr[:500]}",
                "original_size": original_size,
                "compressed_size": 0,
                "ratio": 0,
            }

        if not os.path.isfile(output_path):
            return {
                "success": False,
                "error": "压缩后文件未生成",
                "original_size": original_size,
                "compressed_size": 0,
                "ratio": 0,
            }

        compressed_size = os.path.getsize(output_path)

        # 如果压缩后反而更大，则复制原文件
        if compressed_size >= original_size:
            shutil.copy2(input_path, output_path)
            compressed_size = original_size

        ratio = round((1 - compressed_size / original_size) * 100, 1) if original_size > 0 else 0

        return {
            "success": True,
            "error": "",
            "original_size": original_size,
            "compressed_size": compressed_size,
            "ratio": ratio,
        }

    except subprocess.TimeoutExpired:
        return {
            "success": False,
            "error": "压缩超时（120秒）",
            "original_size": original_size,
            "compressed_size": 0,
            "ratio": 0,
        }
    except Exception as e:
        return {
            "success": False,
            "error": str(e),
            "original_size": original_size,
            "compressed_size": 0,
            "ratio": 0,
        }


def batch_compress(files_info, quality="standard", output_dir=None):
    """
    批量压缩 PDF 文件

    Args:
        files_info: list of {"filename": str, "filepath": str}
        quality: 压缩级别
        output_dir: 输出目录（默认为桌面）

    Returns:
        list: 每个文件的压缩结果
    """
    if output_dir is None:
        output_dir = os.path.join(os.path.expanduser("~"), "Desktop")

    os.makedirs(output_dir, exist_ok=True)

    results = []
    for info in files_info:
        input_path = info["filepath"]
        filename = info["filename"]
        name, ext = os.path.splitext(filename)
        output_filename = f"{name}_compressed{ext}"
        output_path = os.path.join(output_dir, output_filename)

        result = compress_pdf(input_path, output_path, quality)
        result["filename"] = filename
        result["output_filename"] = output_filename
        result["output_path"] = output_path
        result["quality_label"] = QUALITY_SETTINGS.get(quality, QUALITY_SETTINGS["standard"])["label"]
        results.append(result)

        # 清理临时上传文件
        try:
            os.remove(input_path)
        except Exception:
            pass

    return results
