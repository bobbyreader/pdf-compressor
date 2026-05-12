/**
 * 本地开发服务器
 * 用于在没有 Vercel 的情况下本地测试
 */

const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;

const MIME_TYPES = {
    ".html": "text/html",
    ".js": "application/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
};

const server = http.createServer((req, res) => {
    console.log(`${req.method} ${req.url}`);

    // 默认返回 index.html
    let filePath = req.url === "/" ? "/index.html" : req.url;

    // 安全检查：只允许访问公共文件
    filePath = path.join(__dirname, filePath);

    // 防止路径遍历攻击
    if (!filePath.startsWith(__dirname)) {
        res.writeHead(403);
        res.end("Forbidden");
        return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";

    fs.readFile(filePath, (err, content) => {
        if (err) {
            if (err.code === "ENOENT") {
                res.writeHead(404);
                res.end("File not found: " + req.url);
            } else {
                res.writeHead(500);
                res.end("Server error: " + err.code);
            }
        } else {
            res.writeHead(200, { "Content-Type": contentType });
            res.end(content);
        }
    });
});

server.listen(PORT, () => {
    console.log("=".repeat(50));
    console.log("  PDF 压缩工具已启动 (本地开发模式)");
    console.log(`  请在浏览器中打开: http://localhost:${PORT}`);
    console.log("=".repeat(50));
});
