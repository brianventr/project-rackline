import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { ContactShadows, OrbitControls } from "@react-three/drei";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import * as THREE from "three";
import { PhysicalCamera, WebGLPathTracer } from "three-gpu-pathtracer";
import {
  backdropById,
  cropFrame,
  fitDistance,
  rotateEquirect,
  studioDirection,
  studioPresetById,
  verticalFovForFocalLength,
} from "@/domain/cad-lab";
import { FinishMaterials, STUDIO_TEXTURE_WIDTH, equirectTexture, studioPixels, sweepEnvironmentTexture, sweepGeometry, sweepMaterial } from "./studio";
import { disposeModel, type LoadedModel } from "./model-loader";

export type ToneMappingId = "neutral" | "agx" | "aces";

export type ViewerLook = {
  studio: string;
  backdrop: string;
  glossyFloor: boolean;
  /** Stops of exposure, 0 is neutral. */
  exposure: number;
  envIntensity: number;
  /** Degrees the studio turns around the product. */
  envRotation: number;
  toneMapping: ToneMappingId;
  lens: number;
  dof: boolean;
  fStop: number;
};

/** Quarter turns: about the vertical (turn), the left-right axis (tip), and the view axis (roll). */
export type Orientation = { turn: number; tip: number; roll: number };

export type CameraView = "three-quarter" | "front" | "side" | "top";

export type ViewerHandle = {
  scene: THREE.Scene;
  camera: PhysicalCamera;
  canvas: HTMLCanvasElement;
  frame: (view: CameraView) => void;
};

export const TONE_MAPPINGS: Record<ToneMappingId, THREE.ToneMapping> = {
  neutral: THREE.NeutralToneMapping,
  agx: THREE.AgXToneMapping,
  aces: THREE.ACESFilmicToneMapping,
};

/** Layer the sweep lives on: the main camera sees it, contact shadows and picking do not. */
const SWEEP_LAYER = 1;

type Props = {
  model: LoadedModel | null;
  /** Changes when a different model opens, so the camera reframes. */
  modelKey: string;
  assign: Record<string, string>;
  tints: Record<string, string>;
  hidden: string[];
  look: ViewerLook;
  orientation: Orientation;
  photo: boolean;
  /** A still render is reading the scene: hide raster-only helpers and the selection glow. */
  still: boolean;
  paused: boolean;
  maxSamples: number;
  selectedPart: string | null;
  /** Aspect of the render crop frame to draw, or null for none. */
  crop: number | null;
  onSelectPart: (id: string | null) => void;
  onSamples: (samples: number) => void;
  onReady: (handle: ViewerHandle | null) => void;
};

export function CadViewer(props: Props) {
  const camera = useMemo(() => {
    const cam = new PhysicalCamera(27, 1, 0.01, 100);
    cam.layers.enable(SWEEP_LAYER);
    cam.position.set(1, 0.6, 1.6);
    return cam;
  }, []);
  const [aspect, setAspect] = useState(1);
  const pointerDown = useRef<{ x: number; y: number } | null>(null);
  const transparent = backdropById(props.look.backdrop).background === "transparent";

  return (
    <div
      className="relative h-full w-full overflow-hidden"
      style={transparent ? CHECKER : undefined}
      onPointerDown={(event) => {
        pointerDown.current = { x: event.clientX, y: event.clientY };
      }}
    >
      <Canvas
        camera={camera}
        dpr={[1, 2]}
        gl={{ antialias: true, preserveDrawingBuffer: true, alpha: true, powerPreference: "high-performance" }}
        onCreated={(state) => {
          state.raycaster.firstHitOnly = true;
          state.gl.setClearColor(0x000000, 0);
        }}
        onPointerMissed={(event) => {
          const start = pointerDown.current;
          if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 4) return;
          props.onSelectPart(null);
        }}
      >
        <AspectWatcher onAspect={setAspect} />
        <Stage {...props} camera={camera} />
      </Canvas>
      {props.crop ? <CropOverlay viewAspect={aspect} renderAspect={props.crop} /> : null}
    </div>
  );
}

