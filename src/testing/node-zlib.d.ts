// Node's zlib, which only the tests use (they run in Node): it compresses test entries with
// the real DEFLATE encoder so the decoder meets dynamic, fixed and stored blocks.
declare module 'node:zlib' {
  export function deflateRawSync(data: Uint8Array, options?: { level?: number; strategy?: number }): Uint8Array
  export const constants: { Z_FIXED: number; Z_HUFFMAN_ONLY: number; Z_RLE: number; Z_DEFAULT_STRATEGY: number }
}
