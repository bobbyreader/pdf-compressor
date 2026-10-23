/**
 * PDF 压缩工具 - 纯前端版（保真重构）
 *
 * 保真模式（默认三档）：只重压缩 PDF 内嵌的图片流（JPEG 重编码 / 原始像素重编码），
 * 文字、矢量、链接、表单、书签全部原样保留。库文件全部本地加载（vendor/），不依赖 CDN。
 * 图片化模式：把整页渲染为 JPEG 再重组，仅适合扫描件（文字会不可选），保留作可选项。
 */

const MODES = {
    light: {
        label: "轻度压缩",
        desc: "保留文字 · 图片高质量",
        engine: "fidelity",
        jpegQuality: 0.9,
        maxDim: 4096,
    },
    standard: {
        label: "标准压缩",
        desc: "保留文字 · 平衡推荐",
        engine: "fidelity",
        jpegQuality: 0.8,
        maxDim: 2560,
    },
    extreme: {
        label: "强力压缩",
        desc: "保留文字 · 图片更小",
        engine: "fidelity",
        jpegQuality: 0.62,
        maxDim: 1600,
    },
    raster: {
        label: "整页图片化",
        desc: "仅适合扫描件 · 文字不可选",
        engine: "raster",
        jpegQuality: 0.6,
        scale: 1.5,
    },
};

// 全局状态
let selectedFiles = [];
let currentMode = "standard";
let processingFiles = new Map();

// 库全局变量（本地 vendor/ 加载）
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

function friendlyError(error) {
    const msg = (error && error.message) || String(error || "未知错误");
    if (/encrypt|password/i.test(msg)) return "该 PDF 已加密，无法处理";
    if (/invalid|malformed|parse|header/i.test(msg)) return "PDF 文件损坏或格式不受支持";
    return msg;
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
    let rejected = 0;
    for (const f of fileList) {
        const isPdf = f.type === "application/pdf" || /\.pdf$/i.test(f.name);
        if (isPdf && !selectedFiles.find((x) => x.name === f.name && x.size === f.size)) {
            selectedFiles.push(f);
        } else {
            rejected++;
        }
    }
    if (rejected > 0) showToast(`已忽略 ${rejected} 个非 PDF 或重复文件`, "error");
    renderFileList();
}

function removeFile(index) {
    selectedFiles.splice(index, 1);
    processingFiles.clear();
    renderFileList();
}

function isReady() {
    return pdfjsLib && pdfDocLib;
}

