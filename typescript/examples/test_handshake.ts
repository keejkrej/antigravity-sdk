import { spawn } from "node:child_process";
import { encodeInputConfig } from "../src/protobuf.ts";

const binaryPath = process.env.ANTIGRAVITY_HARNESS_PATH || "/home/jack/.gemini/antigravity-cli/bin/agentapi";
console.log("Spawning", binaryPath);

const child = spawn(binaryPath, [], {
  stdio: ["pipe", "pipe", "pipe"],
});

child.stdout.on("data", (chunk) => {
  console.log("STDOUT:", chunk.toString("hex"), chunk.toString("utf8"));
});

child.stderr.on("data", (chunk) => {
  console.log("STDERR:", chunk.toString("utf8"));
});

child.on("exit", (code, signal) => {
  console.log("EXIT:", code, signal);
});

const serializedConfig = encodeInputConfig(undefined);
const lenBuf = Buffer.alloc(4);
lenBuf.writeUInt32LE(serializedConfig.length, 0);

console.log("Writing length:", lenBuf.readUInt32LE(0));
child.stdin.write(lenBuf);
console.log("Writing config:", serializedConfig.length, "bytes");
child.stdin.write(serializedConfig);
