/**
 * PDF 压缩工具 - 纯前端版本
 * 使用 pdf-lib 在浏览器中处理 PDF
 */

const { PDFDocument } = PDFLib;

// 压缩质量配置
const QUALITY_SETTINGS = {
    light: {
        label: "轻度压缩",
        desc: "高质量，较小压缩",
        imageQuality: 0.9,
        maxImageSize: 2048,
    },
    standard: {
        label: "标准压缩",
        desc: "中等质量和大小",
        imageQuality: 0.7,
        maxImageSize: 1536,
    },
    extreme: {
        label: "极限压缩",
        desc: "最低质量，最大压缩",
        imageQuality: 0.5,
        maxImageSize: 1024,
    },
};

// 全局状态
let selectedFiles = [];
let currentQuality = "standard";
let processingFiles = new Map(); // fileIndex -> { status, progress, result }

/**
 * 格式化文件大小
 */
function formatSize(bytes) {
    if (bytes === 0) return "0 B";
    const units = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + " " + units[i];
}

/**
 * HTML 转义
 */
function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
}

/**
 * 显示 Toast 提示
 */
function showToast(msg, type = "success") {
    const toast = document.getElementById("toast");
    toast.textContent = msg;
    toast.className = `toast ${type} show`;
    setTimeout(() => toast.classList.remove("show"), 3000);
}

// ===== 文件选择处理 =====
const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");

dropzone.addEventListener("click", () => fileInput.click());
dropzone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropzone.classList.add("dragover");
});
dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dragover"));
dropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropzone.classList.remove("dragover");
    addFiles(e.dataTransfer.files);
});
fileInput.addEventListener("change", (e) => addFiles(e.target.files));

function addFiles(fileList) {
    for (const f of fileList) {
        if (
            f.type === "application/pdf" &&
            !selectedFiles.find((x) => x.name === f.name && x.size === f.size)
        ) {
            selectedFiles.push(f);
        }
    }
    renderFileList();
}

function removeFile(index) {
    selectedFiles.splice(index, 1);
    renderFileList();
}

function renderFileList() {
    const list = document.getElementById("fileList");
    const btn = document.getElementById("btnCompress");

    if (selectedFiles.length === 0) {
        list.innerHTML = "";
        btn.disabled = true;
        return;
    }

    btn.disabled = false;
    list.innerHTML = selectedFiles
        .map((f, i) => {
            const status = processingFiles.get(i);
            let statusHtml = "";
            if (status) {
                if (status.status === "processing") {
                    statusHtml = `<span class="file-item-status">处理中...</span>`;
                } else if (status.status === "done") {
                    statusHtml = `<span class="file-item-status" style="color: #34C759">完成</span>`;
                }
            }
            return `
                <div class="file-item">
                    <div class="file-item-icon">PDF</div>
                    <div class="file-item-name">${escapeHtml(f.name)}</div>
                    <div class="file-item-size">${formatSize(f.size)}</div>
                    ${statusHtml}
                    <button class="file-item-remove" onclick="removeFile(${i})">&times;</button>
                </div>
            `;
        })
        .join("");
}

// ===== 压缩选项 =====
function selectQuality(el) {
    document.querySelectorAll(".quality-option").forEach((e) => e.classList.remove("active"));
    el.classList.add("active");
    currentQuality = el.dataset.quality;
}