const CHECKER = {
  backgroundColor: "#f4f4f5",
  backgroundImage:
    "linear-gradient(45deg, #e4e4e7 25%, transparent 25%), linear-gradient(-45deg, #e4e4e7 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #e4e4e7 75%), linear-gradient(-45deg, transparent 75%, #e4e4e7 75%)",
  backgroundSize: "20px 20px",
  backgroundPosition: "0 0, 0 10px, 10px -10px, -10px 0",
};

function AspectWatcher({ onAspect }: { onAspect: (aspect: number) => void }) {
  const size = useThree((state) => state.size);
  useEffect(() => {
    if (size.height > 0) onAspect(size.width / size.height);
  }, [size.width, size.height, onAspect]);
  return null;
}

/** Shades everything outside the render's crop so the frame on screen is the frame in the PNG. */
function CropOverlay({ viewAspect, renderAspect }: { viewAspect: number; renderAspect: number }) {
  const frame = cropFrame(viewAspect, renderAspect);
  return (
    <div className="pointer-events-none absolute inset-0 grid place-items-center">
      <div
        className="rounded-sm outline outline-1 outline-white/80"
        style={{
          width: `${frame.width * 100}%`,
          height: `${frame.height * 100}%`,
          boxShadow: "0 0 0 100vmax rgba(17, 20, 26, 0.45)",
        }}
      />
    </div>
  );
}

type Bounds = { radius: number; height: number; box: THREE.Box3 };

