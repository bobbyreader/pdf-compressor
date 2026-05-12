# -*- coding: utf-8 -*-
"""环境检查与自动安装模块"""

import subprocess
import sys
import json
import shutil
import os


def get_ghostscript_path():
    """在常见安装路径中查找 Ghostscript"""
    candidates = [
        r"C:\Program Files\gs\gs10.02.1\bin\gswin64c.exe",
        r"C:\Program Files\gs\gs10.01.1\bin\gswin64c.exe",
        r"C:\Program Files\gs\gs9.56.1\bin\gswin64c.exe",
        r"C:\Program Files\gs\gs9.55.0\bin\gswin64c.exe",
    ]
    for path in candidates:
        if os.path.isfile(path):
            return path
    # 尝试通过 where 命令查找
    result = subprocess.run(
        ["where", "gswin64c"], capture_output=True, text=True, timeout=10
    )
    if result.returncode == 0:
        return result.stdout.strip().splitlines()[0]
    result = subprocess.run(
        ["where", "gs"], capture_output=True, text=True, timeout=10
    )
    if result.returncode == 0:
        return result.stdout.strip().splitlines()[0]
    return None


def check_python():
    """检查 Python 版本"""
    version = sys.version_info
    ok = version >= (3, 8)
    return {
        "name": "Python",
        "installed": True,
        "version": f"{version.major}.{version.minor}.{version.micro}",
        "ok": ok,
        "message": "OK" if ok else f"Python {version.major}.{version.minor} 低于 3.8，请升级",
    }


def check_pip_package(package_name):
    """检查 pip 包是否已安装"""
    try:
        result = subprocess.run(
            [sys.executable, "-m", "pip", "show", package_name],
            capture_output=True, text=True, timeout=30,
        )
        if result.returncode == 0:
            for line in result.stdout.splitlines():
                if line.startswith("Version:"):
                    version = line.split(":", 1)[1].strip()
                    return {"name": package_name, "installed": True, "version": version, "ok": True}
        return {"name": package_name, "installed": False, "version": "", "ok": False}
    except Exception:
        return {"name": package_name, "installed": False, "version": "", "ok": False}


def install_pip_package(package_name):
    """使用 pip 安装包"""
    try:
        result = subprocess.run(
            [sys.executable, "-m", "pip", "install", package_name],
            capture_output=True, text=True, timeout=120,
        )
        if result.returncode == 0:
            return True
        return False
    except Exception:
        return False


def check_ghostscript():
    """检查 Ghostscript 是否已安装"""
    gs_path = get_ghostscript_path()
    if gs_path:
        return {
            "name": "Ghostscript",
            "installed": True,
            "version": "",
            "path": gs_path,
            "ok": True,
            "message": "OK",
        }
    return {
        "name": "Ghostscript",
        "installed": False,
        "version": "",
        "path": "",
        "ok": False,
        "message": "Ghostscript 未安装。正在尝试自动安装...",
    }


def install_ghostscript():
    """尝试使用 winget 安装 Ghostscript"""
    try:
        result = subprocess.run(
            ["winget", "install", "--id", "ArtifexSoftware.GhostScript.GPL", "--accept-source-agreements", "--accept-package-agreements"],
            capture_output=True, text=True, timeout=300,
        )
        if result.returncode == 0:
            return True
        return False
    except Exception:
        return False


def run_env_check(auto_install=True):
    """
    执行完整环境检查
    返回: (all_ok, results)
    """
    results = []

    # 检查 Python
    py = check_python()
    results.append(py)
    if not py["ok"]:
        return False, results

    # 检查并安装 pip 包
    packages = ["flask", "werkzeug"]
    for pkg in packages:
        pkg_info = check_pip_package(pkg)
        if not pkg_info["installed"] and auto_install:
            success = install_pip_package(pkg)
            if success:
                pkg_info = check_pip_package(pkg)
                pkg_info["auto_installed"] = True
            else:
                pkg_info["auto_installed"] = False
        results.append(pkg_info)

    # 检查 Ghostscript
    gs = check_ghostscript()
    if not gs["installed"] and auto_install:
        success = install_ghostscript()
        if success:
            gs = check_ghostscript()
            if gs["installed"]:
                gs["auto_installed"] = True
        else:
            gs["auto_installed"] = False
    results.append(gs)

    all_ok = all(r["ok"] for r in results)
    return all_ok, results


def get_gs_command():
    """获取 Ghostscript 命令路径"""
    gs_path = get_ghostscript_path()
    if gs_path:
        return gs_path
    return None
