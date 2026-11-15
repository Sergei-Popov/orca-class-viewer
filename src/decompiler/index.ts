// The boundary for full decompilation, planned for a later version. A decompiler turns a class,
// with the classes it needs from the same archive, into Java source with method bodies. This
// version bundles none: the Outline tab shows the declarations from this plugin's own reader, and
// method bodies stay compiled code that the Bytecode tab lists.
//
// A decompiler behind this boundary runs inside the editor's frame, offline, on the bytes Orca
// sends. It may take long on big classes, so it is asynchronous and can be cancelled.

export type DecompileInput = {
  /** Binary name of the class, such as demo/Outer. */
  name: string
  bytes: Uint8Array
  /** Other classes it may read, such as nested classes from the same archive. */
  resolve?: (name: string) => Uint8Array | undefined
}

export type DecompileResult = { ok: true; source: string; warnings: string[] } | { ok: false; error: string }

export interface Decompiler {
  /** Shown to the reader with the result, with its version and licence. */
  readonly name: string
  readonly version: string
  readonly licence: string
  decompile(input: DecompileInput, signal?: AbortSignal): Promise<DecompileResult>
}

/** The bundled decompiler; none in this version. */
export const decompiler: Decompiler | undefined = undefined
