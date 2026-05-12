/**
 * PDF 压缩工具 - 纯前端版本 (增强版)
 * 使用 PDF.js + Canvas 重绘页面 + 图片压缩
 */

const QUALITY_SETTINGS = {
    light: {
        label: "轻度压缩",
        desc: "几乎无损 · 体积略小",
        jpegQuality: 0.95,
        scale: 1.0,
    },
    standard: {
        label: "标准压缩",
        desc: "良好平衡 · 推荐使用",
        jpegQuality: 0.85,
        scale: 1.0,
    },
    extreme: {
        label: "强力压缩",
        desc: "最小体积 · 保持可读",
        jpegQuality: 0.7,
        scale: 1.0,
    },
};

// 全局状态
let selectedFiles = [];
let currentQuality = "standard";
let processingFiles = new Map();

// PDF.js 全局变量
let pdfjsLib = null;
let pdfDocLib = null;

// ===== 工具函数 =====
function formatSize(bytes) {
    if (bytes === 0) return "0 B";
    const units = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + " " + units[i];
}

function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
}

function showToast(msg, type = "success") {
    const toast = document.getElementById("toast");
    toast.textContent = msg;
    toast.className = `toast ${type} show`;
    setTimeout(() => toast.classList.remove("show"), 3000);
}

function updateStatus(text, type = "ok") {
    const statusBar = document.getElementById("statusBar");
    const statusText = document.getElementById("statusText");
    statusBar.className = `status-bar ${type}`;
    statusText.textContent = text;
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

function isReady() {
    return pdfjsLib && pdfDocLib;
}

function renderFileList() {
    const list = document.getElementById("fileList");
    const btn = document.getElementById("btnCompress");

    if (selectedFiles.length === 0) {
        list.innerHTML = "";
        btn.disabled = !isReady();
        return;
    }

    btn.disabled = !isReady();
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

// ===== PDF.js 页面渲染为 Canvas =====
async function renderPageToCanvas(page, scale, canvas) {
    const viewport = page.getViewport({ scale });

    canvas.width = viewport.width;
    canvas.height = viewport.height;

    const context = canvas.getContext("2d");
    context.fillStyle = "white";
    context.fillRect(0, 0, canvas.width, canvas.height);

    const renderContext = {
        canvasContext: context,
        viewport: viewport,
    };

    await page.render(renderContext).promise;
    return viewport;
}

// ===== 使用 pdf-lib 创建新 PDF =====
async function createCompressedPdfFromCanvases(canvases, settings, pageSize) {
    const { PDFDocument } = pdfDocLib;

    const pdfDoc = await PDFDocument.create();

    for (let i = 0; i < canvases.length; i++) {
        const canvas = canvases[i];
        const imageData = canvas.toDataURL("image/jpeg", settings.jpegQuality);

        // 将 data URL 转换为 bytes
        const base64 = imageData.split(",")[1];
        const imageBytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));

        let image;
        if (canvas.width > canvas.height) {
            image = await pdfDoc.embedJpg(imageBytes);
        } else {
            image = await pdfDoc.embedJpg(imageBytes);
        }

        // 计算页面尺寸
        const pageWidth = canvas.width;
        const pageHeight = canvas.height;

        const page = pdfDoc.addPage([pageWidth, pageHeight]);

        // 绘制图片填满整个页面
        page.drawImage(image, {
            x: 0,
            y: 0,
            width: pageWidth,
            height: pageHeight,
        });
    }

    // 保存并返回 bytes
    const pdfBytes = await pdfDoc.save({
        useObjectStreams: true,
        addDefaultPage: false,
    });

    return pdfBytes;
}

// ===== 备用：仅使用 pdf-lib 的轻量级优化 =====
async function lightCompressPdf(arrayBuffer) {
    const { PDFDocument } = pdfDocLib;
    const pdfDoc = await PDFDocument.load(arrayBuffer, {
        ignoreEncryption: true,
        updateMetadata: false,
    });

    // 移除元数据
    pdfDoc.setTitle("");
    pdfDoc.setAuthor("");
    pdfDoc.setSubject("");
    pdfDoc.setKeywords([]);
    pdfDoc.setProducer("");
    pdfDoc.setCreator("");

    const compressedBytes = await pdfDoc.save({
        useObjectStreams: true,
        addDefaultPage: false,
        preserveEditability: false,
    });

    return compressedBytes;
}

