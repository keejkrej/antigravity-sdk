/**
 * Pure TypeScript Protobuf encoder and decoder helpers for the localharness handshake.
 *
 * Implements lightweight varint encoding/decoding and length-delimited wire types
 * to avoid large external dependencies.
 */

function encodeVarint(value: number): number[] {
  const bytes: number[] = [];
  let temp = value;
  while (temp > 127) {
    bytes.push((temp & 0x7f) | 0x80);
    temp >>>= 7;
  }
  bytes.push(temp & 0x7f);
  return bytes;
}

function decodeVarint(bytes: Uint8Array, offset: { val: number }): number {
  let result = 0;
  let shift = 0;
  while (offset.val < bytes.length) {
    const byte = bytes[offset.val++];
    result |= (byte & 0x7f) << shift;
    if (!(byte & 0x80)) {
      return result;
    }
    shift += 7;
  }
  throw new Error("Truncated varint");
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function encodeStringField(fieldNumber: number, val: string): number[] {
  const strBytes = textEncoder.encode(val);
  const key = (fieldNumber << 3) | 2;
  const keyBytes = encodeVarint(key);
  const lenBytes = encodeVarint(strBytes.length);
  return [...keyBytes, ...lenBytes, ...strBytes];
}

function encodeUint32Field(fieldNumber: number, val: number): number[] {
  const key = (fieldNumber << 3) | 0;
  const keyBytes = encodeVarint(key);
  const valBytes = encodeVarint(val);
  return [...keyBytes, ...valBytes];
}

/**
 * Encodes the InputConfig protobuf message.
 *
 * InputConfig fields:
 * - storage_directory: string (field 1, wire type 2)
 * - port: uint32 (field 2, wire type 0)
 * - bind_address: string (field 3, wire type 2)
 */
export function encodeInputConfig(
  storageDirectory?: string,
  port?: number,
  bindAddress?: string
): Uint8Array {
  const bytes: number[] = [];
  if (storageDirectory !== undefined) {
    bytes.push(...encodeStringField(1, storageDirectory));
  }
  if (port !== undefined) {
    bytes.push(...encodeUint32Field(2, port));
  }
  if (bindAddress !== undefined) {
    bytes.push(...encodeStringField(3, bindAddress));
  }
  return new Uint8Array(bytes);
}

export interface OutputConfig {
  port: number;
  apiKey: string;
}

/**
 * Decodes the OutputConfig protobuf message.
 *
 * OutputConfig fields:
 * - port: int32 (field 1, wire type 0)
 * - api_key: string (field 2, wire type 2)
 */
export function decodeOutputConfig(bytes: Uint8Array): OutputConfig {
  const offset = { val: 0 };
  let port = 0;
  let apiKey = "";

  while (offset.val < bytes.length) {
    const key = decodeVarint(bytes, offset);
    const wireType = key & 7;
    const fieldNumber = key >>> 3;

    if (fieldNumber === 1 && wireType === 0) {
      port = decodeVarint(bytes, offset);
    } else if (fieldNumber === 2 && wireType === 2) {
      const len = decodeVarint(bytes, offset);
      const strBytes = bytes.subarray(offset.val, offset.val + len);
      apiKey = textDecoder.decode(strBytes);
      offset.val += len;
    } else {
      // Skip unknown fields to remain forward-compatible
      if (wireType === 0) {
        decodeVarint(bytes, offset);
      } else if (wireType === 2) {
        const len = decodeVarint(bytes, offset);
        offset.val += len;
      } else if (wireType === 1) {
        offset.val += 8; // 64-bit float/int
      } else if (wireType === 5) {
        offset.val += 4; // 32-bit float/int
      } else {
        throw new Error(`Unsupported wire type: ${wireType}`);
      }
    }
  }

  return { port, apiKey };
}
