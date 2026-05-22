// Copyright 2026 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

/**
 * MCP Integration example for Google Antigravity SDK.
 *
 * This example demonstrates how to connect an agent to external MCP servers
 * using stdio, SSE, and Streamable HTTP transports.
 *
 * To run:
 *   bun typescript/examples/mcp_tools.ts
 */

import http from "http";
import { createServer } from "net";
import readline from "readline";
import { fileURLToPath } from "url";
import { Agent, policy } from "../src/index.js";

const __filename = fileURLToPath(import.meta.url);

// ============================================================================
// NATIVE TYPESCRIPT MCP SERVER IMPLEMENTATION (MOCK MATH SERVER)
// ============================================================================

/**
 * Handles incoming MCP JSON-RPC requests according to the protocol specification.
 */
function handleMcpRequest(req: any): any {
  const { jsonrpc, id, method, params } = req;

  // Handle initialization handshake notifications (no ID/response expected)
  if (!id && method === "notifications/initialized") {
    return null;
  }

  // 1. Initialize Handshake
  if (method === "initialize") {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        serverInfo: { name: "Pirate Math TS", version: "0.1.0" },
      },
    };
  }

  // 2. Tools Discovery
  if (method === "tools/list") {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        tools: [
          {
            name: "pirate_multiply",
            description: "Does multiplication like a pirate.",
            inputSchema: {
              type: "object",
              properties: {
                a: { type: "integer" },
                b: { type: "integer" },
              },
              required: ["a", "b"],
            },
          },
        ],
      },
    };
  }

  // 3. Tools Execution
  if (method === "tools/call") {
    const { name, arguments: args } = params;
    if (name === "pirate_multiply") {
      const a = Number(args.a);
      const b = Number(args.b);
      const result = (a + b) * 7 - 13;
      const text = `🏴‍☠️ Pirate Multiplication: ${a} × ${b}

**Yo ho ho!** The pirate multiplication be done!

| Factor | Value |
|--------|-------|
| a | ${a} |
| b | ${b} |

**Result:** \`${result}\`

*Seven seas math - we add 'em, multiply by 7, subtract 13!*`;

      return {
        jsonrpc: "2.0",
        id,
        result: {
          content: [
            {
              type: "text",
              text,
            },
          ],
        },
      };
    }
  }

  // Method fallback
  return {
    jsonrpc: "2.0",
    id,
    error: {
      code: -32601,
      message: `Method not found: ${method}`,
    },
  };
}

/**
 * Runs the MCP server in Stdio mode.
 */
function runStdioServer() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  rl.on("line", (line) => {
    try {
      const request = JSON.parse(line);
      const response = handleMcpRequest(request);
      if (response) {
        process.stdout.write(JSON.stringify(response) + "\n");
      }
    } catch (e) {
      // Ignore parse errors
    }
  });
}

/**
 * Runs the MCP server in SSE mode.
 */
function runSseServer(port: number): http.Server {
  const sessions = new Map<string, http.ServerResponse>();

  return http.createServer((req, res) => {
    const url = new URL(req.url || "", `http://${req.headers.host}`);

    // GET /sse starts the server-sent events stream
    if (req.method === "GET" && url.pathname === "/sse") {
      const sessionId = Math.random().toString(36).substring(7);
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      });

      // Write initial endpoint redirect event telling the client where to POST messages
      res.write(
        `event: endpoint\ndata: http://localhost:${port}/message?session=${sessionId}\n\n`
      );
      sessions.set(sessionId, res);

      req.on("close", () => {
        sessions.delete(sessionId);
      });
      return;
    }

    // POST /message handles incoming JSON-RPC client messages
    if (req.method === "POST" && url.pathname === "/message") {
      const sessionId = url.searchParams.get("session") || "";
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        try {
          const request = JSON.parse(body);
          const response = handleMcpRequest(request);
          if (response) {
            const sseRes = sessions.get(sessionId);
            if (sseRes) {
              sseRes.write(`event: message\ndata: ${JSON.stringify(response)}\n\n`);
            }
          }
          res.writeHead(202);
          res.end();
        } catch (e) {
          res.writeHead(400);
          res.end();
        }
      });
      return;
    }

    res.writeHead(404);
    res.end();
  });
}

/**
 * Runs the MCP server in HTTP / Streamable HTTP mode.
 */
function runHttpServer(port: number): http.Server {
  return http.createServer((req, res) => {
    if (req.method === "POST" && req.url === "/mcp") {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        try {
          const request = JSON.parse(body);
          const response = handleMcpRequest(request);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(response));
        } catch (e) {
          res.writeHead(400);
          res.end();
        }
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });
}

// ============================================================================
// CLIENT RUNNER DEMONSTRATING TRANSPORTS
// ============================================================================

/**
 * Find an available port on localhost to avoid port collisions.
 */
async function findAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "string" ? 0 : addr?.port;
      server.close(() => {
        if (port) resolve(port);
        else reject(new Error("Failed to find available port"));
      });
    });
  });
}

async function mcpStdio() {
  console.log("\n  --- Showcasing Stdio Transport ---");

  const agent = new Agent({
    policies: [policy.allow_all()],
    mcpServers: [
      {
        type: "stdio",
        command: process.argv[0], // Dynamically uses the current runtime executable (node/bun/etc.)
        args: [__filename, "--server-mode", "stdio"],
      },
    ],
    geminiConfig: {
      modelName: "gemini-3.5-flash",
    },
  });

  try {
    await agent.start();
    const prompt = "Use the pirate_multiply tool to multiply 5 and 7.";
    console.log(`  User: ${prompt}`);
    const response = await agent.chat(prompt);
    console.log(`  Agent: ${await response.text()}`);
  } finally {
    await agent.stop();
  }
}

async function mcpSse() {
  console.log("\n  --- Showcasing SSE Transport ---");
  const port = await findAvailablePort();
  const server = runSseServer(port);
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));

  const agent = new Agent({
    policies: [policy.allow_all()],
    mcpServers: [
      {
        type: "sse",
        url: `http://localhost:${port}/sse`,
      },
    ],
    geminiConfig: {
      modelName: "gemini-3.5-flash",
    },
  });

  try {
    await agent.start();
    const prompt = "Use the pirate_multiply tool to multiply 5 and 7.";
    console.log(`  User: ${prompt}`);
    const response = await agent.chat(prompt);
    console.log(`  Agent: ${await response.text()}`);
  } finally {
    try {
      await agent.stop();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }
}

async function mcpHttp() {
  console.log("\n  --- Showcasing Streamable HTTP Transport ---");
  const port = await findAvailablePort();
  const server = runHttpServer(port);
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));

  const agent = new Agent({
    policies: [policy.allow_all()],
    mcpServers: [
      {
        type: "http",
        url: `http://localhost:${port}/mcp`,
      },
    ],
    geminiConfig: {
      modelName: "gemini-3.5-flash",
    },
  });

  try {
    await agent.start();
    const prompt = "Use the pirate_multiply tool to multiply 5 and 7.";
    console.log(`  User: ${prompt}`);
    const response = await agent.chat(prompt);
    console.log(`  Agent: ${await response.text()}`);
  } finally {
    try {
      await agent.stop();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }
}

async function main() {
  // Check if we are running in child server mode
  const modeIndex = process.argv.indexOf("--server-mode");
  if (modeIndex !== -1 && process.argv[modeIndex + 1] === "stdio") {
    runStdioServer();
    return;
  }

  // Otherwise, run the interactive client transport demo
  await mcpStdio();
  await mcpSse();
  await mcpHttp();
}

main().catch((err) => {
  console.error("Execution failed:", err);
  process.exit(1);
});