function Stage(props: Props & { camera: PhysicalCamera }) {
  const { model, look, orientation, photo, still, paused, camera } = props;
  const clean = photo || still;
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const size = useThree((state) => state.size);
  const controls = useRef<OrbitControlsImpl | null>(null);
  const orient = useRef<THREE.Group>(null);
  const place = useRef<THREE.Group>(null);
  const [bounds, setBounds] = useState<Bounds | null>(null);
  const [sceneVersion, setSceneVersion] = useState(0);
  const [envVersion, setEnvVersion] = useState(0);
  const materials = useMemo(() => new FinishMaterials(), []);
  useEffect(() => () => materials.dispose(), [materials]);
  const tracer = useRef<PathTracer | null>(null);
  useEffect(
    () => () => {
      tracer.current?.tracer.dispose();
      tracer.current = null;
    },
    [],
  );

  const backdrop = backdropById(look.backdrop);
  const radius = bounds?.radius ?? 0.5;

  // Free a model once this renderer has swapped it out, so no frame draws a disposed geometry back to life.
  useEffect(() => {
    if (!model) return;
    return () => disposeModel(model);
  }, [model]);

  // Orientation: lay the long side across the frame, apply the quarter turns, rest it on the floor.
  useLayoutEffect(() => {
    const group = orient.current;
    const holder = place.current;
    if (!group || !holder) return;
    if (!model) {
      setBounds(null);
      return;
    }
    group.quaternion.identity();
    group.position.set(0, 0, 0);
    holder.position.set(0, 0, 0);
    holder.updateMatrixWorld(true);
    const raw = new THREE.Box3().setFromObject(model.root);
    const auto = raw.max.z - raw.min.z > raw.max.x - raw.min.x ? Math.PI / 2 : 0;
    const q = new THREE.Quaternion()
      .setFromAxisAngle(new THREE.Vector3(0, 1, 0), (orientation.turn * Math.PI) / 2)
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), (orientation.tip * Math.PI) / 2))
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), (orientation.roll * Math.PI) / 2))
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), auto));
    group.quaternion.copy(q);
    holder.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(group);
    const center = box.getCenter(new THREE.Vector3());
    holder.position.set(-center.x, -box.min.y, -center.z);
    holder.updateMatrixWorld(true);
    const sizeVec = box.getSize(new THREE.Vector3());
    // The box as it sits on the floor, for framing.
    const placed = box.clone().translate(holder.position);
    setBounds({ radius: Math.max(1e-3, sizeVec.length() / 2), height: sizeVec.y, box: placed });
  }, [model, orientation.turn, orientation.tip, orientation.roll]);

  // Finishes, selection glow, and hidden parts.
  const hiddenKey = props.hidden.join(",");
  useLayoutEffect(() => {
    if (!model) return;
    const hidden = new Set(props.hidden);
    for (const part of model.parts) {
      const finishId = props.assign[part.id] ?? part.defaultFinish;
      const base = materials.get(finishId, props.tints[finishId] ?? null, part.cadColor);
      part.mesh.material = props.selectedPart === part.id && !clean ? materials.highlight(base) : base;
      part.mesh.visible = !hidden.has(part.id);
    }
    setSceneVersion((v) => v + 1);
  }, [model, props.assign, props.tints, hiddenKey, props.selectedPart, clean, materials]);

  // The sweep, scaled to the product.
  const sweep = useMemo(() => (bounds ? sweepGeometry(bounds.radius) : null), [bounds]);
  const sweepMat = useMemo(() => sweepMaterial(backdrop.color ?? "#ffffff", look.glossyFloor), [backdrop.color, look.glossyFloor]);
  useEffect(() => () => sweep?.dispose(), [sweep]);
  useEffect(() => () => sweepMat.dispose(), [sweepMat]);
  const sweepRef = useRef<THREE.Mesh>(null);
  useLayoutEffect(() => {
    sweepRef.current?.layers.set(SWEEP_LAYER);
    setSceneVersion((v) => v + 1);
  }, [sweep, sweepMat, backdrop.background]);

  // The studio environment and the background. The path tracer gets the bare studio and traces the real
  // sweep; the raster preview gets the studio with the sweep painted in, so its reflections match.
  const pixels = useMemo(() => studioPixels(studioPresetById(look.studio)), [look.studio]);
  const envTexture = useMemo(() => equirectTexture(pixels, STUDIO_TEXTURE_WIDTH), [pixels]);
  useEffect(() => () => envTexture.dispose(), [envTexture]);
  const probeHeight = bounds ? bounds.height / 2 / bounds.radius : 0.5;
  // The sweep stays put when the lights turn, so it is baked into an already-turned studio.
  const sweptTexture = useMemo(
    () =>
      backdrop.background === "sweep" && backdrop.color
        ? sweepEnvironmentTexture(
            rotateEquirect(pixels, STUDIO_TEXTURE_WIDTH, STUDIO_TEXTURE_WIDTH / 2, (look.envRotation * Math.PI) / 180),
            backdrop.color,
            probeHeight,
          )
        : null,
    [pixels, backdrop.background, backdrop.color, probeHeight, look.envRotation],
  );
  useEffect(() => () => sweptTexture?.dispose(), [sweptTexture]);
  useLayoutEffect(() => {
    const rotation = (look.envRotation * Math.PI) / 180;
    const swept = !clean && sweptTexture;
    scene.environment = swept ? sweptTexture : envTexture;
    scene.environmentIntensity = look.envIntensity;
    scene.environmentRotation.set(0, swept ? 0 : rotation, 0);
    scene.backgroundRotation.set(0, rotation, 0);
    // Only the studio background follows the light level; a sweep color stays the color it says.
    scene.backgroundIntensity = backdrop.background === "studio" ? look.envIntensity : 1;
    if (backdrop.background === "sweep") {
      scene.background = new THREE.Color(backdrop.color ?? "#ffffff");
      scene.backgroundBlurriness = 0;
    } else if (backdrop.background === "studio") {
      scene.background = envTexture;
      scene.backgroundBlurriness = 0.25;
    } else {
      scene.background = null;
    }
    gl.toneMapping = TONE_MAPPINGS[look.toneMapping];
    gl.toneMappingExposure = Math.pow(2, look.exposure);
    setEnvVersion((v) => v + 1);
  }, [scene, gl, envTexture, sweptTexture, clean, look.envIntensity, look.envRotation, look.toneMapping, look.exposure, backdrop.background, backdrop.color]);
  useEffect(
    () => () => {
      scene.environment = null;
      scene.background = null;
    },
    [scene],
  );

  // Lens and depth of field. A lens change keeps the framing by moving the camera along its line.
  useLayoutEffect(() => {
    const fov = verticalFovForFocalLength(look.lens);
    const target = controls.current?.target ?? new THREE.Vector3();
    if (Math.abs(camera.fov - fov) > 1e-3) {
      const offset = camera.position.clone().sub(target);
      const scale = Math.sin(THREE.MathUtils.degToRad(camera.fov) / 2) / Math.sin(THREE.MathUtils.degToRad(fov) / 2);
      camera.position.copy(target).add(offset.multiplyScalar(scale));
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
    // three derives focal length from a 35 mm film gauge across the wider side; a 36 × 24 mm frame makes
    // getFocalLength() equal the lens, so the path tracer's aperture is lens / f-stop at any aspect.
    camera.filmGauge = 24 * Math.max(size.width / Math.max(1, size.height), 1);
    camera.fStop = look.dof ? look.fStop : 1e5;
    camera.apertureBlades = look.dof ? 7 : 0;
    camera.focusDistance = camera.position.distanceTo(target);
    setEnvVersion((v) => v + 1);
  }, [camera, look.lens, look.dof, look.fStop, size.width, size.height]);

  const frame = useMemo(
    () => (view: CameraView) => {
      if (!bounds) return;
      const target = new THREE.Vector3(0, bounds.height / 2, 0);
      const direction =
        view === "front"
          ? new THREE.Vector3(...studioDirection(0, 6))
          : view === "side"
            ? new THREE.Vector3(...studioDirection(90, 6))
            : view === "top"
              ? new THREE.Vector3(0.0001, 1, 0.02).normalize()
              : new THREE.Vector3(...studioDirection(32, 24));
      // Fit the eight box corners in camera axes for this view, so long, flat products fill the frame.
      const toCamera = direction.clone().normalize();
      const right = new THREE.Vector3(0, 1, 0).cross(toCamera).normalize();
      const up = toCamera.clone().cross(right);
      const corners: [number, number, number][] = [];
      const { min, max } = bounds.box;
      for (const x of [min.x, max.x])
        for (const y of [min.y, max.y])
          for (const z of [min.z, max.z]) {
            const p = new THREE.Vector3(x, y, z).sub(target);
            corners.push([p.dot(right), p.dot(up), p.dot(toCamera)]);
          }
      const aspect = size.height > 0 ? size.width / size.height : camera.aspect;
      const distance = Math.max(bounds.radius * 0.5, fitDistance(corners, camera.fov, aspect, 1.12));
      // A tight near/far ratio keeps depth precise enough for the contact shadow to sit just above the floor.
      camera.near = bounds.radius / 50;
      camera.far = bounds.radius * 80;
      camera.position.copy(target).add(toCamera.multiplyScalar(distance));
      camera.updateProjectionMatrix();
      camera.lookAt(target);
      camera.focusDistance = distance;
      const orbit = controls.current;
      if (orbit) {
        orbit.target.copy(target);
        orbit.minDistance = bounds.radius * 0.4;
        orbit.maxDistance = Math.max(bounds.radius * 12, distance * 3);
        orbit.update();
      }
      setEnvVersion((v) => v + 1);
    },
    [bounds, camera, size.width, size.height],
  );

  // Reframe when a different model opens or its orientation changes.
  const framedFor = useRef("");
  useEffect(() => {
    if (!bounds) return;
    const key = `${props.modelKey}|${orientation.turn}|${orientation.tip}|${orientation.roll}`;
    if (framedFor.current === key) return;
    framedFor.current = key;
    frame("three-quarter");
  }, [bounds, frame, props.modelKey, orientation.turn, orientation.tip, orientation.roll]);

  const onReady = props.onReady;
  useEffect(() => {
    onReady({ scene, camera, canvas: gl.domElement, frame });
  }, [onReady, scene, camera, gl, frame]);
  useEffect(() => () => onReady(null), [onReady]);

  const onClick = (event: ThreeEvent<MouseEvent>) => {
    if (clean || event.delta > 4) return;
    event.stopPropagation();
    const id = event.object.userData.partId;
    props.onSelectPart(typeof id === "string" ? id : null);
  };

  const shadowKey = `${props.modelKey}|${orientation.turn}|${orientation.tip}|${orientation.roll}|${hiddenKey}|${bounds?.radius ?? 0}`;

  return (
    <>
      <group ref={place}>
        <group ref={orient}>{model ? <primitive object={model.root} onClick={onClick} /> : null}</group>
      </group>
      {sweep ? (
        <mesh ref={sweepRef} geometry={sweep} material={sweepMat} visible={backdrop.background === "sweep"} />
      ) : null}
      {/* Raster only, and mounted rather than hidden: drei turns its group visible again after each shadow pass. */}
      {bounds && backdrop.background === "sweep" && !clean ? (
        <ContactShadows
          key={shadowKey}
          frames={1}
          position={[0, radius * 0.003, 0]}
          scale={radius * 3}
          far={radius * 0.9}
          blur={2.8}
          opacity={0.7}
          resolution={1024}
          color="#000000"
        />
      ) : null}
      <OrbitControls
        ref={controls}
        makeDefault
        enableDamping
        dampingFactor={0.14}
        maxPolarAngle={backdrop.background === "sweep" ? Math.PI / 2 - 0.03 : Math.PI}
        onChange={() => {
          camera.focusDistance = camera.position.distanceTo(controls.current?.target ?? new THREE.Vector3());
          // Straight to the tracer, not through state: damping fires this every frame of a drag.
          const current = tracer.current;
          if (photo && current?.ready) current.tracer.updateCamera();
        }}
      />
      <Renderer
        tracer={tracer}
        photo={photo}
        paused={paused}
        maxSamples={props.maxSamples}
        sceneVersion={sceneVersion}
        cameraVersion={envVersion}
        onSamples={props.onSamples}
      />
    </>
  );
}

