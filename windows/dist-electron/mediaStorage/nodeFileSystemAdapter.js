"use strict";
// src/utils/mediaStorage/nodeFileSystemAdapter.ts
// Node.js filesystem adapter for Windows Electron and unified regression tests.
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.NodeFileSystemAdapter = void 0;
const node_fs_1 = __importDefault(require("node:fs"));
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const promises_2 = require("node:stream/promises");
class NodeFileSystemAdapter {
    async exists(targetPath) {
        try {
            await promises_1.default.access(targetPath);
            return true;
        }
        catch {
            return false;
        }
    }
    async stat(targetPath) {
        try {
            const s = await promises_1.default.stat(targetPath);
            return { size: s.size, mtimeMs: s.mtimeMs };
        }
        catch {
            return null;
        }
    }
    async readFile(targetPath) {
        return promises_1.default.readFile(targetPath, "utf8");
    }
    async writeFile(targetPath, content) {
        await this.ensureDir(node_path_1.default.dirname(targetPath));
        await promises_1.default.writeFile(targetPath, content, "utf8");
    }
    async deleteFile(targetPath) {
        try {
            await promises_1.default.unlink(targetPath);
        }
        catch {
            // Ignore if not present
        }
    }
    async rename(src, dest) {
        await this.ensureDir(node_path_1.default.dirname(dest));
        try {
            await promises_1.default.rename(src, dest);
        }
        catch {
            // Cross-device or locked target fallback: copy and unlink
            await promises_1.default.copyFile(src, dest);
            await promises_1.default.unlink(src).catch(() => { });
        }
    }
    async copyFile(src, dest) {
        await this.ensureDir(node_path_1.default.dirname(dest));
        await promises_1.default.copyFile(src, dest);
    }
    async computeSha256(targetPath) {
        const crypto = await Promise.resolve().then(() => __importStar(require("node:crypto")));
        const hash = crypto.createHash("sha256");
        const stream = node_fs_1.default.createReadStream(targetPath);
        for await (const chunk of stream) {
            hash.update(chunk);
        }
        return hash.digest("hex");
    }
    async ensureDir(dirPath) {
        if (!node_fs_1.default.existsSync(dirPath)) {
            await promises_1.default.mkdir(dirPath, { recursive: true });
        }
    }
    async readDir(dirPath) {
        try {
            const items = await promises_1.default.readdir(dirPath, { withFileTypes: true });
            const entries = [];
            for (const item of items) {
                let size;
                if (!item.isDirectory()) {
                    try {
                        const st = await promises_1.default.stat(node_path_1.default.join(dirPath, item.name));
                        size = st.size;
                    }
                    catch { }
                }
                entries.push({
                    name: item.name,
                    isDirectory: item.isDirectory(),
                    size,
                });
            }
            return entries;
        }
        catch {
            return [];
        }
    }
    async downloadFile(url, destPath, options) {
        await this.ensureDir(node_path_1.default.dirname(destPath));
        await this.deleteFile(destPath);
        const res = await fetch(url, {
            method: "GET",
            headers: options?.headers,
        });
        const normalizedHeaders = {};
        res.headers.forEach((v, k) => {
            normalizedHeaders[k.toLowerCase()] = v;
        });
        if (res.status === 304) {
            return {
                status: 304,
                headers: normalizedHeaders,
                bytesWritten: 0,
            };
        }
        if (!res.ok || !res.body) {
            return {
                status: res.status,
                headers: normalizedHeaders,
                bytesWritten: 0,
            };
        }
        const fileStream = node_fs_1.default.createWriteStream(destPath);
        await (0, promises_2.pipeline)(res.body, fileStream);
        const st = await promises_1.default.stat(destPath);
        return {
            status: res.status,
            headers: normalizedHeaders,
            bytesWritten: st.size,
        };
    }
}
exports.NodeFileSystemAdapter = NodeFileSystemAdapter;