// ===== 核心压缩函数 =====
async function compressSingleFile(file, quality, onProgress) {
    const settings = QUALITY_SETTINGS[quality];
    const originalSize = file.size;

    try {
        const arrayBuffer = await file.arrayBuffer();

        // 加载 PDF
        updateStatus(`正在加载: ${file.name}`, "loading");
        const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
        const pdfDoc = await loadingTask.promise;
        const numPages = pdfDoc.numPages;

        // 创建临时 canvas
        const tempCanvas = document.createElement("canvas");
        const canvases = [];

        // 逐页渲染
        for (let i = 1; i <= numPages; i++) {
            updateStatus(`正在渲染第 ${i}/${numPages} 页...`, "loading");

            if (onProgress) {
                onProgress((i / numPages) * 100, i, numPages);
            }

            const page = await pdfDoc.getPage(i);

            // 获取原始页面尺寸
            const viewport = page.getViewport({ scale: 1 });
            const originalWidth = viewport.width;
            const originalHeight = viewport.height;

            // 根据质量设置缩放
            const targetWidth = Math.round(originalWidth * settings.scale);
            const targetHeight = Math.round(originalHeight * settings.scale);

            tempCanvas.width = targetWidth;
            tempCanvas.height = targetHeight;

            await renderPageToCanvas(page, settings.scale, tempCanvas);
            canvases.push(tempCanvas.cloneNode(false));
            const newCanvas = canvases[canvases.length - 1];
            newCanvas.width = targetWidth;
            newCanvas.height = targetHeight;
            const ctx = newCanvas.getContext("2d");
            ctx.drawImage(tempCanvas, 0, 0, targetWidth, targetHeight);
        }

        updateStatus("正在生成压缩文件...", "loading");

        // 创建压缩后的 PDF
        const compressedBytes = await createCompressedPdfFromCanvases(
            canvases,
            settings,
            null
        );

        const compressedSize = compressedBytes.length;

        // 计算压缩比
        let ratio = 0;
        let message = "";
        let blob;

        if (compressedSize >= originalSize) {
            // 如果压缩后反而更大，尝试轻量级压缩
            updateStatus("正在尝试轻量级优化...", "loading");
            const lightBytes = await lightCompressPdf(arrayBuffer);

            if (lightBytes.length < originalSize) {
                ratio = ((1 - lightBytes.length / originalSize) * 100).toFixed(1);
                blob = new Blob([lightBytes], { type: "application/pdf" });
                compressedSize = lightBytes.length;
                message = "轻量级优化";
            } else {
                ratio = 0;
                blob = new Blob([arrayBuffer], { type: "application/pdf" });
                message = "文件已是最优";
            }
        } else {
            ratio = ((1 - compressedSize / originalSize) * 100).toFixed(1);
            blob = new Blob([compressedBytes], { type: "application/pdf" });
        }

        return {
            success: true,
            originalSize,
            compressedSize,
            ratio: parseFloat(ratio),
            blob,
            filename: file.name.replace(/\.pdf$/i, "_compressed.pdf"),
            message,
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
    if (selectedFiles.length === 0 || !isReady()) return;

    const btn = document.getElementById("btnCompress");
    const progressSection = document.getElementById("progressSection");
    const progressFill = document.getElementById("progressFill");
    const progressLabel = document.getElementById("progressLabel");
    const progressPercent = document.getElementById("progressPercent");
    const progressStatus = document.getElementById("progressStatus");

    btn.disabled = true;
    progressSection.classList.add("show");
    document.getElementById("resultsSection").classList.remove("show");

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

        const result = await compressSingleFile(
            selectedFiles[i],
            currentQuality,
            (pct, page, totalPages) => {
                const overallPct = ((i + pct / 100) / total) * 100;
                progressFill.style.width = `${overallPct.toFixed(0)}%`;
                progressPercent.textContent = `${overallPct.toFixed(0)}%`;
                progressStatus.textContent = `第 ${page}/${totalPages} 页`;
            }
        );

        result.filename = selectedFiles[i].name;
        results.push(result);

        processingFiles.set(i, { status: "done", progress: 100, result });
        renderFileList();

        await new Promise((r) => setTimeout(r, 100));
    }

    progressFill.style.width = "100%";
    progressPercent.textContent = "100%";
    progressLabel.textContent = "压缩完成";
    progressStatus.textContent = `共处理 ${total} 个文件`;

    updateStatus("压缩完成 · 纯浏览器处理，保护隐私", "ok");

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

    if (successResults.length > 1) {
        footer.innerHTML = `<button class="btn-download" onclick="downloadAllFiles()">下载全部文件 (${successResults.length} 个)</button>`;
    } else {
        footer.textContent = "点击上方按钮下载压缩后的文件";
    }

    section.classList.add("show");
    section.scrollIntoView({ behavior: "smooth", block: "start" });

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

    if (successResults.length === 1) {
        downloadFile(0);
        return;
    }

    showToast(`正在下载 ${successResults.length} 个文件...`, "success");

    successResults.forEach((result, i) => {
        setTimeout(() => {
            const index = results.indexOf(result);
            downloadFile(index);
        }, i * 500);
    });
}

// ===== 初始化 PDF.js 和 pdf-lib =====
async function initPdfJs() {
    try {
        updateStatus("正在加载 PDF 处理引擎...", "loading");

        // 加载 PDF.js
        const pdfJsUrl = "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js";
        await new Promise((resolve, reject) => {
            const script = document.createElement("script");
            script.src = pdfJsUrl;
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
        });

        pdfjsLib = window.pdfjsLib;
        pdfjsLib.GlobalWorkerOptions.workerSrc =
            "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";

        // 加载 pdf-lib
        const pdfLibUrl = "https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js";
        await new Promise((resolve, reject) => {
            const script = document.createElement("script");
            script.src = pdfLibUrl;
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
        });

        pdfDocLib = window.PDFLib;

        updateStatus("就绪 · 纯浏览器处理，保护隐私", "ok");
        document.getElementById("btnCompress").disabled = selectedFiles.length === 0;
    } catch (error) {
        console.error("Failed to load libraries:", error);
        updateStatus("PDF 引擎加载失败，请刷新页面重试", "error");
        document.getElementById("btnCompress").disabled = true;
    }
}

// ===== 初始化 =====
document.addEventListener("DOMContentLoaded", () => {
    updateStatus("正在加载 PDF 处理引擎...", "loading");
    initPdfJs();
});
