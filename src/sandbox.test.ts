import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Sandbox } from "./sandbox.js";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import * as fsp from "fs/promises";

describe("Sandbox", () => {
  let sandbox: Sandbox;
  let mockMcpClients: Map<string, Client>;

  beforeEach(async () => {
    // Mock MCP client
    mockMcpClients = new Map();
    const mockClient: Partial<Client> = {
      // Return an MCP-style tool result with text content
      callTool: vi.fn().mockResolvedValue({
        content: [{ type: "text", text: '{"name": "test-package"}' }],
        isError: false,
      }) as any,
    };
    mockMcpClients.set("filesystem", mockClient as Client);

    sandbox = new Sandbox(mockMcpClients as any);
    await sandbox.initialize();
  });

  afterEach(async () => {
    await sandbox.cleanup();
  });

  it("should initialize and create temp directory", async () => {
    const tempDirPath = (sandbox as any)["tempDir"] as string;

    // temp dir exists
    const tempDirExists = await fsp
      .access(tempDirPath)
      .then(() => true)
      .catch(() => false);
    expect(tempDirExists).toBe(true);

    // servers link or directory exists
    const serversPath = path.join(tempDirPath, "servers");
    const serversExists = await fsp
      .lstat(serversPath)
      .then((st) => st.isSymbolicLink() || st.isDirectory())
      .catch(() => false);
    expect(serversExists).toBe(true);
  });

  it("should execute simple code successfully", async () => {
    const result = await sandbox.executeCode('console.log("hello test")');
    expect(result.success).toBe(true);
    expect(result.output || "").toContain("hello test");
  });

  it("should call MCP tools via IPC", async () => {
    const code = `
      import * as fs from "./servers/filesystem/index.js";
      const result = await fs.readFile({ path: "test.json" });
      console.log(result);
    `;
    const result = await sandbox.executeCode(code);
    expect(result.success).toBe(true);
    // Verify parent-side tool call was invoked
    const client = mockMcpClients.get("filesystem") as any;
    expect(client.callTool).toHaveBeenCalled();
    // Output contains payload text
    expect(result.output || "").toContain("test-package");
  });

  it("should handle syntax errors", async () => {
    const result = await sandbox.executeCode("invalid syntax!!!");
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error || "").toMatch(/syntax|unexpected|invalid|token/i);
  });

  it("should handle runtime errors", async () => {
    const result = await sandbox.executeCode(
      'throw new Error("test runtime error")',
    );
    expect(result.success).toBe(false);
    expect(result.error || "").toContain("test runtime error");
  });

  it("should timeout long-running code", async () => {
    const code = "while(true) {}";
    const start = Date.now();
    const result = await sandbox.executeCode(code);
    const elapsed = Date.now() - start;
    expect(result.success).toBe(false);
    expect(result.error || "").toMatch(/timeout|killed/i);
    // Should have waited roughly the sandbox timeout (10s) before failing
    expect(elapsed).toBeGreaterThanOrEqual(9000);
  }, 15000);

  it("should clean up temporary files after execution", async () => {
    await sandbox.executeCode('console.log("test")');

    // give a short grace period for cleanup to finish
    await new Promise((r) => setTimeout(r, 100));

    const tempDirPath = (sandbox as any)["tempDir"] as string;
    const files = await fsp.readdir(tempDirPath);
    const leftovers = files.filter(
      (f) => f.startsWith("exec-") || f.startsWith("runner-"),
    );
    // exec-* should be removed; runner-* are not used by current impl
    expect(leftovers.length).toBe(0);
  });

  it("should handle concurrent executions", async () => {
    // Stagger a few ms to avoid identical Date.now() filenames while still overlapping
    const p1 = sandbox.executeCode('console.log("test1")');
    await new Promise((r) => setTimeout(r, 2));
    const p2 = sandbox.executeCode('console.log("test2")');
    await new Promise((r) => setTimeout(r, 2));
    const p3 = sandbox.executeCode('console.log("test3")');

    const results = await Promise.all([p1, p2, p3]);
    expect(results).toHaveLength(3);
    for (const r of results) {
      expect(r.success).toBe(true);
    }
  });

  it("should remove temp directory on cleanup", async () => {
    const tempDirPath = (sandbox as any)["tempDir"] as string;
    await sandbox.cleanup();
    const exists = await fsp
      .access(tempDirPath)
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(false);
  });

  it("propagates MCP tool errors via IPC (tool error branch)", async () => {
    const client = mockMcpClients.get("filesystem") as any;
    client.callTool.mockRejectedValueOnce(new Error("tool failed"));

    const code = `
      import * as fs from "./servers/filesystem/index.js";
      await fs.readFile({ path: "X" });
    `;
    const res = await sandbox.executeCode(code);
    expect(res.success).toBe(false);
    expect(res.error || "").toMatch(/tool failed|Exit code|error/i);
  });
});
