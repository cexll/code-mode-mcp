import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  FilesystemTools,
  FetchTools,
  createBuiltinTools,
} from "./builtin-tools.js";
import * as fs from "fs/promises";
import * as path from "path";

describe("createBuiltinTools", () => {
  it("should create a map with filesystem and fetch tools", () => {
    const tools = createBuiltinTools();

    expect(tools.size).toBe(2);
    expect(tools.has("filesystem")).toBe(true);
    expect(tools.has("fetch")).toBe(true);
    expect(tools.get("filesystem")).toBeInstanceOf(FilesystemTools);
    expect(tools.get("fetch")).toBeInstanceOf(FetchTools);
  });
});

describe("FilesystemTools", () => {
  let filesystemTools: FilesystemTools;
  const testDir = path.join(process.cwd(), "test-builtin");
  const testFile = path.join(testDir, "test.txt");

  beforeEach(async () => {
    filesystemTools = new FilesystemTools();
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe("listTools", () => {
    it("should return all 10 filesystem tools", async () => {
      const result = await filesystemTools.listTools();

      expect(result.tools).toHaveLength(10);
      const toolNames = result.tools.map((t: any) => t.name);
      expect(toolNames).toContain("read_file");
      expect(toolNames).toContain("write_file");
      expect(toolNames).toContain("list_directory");
      expect(toolNames).toContain("create_directory");
      expect(toolNames).toContain("move_file");
      expect(toolNames).toContain("search_files");
      expect(toolNames).toContain("get_file_info");
      expect(toolNames).toContain("read_multiple_files");
      expect(toolNames).toContain("list_allowed_directories");
      // Note: edit_file is declared in listTools but not implemented in callTool
    });
  });

  describe("readFile", () => {
    it("should read file successfully", async () => {
      await fs.writeFile(testFile, "test content");

      const result = await filesystemTools.callTool({
        name: "read_file",
        arguments: { path: testFile },
      });

      expect(result.content[0].text).toBe("test content");
    });

    it("should throw error for nonexistent file", async () => {
      await expect(
        filesystemTools.callTool({
          name: "read_file",
          arguments: { path: path.join(testDir, "nonexistent.txt") },
        }),
      ).rejects.toThrow();
    });
  });

  describe("writeFile", () => {
    it("should write file successfully", async () => {
      const result = await filesystemTools.callTool({
        name: "write_file",
        arguments: { path: testFile, content: "hello world" },
      });

      expect(result.content[0].text).toContain("Successfully wrote");

      const content = await fs.readFile(testFile, "utf-8");
      expect(content).toBe("hello world");
    });

    it("should create parent directories if needed", async () => {
      const nestedFile = path.join(testDir, "nested", "file.txt");

      await filesystemTools.callTool({
        name: "write_file",
        arguments: { path: nestedFile, content: "nested content" },
      });

      const content = await fs.readFile(nestedFile, "utf-8");
      expect(content).toBe("nested content");
    });
  });

  describe("listDirectory", () => {
    it("should list directory contents", async () => {
      await fs.writeFile(path.join(testDir, "file1.txt"), "content1");
      await fs.writeFile(path.join(testDir, "file2.txt"), "content2");
      await fs.mkdir(path.join(testDir, "subdir"));

      const result = await filesystemTools.callTool({
        name: "list_directory",
        arguments: { path: testDir },
      });

      const items = JSON.parse(result.content[0].text);
      expect(items).toHaveLength(3);
      expect(items.some((i: any) => i.name === "file1.txt")).toBe(true);
      expect(items.some((i: any) => i.name === "file2.txt")).toBe(true);
      expect(items.some((i: any) => i.name === "subdir")).toBe(true);
    });

    it("should throw error for nonexistent directory", async () => {
      await expect(
        filesystemTools.callTool({
          name: "list_directory",
          arguments: { path: path.join(testDir, "nonexistent") },
        }),
      ).rejects.toThrow();
    });
  });

  describe("createDirectory", () => {
    it("should create directory successfully", async () => {
      const newDir = path.join(testDir, "newdir");

      const result = await filesystemTools.callTool({
        name: "create_directory",
        arguments: { path: newDir },
      });

      expect(result.content[0].text).toContain(
        "Successfully created directory",
      );

      const stat = await fs.stat(newDir);
      expect(stat.isDirectory()).toBe(true);
    });

    it("should create nested directories", async () => {
      const nestedDir = path.join(testDir, "a", "b", "c");

      await filesystemTools.callTool({
        name: "create_directory",
        arguments: { path: nestedDir },
      });

      const stat = await fs.stat(nestedDir);
      expect(stat.isDirectory()).toBe(true);
    });
  });

  describe("moveFile", () => {
    it("should move file successfully", async () => {
      await fs.writeFile(testFile, "move me");
      const destFile = path.join(testDir, "moved.txt");

      const result = await filesystemTools.callTool({
        name: "move_file",
        arguments: { source: testFile, destination: destFile },
      });

      expect(result.content[0].text).toContain("Successfully moved");

      const content = await fs.readFile(destFile, "utf-8");
      expect(content).toBe("move me");

      await expect(fs.access(testFile)).rejects.toThrow();
    });

    it("should throw error for nonexistent source", async () => {
      await expect(
        filesystemTools.callTool({
          name: "move_file",
          arguments: {
            source: path.join(testDir, "nonexistent.txt"),
            destination: path.join(testDir, "dest.txt"),
          },
        }),
      ).rejects.toThrow();
    });
  });

  describe("searchFiles", () => {
    it("should search files by pattern", async () => {
      await fs.writeFile(path.join(testDir, "test1.txt"), "content");
      await fs.writeFile(path.join(testDir, "test2.txt"), "content");
      await fs.writeFile(path.join(testDir, "other.md"), "content");

      const result = await filesystemTools.callTool({
        name: "search_files",
        arguments: { path: testDir, pattern: ".*\\.txt$" },
      });

      const files = JSON.parse(result.content[0].text);
      expect(files).toHaveLength(2);
      expect(files.every((f: string) => f.endsWith(".txt"))).toBe(true);
    });

    it("should return empty array when no matches", async () => {
      const result = await filesystemTools.callTool({
        name: "search_files",
        arguments: { path: testDir, pattern: ".*\\.xyz$" },
      });

      const files = JSON.parse(result.content[0].text);
      expect(files).toHaveLength(0);
    });
  });

  describe("getFileInfo", () => {
    it("should get file info successfully", async () => {
      await fs.writeFile(testFile, "file info test");

      const result = await filesystemTools.callTool({
        name: "get_file_info",
        arguments: { path: testFile },
      });

      const info = JSON.parse(result.content[0].text);
      expect(info.size).toBeGreaterThan(0);
      expect(info.created).toBeDefined();
      expect(info.modified).toBeDefined();
      expect(info.accessed).toBeDefined();
      expect(info.isDirectory).toBe(false);
      expect(info.isFile).toBe(true);
      expect(info.permissions).toBeDefined();
    });

    it("should throw error for nonexistent file", async () => {
      await expect(
        filesystemTools.callTool({
          name: "get_file_info",
          arguments: { path: path.join(testDir, "nonexistent.txt") },
        }),
      ).rejects.toThrow();
    });
  });

  describe("readMultipleFiles", () => {
    it("should read multiple files successfully", async () => {
      const file1 = path.join(testDir, "file1.txt");
      const file2 = path.join(testDir, "file2.txt");
      await fs.writeFile(file1, "content1");
      await fs.writeFile(file2, "content2");

      const result = await filesystemTools.callTool({
        name: "read_multiple_files",
        arguments: { paths: [file1, file2] },
      });

      const files = JSON.parse(result.content[0].text);
      expect(files).toHaveLength(2);
      expect(files[0].content).toBe("content1");
      expect(files[1].content).toBe("content2");
    });

    it("should handle mix of existing and nonexistent files", async () => {
      const file1 = path.join(testDir, "exists.txt");
      const file2 = path.join(testDir, "nonexistent.txt");
      await fs.writeFile(file1, "exists");

      const result = await filesystemTools.callTool({
        name: "read_multiple_files",
        arguments: { paths: [file1, file2] },
      });

      const files = JSON.parse(result.content[0].text);
      expect(files).toHaveLength(2);
      expect(files[0].content).toBe("exists");
      expect(files[1].error).toBeDefined();
    });
  });

  describe("listAllowedDirectories", () => {
    it("should return allowed directories", async () => {
      const result = await filesystemTools.callTool({
        name: "list_allowed_directories",
        arguments: {},
      });

      const dirs = JSON.parse(result.content[0].text);
      expect(Array.isArray(dirs)).toBe(true);
      expect(dirs.length).toBeGreaterThan(0);
    });
  });

  // Note: edit_file is declared in listTools but not implemented in callTool
  // Skip these tests until edit_file is implemented

  describe("callTool error handling", () => {
    it("should throw error for unknown tool", async () => {
      await expect(
        filesystemTools.callTool({
          name: "unknown_tool",
          arguments: {},
        }),
      ).rejects.toThrow("Unknown tool");
    });
  });
});

describe("FetchTools", () => {
  let fetchTools: FetchTools;

  beforeEach(() => {
    fetchTools = new FetchTools();
  });

  describe("listTools", () => {
    it("should return fetch tool", async () => {
      const result = await fetchTools.listTools();

      expect(result.tools).toHaveLength(1);
      expect(result.tools[0].name).toBe("fetch");
    });
  });

  describe("fetch", () => {
    it("should fetch URL successfully", async () => {
      const result = await fetchTools.callTool({
        name: "fetch",
        arguments: { url: "https://httpbin.org/json" },
      });

      expect(result.content[0].text).toBeDefined();
      expect(result.content[0].text.length).toBeGreaterThan(0);
    }, 15000);

    it("should handle max_length parameter", async () => {
      const result = await fetchTools.callTool({
        name: "fetch",
        arguments: { url: "https://httpbin.org/json", max_length: 100 },
      });

      expect(result.content[0].text.length).toBeLessThanOrEqual(100);
    }, 15000);

    it("should handle start_index parameter", async () => {
      const fullResult = await fetchTools.callTool({
        name: "fetch",
        arguments: { url: "https://httpbin.org/json" },
      });

      const partialResult = await fetchTools.callTool({
        name: "fetch",
        arguments: { url: "https://httpbin.org/json", start_index: 10 },
      });

      // 验证部分结果是全部结果的子串（从第10个字符开始）
      const fullText = fullResult.content[0].text;
      const partialText = partialResult.content[0].text;

      expect(fullText.substring(10)).toContain(partialText.substring(0, 100));
    }, 15000);

    it("should throw error for invalid URL", async () => {
      await expect(
        fetchTools.callTool({
          name: "fetch",
          arguments: { url: "invalid-url" },
        }),
      ).rejects.toThrow();
    });

    it("should handle fetch timeout", async () => {
      // 使用一个会超时的URL（假设这个IP不存在或不响应）
      await expect(
        fetchTools.callTool({
          name: "fetch",
          arguments: { url: "https://192.0.2.1" }, // TEST-NET-1, 保留用于文档
        }),
      ).rejects.toThrow();
    }, 10000);
  });

  describe("callTool error handling", () => {
    it("should throw error for unknown tool", async () => {
      await expect(
        fetchTools.callTool({
          name: "unknown_tool",
          arguments: {},
        }),
      ).rejects.toThrow("Unknown tool");
    });
  });
});