function renderFileList() {
    const list = document.getElementById("fileList");
    const btn = document.getElementById("btnCompress");

    btn.disabled = !isReady() || selectedFiles.length === 0;
    if (selectedFiles.length === 0) {
        list.innerHTML = "";
        return;
    }

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

// ===== 模式选择 =====
function selectQuality(el) {
    document.querySelectorAll(".quality-option").forEach((e) => e.classList.remove("active"));
    el.classList.add("active");
    currentMode = el.dataset.quality;
}

// ===== 保真引擎：只重压缩内嵌图片，文字/矢量/结构原样保留 =====

function dictNumber(dict, key) {
    const { PDFName } = pdfDocLib;
    const v = dict.lookup(PDFName.of(key));
    return v && typeof v.asNumber === "function" ? v.asNumber() : null;
}

function dictNameString(dict, key) {
    const { PDFName } = pdfDocLib;
    const v = dict.lookup(PDFName.of(key));
    return v ? v.toString() : null;
}

function dictFilterList(dict) {
    const { PDFName, PDFArray } = pdfDocLib;
    const v = dict.lookup(PDFName.of("Filter"));
    if (!v) return [];
    if (v instanceof PDFArray) {
        const out = [];
        for (let i = 0; i < v.size(); i++) out.push(v.get(i).toString());
        return out;
    }
    return [v.toString()];
}

function dictDecodeParms(dict) {
    const { PDFName, PDFArray, PDFDict } = pdfDocLib;
    let v = dict.lookup(PDFName.of("DecodeParms")) || dict.lookup(PDFName.of("DP"));
    if (v instanceof PDFArray) v = v.size() > 0 ? v.get(0) : null;
    return v instanceof PDFDict ? v : null;
}

function canvasToJpegBytes(canvas, quality) {
    return new Promise((resolve, reject) => {
        canvas.toBlob(
            async (blob) => {
                if (!blob) return reject(new Error("JPEG 编码失败"));
                resolve(new Uint8Array(await blob.arrayBuffer()));
            },
            "image/jpeg",
            quality
        );
    });
}

function drawBitmapToJpeg(source, srcW, srcH, settings) {
    const scale = Math.min(1, settings.maxDim / Math.max(srcW, srcH));
    const w = Math.max(1, Math.round(srcW * scale));
    const h = Math.max(1, Math.round(srcH * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(source, 0, 0, w, h);
    return canvasToJpegBytes(canvas, settings.jpegQuality).then((bytes) => ({ bytes, width: w, height: h }));
}

async function inflateZlib(bytes) {
    if (typeof DecompressionStream === "undefined") throw new Error("浏览器不支持解压");
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

// 行字节数推断：/Columns 的口径在不同生成器下不一致（样本数/像素数都有），
// 用数据总长与行数反推最可靠，推不出时用 宽×分量数。
function inferRowBytes(dataLength, predictor, width, colors, columns, height) {
    const candidates = [];
    for (const c of [width * colors, columns || 0, (columns || 0) * colors]) {
        if (c > 0 && !candidates.includes(c)) candidates.push(c);
    }
    if (height > 0) {
        for (const c of candidates) {
            if (predictor >= 10 && dataLength === (c + 1) * height) return c;
            if (predictor < 10 && dataLength === c * height) return c;
        }
    }
    return width * colors;
}

// PNG/TIFF 预测器还原（仅 8 bpc）
function unprediction(data, predictor, width, colors, columns, height) {
    const rowBytes = inferRowBytes(data.length, predictor, width, colors, columns, height);
    const bpp = Math.max(1, colors);
    if (predictor === 2) {
        const out = new Uint8Array(data.length);
        for (let rowStart = 0; rowStart + rowBytes <= data.length; rowStart += rowBytes) {
            for (let i = 0; i < rowBytes; i++) {
                const left = i >= bpp ? out[rowStart + i - bpp] : 0;
                out[rowStart + i] = (data[rowStart + i] + left) & 0xff;
            }
        }
        return out;
    }
    if (predictor >= 10) {
        const rows = Math.floor(data.length / (rowBytes + 1));
        const out = new Uint8Array(rowBytes * rows);
        let prevRow = new Uint8Array(rowBytes);
        let src = 0;
        for (let r = 0; r < rows; r++) {
            const filter = data[src++];
            const row = data.subarray(src, src + rowBytes);
            src += rowBytes;
            const cur = new Uint8Array(rowBytes);
            for (let i = 0; i < rowBytes; i++) {
                const a = i >= bpp ? cur[i - bpp] : 0;
                const b = prevRow[i];
                const c = i >= bpp ? prevRow[i - bpp] : 0;
                let v = row[i];
                if (filter === 1) v = (v + a) & 0xff;
                else if (filter === 2) v = (v + b) & 0xff;
                else if (filter === 3) v = (v + ((a + b) >> 1)) & 0xff;
                else if (filter === 4) {
                    const p = a + b - c;
                    const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
                    const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
                    v = (v + pr) & 0xff;
                } else if (filter !== 0) {
                    throw new Error("未知 PNG 预测器");
                }
                cur[i] = v;
            }
            out.set(cur, r * rowBytes);
            prevRow = cur;
        }
        return out;
    }
    return data;
}

// 把原始像素（RGB/Gray, 8bpc）绘制并重编码为 JPEG
async function reencodeRawPixels(raw, width, height, colors, settings) {
    const expected = width * height * colors;
    if (raw.length < expected) throw new Error("像素数据不完整");
    const imageData = new ImageData(width, height);
    const px = imageData.data;
    for (let i = 0, j = 0; i < expected; i += colors, j += 4) {
        if (colors === 3) {
            px[j] = raw[i]; px[j + 1] = raw[i + 1]; px[j + 2] = raw[i + 2];
        } else {
            px[j] = px[j + 1] = px[j + 2] = raw[i];
        }
        px[j + 3] = 255;
    }
    const bitmap = await createImageBitmap(imageData);
    try {
        return await drawBitmapToJpeg(bitmap, width, height, settings);
    } finally {
        bitmap.close && bitmap.close();
    }
}

// 处理单个图片流；返回 {replaced:boolean, oldSize, newSize} 或抛出跳过原因
async function recompressImageStream(context, ref, stream, settings) {
    const { PDFName, PDFRawStream } = pdfDocLib;
    const dict = stream.dict;
    const width = dictNumber(dict, "Width");
    const height = dictNumber(dict, "Height");
    if (!width || !height) throw new Error("缺少尺寸");
    if (width * height > 80 * 1000 * 1000) throw new Error("图片过大");
    if (dict.get(PDFName.of("SMask")) || dict.get(PDFName.of("Mask"))) throw new Error("带透明/遮罩，保留原图");
    if (dictNameString(dict, "ImageMask") === "true") throw new Error("遮罩图，保留原图");

    const rawBytes = stream.getContents();
    const filters = dictFilterList(dict);
    const colorSpace = dictNameString(dict, "ColorSpace");
    const bpc = dictNumber(dict, "BitsPerComponent") || 8;

    let encoded = null;

    if (filters.length === 1 && filters[0] === "/DCTDecode") {
        // 已是 JPEG：解码后按档位缩放/重编码（CMYK JPEG 浏览器解码不可靠，跳过）
        if (colorSpace === "/DeviceCMYK") throw new Error("CMYK 图片，保留原图");
        const bitmap = await createImageBitmap(new Blob([rawBytes], { type: "image/jpeg" }));
        try {
            encoded = await drawBitmapToJpeg(bitmap, bitmap.width, bitmap.height, settings);
        } finally {
            bitmap.close && bitmap.close();
        }
    } else if (filters.length === 1 && filters[0] === "/FlateDecode") {
        if (bpc !== 8) throw new Error("非 8 位色深，保留原图");
        let colors = 0;
        if (colorSpace === "/DeviceRGB") colors = 3;
        else if (colorSpace === "/DeviceGray") colors = 1;
        else throw new Error("色彩空间不支持重压，保留原图");
        const inflated = await inflateZlib(rawBytes);
        const parms = dictDecodeParms(dict);
        const predictor = parms ? dictNumber(parms, "Predictor") || 1 : 1;
        const columns = parms ? dictNumber(parms, "Columns") : null;
        const pixels = predictor === 1 ? inflated : unprediction(inflated, predictor, width, colors, columns, height);
        encoded = await reencodeRawPixels(pixels, width, height, colors, settings);
    } else {
        throw new Error("编码格式保留原图");
    }

    if (!encoded || encoded.bytes.length >= rawBytes.length * 0.98) {
        return { replaced: false, oldSize: rawBytes.length, newSize: rawBytes.length };
    }

    const newStream = context.stream(encoded.bytes);
    const nd = newStream.dict;
    nd.set(PDFName.of("Type"), PDFName.of("XObject"));
    nd.set(PDFName.of("Subtype"), PDFName.of("Image"));
    nd.set(PDFName.of("Width"), pdfDocLib.PDFNumber.of(encoded.width));
    nd.set(PDFName.of("Height"), pdfDocLib.PDFNumber.of(encoded.height));
    nd.set(PDFName.of("ColorSpace"), PDFName.of("DeviceRGB"));
    nd.set(PDFName.of("BitsPerComponent"), pdfDocLib.PDFNumber.of(8));
    nd.set(PDFName.of("Filter"), PDFName.of("DCTDecode"));
    nd.set(PDFName.of("Length"), pdfDocLib.PDFNumber.of(encoded.bytes.length));
    const interpolate = dict.lookup(PDFName.of("Interpolate"));
    if (interpolate) nd.set(PDFName.of("Interpolate"), interpolate);
    context.assign(ref, newStream);
    return { replaced: true, oldSize: rawBytes.length, newSize: encoded.bytes.length };
}

async function compressFidelity(arrayBuffer, settings, onProgress) {
    const { PDFDocument, PDFName, PDFRawStream } = pdfDocLib;
    const pdfDoc = await PDFDocument.load(arrayBuffer, { ignoreEncryption: true });

    // 收集全部图片流
    const targets = [];
    for (const [ref, obj] of pdfDoc.context.enumerateIndirectObjects()) {
        if (obj instanceof PDFRawStream && dictNameString(obj.dict, "Subtype") === "/Image") {
            targets.push([ref, obj]);
        }
    }

    let replaced = 0;
    let skipped = 0;
    for (let i = 0; i < targets.length; i++) {
        if (onProgress) onProgress(((i + 1) / Math.max(1, targets.length)) * 100, i + 1, targets.length);
        try {
            const r = await recompressImageStream(pdfDoc.context, targets[i][0], targets[i][1], settings);
            if (r.replaced) replaced++;
            else skipped++;
        } catch (e) {
            skipped++;
        }
    }

    const saved = await pdfDoc.save({ useObjectStreams: true, addDefaultPage: false });
    return { bytes: saved, replaced, skipped, totalImages: targets.length };
}

// ===== 图片化引擎（可选项）：整页渲染为 JPEG 再重组，仅适合扫描件 =====

async function compressRaster(arrayBuffer, settings, onProgress) {
    const { PDFDocument } = pdfDocLib;
    // PDF.js 会接管（分离）传入的 ArrayBuffer，必须传副本，保留原缓冲给回退逻辑
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer.slice(0) });
    const srcDoc = await loadingTask.promise;
    const numPages = srcDoc.numPages;

    const outDoc = await PDFDocument.create();
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");

    for (let i = 1; i <= numPages; i++) {
        if (onProgress) onProgress((i / numPages) * 100, i, numPages);
        const page = await srcDoc.getPage(i);
        const viewport = page.getViewport({ scale: settings.scale });
        canvas.width = Math.round(viewport.width);
        canvas.height = Math.round(viewport.height);
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport }).promise;

        const imgBytes = await canvasToJpegBytes(canvas, settings.jpegQuality);
        const image = await outDoc.embedJpg(imgBytes);
        // 页面物理尺寸保持原样（point），图片按渲染像素嵌入
        const baseViewport = page.getViewport({ scale: 1 });
        const newPage = outDoc.addPage([baseViewport.width, baseViewport.height]);
        newPage.drawImage(image, { x: 0, y: 0, width: baseViewport.width, height: baseViewport.height });
        page.cleanup && page.cleanup();
    }

    const bytes = await outDoc.save({ useObjectStreams: true, addDefaultPage: false });
    return { bytes };
}

