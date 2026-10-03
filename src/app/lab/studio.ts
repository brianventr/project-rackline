import * as THREE from "three";
import {
  SWEEP_SHAPE,
  bakeSweepEnvironment,
  finishById,
  hexToLinearRgb,
  linearRgbToHex,
  studioEnvironmentPixels,
  type LinearRgb,
  type StudioPreset,
} from "@/domain/cad-lab";

export const STUDIO_TEXTURE_WIDTH = 1024;

/**
 * The studio as a float equirect texture. The raster viewer prefilters it (PMREM) for reflections;
 * the path tracer importance-samples it directly, so softboxes light, reflect, and cast soft shadows.
 */
export function equirectTexture(pixels: Float32Array, width: number): THREE.DataTexture {
  const texture = new THREE.DataTexture(pixels, width, width / 2, THREE.RGBAFormat, THREE.FloatType);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.colorSpace = THREE.LinearSRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

export function studioPixels(preset: StudioPreset, width = STUDIO_TEXTURE_WIDTH): Float32Array {
  return studioEnvironmentPixels(preset, width, width / 2);
}

/** The raster preview's environment with the sweep painted in (see bakeSweepEnvironment). */
export function sweepEnvironmentTexture(pixels: Float32Array, sweepColor: string, probeHeight: number, width = STUDIO_TEXTURE_WIDTH): THREE.DataTexture {
  return equirectTexture(bakeSweepEnvironment(pixels, width, width / 2, hexToLinearRgb(sweepColor), probeHeight), width);
}

/**
 * A seamless photo sweep (cyclorama): floor toward the camera, a curve, and a wall behind, sized in
 * multiples of the product's bounding radius `r`. Normals face the product, so it lights like paper.
 */
export function sweepGeometry(r: number): THREE.BufferGeometry {
  const width = SWEEP_SHAPE.width * r;
  const front = SWEEP_SHAPE.front * r;
  const back = SWEEP_SHAPE.back * r;
  const curve = SWEEP_SHAPE.curve * r;
  const height = SWEEP_SHAPE.height * r;
  const profile: { y: number; z: number; ny: number; nz: number }[] = [];
  profile.push({ y: 0, z: front, ny: 1, nz: 0 });
  const steps = 24;
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * (Math.PI / 2);
    profile.push({ y: curve - curve * Math.cos(t), z: -back + curve - curve * Math.sin(t), ny: Math.cos(t), nz: Math.sin(t) });
  }
  profile.push({ y: height, z: -back, ny: 0, nz: 1 });

  const columns = 2;
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (let p = 0; p < profile.length; p++) {
    const point = profile[p]!;
    for (let c = 0; c < columns; c++) {
      const x = -width / 2 + (width * c) / (columns - 1);
      positions.push(x, point.y, point.z);
      normals.push(0, point.ny, point.nz);
      uvs.push(c / (columns - 1), p / (profile.length - 1));
    }
  }
  for (let p = 0; p < profile.length - 1; p++) {
    const a = p * columns;
    const b = (p + 1) * columns;
    indices.push(a, a + 1, b, a + 1, b + 1, b);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  return geometry;
}

/** Paper for a matte sweep, or an acrylic sheet with a clear coat when the floor should reflect. */
export function sweepMaterial(color: string, glossy: boolean): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(color),
    roughness: glossy ? 0.32 : 0.92,
    metalness: 0,
    clearcoat: glossy ? 1 : 0,
    clearcoatRoughness: glossy ? 0.04 : 0,
    specularIntensity: glossy ? 1 : 0.35,
    // Pushed back in depth so the raster contact shadow, a hair above the floor, always draws over it.
    polygonOffset: true,
    polygonOffsetFactor: 2,
    polygonOffsetUnits: 2,
  });
}

/**
 * One physical material per finish (and tint, and CAD color for "keep the CAD color" finishes), shared by
 * every part that wears it so a scene of 70 parts stays at a handful of materials.
 */
export class FinishMaterials {
  private cache = new Map<string, THREE.MeshPhysicalMaterial>();
  private highlighted = new Map<THREE.Material, THREE.MeshPhysicalMaterial>();

  get(finishId: string, tint: string | null, cadColor: LinearRgb | null): THREE.MeshPhysicalMaterial {
    const finish = finishById(finishId);
    const color = tint ?? (finish.color === "cad" ? linearRgbToHex(cadColor ?? [0.52, 0.52, 0.52]) : finish.color);
    const key = `${finish.id}|${color}`;
    let material = this.cache.get(key);
    if (!material) {
      material = new THREE.MeshPhysicalMaterial({
        name: finish.label,
        color: new THREE.Color(color),
        metalness: finish.metalness,
        roughness: finish.roughness,
        clearcoat: finish.clearcoat ?? 0,
        clearcoatRoughness: finish.clearcoatRoughness ?? 0,
        sheen: finish.sheen ?? 0,
        sheenRoughness: finish.sheenRoughness ?? 1,
        sheenColor: new THREE.Color(finish.sheenColor ?? "#000000"),
        transmission: finish.transmission ?? 0,
        ior: finish.ior ?? 1.5,
        thickness: finish.thickness ?? 0,
        side: finish.transmission ? THREE.DoubleSide : THREE.FrontSide,
      });
      this.cache.set(key, material);
    }
    return material;
  }

  /** A copy that glows indigo, for the selected part in the raster view. */
  highlight(material: THREE.MeshPhysicalMaterial): THREE.MeshPhysicalMaterial {
    let copy = this.highlighted.get(material);
    if (!copy) {
      copy = material.clone();
      copy.emissive = new THREE.Color("#6366f1");
      copy.emissiveIntensity = 0.45;
      this.highlighted.set(material, copy);
    }
    return copy;
  }

  dispose() {
    for (const material of this.cache.values()) material.dispose();
    for (const material of this.highlighted.values()) material.dispose();
    this.cache.clear();
    this.highlighted.clear();
  }
}
