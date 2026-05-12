# -*- coding: utf-8 -*-
"""Flask 主应用 - PDF 压缩工具"""

import os
import uuid
from flask import Flask, render_template, request, jsonify
from werkzeug.utils import secure_filename
from utils.env_checker import run_env_check
from utils.compressor import batch_compress, QUALITY_SETTINGS

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 200 * 1024 * 1024  # 200MB 上传限制
app.config["UPLOAD_FOLDER"] = os.path.join(os.path.dirname(os.path.abspath(__file__)), "output")
ALLOWED_EXTENSIONS = {"pdf"}


def allowed_file(filename):
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/check-env")
def check_env():
    """检查环境状态"""
    all_ok, results = run_env_check(auto_install=True)
    return jsonify({
        "ok": all_ok,
        "details": results,
    })


@app.route("/api/compress", methods=["POST"])
def compress():
    """上传并压缩 PDF 文件"""
    # 检查是否有文件
    if "files" not in request.files:
        return jsonify({"success": False, "error": "未选择文件"}), 400

    files = request.files.getlist("files")
    if not files or all(f.filename == "" for f in files):
        return jsonify({"success": False, "error": "未选择文件"}), 400

    quality = request.form.get("quality", "standard")
    if quality not in QUALITY_SETTINGS:
        quality = "standard"

    # 保存上传文件到临时目录
    upload_dir = app.config["UPLOAD_FOLDER"]
    os.makedirs(upload_dir, exist_ok=True)

    files_info = []
    for f in files:
        if f.filename == "" or not allowed_file(f.filename):
            continue
        original_name = f.filename
        unique_name = f"{uuid.uuid4().hex}_{secure_filename(original_name)}"
        filepath = os.path.join(upload_dir, unique_name)
        f.save(filepath)
        files_info.append({"filename": original_name, "filepath": filepath})

    if not files_info:
        return jsonify({"success": False, "error": "没有有效的 PDF 文件"}), 400

    # 执行压缩
    results = batch_compress(files_info, quality=quality)

    success_count = sum(1 for r in results if r["success"])
    return jsonify({
        "success": success_count > 0,
        "total": len(results),
        "success_count": success_count,
        "fail_count": len(results) - success_count,
        "results": results,
    })


if __name__ == "__main__":
    os.makedirs(app.config["UPLOAD_FOLDER"], exist_ok=True)
    print("=" * 50)
    print("  PDF 压缩工具已启动")
    print("  请在浏览器中打开: http://127.0.0.1:5000")
    print("=" * 50)
    app.run(host="127.0.0.1", port=5000, debug=False)