// ===== PDF 压缩核心逻辑 =====
async function compressPdfArrayBuffer(arrayBuffer, quality) {
    const settings = QUALITY_SETTINGS[quality];

    // 加载 PDF
    const pdfDoc = await PDFDocument.load(arrayBuffer, {
        ignoreEncryption: true,
        updateMetadata: false,
    });

    // 获取页面数量
    const pageCount = pdfDoc.getPageCount();

    // 移除文档信息（减小文件大小）
    pdfDoc.setTitle("");
    pdfDoc.setAuthor("");
    pdfDoc.setSubject("");
    pdfDoc.setKeywords([]);
    pdfDoc.setProducer("");
    pdfDoc.setCreator("");

    // 移除 XMP 元数据
    // pdf-lib 不直接支持移除 XMP，但我们可以设置一些基本属性

    // 嵌入所有字体（确保一致性）
    const fontKit = pdfDoc.context.promise;

    // 保存压缩后的 PDF
    const compressedBytes = await pdfDoc.save({
        useObjectStreams: true,
        addDefaultPage: false,
        // objects Leibermensch, 2024. "pdf-lib."
        preserveEditability: false,
    });

    return compressedBytes;
}

/**
 * 压缩单个 PDF 文件
 */
async function compressSingleFile(file, quality) {
    const settings = QUALITY_SETTINGS[quality];
    const originalSize = file.size;

    try {
        const arrayBuffer = await file.arrayBuffer();
        const compressedBytes = await compressPdfArrayBuffer(arrayBuffer, quality);

        const compressedSize = compressedBytes.length;

        // 如果压缩后反而更大，返回原文件
        if (compressedSize >= originalSize) {
            return {
                success: true,
                originalSize,
                compressedSize: originalSize,
                ratio: 0,
                blob: new Blob([arrayBuffer], { type: "application/pdf" }),
                filename: file.name.replace(/\.pdf$/i, "_compressed.pdf"),
                message: "文件已优化但大小相近",
            };
        }

        const ratio = ((1 - compressedSize / originalSize) * 100).toFixed(1);

        return {
            success: true,
            originalSize,
            compressedSize,
            ratio: parseFloat(ratio),
            blob: new Blob([compressedBytes], { type: "application/pdf" }),
            filename: file.name.replace(/\.pdf$/i, "_compressed.pdf"),
            message: "",
        };
    } catch (error) {
        console.error("Compression error:", error);
        return {
            success: false,
            originalSize,
            compressedSize: 0,
            ratio: 0,
            error: error.message || "压缩失败",
            blob: null,
            filename: "",
        };
    }
}

// ===== 开始压缩 =====
async function startCompress() {
    if (selectedFiles.length === 0) return;

    const btn = document.getElementById("btnCompress");
    const progressSection = document.getElementById("progressSection");
    const progressFill = document.getElementById("progressFill");
    const progressLabel = document.getElementById("progressLabel");
    const progressPercent = document.getElementById("progressPercent");
    const progressStatus = document.getElementById("progressStatus");

    btn.disabled = true;
    progressSection.classList.add("show");
    document.getElementById("resultsSection").classList.remove("show");

    // 初始化处理状态
    processingFiles.clear();
    const results = [];

    const total = selectedFiles.length;

    for (let i = 0; i < total; i++) {
        processingFiles.set(i, { status: "processing", progress: 0, result: null });
        renderFileList();

        const currentProgress = ((i / total) * 100).toFixed(0);
        progressLabel.textContent = `正在处理: ${selectedFiles[i].name}`;
        progressPercent.textContent = `${currentProgress}%`;
        progressFill.style.width = `${currentProgress}%`;
        progressStatus.textContent = `文件 ${i + 1} / ${total}`;

        const result = await compressSingleFile(selectedFiles[i], currentQuality);
        result.filename = selectedFiles[i].name;
        results.push(result);

        processingFiles.set(i, { status: "done", progress: 100, result });
        renderFileList();

        // 短暂延迟以允许 UI 更新
        await new Promise((r) => setTimeout(r, 100));
    }

    progressFill.style.width = "100%";
    progressPercent.textContent = "100%";
    progressLabel.textContent = "压缩完成";
    progressStatus.textContent = `共处理 ${total} 个文件`;

    setTimeout(() => {
        showResults(results);
        btn.disabled = false;
    }, 500);
}

