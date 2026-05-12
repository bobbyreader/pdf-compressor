@echo off
chcp 65001 >nul 2>&1
title PDF 压缩工具
echo ====================================================
echo           PDF 压缩工具 - 启动脚本
echo ====================================================
echo.

:: 检查 Python
echo [1/4] 检查 Python 环境...
python --version >nul 2>&1
if errorlevel 1 (
    echo [错误] 未检测到 Python，请先安装 Python 3.8+
    echo 下载地址: https://www.python.org/downloads/
    pause
    exit /b 1
)
echo       Python 已安装 ✓
echo.

:: 安装 Python 依赖
echo [2/4] 安装 Python 依赖...
cd /d "%~dp0"
python -m pip install -r requirements.txt --quiet
if errorlevel 1 (
    echo [警告] 部分依赖安装失败，尝试继续...
)
echo       依赖安装完成 ✓
echo.

:: 检查 Ghostscript
echo [3/4] 检查 Ghostscript...
where gswin64c >nul 2>&1
if errorlevel 1 (
    where gs >nul 2>&1
    if errorlevel 1 (
        echo       Ghostscript 未检测到，尝试自动安装...
        winget install --id ArtifexSoftware.GhostScript.GPL --accept-source-agreements --accept-package-agreements
        if errorlevel 1 (
            echo [警告] Ghostscript 自动安装失败
            echo         请手动安装: https://ghostscript.com/releases/gsdnld.html
            echo         或执行: winget install ArtifexSoftware.GhostScript.GPL
            echo.
        )
    )
)
echo       Ghostscript 检查完成 ✓
echo.

:: 启动服务
echo [4/4] 启动 PDF 压缩服务...
echo.
python app.py
pause
