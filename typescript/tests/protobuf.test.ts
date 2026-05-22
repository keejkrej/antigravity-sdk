import { expect, test, describe } from "bun:test";
import { encodeInputConfig, decodeOutputConfig } from "../src/protobuf.ts";

describe("Protobuf Handshake Serialization", () => {
  test("encodeInputConfig should correctly encode empty config", () => {
    const bytes = encodeInputConfig();
    expect(bytes.length).toBe(0);
  });

  test("decodeOutputConfig should correctly decode port and apiKey fields", () => {
    // Manually construct output config bytes for verification:
    // Field 1 (wire 0): port = 8080. Key: (1 << 3) | 0 = 8. Value 8080 = [0x90, 0x3f]
    // Field 2 (wire 2): apiKey = "test-key". Key: (2 << 3) | 2 = 18. Len: 8. Val: "test-key"
    const testBytes = new Uint8Array([
      8,
      0x90,
      0x3f,
      18,
      8,
      ...Buffer.from("test-key"),
    ]);

    const config = decodeOutputConfig(testBytes);
    expect(config.port).toBe(8080);
    expect(config.apiKey).toBe("test-key");
  });

  test("encodeInputConfig should correctly serialize all fields", () => {
    const bytes = encodeInputConfig("/path/to/save", 9090, "127.0.0.1");
    expect(bytes.length).toBeGreaterThan(0);

    // Basic assertion checks on string serialization elements
    const text = new TextDecoder().decode(bytes);
    expect(text).toContain("/path/to/save");
    expect(text).toContain("127.0.0.1");
  });
});
