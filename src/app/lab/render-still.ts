import * as THREE from "three";
import { FullScreenQuad } from "three/examples/jsm/postprocessing/Pass.js";
import { DenoiseMaterial, PhysicalCamera, WebGLPathTracer } from "three-gpu-pathtracer";
import { renderTiles } from "@/domain/cad-lab";

export type StillOptions = {
  scene: THREE.Scene;
  camera: PhysicalCamera;
  width: number;
  height: number;
  /** Vertical field of view for the crop frame (see cropVerticalFov). */
  fov: number;
  samples: number;
  bounces: number;
  toneMapping: THREE.ToneMapping;
  exposure: number;
  denoise: boolean;
  transparent: boolean;
  /** Where the live render is shown while it converges. */
  canvas: HTMLCanvasElement;
  signal: AbortSignal;
  onProgress: (samples: number, elapsedMs: number) => void;
};

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/**
 * Path-trace one still at full resolution on its own WebGL context, so the viewer keeps its size and
 * the GPU work is split into tiles. Resolves with a PNG once `samples` samples per pixel are in.
 */
export async function renderStill(options: StillOptions): Promise<Blob> {
  const { canvas, width, height, signal } = options;
  canvas.width = width;
  canvas.height = height;
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    alpha: true,
    preserveDrawingBuffer: true,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = options.toneMapping;
  renderer.toneMappingExposure = options.exposure;
  renderer.setClearColor(0x000000, 0);

  const camera = new PhysicalCamera();
  camera.copy(options.camera);
  // A crop narrows the view, not the lens opening: keep the viewer's aperture diameter for the depth of field.
  const aperture = options.camera.bokehSize;
  camera.fov = options.fov;
  camera.aspect = width / height;
  camera.filmGauge = 24 * Math.max(camera.aspect, 1);
  camera.updateProjectionMatrix();
  camera.bokehSize = aperture;
  camera.updateMatrixWorld();

  const tracer = new WebGLPathTracer(renderer);
  const tiles = renderTiles(width, height);
  tracer.tiles.set(tiles.x, tiles.y);
  tracer.bounces = options.bounces;
  tracer.transmissiveBounces = 6;
  tracer.filterGlossyFactor = 0.25;
  tracer.renderDelay = 0;
  tracer.fadeDuration = 0;
  tracer.minSamples = 1;
  tracer.dynamicLowRes = false;
  tracer.rasterizeScene = false;
  tracer.synchronizeRenderSize = true;

  // The denoise kernel already returns premultiplied color, so the material must not multiply by alpha again.
  const denoiser = options.denoise
    ? new FullScreenQuad(new DenoiseMaterial({ sigma: 2.4, threshold: 0.06, kSigma: 1, transparent: true, premultipliedAlpha: false }))
    : null;
  tracer.renderToCanvasCallback = (target, gl, quad) => {
    gl.setClearColor(0x000000, 0);
    gl.clear();
    if (denoiser && tracer.samples >= options.samples) {
      (denoiser.material as DenoiseMaterial).map = target.texture;
      denoiser.render(gl);
    } else {
      quad.render(gl);
    }
  };

  const started = performance.now();
  try {
    // Building the BVH blocks for a moment on big assemblies; let the dialog paint "Preparing" first.
    await nextFrame();
    tracer.setScene(options.scene, camera);

    // WebGL calls return before the GPU runs them, so submitting "as fast as the CPU can" would queue the
    // whole render at once: a frozen tab, a progress bar that lies, and a Stop that cannot stop. Instead
    // one batch of tiles is in flight at a time, fenced, and grown or shrunk to about 20–60 ms of GPU work.
    const gl = renderer.getContext() as WebGL2RenderingContext;
    const tilesPerSample = tiles.x * tiles.y;
    const targetTiles = options.samples * tilesPerSample;
    let batch = 1;
    let submittedTiles = 0;
    let doneTiles = 0;
    let inflight: { sync: WebGLSync | null; tiles: number; at: number } | null = null;
    let shownAt = 0;
    // `isCompiling` exists on WebGLPathTracer but is missing from its typings.
    const compiling = () => Boolean((tracer as unknown as { isCompiling?: boolean }).isCompiling);
    const composite = () => {
      tracer.pausePathTracing = true;
      tracer.renderToCanvas = true;
      tracer.renderSample();
      tracer.pausePathTracing = false;
      tracer.renderToCanvas = false;
    };
    tracer.renderToCanvas = false;
    while (doneTiles < targetTiles) {
      if (signal.aborted) throw new DOMException("Render cancelled", "AbortError");
      if (inflight) {
        const state = inflight.sync ? gl.clientWaitSync(inflight.sync, 0, 0) : gl.ALREADY_SIGNALED;
        if (state === gl.TIMEOUT_EXPIRED) {
          await nextFrame();
          continue;
        }
        const gpuMs = performance.now() - inflight.at;
        if (inflight.sync) gl.deleteSync(inflight.sync);
        doneTiles += inflight.tiles;
        inflight = null;
        if (gpuMs < 20) batch = Math.min(batch * 2, 64);
        else if (gpuMs > 60) batch = Math.max(1, Math.floor(batch / 2));
        const now = performance.now();
        if (now - shownAt > 500 && doneTiles < targetTiles) {
          // Show progress on the canvas: a composite of what has been traced so far, no new samples.
          composite();
          shownAt = now;
        }
        options.onProgress(Math.min(options.samples, Math.floor(doneTiles / tilesPerSample)), now - started);
      }
      if (submittedTiles < targetTiles && !compiling()) {
        // Count what the tracer actually rendered: nothing while its shader is still compiling.
        const before = tracer.samples;
        const count = Math.min(batch, targetTiles - submittedTiles);
        for (let i = 0; i < count; i++) tracer.renderSample();
        const rendered = Math.round((tracer.samples - before) * tilesPerSample);
        if (rendered > 0) {
          submittedTiles += rendered;
          inflight = { sync: gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0), tiles: rendered, at: performance.now() };
          gl.flush();
        }
      }
      await nextFrame();
    }
    options.onProgress(options.samples, performance.now() - started);
    tracer.pausePathTracing = true;
    tracer.renderToCanvas = true;
    tracer.renderSample();
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("The browser could not encode the PNG"))), "image/png"),
    );
  } finally {
    tracer.dispose();
    denoiser?.dispose();
    denoiser?.material.dispose();
    renderer.dispose();
    // Free the context now (browsers cap live WebGL contexts); the page shows the PNG instead.
    renderer.forceContextLoss();
  }
}