// 仅用 pdf-lib 重保存做结构优化（不改变任何内容）
async function lightStructuralSave(arrayBuffer) {
    const { PDFDocument } = pdfDocLib;
    const pdfDoc = await PDFDocument.load(arrayBuffer, {
        ignoreEncryption: true,
        updateMetadata: false,
    });
    return await pdfDoc.save({ useObjectStreams: true, addDefaultPage: false });
}

// ===== 核心：处理单个文件 =====
async function compressSingleFile(file, modeKey, onProgress) {
    const settings = MODES[modeKey];
    const originalSize = file.size;
    const outName = file.name.replace(/\.pdf$/i, "") + "_compressed.pdf";

    try {
        const arrayBuffer = await file.arrayBuffer();
        let outBytes = null;
        let message = "";

        if (settings.engine === "fidelity") {
            updateStatus(`正在重压图片: ${file.name}`, "loading");
            const r = await compressFidelity(arrayBuffer, settings, onProgress);
            outBytes = r.bytes;
            if (r.totalImages === 0) {
                message = "未发现可重压的图片，已做结构优化";
            } else {
                message = `保留文字 · 重压 ${r.replaced}/${r.totalImages} 张图片`;
                if (r.skipped > 0 && r.replaced > 0) message += ` · ${r.skipped} 张保留原图`;
            }
            if (outBytes.length >= originalSize) {
                outBytes = new Uint8Array(arrayBuffer);
                message = "文件已是最优，未做改动";
            }
        } else {
            updateStatus(`正在逐页图片化: ${file.name}`, "loading");
            const r = await compressRaster(arrayBuffer, settings, onProgress);
            outBytes = r.bytes;
            message = "整页图片化 · 文字不可选";
            if (outBytes.length >= originalSize) {
                // 回退到结构优化；仍不更小则返回原文件（arrayBuffer 未被分离，可安全复用）
                const lightBytes = await lightStructuralSave(arrayBuffer);
                if (lightBytes.length < originalSize) {
                    outBytes = lightBytes;
                    message = "图片化未变小，已改用结构优化";
                } else {
                    outBytes = new Uint8Array(arrayBuffer);
                    message = "文件已是最优，未做改动";
                }
            }
        }

        const ratio = parseFloat(((1 - outBytes.length / originalSize) * 100).toFixed(1));
        return {
            success: true,
            originalSize,
            compressedSize: outBytes.length,
            ratio,
            blob: new Blob([outBytes], { type: "application/pdf" }),
            filename: outName,
            displayName: file.name,
            message,
        };
    } catch (error) {
        console.error("Compression error:", error);
        return {
            success: false,
            originalSize,
            compressedSize: 0,
            ratio: 0,
            error: friendlyError(error),
            blob: null,
            filename: outName,
            displayName: file.name,
            message: "",
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

        progressLabel.textContent = `正在处理: ${selectedFiles[i].name}`;
        progressPercent.textContent = `${((i / total) * 100).toFixed(0)}%`;
        progressFill.style.width = `${((i / total) * 100).toFixed(0)}%`;
        progressStatus.textContent = `文件 ${i + 1} / ${total}`;

        const result = await compressSingleFile(
            selectedFiles[i],
            currentMode,
            (pct, cur, all) => {
                const overallPct = ((i + pct / 100) / total) * 100;
                progressFill.style.width = `${overallPct.toFixed(0)}%`;
                progressPercent.textContent = `${overallPct.toFixed(0)}%`;
                progressStatus.textContent = `第 ${cur}/${all} 项`;
            }
        );

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
                const modeLabel = MODES[currentMode].label;
                return `
                    <div class="result-item">
                        <div class="result-item-icon success">&#10003;</div>
                        <div class="result-item-info">
                            <div class="result-item-name">${escapeHtml(r.displayName)}</div>
                            <div class="result-item-detail">
                                ${formatSize(r.originalSize)} → ${formatSize(r.compressedSize)}
                                · ${modeLabel}
                            </div>
                            ${
                                r.message
                                    ? `<div class="result-item-detail" style="color: #d97706">${escapeHtml(r.message)}</div>`
                                    : ""
                            }
                        </div>
                        <div class="result-item-ratio ${ratioClass}">${ratioText}</div>
                    </div>
                    <button class="btn-download" onclick="downloadFile(${index})" style="margin-left: 52px; margin-bottom: 12px;">
                        下载 ${escapeHtml(r.filename)}
                    </button>
                `;
            } else {
                return `
                    <div class="result-item">
                        <div class="result-item-icon fail">&#10007;</div>
                        <div class="result-item-info">
                            <div class="result-item-name">${escapeHtml(r.displayName)}</div>
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
    const result = (window.compressionResults || [])[index];
    if (!result || !result.blob) return;

    const url = URL.createObjectURL(result.blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = result.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function downloadAllFiles() {
    const results = window.compressionResults || [];
    const successIndexes = results
        .map((r, i) => (r.success ? i : -1))
        .filter((i) => i >= 0);

    if (successIndexes.length === 0) {
        showToast("没有可下载的文件", "error");
        return;
    }

    showToast(`正在下载 ${successIndexes.length} 个文件...`, "success");
    successIndexes.forEach((resultIndex, k) => {
        setTimeout(() => downloadFile(resultIndex), k * 500);
    });
}

// ===== 初始化：本地加载 PDF.js 与 pdf-lib（不依赖任何 CDN） =====
function loadScript(src) {
    return new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = src;
        script.onload = resolve;
        script.onerror = () => reject(new Error("加载失败: " + src));
        document.head.appendChild(script);
    });
}

async function initLibraries() {
    try {
        updateStatus("正在加载 PDF 处理引擎...", "loading");

        await loadScript("vendor/pdf.min.js");
        pdfjsLib = window.pdfjsLib;
        pdfjsLib.GlobalWorkerOptions.workerSrc = "vendor/pdf.worker.min.js";

        await loadScript("vendor/pdf-lib.min.js");
        pdfDocLib = window.PDFLib;

        updateStatus("就绪 · 纯浏览器处理，保护隐私", "ok");
        renderFileList();
    } catch (error) {
        console.error("Failed to load libraries:", error);
        updateStatus("PDF 引擎加载失败，请刷新页面重试", "error");
        document.getElementById("btnCompress").disabled = true;
    }
}

document.addEventListener("DOMContentLoaded", () => {
    updateStatus("正在加载 PDF 处理引擎...", "loading");
    initLibraries();
});
