declare module "occt-import-js" {
  type OcctModule = {
    ReadStepFile(content: Uint8Array, params: Record<string, unknown> | null): unknown;
  };
  /** Emscripten factory for OpenCascade's STEP reader. `locateFile` points it at the .wasm. */
  export default function occtimportjs(options?: { locateFile?: (path: string) => string }): Promise<OcctModule>;
}