type PathTracer = { tracer: WebGLPathTracer; ready: boolean };

/**
 * Draws every frame: the raster studio normally, the path tracer in photo mode (it resets whenever the
 * camera, a finish, or the light changes, and stops once it has `maxSamples` per pixel).
 */
function Renderer({
  tracer: tracerRef,
  photo,
  paused,
  maxSamples,
  sceneVersion,
  cameraVersion,
  onSamples,
}: {
  tracer: { current: PathTracer | null };
  photo: boolean;
  paused: boolean;
  maxSamples: number;
  sceneVersion: number;
  cameraVersion: number;
  onSamples: (samples: number) => void;
}) {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);
  const viewport = useThree((state) => state.viewport);
  const size = useThree((state) => state.size);
  // Built the first time photo mode opens, so plain viewing never compiles the path tracing shader.
  const tracerFor = () => {
    if (!tracerRef.current) {
      const t = new WebGLPathTracer(gl);
      t.tiles.set(2, 2);
      t.bounces = 6;
      t.transmissiveBounces = 6;
      t.filterGlossyFactor = 0.5;
      t.minSamples = 1;
      t.renderDelay = 0;
      t.fadeDuration = 200;
      t.dynamicLowRes = true;
      t.lowResScale = 0.25;
      tracerRef.current = { tracer: t, ready: false };
    }
    tracerRef.current.tracer.renderScale = Math.max(0.5, 1 / viewport.dpr);
    return tracerRef.current;
  };

  useEffect(() => {
    if (!photo) {
      if (tracerRef.current) tracerRef.current.ready = false;
      return;
    }
    const current = tracerFor();
    current.tracer.setScene(scene, camera);
    current.ready = true;
    onSamples(0);
  }, [photo, sceneVersion, scene, camera, onSamples, viewport.dpr]);

  // A resize changes the camera's aspect and clears the canvas, so the tracer starts over at the new size.
  useEffect(() => {
    const current = tracerRef.current;
    if (!photo || !current?.ready) return;
    current.tracer.updateEnvironment();
    current.tracer.updateCamera();
    onSamples(0);
  }, [photo, cameraVersion, tracerRef, onSamples, size.width, size.height]);

  const reported = useRef(-1);
  useFrame(() => {
    if (paused) return;
    const current = tracerRef.current;
    if (!photo || !current?.ready) {
      gl.render(scene, camera);
      return;
    }
    const tracer = current.tracer;
    // Once converged, keep compositing the finished image (cheap) so a cleared canvas never stays blank.
    tracer.pausePathTracing = tracer.samples >= maxSamples;
    tracer.renderSample();
    const samples = Math.floor(tracer.samples);
    if (samples !== reported.current) {
      reported.current = samples;
      onSamples(samples);
    }
  }, 1);
  return null;
}
