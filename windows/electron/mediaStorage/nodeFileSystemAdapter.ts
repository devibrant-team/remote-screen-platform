// src/utils/mediaStorage/nodeFileSystemAdapter.ts
// Node.js filesystem adapter for Windows Electron and unified regression tests.

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { DownloadResult, FileEntry, FileSystemAdapter } from "./mediaStorageTypes";

export class NodeFileSystemAdapter implements FileSystemAdapter {
  public async exists(targetPath: string): Promise<boolean> {
    try {
      await fsp.access(targetPath);
      return true;
    } catch {
      return false;
    }
  }

  public async stat(targetPath: string): Promise<{ size: number; mtimeMs?: number } | null> {
    try {
      const s = await fsp.stat(targetPath);
      return { size: s.size, mtimeMs: s.mtimeMs };
    } catch {
      return null;
    }
  }

  public async readFile(targetPath: string): Promise<string> {
    return fsp.readFile(targetPath, "utf8");
  }

  public async writeFile(targetPath: string, content: string): Promise<void> {
    await this.ensureDir(path.dirname(targetPath));
    await fsp.writeFile(targetPath, content, "utf8");
  }

  public async deleteFile(targetPath: string): Promise<void> {
    try {
      await fsp.unlink(targetPath);
    } catch {
      // Ignore if not present
    }
  }

  public async rename(src: string, dest: string): Promise<void> {
    await this.ensureDir(path.dirname(dest));
    try {
      await fsp.rename(src, dest);
    } catch {
      // Cross-device or locked target fallback: copy and unlink
      await fsp.copyFile(src, dest);
      await fsp.unlink(src).catch(() => {});
    }
  }

  public async copyFile(src: string, dest: string): Promise<void> {
    await this.ensureDir(path.dirname(dest));
    await fsp.copyFile(src, dest);
  }

  public async computeSha256(targetPath: string): Promise<string> {
    const crypto = await import("node:crypto");
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(targetPath);
    for await (const chunk of stream) {
      hash.update(chunk);
    }
    return hash.digest("hex");
  }

  public async ensureDir(dirPath: string): Promise<void> {
    if (!fs.existsSync(dirPath)) {
      await fsp.mkdir(dirPath, { recursive: true });
    }
  }

  public async readDir(dirPath: string): Promise<FileEntry[]> {
    try {
      const items = await fsp.readdir(dirPath, { withFileTypes: true });
      const entries: FileEntry[] = [];
      for (const item of items) {
        let size: number | undefined;
        if (!item.isDirectory()) {
          try {
            const st = await fsp.stat(path.join(dirPath, item.name));
            size = st.size;
          } catch {}
        }
        entries.push({
          name: item.name,
          isDirectory: item.isDirectory(),
          size,
        });
      }
      return entries;
    } catch {
      return [];
    }
  }

  public async downloadFile(
    url: string,
    destPath: string,
    options?: { headers?: Record<string, string> }
  ): Promise<DownloadResult> {
    await this.ensureDir(path.dirname(destPath));
    await this.deleteFile(destPath);

    const res = await fetch(url, {
      method: "GET",
      headers: options?.headers,
    });

    const normalizedHeaders: Record<string, string> = {};
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

    const fileStream = fs.createWriteStream(destPath);
    await pipeline(res.body as any, fileStream);

    const st = await fsp.stat(destPath);
    return {
      status: res.status,
      headers: normalizedHeaders,
      bytesWritten: st.size,
    };
  }
}