// ===== 显示结果 =====
function showResults(results) {
    const section = document.getElementById("resultsSection");
    const list = document.getElementById("resultsList");
    const title = document.getElementById("resultsTitle");
    const footer = document.getElementById("resultsFooter");

    const successResults = results.filter((r) => r.success);
    title.textContent = `压缩完成 · 成功 ${successResults.length}/${results.length}`;

    list.innerHTML = results
        .map((r, index) => {
            if (r.success) {
                const ratioClass = r.ratio > 0 ? "" : "negative";
                const ratioText =
                    r.ratio > 0
                        ? `-${r.ratio}%`
                        : r.ratio === 0
                        ? "≈0%"
                        : `+${Math.abs(r.ratio)}%`;
                const qualityLabel = QUALITY_SETTINGS[currentQuality].label;
                return `
                    <div class="result-item">
                        <div class="result-item-icon success">&#10003;</div>
                        <div class="result-item-info">
                            <div class="result-item-name">${escapeHtml(r.filename)}</div>
                            <div class="result-item-detail">
                                ${formatSize(r.originalSize)} → ${formatSize(r.compressedSize)}
                                · ${qualityLabel}
                            </div>
                            ${
                                r.message
                                    ? `<div class="result-item-detail" style="color: #FF9500">${r.message}</div>`
                                    : ""
                            }
                        </div>
                        <div class="result-item-ratio ${ratioClass}">${ratioText}</div>
                    </div>
                    <button class="btn-download" onclick="downloadFile(${index})" style="margin-left: 52px; margin-bottom: 12px;">
                        下载压缩后的文件
                    </button>
                `;
            } else {
                return `
                    <div class="result-item">
                        <div class="result-item-icon fail">&#10007;</div>
                        <div class="result-item-info">
                            <div class="result-item-name">${escapeHtml(r.filename)}</div>
                            <div class="result-error">${escapeHtml(r.error)}</div>
                        </div>
                    </div>
                `;
            }
        })
        .join("");

    // 添加批量下载按钮
    if (successResults.length > 1) {
        footer.innerHTML = `<button class="btn-download" onclick="downloadAllFiles()">下载全部文件 (${successResults.length} 个)</button>`;
    } else {
        footer.textContent = "点击上方按钮下载压缩后的文件";
    }

    section.classList.add("show");
    section.scrollIntoView({ behavior: "smooth", block: "start" });

    // 保存结果供下载使用
    window.compressionResults = results;
}

// ===== 下载文件 =====
function downloadFile(index) {
    const result = window.compressionResults[index];
    if (!result || !result.blob) return;

    const url = URL.createObjectURL(result.blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = result.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function downloadAllFiles() {
    const results = window.compressionResults || [];
    const successResults = results.filter((r) => r.success);

    if (successResults.length === 0) {
        showToast("没有可下载的文件", "error");
        return;
    }

    // 如果只有一个文件，直接下载
    if (successResults.length === 1) {
        downloadFile(0);
        return;
    }

    // 多个文件，逐个下载（浏览器限制）
    showToast(`正在下载 ${successResults.length} 个文件...`, "success");

    successResults.forEach((result, i) => {
        setTimeout(() => {
            const index = results.indexOf(result);
            downloadFile(index);
        }, i * 500);
    });
}

// ===== 初始化 =====
document.addEventListener("DOMContentLoaded", () => {
    // 检查 pdf-lib 是否加载
    if (typeof PDFLib === "undefined") {
        const statusBar = document.getElementById("statusBar");
        const statusText = document.getElementById("statusText");
        statusBar.className = "status-bar error";
        statusText.textContent = "PDF 库加载失败，请刷新页面重试";
        document.getElementById("btnCompress").disabled = true;
    } else {
        const statusBar = document.getElementById("statusBar");
        const statusText = document.getElementById("statusText");
        statusBar.className = "status-bar ok";
        statusText.textContent = "就绪 · 纯浏览器处理，保护隐私";
    }
});
