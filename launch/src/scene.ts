import {
  AmbientLight as ThreeAmbientLight,
  AnimationMixer as ThreeAnimationMixer,
  BufferAttribute as ThreeBufferAttribute,
  BufferGeometry as ThreeBufferGeometry,
  CanvasTexture as ThreeCanvasTexture,
  Color as ThreeColor,
  DirectionalLight as ThreeDirectionalLight,
  Euler as ThreeEuler,
  Fog as ThreeFog,
  FloatType as ThreeFloatType,
  Group as ThreeGroup,
  HalfFloatType as ThreeHalfFloatType,
  InstancedMesh as ThreeInstancedMesh,
  LoadingManager as ThreeLoadingManager,
  LinearFilter as ThreeLinearFilter,
  LinearSRGBColorSpace as ThreeLinearSRGBColorSpace,
  LoopOnce as ThreeLoopOnce,
  Material as ThreeMaterial,
  MathUtils as ThreeMathUtils,
  Matrix3 as ThreeMatrix3,
  Matrix4 as ThreeMatrix4,
  Mesh as ThreeMesh,
  MeshStandardMaterial as ThreeMeshStandardMaterial,
  NoColorSpace as ThreeNoColorSpace,
  NoToneMapping as ThreeNoToneMapping,
  Object3D as ThreeObject3D,
  PerspectiveCamera as ThreePerspectiveCamera,
  PlaneGeometry as ThreePlaneGeometry,
  Points as ThreePoints,
  Quaternion as ThreeQuaternion,
  RGBAFormat as ThreeRGBAFormat,
  RepeatWrapping as ThreeRepeatWrapping,
  Scene as ThreeScene,
  ShaderMaterial as ThreeShaderMaterial,
  SRGBColorSpace as ThreeSRGBColorSpace,
  Texture as ThreeTexture,
  TextureLoader as ThreeTextureLoader,
  Vector2 as ThreeVector2,
  Vector3 as ThreeVector3,
  WebGLRenderer as ThreeWebGLRenderer,
  type AnimationAction as ThreeAnimationAction,
} from "three";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

import {
  EXPERIENCE_CONFIG,
  decideQuality,
  estimateGpuMemory,
  estimateTextureStorageBytes,
  isMobileViewport,
  nextLowerQuality,
  percentile90,
  qualityIndex,
  seededRandom,
  selectDrawCallMitigation,
  selectGpuMemoryMitigation,
  selectGpuSafeRenderPixelLimit,
  type GpuMemoryEstimate,
} from "./config";
import {
  runBestEffortCleanup,
  ShaderFailureLatch,
} from "./lifecycle";
import { disposeObject3D, ResourceScope } from "./resource-scope";
import {
  UPSTREAM_CAMERA,
  UPSTREAM_GATE,
  UPSTREAM_POSTPROCESS_ORDER,
  UPSTREAM_RANDOM_WARMUP_CALLS,
  UPSTREAM_REFERENCE_PROFILE,
  UPSTREAM_ROAD,
  advanceUpstreamCameraZ,
  backOut,
  createUpstreamLegacyColor,
  createUpstreamGradientTexture,
  createUpstreamHashFog,
  createUpstreamHdrTarget,
  createUpstreamTransitionPass,
  cubicIn,
  cubicOut,
  estimateUpstreamBloomTargetBytes,
  evaluateUpstreamTransition,
  setTransitionValues,
  tuneUpstreamMaterial,
  tuneUpstreamWhitePlaneMaterial,
  UPSTREAM_BLOOM,
  UPSTREAM_LIGHTS,
  UPSTREAM_HDR_COLOR_BYTES_PER_PIXEL,
  UPSTREAM_WHITE_PLANE_COLOR_SCALE,
  UpstreamMipmapBloomPass,
  type UpstreamHashFog,
  type UpstreamTransitionValues,
} from "./scene-fidelity";
import {
  UPSTREAM_CLOUD_POSITIONS,
  UPSTREAM_SCENERY_LAYOUT,
  type UpstreamSceneryId,
} from "./upstream-layout";
import type {
  LaunchCapability,
  LaunchClock,
  LaunchDebugState,
  LaunchMotionMilestone,
  LaunchMotionMilestonePayload,
  LaunchMotionStage,
  LaunchProgress,
  LaunchRuntimeManifest,
  LaunchSceneAdapter,
  QualityLevel,
  RuntimeAsset,
  SceneAction,
} from "./types";
import { normalizeAssetMap } from "./types";

// Keep the implementation readable while preserving named-import tree shaking.
// Type/value pairs are declared separately because constructor aliases lose the
// instance type when accessed through an object literal.
namespace THREE {
  export const AmbientLight = ThreeAmbientLight;
  export const AnimationMixer = ThreeAnimationMixer;
  export type AnimationMixer = ThreeAnimationMixer;
  export type AnimationAction = ThreeAnimationAction;
  export const BufferAttribute = ThreeBufferAttribute;
  export const BufferGeometry = ThreeBufferGeometry;
  export type BufferGeometry = ThreeBufferGeometry;
  export const CanvasTexture = ThreeCanvasTexture;
  export const Color = ThreeColor;
  export const DirectionalLight = ThreeDirectionalLight;
  export const Euler = ThreeEuler;
  export const Fog = ThreeFog;
  export const Group = ThreeGroup;
  export const InstancedMesh = ThreeInstancedMesh;
  export type InstancedMesh = ThreeInstancedMesh;
  export const LoadingManager = ThreeLoadingManager;
  export const LinearFilter = ThreeLinearFilter;
  export const LinearSRGBColorSpace = ThreeLinearSRGBColorSpace;
  export const LoopOnce = ThreeLoopOnce;
  export type Material = ThreeMaterial;
  export const MathUtils = ThreeMathUtils;
  export const Matrix3 = ThreeMatrix3;
  export const Matrix4 = ThreeMatrix4;
  export type Matrix4 = ThreeMatrix4;
  export const Mesh = ThreeMesh;
  export type Mesh = ThreeMesh;
  export const MeshStandardMaterial = ThreeMeshStandardMaterial;
  export const NoColorSpace = ThreeNoColorSpace;
  export const NoToneMapping = ThreeNoToneMapping;
  export const Object3D = ThreeObject3D;
  export type Object3D = ThreeObject3D;
  export const PerspectiveCamera = ThreePerspectiveCamera;
  export type PerspectiveCamera = ThreePerspectiveCamera;
  export const PlaneGeometry = ThreePlaneGeometry;
  export const Points = ThreePoints;
  export type Points = ThreePoints;
  export const Quaternion = ThreeQuaternion;
  export const RepeatWrapping = ThreeRepeatWrapping;
  export type Quaternion = ThreeQuaternion;
  export const Scene = ThreeScene;
  export type Scene = ThreeScene;
  export const ShaderMaterial = ThreeShaderMaterial;
  export type ShaderMaterial = ThreeShaderMaterial;
  export const SRGBColorSpace = ThreeSRGBColorSpace;
  export const Texture = ThreeTexture;
  export type Texture = ThreeTexture;
  export const TextureLoader = ThreeTextureLoader;
  export type TextureLoader = ThreeTextureLoader;
  export const Vector2 = ThreeVector2;
  export const Vector3 = ThreeVector3;
  export type Vector3 = ThreeVector3;
  export const WebGLRenderer = ThreeWebGLRenderer;
  export type WebGLRenderer = ThreeWebGLRenderer;
}

interface SceneOptions {
  canvas: HTMLCanvasElement;
  manifest: LaunchRuntimeManifest;
  signal: AbortSignal;
  scope: ResourceScope;
  clock: LaunchClock;
  seed: number;
  fixedQuality?: QualityLevel;
  shouldRenderFrame?: () => boolean;
  onProgress: (progress: LaunchProgress) => void;
  onFirstFrame: () => void;
  onCapability: (capability: LaunchCapability, available: boolean) => void;
  onFatal: (reason: unknown) => void;
  generation?: number;
  onMotionMilestone?: (payload: LaunchMotionMilestonePayload) => void;
}

interface ScalableInstances {
  mesh: THREE.InstancedMesh;
  counts: readonly [number, number, number];
}

interface RoadSegmentState {
  object: THREE.Object3D;
  slices: RoadSegmentSlice[];
  initialPosition: THREE.Vector3;
  settledY: number;
  riseStartedAt: number | null;
}

interface RoadSegmentSlice {
  position: ThreeBufferAttribute;
  startVertex: number;
  basePositions: Float32Array;
}

interface RoadMergeEntry {
  state: RoadSegmentState;
  geometry: THREE.BufferGeometry;
}

interface DoorGeometrySlice {
  source: THREE.Mesh;
  position: ThreeBufferAttribute;
  normal: ThreeBufferAttribute;
  startVertex: number;
  basePositions: Float32Array;
  baseNormals: Float32Array;
}

interface DoorMergeEntry {
  source: THREE.Mesh;
  geometry: THREE.BufferGeometry;
  basePositions: Float32Array;
  baseNormals: Float32Array;
}

interface FidelitySceneDebug {
  motionStage: LaunchMotionStage;
  cameraZ: number;
  cameraCenterZ: number;
  roadWrapCount: number;
  roadSegmentCount: number;
  gateTriggerZ: number | null;
  gateDoorZ: number | null;
  doorFormationTime: number;
  transitionIntensity: number;
  whiteAlpha: number;
  referenceProfile: typeof UPSTREAM_REFERENCE_PROFILE;
  postprocessOrder: readonly string[];
}

const TEXTURE_PROPERTIES = [
  "map",
  "alphaMap",
  "aoMap",
  "bumpMap",
  "displacementMap",
  "emissiveMap",
  "envMap",
  "lightMap",
  "metalnessMap",
  "normalMap",
  "roughnessMap",
] as const;

const TIER_ZERO_IDS = [
  "model.road",
  "model.door",
  "model.whitePlane",
  "model.bridge01",
  "model.bridge02",
  "model.bridge03",
  "model.bridge04",
  "model.bigCloud",
  "texture.cloud",
  "texture.cloud0",
  "texture.cloud1",
  "texture.star",
] as const;

const COLUMN_IDS = [
  "model.column01",
  "model.column02",
  "model.column03",
  "model.column04",
] as const;

const READY_VISUAL_IDS = [
  ...TIER_ZERO_IDS,
  ...COLUMN_IDS,
  "model.light",
  "texture.light",
] as const;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function bloomResolutionScale(quality: QualityLevel): number {
  if (quality === "high") return UPSTREAM_BLOOM.resolutionScale;
  if (quality === "medium") return UPSTREAM_BLOOM.resolutionScale * 0.7;
  return UPSTREAM_BLOOM.resolutionScale * 0.5;
}

function shadowResolution(quality: QualityLevel): number {
  if (quality === "high") return 1_024;
  if (quality === "medium") return 512;
  return 256;
}

/** High/medium keep the locked PNG payload even on phones; only an initially
 * low-quality session opts into the derived 512px mobile texture. */
export function selectSceneRuntimeAsset(
  asset: RuntimeAsset,
  mobile: boolean,
  initialQuality: QualityLevel,
): RuntimeAsset {
  if (!mobile || initialQuality !== "low" || !asset.mobileUrl) return asset;
  return {
    ...asset,
    url: asset.mobileUrl,
    ...(asset.mobileBytes !== undefined ? { bytes: asset.mobileBytes } : {}),
    ...(asset.mobileSha256 !== undefined
      ? { sha256: asset.mobileSha256 }
      : {}),
  };
}

function textureIdentity(texture: THREE.Texture): string {
  // GLTFLoader preserves the source image name. The locked upstream column
  // models reuse identically named image payloads, while each loader assigns a
  // different blob URL; prefer the stable name so those GPU textures dedupe.
  if (texture.name) return `name:${texture.name}`;
  const image = texture.source.data as
    | { currentSrc?: string; src?: string; width?: number; height?: number }
    | undefined;
  const source = image?.currentSrc || image?.src;
  if (source) return `source:${source}`;
  return `unique:${texture.uuid}`;
}

function copyTextureSettings(
  source: THREE.Texture,
  destination: THREE.Texture,
): void {
  destination.name = source.name;
  destination.mapping = source.mapping;
  destination.channel = source.channel;
  destination.wrapS = source.wrapS;
  destination.wrapT = source.wrapT;
  destination.magFilter = source.magFilter;
  destination.minFilter = source.minFilter;
  destination.anisotropy = Math.min(source.anisotropy, 4);
  destination.colorSpace = source.colorSpace;
  destination.flipY = source.flipY;
  destination.generateMipmaps = source.generateMipmaps;
  destination.premultiplyAlpha = source.premultiplyAlpha;
  destination.unpackAlignment = source.unpackAlignment;
  destination.offset.copy(source.offset);
  destination.repeat.copy(source.repeat);
  destination.center.copy(source.center);
  destination.rotation = source.rotation;
  destination.matrixAutoUpdate = source.matrixAutoUpdate;
  destination.matrix.copy(source.matrix);
  destination.needsUpdate = true;
}

function downscaleTexture(
  texture: THREE.Texture,
  maxDimension: number,
): THREE.Texture {
  const image = texture.source.data as CanvasImageSource & {
    naturalWidth?: number;
    naturalHeight?: number;
    videoWidth?: number;
    videoHeight?: number;
    width?: number;
    height?: number;
  };
  if (!image) return texture;

  const width = image.naturalWidth || image.videoWidth || image.width || 0;
  const height = image.naturalHeight || image.videoHeight || image.height || 0;
  if (!width || !height || Math.max(width, height) <= maxDimension) {
    return texture;
  }

  const scale = maxDimension / Math.max(width, height);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext("2d", { alpha: true });
  if (!context) return texture;

  try {
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
  } catch {
    return texture;
  }

  const replacement = new THREE.CanvasTexture(canvas);
  copyTextureSettings(texture, replacement);
  return replacement;
}

function optimizeModelTextures(
  root: THREE.Object3D,
  mobile: boolean,
  canonicalTextures: Map<string, THREE.Texture>,
  convertedTextures: WeakMap<THREE.Texture, THREE.Texture>,
): void {
  const processTexture = (texture: THREE.Texture): THREE.Texture => {
    const converted = convertedTextures.get(texture);
    if (converted) return converted;

    const key = textureIdentity(texture);
    const canonical = canonicalTextures.get(key);
    if (canonical) {
      convertedTextures.set(texture, canonical);
      if (canonical !== texture) texture.dispose();
      return canonical;
    }

    const optimized = mobile ? downscaleTexture(texture, 512) : texture;
    if (optimized !== texture) texture.dispose();
    convertedTextures.set(texture, optimized);
    canonicalTextures.set(key, optimized);
    return optimized;
  };

  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.material) return;
    const materials = Array.isArray(mesh.material)
      ? mesh.material
      : [mesh.material];
    for (const material of materials) {
      const values = material as THREE.Material &
        Partial<Record<(typeof TEXTURE_PROPERTIES)[number], THREE.Texture>>;
      for (const property of TEXTURE_PROPERTIES) {
        const texture = values[property];
        if (texture) values[property] = processTexture(texture);
      }
      material.needsUpdate = true;
    }
  });
}

function tuneMaterials(
  root: THREE.Object3D,
  renderer: THREE.WebGLRenderer,
  variant: "road" | "door" | "scenery" = "scenery",
): void {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.frustumCulled = true;
    mesh.castShadow = variant !== "road";
    mesh.receiveShadow = true;
    const materials = Array.isArray(mesh.material)
      ? mesh.material
      : [mesh.material];
    for (const material of materials) {
      if (material instanceof THREE.MeshStandardMaterial) {
        tuneUpstreamMaterial(material, variant, renderer);
      }
    }
  });
}

interface SceneStorageEstimate {
  textureBytes: number;
  geometryBytes: number;
}

interface ImageDimensions {
  width: number;
  height: number;
  layers: number;
}

function imageDimensions(source: unknown): ImageDimensions {
  const images = Array.isArray(source) ? source : [source];
  const first = images[0] as
    | {
        width?: number;
        height?: number;
        naturalWidth?: number;
        naturalHeight?: number;
        videoWidth?: number;
        videoHeight?: number;
      }
    | undefined;
  return {
    width: first?.naturalWidth || first?.videoWidth || first?.width || 1024,
    height: first?.naturalHeight || first?.videoHeight || first?.height || 1024,
    layers: Math.max(1, images.length),
  };
}

function estimateSceneStorage(root: THREE.Object3D): SceneStorageEstimate {
  const textures = new Set<THREE.Texture>();
  const textureSources = new Set<unknown>();
  const materials = new Set<THREE.Material>();
  const geometries = new Set<THREE.BufferGeometry>();
  const buffers = new Set<ArrayBufferLike>();
  let textureBytes = 0;
  let geometryBytes = 0;

  const addBuffer = (value: unknown): void => {
    const view = value as { buffer?: ArrayBufferLike; byteLength?: number } | undefined;
    if (!view?.buffer || buffers.has(view.buffer)) return;
    buffers.add(view.buffer);
    geometryBytes += view.buffer.byteLength;
  };

  const addTexture = (texture: THREE.Texture): void => {
    if (textures.has(texture)) return;
    textures.add(texture);
    const source = texture.source?.data ?? texture;
    if (textureSources.has(source)) return;
    textureSources.add(source);
    const dimensions = imageDimensions(source);
    const bytesPerPixel =
      texture.type === ThreeFloatType
        ? 16
        : texture.type === ThreeHalfFloatType
          ? 8
          : 4;
    textureBytes += estimateTextureStorageBytes(
      dimensions.width,
      dimensions.height,
      bytesPerPixel,
      texture.generateMipmaps,
      dimensions.layers,
    );
  };

  const addMaterial = (material: THREE.Material): void => {
    if (materials.has(material)) return;
    materials.add(material);
    const values = material as THREE.Material &
      Partial<Record<(typeof TEXTURE_PROPERTIES)[number], THREE.Texture>>;
    for (const property of TEXTURE_PROPERTIES) {
      const texture = values[property];
      if (texture) addTexture(texture);
    }
    if (material instanceof THREE.ShaderMaterial) {
      for (const uniform of Object.values(material.uniforms)) {
        if (uniform.value instanceof THREE.Texture) addTexture(uniform.value);
      }
    }
  };

  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.geometry && !geometries.has(mesh.geometry)) {
      geometries.add(mesh.geometry);
      for (const attribute of Object.values(mesh.geometry.attributes)) {
        const storage = attribute as unknown as {
          array?: unknown;
          data?: { array?: unknown };
        };
        addBuffer(storage.array ?? storage.data?.array);
      }
      if (mesh.geometry.index) addBuffer(mesh.geometry.index.array);
      for (const attributes of Object.values(mesh.geometry.morphAttributes)) {
        if (!attributes) continue;
        for (const attribute of attributes) addBuffer(attribute.array);
      }
    }
    if (mesh.material) {
      const meshMaterials = Array.isArray(mesh.material)
        ? mesh.material
        : [mesh.material];
      for (const material of meshMaterials) addMaterial(material);
    }
    const instanced = object as THREE.InstancedMesh;
    if (instanced.isInstancedMesh) {
      addBuffer(instanced.instanceMatrix.array);
      if (instanced.instanceColor) addBuffer(instanced.instanceColor.array);
    }
  });

  return { textureBytes, geometryBytes };
}

function upstreamMatrices(id: UpstreamSceneryId): THREE.Matrix4[] {
  const layout = UPSTREAM_SCENERY_LAYOUT[id];
  const matrices: THREE.Matrix4[] = [];
  for (let offset = 0; offset < layout.length; offset += 9) {
    const position = new THREE.Vector3(
      layout[offset] ?? 0,
      layout[offset + 1] ?? 0,
      layout[offset + 2] ?? 0,
    );
    const rotation = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(
        layout[offset + 3] ?? 0,
        layout[offset + 4] ?? 0,
        layout[offset + 5] ?? 0,
      ),
    );
    const scale = new THREE.Vector3(
      layout[offset + 6] ?? 1,
      layout[offset + 7] ?? 1,
      layout[offset + 8] ?? 1,
    );
    matrices.push(new THREE.Matrix4().compose(position, rotation, scale));
  }
  return matrices.sort(
    (left, right) => right.elements[14] - left.elements[14],
  );
}

const ACES_INVERSE_SHADER = /* glsl */ `
  vec3 invRrtOdtFit(vec3 value) {
    vec3 numerator = -(
      sqrt(10.0) * sqrt(
        -187248350.0 * pow(value, vec3(2.0))
        + 232585567.0 * value
        + 241290.0
      ) + 21650.0 * value - 1230.0
    );
    return numerator / (98370.0 * value - 100000.0);
  }
  mat3 matrixFromRows(vec3 row0, vec3 row1, vec3 row2) {
    return transpose(mat3(row0, row1, row2));
  }
  vec3 inverseAces(vec3 color) {
    mat3 outputMatrix = matrixFromRows(
      vec3(0.64304, 0.31119, 0.04578),
      vec3(0.05926, 0.93144, 0.00929),
      vec3(0.00596, 0.06393, 0.93012)
    );
    mat3 inputMatrix = matrixFromRows(
      vec3(1.76474, -0.67577, -0.08896),
      vec3(-0.14702, 1.16025, -0.01322),
      vec3(-0.03633, -0.16243, 1.19877)
    );
    return inputMatrix * invRrtOdtFit(outputMatrix * color);
  }
`;

function createCloudMaterial(texture: THREE.Texture): THREE.ShaderMaterial {
  texture.colorSpace = THREE.NoColorSpace;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return new THREE.ShaderMaterial({
    name: "yurisa-cloud-mask-material",
    uniforms: {
      cloudTexture: { value: texture },
      colorLow: { value: createUpstreamLegacyColor(0x00a2f0) },
      colorHigh: { value: createUpstreamLegacyColor(0xf0f0f5) },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      float randomCell(vec2 value) {
        return fract(sin(dot(value, vec2(12.9898, 78.233))) * 43758.5453123);
      }
      void main() {
        vec3 origin = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        float cellIndex = ceil(randomCell(origin.xy) * 8.0);
        vec2 cellSize = vec2(0.5, 0.25);
        vUv = uv * cellSize + vec2(
          mod(cellIndex, 2.0) * cellSize.x,
          (ceil(cellIndex / 2.0) - 1.0) * cellSize.y
        );
        vec4 transformed = instanceMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * modelViewMatrix * transformed;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D cloudTexture;
      uniform vec3 colorLow;
      uniform vec3 colorHigh;
      varying vec2 vUv;
      ${ACES_INVERSE_SHADER}
      void main() {
        vec4 mask = texture2D(cloudTexture, vUv);
        vec3 color = mix(colorLow, colorHigh, pow(mask.r, 0.6));
        gl_FragColor = vec4(inverseAces(color), mask.a);
      }
    `,
    transparent: true,
    depthWrite: false,
  });
}

function createBigCloudMaterial(
  texture: THREE.Texture,
  background: boolean,
): THREE.ShaderMaterial {
  texture.colorSpace = THREE.NoColorSpace;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return new THREE.ShaderMaterial({
    name: background
      ? "yurisa-big-cloud-background-material"
      : "yurisa-big-cloud-material",
    uniforms: { cloudTexture: { value: texture } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = vec2(uv.x, 1.0 - uv.y);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: background
      ? /* glsl */ `
          uniform sampler2D cloudTexture;
          varying vec2 vUv;
          void main() {
            float mask = texture2D(cloudTexture, vUv).r;
            gl_FragColor = vec4(vec3(1.8), mask * 0.4);
          }
        `
      : /* glsl */ `
          uniform sampler2D cloudTexture;
          varying vec2 vUv;
          ${ACES_INVERSE_SHADER}
          void main() {
            vec4 mask = texture2D(cloudTexture, vUv);
            vec3 color = mix(
              vec3(23.0, 145.0, 250.0) / 255.0,
              vec3(0.93),
              pow(mask.r, 0.4)
            );
            gl_FragColor = vec4(inverseAces(color), mask.a);
          }
        `,
    transparent: true,
    depthWrite: false,
  });
}

function createAuroraMaterial(texture: THREE.Texture): THREE.ShaderMaterial {
  texture.colorSpace = THREE.NoColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return new THREE.ShaderMaterial({
    name: "yurisa-aurora-material",
    uniforms: {
      lightTexture: { value: texture },
      time: { value: 123 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vWorldPosition;
      void main() {
        vUv = vec2(uv.x, 1.0 - uv.y);
        vec4 transformed = instanceMatrix * vec4(position, 1.0);
        vec4 worldPosition = modelMatrix * transformed;
        vWorldPosition = worldPosition.xyz;
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D lightTexture;
      uniform float time;
      varying vec2 vUv;
      varying vec3 vWorldPosition;
      void main() {
        float mask = 1.5 * texture2D(lightTexture, vUv + vec2(time * 0.015, 0.0)).r;
        mask += texture2D(
          lightTexture,
          vUv * vec2(0.4, 1.0) + vec2(time * -0.0075, 0.0)
        ).r;
        float distanceFade = smoothstep(200.0, 1000.0, distance(cameraPosition, vWorldPosition));
        float edgeFade = smoothstep(0.0, 0.5, vUv.y)
          * smoothstep(0.0, 0.1, vUv.x)
          * smoothstep(1.0, 0.9, vUv.x);
        gl_FragColor = vec4(vec3(1.8), mask * distanceFade * edgeFade);
      }
    `,
    transparent: true,
    depthWrite: false,
  });
}

function createStarMaterial(
  texture: THREE.Texture,
): THREE.ShaderMaterial {
  texture.colorSpace = THREE.NoColorSpace;
  return new THREE.ShaderMaterial({
    name: "yurisa-star-mask-material",
    uniforms: {
      starTexture: { value: texture },
      time: { value: 0 },
      size: { value: 100 },
    },
    vertexShader: /* glsl */ `
      uniform float time;
      uniform float size;
      attribute vec3 color;
      varying vec3 vColor;
      varying vec3 vWorldPosition;
      float randomValue(float seed) {
        return fract(sin(seed) * 43758.5453);
      }
      void main() {
        vColor = color;
        float movement = sin(
          time * (0.1 * randomValue(color.b)) + randomValue(color.g)
        );
        vec3 drift = vec3(
          (randomValue(color.r) - 0.5) * 2.0,
          (randomValue(color.g) - 0.8) * 2.0,
          (randomValue(color.b) - 0.5) * 2.0
        ) * movement * 500.0;
        vec4 worldPosition = modelMatrix * vec4(position + drift, 1.0);
        vWorldPosition = worldPosition.xyz;
        vec4 viewPosition = viewMatrix * worldPosition;
        gl_Position = projectionMatrix * viewPosition;
        gl_PointSize = size * (450.0 / max(1.0, -viewPosition.z));
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D starTexture;
      uniform float time;
      varying vec3 vColor;
      varying vec3 vWorldPosition;
      float randomValue(float seed) {
        return fract(sin(seed) * 43758.5453);
      }
      void main() {
        float cell = floor(randomValue(vColor.r + vColor.g + vColor.b) * 3.0);
        vec2 uv = vec2((gl_PointCoord.x + cell) / 3.0, 1.0 - gl_PointCoord.y);
        float mask = texture2D(starTexture, uv).r;
        float distanceFade = smoothstep(
          1500.0,
          5000.0,
          distance(cameraPosition, vWorldPosition)
        );
        float twinkle = smoothstep(
          0.0,
          0.2,
          sin(time * (1.2 * randomValue(vColor.b) + 0.4) + randomValue(vColor.g)) - 0.8
        );
        gl_FragColor = vec4(vColor, mask * distanceFade * twinkle);
      }
    `,
    transparent: true,
    depthWrite: false,
  });
}

function loadTexture(
  loader: THREE.TextureLoader,
  asset: RuntimeAsset | undefined,
  signal: AbortSignal,
  progressCallback?: (fraction: number) => void,
): Promise<THREE.Texture | null> {
  if (!asset?.url) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Launch load aborted", "AbortError"));
      return;
    }
    const request = new XMLHttpRequest();
    let objectUrl: string | null = null;
    let settled = false;

    const cleanup = (): void => {
      signal.removeEventListener("abort", abortRequest);
      request.onabort = null;
      request.onerror = null;
      request.onload = null;
      request.onprogress = null;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = null;
    };
    const fail = (reason: unknown): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(reason);
    };
    const abortRequest = (): void => {
      request.abort();
      fail(new DOMException("Launch load aborted", "AbortError"));
    };

    signal.addEventListener("abort", abortRequest, { once: true });
    request.open("GET", asset.url, true);
    request.responseType = "blob";
    request.onprogress = (event): void => {
      if (signal.aborted || settled) return;
      const expected = event.total || asset.bytes || 0;
      progressCallback?.(
        expected > 0 ? clamp01(event.loaded / expected) : 0.5,
      );
    };
    request.onerror = (): void => {
      fail(new Error(`Launch texture request failed: ${asset.url}`));
    };
    request.onabort = (): void => {
      fail(new DOMException("Launch load aborted", "AbortError"));
    };
    request.onload = (): void => {
      if (signal.aborted) {
        abortRequest();
        return;
      }
      if ((request.status < 200 || request.status >= 300) && request.status !== 0) {
        fail(
          new Error(
            `Launch texture request failed: ${request.status} ${asset.url}`,
          ),
        );
        return;
      }
      if (!(request.response instanceof Blob)) {
        fail(new Error(`Launch texture response was not a Blob: ${asset.url}`));
        return;
      }
      objectUrl = URL.createObjectURL(request.response);
      loader.load(
        objectUrl,
        (texture) => {
          if (signal.aborted) {
            texture.dispose();
            abortRequest();
            return;
          }
          texture.colorSpace = THREE.SRGBColorSpace;
          progressCallback?.(1);
          settled = true;
          cleanup();
          resolve(texture);
        },
        undefined,
        fail,
      );
    };
    request.send();
  });
}

async function loadRequiredTexture(
  loader: THREE.TextureLoader,
  id: string,
  asset: RuntimeAsset | undefined,
  signal: AbortSignal,
  progressCallback?: (fraction: number) => void,
): Promise<THREE.Texture> {
  if (!asset?.url) {
    throw new Error(`Missing required launch asset: ${id}`);
  }
  const texture = await loadTexture(loader, asset, signal, progressCallback);
  if (!texture) {
    throw new Error(`Required launch texture did not load: ${id}`);
  }
  return texture;
}

export function createLaunchScene(options: SceneOptions): LaunchSceneAdapter {
  const {
    canvas,
    manifest,
    signal,
    scope,
    clock,
    onProgress,
    onFirstFrame,
    onCapability,
    onFatal,
  } = options;
  const mobile = isMobileViewport();
  const initialQuality = options.fixedQuality ?? "high";
  const assets = Object.fromEntries(
    Object.entries(normalizeAssetMap(manifest)).map(([id, asset]) => [
      id,
      selectSceneRuntimeAsset(asset, mobile, initialQuality),
    ]),
  );
  const random = seededRandom(options.seed);
  for (let index = 0; index < UPSTREAM_RANDOM_WARMUP_CALLS; index += 1) {
    random();
  }
  const canonicalTextures = new Map<string, THREE.Texture>();
  const convertedTextures = new WeakMap<THREE.Texture, THREE.Texture>();
  const scalableInstances: ScalableInstances[] = [];
  const frameSamples: number[] = [];
  const gpuBudgetBytes = mobile
    ? EXPERIENCE_CONFIG.performance.mobileGpuBytes
    : EXPERIENCE_CONFIG.performance.desktopGpuBytes;
  const drawCallLimit = mobile
    ? EXPERIENCE_CONFIG.performance.mobileDrawCalls
    : EXPERIENCE_CONFIG.performance.desktopDrawCalls;

  let renderer: THREE.WebGLRenderer | null = null;
  let composer: EffectComposer | null = null;
  let renderPass: RenderPass | null = null;
  let bloomPass: UpstreamMipmapBloomPass | null = null;
  let transitionPass: ShaderPass | null = null;
  let scene: THREE.Scene | null = null;
  let camera: THREE.PerspectiveCamera | null = null;
  // ForwardCamera in the locked r150 source drives the rendered camera from a
  // separate, exported cameraCenter while travelling, then freezes that
  // center when the gate tween takes over. World-follow effects continue to
  // use the frozen center; they must not follow the gate/enter camera tweens.
  const cameraCenter = new THREE.Vector3();
  let gradientTexture: ReturnType<typeof createUpstreamGradientTexture> | null = null;
  let hashFog: UpstreamHashFog | null = null;
  let directionalLight: ThreeDirectionalLight | null = null;
  let directionalTarget: ThreeGroup | null = null;
  let loader: GLTFLoader | null = null;
  let dracoLoader: DRACOLoader | null = null;
  let roadRoot: THREE.Object3D | null = null;
  let roadUnitLength = 0;
  const roadSegments: RoadSegmentState[] = [];
  const cloudPositions: THREE.Vector3[] = [];
  let cloudBatch: THREE.InstancedMesh | null = null;
  let door: THREE.Object3D | null = null;
  let doorWhitePlane: THREE.Object3D | null = null;
  let doorMixers: THREE.AnimationMixer[] = [];
  let doorActions: THREE.AnimationAction[] = [];
  const doorGeometrySlices: DoorGeometrySlice[] = [];
  let bigCloud: THREE.Object3D | null = null;
  let stars: THREE.Points | null = null;
  let starMaterial: THREE.ShaderMaterial | null = null;
  const auroraMaterials: THREE.ShaderMaterial[] = [];
  let rafId = 0;
  let lastFrameAt = 0;
  let gateStartedAt = 0;
  let gateCameraFromZ = 0;
  let gateCameraToZ = 0;
  let gateTriggerZ: number | null = null;
  let gateDoorZ: number | null = null;
  let enterStartedAt = 0;
  let enterCameraFromZ = 0;
  let enterCameraToZ = 0;
  let doorOpeningStarted = false;
  let doorOpeningElapsedSeconds = 0;
  let doorFormationTime = 0;
  let roadWrapCount = 0;
  let roadStopped = false;
  let motionStage: LaunchMotionStage = "idle";
  let transitionValues: UpstreamTransitionValues = {
    intensity: 0,
    whiteAlpha: 0,
  };
  const sentMilestones = new Set<LaunchMotionMilestone>();
  let action: SceneAction | null = null;
  let quality: QualityLevel = initialQuality;
  let badFrameWindows = 0;
  let frameP90Ms = 0;
  let paused = false;
  let pausedAt = 0;
  let disposed = false;
  let firstFrameSent = false;
  let muted = false;
  let decorativeExtrasSuppressed = false;
  let drawCallMitigation = 0;
  let gpuMemoryMitigation = 0;
  let renderPixels = 1;
  let gpuRenderPixelLimit: number | null = null;
  let gpuMemoryDirty = true;
  const shaderFailure = new ShaderFailureLatch();
  let gpuMemoryEstimate: GpuMemoryEstimate = estimateGpuMemory({
    textureBytes: 0,
    geometryBytes: 0,
    renderPixels,
    composer: false,
    bloom: false,
  });
  let fatalSent = false;

  const report = (progress: LaunchProgress): void => {
    try {
      onProgress(progress);
    } catch {
      // Reporting must not turn an optional host integration into a fatal error.
    }
  };

  const emitMotionMilestone = (milestone: LaunchMotionMilestone): void => {
    if (sentMilestones.has(milestone) || disposed) return;
    sentMilestones.add(milestone);
    try {
      options.onMotionMilestone?.({
        generation: options.generation ?? 0,
        milestone,
      });
    } catch {
      // Host milestone handling is outside the renderer's failure boundary.
    }
  };

  const failIfDisposed = (): void => {
    if (disposed || signal.aborted || !scope.alive) {
      throw new DOMException("Launch load aborted", "AbortError");
    }
  };

  const loadModel = (
    id: string,
    required: boolean,
    progressCallback?: (fraction: number) => void,
  ): Promise<GLTF | null> => {
    const asset = assets[id];
    if (!asset?.url) {
      if (required) return Promise.reject(new Error(`Missing required launch asset: ${id}`));
      return Promise.resolve(null);
    }
    if (!loader) return Promise.reject(new Error("GLTF loader is not initialized"));

    return new Promise((resolve, reject) => {
      loader?.load(
        asset.url,
        (gltf) => {
          if (disposed || signal.aborted || !scope.alive) {
            disposeObject3D(gltf.scene);
            reject(new DOMException("Launch load aborted", "AbortError"));
            return;
          }
          optimizeModelTextures(
            gltf.scene,
            mobile,
            canonicalTextures,
            convertedTextures,
          );
          progressCallback?.(1);
          resolve(gltf);
        },
        (event) => {
          const expected = event.total || asset.bytes || 0;
          progressCallback?.(expected > 0 ? clamp01(event.loaded / expected) : 0.5);
        },
        (error) => {
          if (required) reject(error);
          else resolve(null);
        },
      );
    });
  };

  const createRenderer = (): void => {
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      powerPreference: "high-performance",
      preserveDrawingBuffer: false,
    });
    if (!renderer.capabilities.isWebGL2) {
      throw new Error("The launch experience requires WebGL2");
    }
    renderer.debug.checkShaderErrors = true;
    renderer.debug.onShaderError = (
      gl,
      program,
      vertexShader,
      fragmentShader,
    ): void => {
      const readLog = (read: () => string | null): string => {
        try {
          return read()?.trim() || "(no diagnostic log)";
        } catch {
          return "(diagnostic log unavailable)";
        }
      };
      shaderFailure.capture(
        readLog(() => gl.getProgramInfoLog(program)),
        readLog(() => gl.getShaderInfoLog(vertexShader)),
        readLog(() => gl.getShaderInfoLog(fragmentShader)),
      );
    };
    // The locked r150 viewer used LinearEncoding. Its postprocessing
    // ToneMappingPlugin performs ACES, but the final pass does not apply an
    // additional sRGB transfer. LinearSRGBColorSpace preserves that byte-level
    // output contract in r185's OutputPass.
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.toneMappingExposure = 1;
    renderer.shadowMap.enabled = true;
    renderer.info.autoReset = false;
    renderer.setClearColor(createUpstreamLegacyColor(0x26a8ff), 1);

    scene = new THREE.Scene();
    scene.fog = new THREE.Fog(
      createUpstreamLegacyColor(0x389af2),
      5_000,
      10_000,
    );
    camera = new THREE.PerspectiveCamera(
      UPSTREAM_CAMERA.fov,
      1,
      UPSTREAM_CAMERA.near,
      UPSTREAM_CAMERA.far,
    );
    camera.position.set(0, 0, 0);
    cameraCenter.copy(camera.position);
    camera.rotation.x = THREE.MathUtils.degToRad(UPSTREAM_CAMERA.pitchDegrees);

    const initialHeight = Math.max(
      2,
      canvas.parentElement?.clientHeight || window.innerHeight,
    );
    gradientTexture = createUpstreamGradientTexture(initialHeight);
    scene.background = gradientTexture;
    // Keep the author's object-level 6 / 35 contract. tuneUpstreamMaterial
    // ports r150 WebGLLights' useLegacyLights PI multiplier into both ambient
    // and direct shader paths, before the packed-HDR mipmap Bloom and ACES.
    const ambientLight = new THREE.AmbientLight(
      0xffffff,
      UPSTREAM_LIGHTS.ambientIntensity,
    );
    ambientLight.color.copy(
      createUpstreamLegacyColor(UPSTREAM_LIGHTS.ambientColor),
    );
    scene.add(ambientLight);

    directionalLight = new THREE.DirectionalLight(
      0xffffff,
      UPSTREAM_LIGHTS.directionalIntensity,
    );
    directionalLight.color.copy(
      createUpstreamLegacyColor(UPSTREAM_LIGHTS.directionalColor),
    );
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.set(1_024, 1_024);
    directionalLight.shadow.camera.top = 400;
    directionalLight.shadow.camera.bottom = -100;
    directionalLight.shadow.camera.left = -100;
    directionalLight.shadow.camera.right = 400;
    directionalLight.shadow.camera.near = 1;
    directionalLight.shadow.camera.far = 50_000;
    directionalLight.shadow.bias = -0.00005;
    directionalTarget = new THREE.Group();
    directionalTarget.name = "yurisa-upstream-sun-target";
    directionalLight.target = directionalTarget;
    scene.add(directionalTarget, directionalLight);

    hashFog = createUpstreamHashFog();
    hashFog.mesh.position.z = -400;
    scene.add(hashFog.mesh);

    composer = new EffectComposer(
      renderer,
      createUpstreamHdrTarget("YurisaComposer.rt1", false),
    );
    // RenderPass always writes the scene into the composer's read buffer
    // (rt2); all later passes only sample color. Retain depth on that one
    // target and omit the unused rt1 depth renderbuffer. This is real GPU
    // storage removal, not an estimator discount, and leaves the color path
    // byte-for-byte unchanged.
    composer.renderTarget2.depthBuffer = true;
    composer.renderTarget2.texture.type = ThreeHalfFloatType;
    composer.renderTarget2.texture.format = ThreeRGBAFormat;
    renderPass = new RenderPass(scene, camera);
    composer.addPass(renderPass);
    bloomPass = new UpstreamMipmapBloomPass(UPSTREAM_BLOOM);
    composer.addPass(bloomPass);
    transitionPass = createUpstreamTransitionPass(bloomPass.texture);
    composer.addPass(transitionPass);
    onCapability("bloom", true);

    resize();
  };

  const setupLoaders = (): void => {
    const loadingManager = new THREE.LoadingManager();
    loader = new GLTFLoader(loadingManager);
    dracoLoader = new DRACOLoader(loadingManager);
    const decoderPath = manifest.dracoDecoderPath || "/assets/launch/assets/draco/";
    dracoLoader.setDecoderPath(decoderPath.endsWith("/") ? decoderPath : `${decoderPath}/`);
    dracoLoader.setWorkerLimit(mobile ? 2 : 4);
    loader.setDRACOLoader(dracoLoader);
  };

  const syncRoadSegment = (segment: RoadSegmentState): void => {
    const deltaX = segment.object.position.x - segment.initialPosition.x;
    const deltaY = segment.object.position.y - segment.initialPosition.y;
    const deltaZ = segment.object.position.z - segment.initialPosition.z;
    for (const slice of segment.slices) {
      const vertexCount = slice.basePositions.length / 3;
      for (let vertex = 0; vertex < vertexCount; vertex += 1) {
        const source = vertex * 3;
        slice.position.setXYZ(
          slice.startVertex + vertex,
          (slice.basePositions[source] ?? 0) + deltaX,
          (slice.basePositions[source + 1] ?? 0) + deltaY,
          (slice.basePositions[source + 2] ?? 0) + deltaZ,
        );
      }
      slice.position.needsUpdate = true;
    }
  };

  const addRoad = (gltf: GLTF): void => {
    if (!scene || !renderer) return;
    const root = gltf.scene;
    const sourceSegments = [...root.children];
    if (sourceSegments.length !== UPSTREAM_ROAD.sourceSegments) {
      disposeObject3D(root);
      throw new Error(
        `The locked Road GLB must contain ${UPSTREAM_ROAD.sourceSegments} root segments; received ${sourceSegments.length}`,
      );
    }

    tuneMaterials(root, renderer, "road");
    const instancedRoot = new THREE.Group();
    instancedRoot.name = "yurisa-upstream-road";
    roadSegments.length = 0;
    roadUnitLength = sourceSegments.length;
    const originalStates: RoadSegmentState[] = [];
    const extendedStates: RoadSegmentState[] = [];
    const mergeEntries = new Map<THREE.Material, RoadMergeEntry[]>();

    sourceSegments.forEach((segment, sourceIndex) => {
      segment.scale.multiplyScalar(0.1);
      segment.position.multiplyScalar(0.1);
      segment.position.sub(new THREE.Vector3(0, 34, 200));
      segment.updateMatrixWorld(true);
      const segmentInverse = segment.matrixWorld.clone().invert();

      const originalState: RoadSegmentState = {
        object: segment,
        slices: [],
        initialPosition: segment.position.clone(),
        settledY: segment.position.y,
        riseStartedAt: null,
      };
      const clone = new THREE.Object3D();
      clone.position.copy(segment.position);
      clone.quaternion.copy(segment.quaternion);
      clone.scale.copy(segment.scale);
      clone.position.z -= UPSTREAM_ROAD.unitLength;
      const extendedState: RoadSegmentState = {
        object: clone,
        slices: [],
        initialPosition: clone.position.clone(),
        settledY: clone.position.y,
        riseStartedAt: null,
      };

      let primitiveCount = 0;
      segment.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (!mesh.isMesh || !mesh.geometry || !mesh.material) return;
        if (Array.isArray(mesh.material)) {
          throw new Error(
            `The locked Road GLB segment ${sourceIndex} unexpectedly uses grouped materials`,
          );
        }
        mesh.updateMatrixWorld(true);
        const localMatrix = segmentInverse.clone().multiply(mesh.matrixWorld);
        for (const state of [originalState, extendedState]) {
          state.object.updateMatrix();
          const geometry = mesh.geometry.clone();
          geometry.applyMatrix4(
            new THREE.Matrix4().multiplyMatrices(
              state.object.matrix,
              localMatrix,
            ),
          );
          const entries = mergeEntries.get(mesh.material) ?? [];
          entries.push({ state, geometry });
          mergeEntries.set(mesh.material, entries);
        }
        primitiveCount += 1;
      });
      if (primitiveCount === 0) {
        throw new Error(
          `The locked Road GLB segment ${sourceIndex} has no mergeable primitives`,
        );
      }

      originalStates.push(originalState);
      extendedStates.push(extendedState);
    });

    let materialIndex = 0;
    for (const [material, entries] of mergeEntries) {
      const geometries = entries.map((entry) => entry.geometry);
      const mergedGeometry = mergeGeometries(geometries);
      if (!mergedGeometry) {
        for (const geometry of geometries) geometry.dispose();
        throw new Error(
          `The locked Road GLB material batch ${materialIndex} could not be merged`,
        );
      }
      const mergedPosition = mergedGeometry.getAttribute(
        "position",
      ) as ThreeBufferAttribute;
      let startVertex = 0;
      entries.forEach((entry) => {
        const sourcePosition = entry.geometry.getAttribute("position");
        const basePositions = new Float32Array(sourcePosition.count * 3);
        for (let vertex = 0; vertex < sourcePosition.count; vertex += 1) {
          const offset = vertex * 3;
          basePositions[offset] = sourcePosition.getX(vertex);
          basePositions[offset + 1] = sourcePosition.getY(vertex);
          basePositions[offset + 2] = sourcePosition.getZ(vertex);
        }
        entry.state.slices.push({
          position: mergedPosition,
          startVertex,
          basePositions,
        });
        startVertex += sourcePosition.count;
        entry.geometry.dispose();
      });
      const batch = new THREE.Mesh(mergedGeometry, material);
      batch.name = `yurisa-upstream-road-material-${materialIndex}`;
      batch.castShadow = false;
      batch.receiveShadow = true;
      // The authored subsegments continuously exchange loop positions. The
      // merged geometry's initial aggregate bound becomes stale after a wrap.
      batch.frustumCulled = false;
      instancedRoot.add(batch);
      materialIndex += 1;
    }
    roadSegments.push(...originalStates, ...extendedStates);

    // The locked GLB has two materials across 24 independently moving road
    // subsegments. Baking the unchanged transforms into two dynamic geometry
    // buffers preserves the exact loop/rise motion while reducing the road to
    // one draw submission per authored material on every WebGL2 implementation.
    root.clear();
    roadRoot = instancedRoot;
    scene.add(instancedRoot);
    gpuMemoryDirty = true;
  };

  const addDoor = (gltf: GLTF): void => {
    if (!scene || !renderer) return;
    if (gltf.animations.length !== 14) {
      disposeObject3D(gltf.scene);
      throw new Error(
        `The locked Door GLB must contain 14 animation clips; received ${gltf.animations.length}`,
      );
    }
    tuneMaterials(gltf.scene, renderer, "door");
    door = gltf.scene;
    door.name = "yurisa-gate";
    door.scale.set(0.1, 0.1, 0.04);
    door.position.set(0, -34, 0);
    door.visible = false;
    door.updateMatrixWorld(true);

    const doorInverse = door.matrixWorld.clone().invert();
    const mergeEntries = new Map<THREE.Material, DoorMergeEntry[]>();
    const proxyGeometry = new THREE.BufferGeometry();
    const sourceMeshes: THREE.Mesh[] = [];
    door.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh || !mesh.geometry || !mesh.material) return;
      if (Array.isArray(mesh.material)) {
        throw new Error("The locked Door GLB unexpectedly uses grouped materials");
      }
      mesh.updateMatrixWorld(true);
      const position = mesh.geometry.getAttribute("position");
      const normal = mesh.geometry.getAttribute("normal");
      if (!position || !normal) {
        throw new Error("The locked Door GLB requires position and normal attributes");
      }
      const basePositions = new Float32Array(position.count * 3);
      const baseNormals = new Float32Array(normal.count * 3);
      for (let vertex = 0; vertex < position.count; vertex += 1) {
        const offset = vertex * 3;
        basePositions[offset] = position.getX(vertex);
        basePositions[offset + 1] = position.getY(vertex);
        basePositions[offset + 2] = position.getZ(vertex);
        baseNormals[offset] = normal.getX(vertex);
        baseNormals[offset + 1] = normal.getY(vertex);
        baseNormals[offset + 2] = normal.getZ(vertex);
      }
      const geometry = mesh.geometry.clone();
      geometry.applyMatrix4(
        doorInverse.clone().multiply(mesh.matrixWorld),
      );
      const entries = mergeEntries.get(mesh.material) ?? [];
      entries.push({ source: mesh, geometry, basePositions, baseNormals });
      mergeEntries.set(mesh.material, entries);
      sourceMeshes.push(mesh);
    });
    if (sourceMeshes.length !== 12) {
      throw new Error(
        `The locked Door GLB must contain 12 render meshes; received ${sourceMeshes.length}`,
      );
    }

    doorGeometrySlices.length = 0;
    let materialIndex = 0;
    for (const [material, entries] of mergeEntries) {
      const geometries = entries.map((entry) => entry.geometry);
      const mergedGeometry = mergeGeometries(geometries);
      if (!mergedGeometry) {
        for (const geometry of geometries) geometry.dispose();
        throw new Error(
          `The locked Door GLB material batch ${materialIndex} could not be merged`,
        );
      }
      const mergedPosition = mergedGeometry.getAttribute(
        "position",
      ) as ThreeBufferAttribute;
      const mergedNormal = mergedGeometry.getAttribute(
        "normal",
      ) as ThreeBufferAttribute;
      let startVertex = 0;
      entries.forEach((entry) => {
        doorGeometrySlices.push({
          source: entry.source,
          position: mergedPosition,
          normal: mergedNormal,
          startVertex,
          basePositions: entry.basePositions,
          baseNormals: entry.baseNormals,
        });
        startVertex += entry.basePositions.length / 3;
        entry.geometry.dispose();
      });
      const batch = new THREE.Mesh(mergedGeometry, material);
      batch.name = `yurisa-upstream-door-material-${materialIndex}`;
      batch.castShadow = true;
      batch.receiveShadow = true;
      batch.frustumCulled = false;
      door.add(batch);
      materialIndex += 1;
    }
    for (const source of sourceMeshes) {
      const originalGeometry = source.geometry;
      source.geometry = proxyGeometry;
      source.visible = false;
      originalGeometry.dispose();
    }
    scene.add(door);

    // The locked Road component creates one mixer per clip. Putting all 14
    // clips on one mixer makes tracks that target the same node blend with one
    // another and materially changes the gate silhouette.
    doorMixers = gltf.animations.map(() => new THREE.AnimationMixer(door!));
    doorActions = gltf.animations.map((clip, index) => {
      const action = doorMixers[index]?.clipAction(clip);
      if (!action) throw new Error("Door animation mixer did not initialize");
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
      return action;
    });

    gpuMemoryDirty = true;
  };

  const syncDoorGeometry = (): void => {
    if (!door || doorGeometrySlices.length === 0) return;
    door.updateMatrixWorld(true);
    const doorInverse = door.matrixWorld.clone().invert();
    const localMatrix = new THREE.Matrix4();
    const normalMatrix = new THREE.Matrix3();
    const transformedPosition = new THREE.Vector3();
    const transformedNormal = new THREE.Vector3();
    for (const slice of doorGeometrySlices) {
      localMatrix.multiplyMatrices(doorInverse, slice.source.matrixWorld);
      normalMatrix.getNormalMatrix(localMatrix);
      const vertexCount = slice.basePositions.length / 3;
      for (let vertex = 0; vertex < vertexCount; vertex += 1) {
        const offset = vertex * 3;
        transformedPosition
          .set(
            slice.basePositions[offset] ?? 0,
            slice.basePositions[offset + 1] ?? 0,
            slice.basePositions[offset + 2] ?? 0,
          )
          .applyMatrix4(localMatrix);
        transformedNormal
          .set(
            slice.baseNormals[offset] ?? 0,
            slice.baseNormals[offset + 1] ?? 0,
            slice.baseNormals[offset + 2] ?? 0,
          )
          .applyNormalMatrix(normalMatrix);
        slice.position.setXYZ(
          slice.startVertex + vertex,
          transformedPosition.x,
          transformedPosition.y,
          transformedPosition.z,
        );
        slice.normal.setXYZ(
          slice.startVertex + vertex,
          transformedNormal.x,
          transformedNormal.y,
          transformedNormal.z,
        );
      }
      slice.position.needsUpdate = true;
      slice.normal.needsUpdate = true;
    }
  };

  const addDoorWhitePlane = (gltf: GLTF | null): void => {
    if (!scene || !gltf) return;
    const root = gltf.scene;
    root.name = "yurisa-gate-white-plane";
    root.scale.setScalar(0.1);
    root.position.set(0, -34, 0);
    root.visible = false;
    root.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      const materials = Array.isArray(mesh.material)
        ? mesh.material
        : [mesh.material];
      for (const material of materials) {
        if (!(material instanceof THREE.MeshStandardMaterial)) continue;
        material.color
          .set(0xffffff)
          .multiplyScalar(UPSTREAM_WHITE_PLANE_COLOR_SCALE);
        tuneUpstreamWhitePlaneMaterial(material);
        material.needsUpdate = true;
      }
    });
    doorWhitePlane = root;
    scene.add(root);
    gpuMemoryDirty = true;
  };

  const addInstancedModel = (
    gltf: GLTF,
    placements: readonly THREE.Matrix4[],
    capability: LaunchCapability,
    counts: readonly [number, number, number],
    materialFactory?: (material: THREE.Material) => THREE.Material,
  ): void => {
    if (!scene) return;
    let created = 0;
    gltf.scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh || !mesh.geometry || !mesh.material) return;
      const material = Array.isArray(mesh.material)
        ? mesh.material.map((item) => materialFactory?.(item) ?? item)
        : materialFactory?.(mesh.material) ?? mesh.material;
      const instances = new THREE.InstancedMesh(
        mesh.geometry,
        material,
        placements.length,
      );
      instances.name = `yurisa-${capability}-instances`;
      instances.frustumCulled = true;
      instances.castShadow = capability === "bridge" || capability === "pillars";
      instances.receiveShadow = capability === "bridge" || capability === "pillars";
      for (let index = 0; index < placements.length; index += 1) {
        // The fixed upstream instance table already supplies the complete
        // transform. Multiplying mesh.matrixWorld here would reapply the
        // exported 9.459x node scale and create camera-filling geometry.
        const matrix = placements[index];
        if (matrix) instances.setMatrixAt(index, matrix);
      }
      instances.instanceMatrix.needsUpdate = true;
      if (capability === "aurora") {
        instances.count = counts[qualityIndex(quality)];
        scalableInstances.push({ mesh: instances, counts });
      } else {
        // Locked bridge and pillar placement is part of the author reference.
        // Quality changes may never thin these instances.
        instances.count = counts[0];
      }
      scene?.add(instances);
      created += 1;
    });
    if (created > 0) {
      onCapability(capability, true);
      gpuMemoryDirty = true;
    }
  };

  const addBridgeModels = (models: Array<GLTF | null>): void => {
    if (!renderer) return;
    const activeRenderer = renderer;
    if (!models.some(Boolean)) {
      onCapability("bridge", false);
      return;
    }
    models.forEach((model, modelIndex) => {
      if (!model) return;
      tuneMaterials(model.scene, activeRenderer);
      const id = `bridge0${modelIndex + 1}` as UpstreamSceneryId;
      const placements = upstreamMatrices(id);
      const count = placements.length;
      addInstancedModel(model, placements, "bridge", [count, count, count]);
    });
  };

  const addClouds = (texture: THREE.Texture | null): void => {
    if (!scene) return;
    if (!texture) throw new Error("The cloud atlas was unavailable");
    const geometry = new THREE.PlaneGeometry(3_000, 1_500);
    const material = createCloudMaterial(texture);
    cloudPositions.length = 0;
    for (let offset = 0; offset < UPSTREAM_CLOUD_POSITIONS.length; offset += 3) {
      cloudPositions.push(
        new THREE.Vector3(
          UPSTREAM_CLOUD_POSITIONS[offset] ?? 0,
          UPSTREAM_CLOUD_POSITIONS[offset + 1] ?? 0,
          UPSTREAM_CLOUD_POSITIONS[offset + 2] ?? 0,
        ),
      );
    }
    cloudPositions.sort((left, right) => left.z - right.z);
    const count = cloudPositions.length;
    const batch = new THREE.InstancedMesh(geometry, material, count);
    batch.name = "yurisa-upstream-cloud-instances";
    batch.frustumCulled = false;
    const matrix = new THREE.Matrix4();
    cloudPositions.forEach((position, index) => {
      matrix.makeTranslation(position.x, position.y, position.z);
      batch.setMatrixAt(index, matrix);
    });
    batch.instanceMatrix.needsUpdate = true;
    batch.count = count;
    cloudBatch = batch;
    scene.add(batch);
    gpuMemoryDirty = true;
    onCapability("cloud", true);
  };

  const addBigCloud = (
    gltf: GLTF,
    foregroundTexture: THREE.Texture | null,
    backgroundTexture: THREE.Texture | null,
  ): void => {
    if (!scene) return;
    if (!foregroundTexture || !backgroundTexture) {
      throw new Error("The BigCloud mask textures were unavailable");
    }
    const root = gltf.scene;
    root.name = "yurisa-big-cloud";
    root.scale.setScalar(0.1);
    root.position.set(0, 0, 0);
    root.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      const originalMaterials = Array.isArray(mesh.material)
        ? mesh.material
        : [mesh.material];
      for (const material of originalMaterials) material.dispose();
      const isForeground = mesh.name.replace(/[^a-z0-9]/gi, "").includes("011");
      mesh.material = createBigCloudMaterial(
        isForeground ? foregroundTexture : backgroundTexture,
        !isForeground,
      );
      mesh.renderOrder = -1;
      mesh.frustumCulled = false;
    });
    bigCloud = root;
    scene.add(root);
    gpuMemoryDirty = true;
  };

  const addStars = (texture: THREE.Texture | null): void => {
    if (!scene) return;
    if (!texture) throw new Error("The star atlas was unavailable");
    const count = 400;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    for (let index = 0; index < count; index += 1) {
      positions[index * 3] = (random() - 0.5) * 2_500;
      positions[index * 3 + 1] = (random() - 0.5) * 2_500;
      positions[index * 3 + 2] = (random() - 0.5) * 1_000;
      colors[index * 3] = random() * 3 - 0.2;
      colors[index * 3 + 1] = random() * 3 + 0.5;
      colors[index * 3 + 2] = random() * 3 + 1;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    starMaterial = createStarMaterial(texture);
    stars = new THREE.Points(geometry, starMaterial);
    stars.name = "yurisa-stars";
    stars.position.set(1_518.892, 1_161.257, -2_640.637);
    if (drawCallMitigation >= 3) stars.visible = false;
    scene.add(stars);
    gpuMemoryDirty = true;
    onCapability("particles", drawCallMitigation < 3);
  };

  const loadTierOne = async (
    reportReadyAsset: (id: string, fraction: number) => void,
  ): Promise<void> => {
    const selectedColumnIds = [...COLUMN_IDS];
    const columnModels = await Promise.all(
      selectedColumnIds.map((id) =>
        loadModel(id, true, (fraction) => reportReadyAsset(id, fraction)),
      ),
    );
    failIfDisposed();
    if (!renderer || columnModels.some((model) => !model)) {
      throw new Error("Required upstream column scenery did not load");
    }
    const activeRenderer = renderer;
    columnModels.forEach((model, index) => {
      if (!model) throw new Error("Required upstream column scenery did not load");
      tuneMaterials(model.scene, activeRenderer);
      const layoutId = selectedColumnIds[index]?.replace(
        "model.",
        "",
      ) as UpstreamSceneryId;
      const placements = upstreamMatrices(layoutId);
      const count = placements.length;
      addInstancedModel(model, placements, "pillars", [
        count,
        Math.max(1, Math.ceil(count * 0.68)),
        Math.max(1, Math.ceil(count * 0.42)),
      ]);
    });

    const [lightModel, lightTexture] = await Promise.all([
      loadModel("model.light", true, (fraction) =>
        reportReadyAsset("model.light", fraction),
      ),
      loadRequiredTexture(
        new THREE.TextureLoader(),
        "texture.light",
        assets["texture.light"],
        signal,
        (fraction) => reportReadyAsset("texture.light", fraction),
      ),
    ]);
    failIfDisposed();
    if (!lightModel) throw new Error("Required upstream aurora model did not load");
    optimizeModelTextures(
      lightModel.scene,
      mobile,
      canonicalTextures,
      convertedTextures,
    );
    const placements = upstreamMatrices("aurora");
    addInstancedModel(
      lightModel,
      placements,
      "aurora",
      [3, 2, 1],
      (originalMaterial) => {
        originalMaterial.dispose();
        const material = createAuroraMaterial(lightTexture);
        auroraMaterials.push(material);
        return material;
      },
    );
    report({ stage: "lighting", value: 0.94, label: "正在准备光影" });
  };

  const applyQuality = (nextQuality: QualityLevel): void => {
    quality = nextQuality;
    for (const item of scalableInstances) {
      item.mesh.count = decorativeExtrasSuppressed
        ? 0
        : item.counts[qualityIndex(quality)];
    }
    if (stars?.geometry) {
      const count = (stars.geometry.getAttribute("position")?.count ?? 0) as number;
      const ratio = quality === "high" ? 1 : quality === "medium" ? 0.72 : 0.48;
      stars.geometry.setDrawRange(0, Math.round(count * ratio));
      stars.visible = !decorativeExtrasSuppressed;
    }
    gpuMemoryDirty = true;
    resize();
  };

  const reduceDecorativeExtras = (): void => {
    if (decorativeExtrasSuppressed) return;
    decorativeExtrasSuppressed = true;
    if (stars) {
      stars.visible = false;
      onCapability("particles", false);
    }
    for (const item of scalableInstances) item.mesh.count = 0;
    if (scalableInstances.length > 0) onCapability("aurora", false);
    gpuMemoryDirty = true;
  };

  const disposePostprocessing = (): boolean => {
    const currentComposer = composer;
    const currentRenderPass = renderPass;
    const currentBloomPass = bloomPass;
    const currentTransitionPass = transitionPass;
    const hadPostprocessing = Boolean(
      currentComposer ||
        currentRenderPass ||
        currentBloomPass ||
        currentTransitionPass,
    );

    // Clear the live slots first so a re-entrant/final dispose cannot release a
    // pass twice, even when one of the individual disposers throws.
    composer = null;
    renderPass = null;
    bloomPass = null;
    transitionPass = null;

    runBestEffortCleanup([
      ...(currentRenderPass
        ? [{ label: "render pass", run: () => currentRenderPass.dispose() }]
        : []),
      ...(currentBloomPass
        ? [{ label: "bloom pass", run: () => currentBloomPass.dispose() }]
        : []),
      ...(currentTransitionPass
        ? [
            {
              label: "transition pass",
              run: () => currentTransitionPass.dispose(),
            },
          ]
        : []),
      ...(currentComposer
        ? [{ label: "effect composer", run: () => currentComposer.dispose() }]
        : []),
    ]);

    return hadPostprocessing;
  };

  const estimateCurrentGpuMemory = (
    storage: { textureBytes: number; geometryBytes: number },
    candidateRenderPixels: number,
  ): GpuMemoryEstimate => {
    const postprocessingEnabled = Boolean(composer);
    const bloomEnabled = Boolean(composer && bloomPass);
    const bloomScale = bloomResolutionScale(quality);
    const baseEstimate = estimateGpuMemory({
      ...storage,
      renderPixels: candidateRenderPixels,
      composer: postprocessingEnabled,
      composerColorBytesPerPixel: UPSTREAM_HDR_COLOR_BYTES_PER_PIXEL,
      composerDepthBufferCount: postprocessingEnabled ? 1 : 0,
      bloom: false,
      shadowPixels: directionalLight
        ? shadowResolution(quality) ** 2
        : 0,
      safetyFactor: EXPERIENCE_CONFIG.performance.gpuSafetyFactor,
    });
    const bloomTargetBytes = bloomEnabled
      ? estimateUpstreamBloomTargetBytes(candidateRenderPixels, bloomScale)
      : 0;
    const rawBytes = baseEstimate.rawBytes + bloomTargetBytes;
    return {
      ...baseEstimate,
      renderTargetBytes:
        baseEstimate.renderTargetBytes + bloomTargetBytes,
      rawBytes,
      estimatedBytes: Math.ceil(
        rawBytes * EXPERIENCE_CONFIG.performance.gpuSafetyFactor,
      ),
    };
  };

  const refreshGpuRenderPixelLimit = (configuredLimit: number): void => {
    if (!scene) {
      gpuRenderPixelLimit = configuredLimit;
      return;
    }
    const storage = estimateSceneStorage(scene);
    gpuRenderPixelLimit = selectGpuSafeRenderPixelLimit(
      configuredLimit,
      gpuBudgetBytes,
      (candidateRenderPixels) =>
        estimateCurrentGpuMemory(storage, candidateRenderPixels).estimatedBytes,
    );
  };

  const refreshGpuMemoryEstimate = (): void => {
    if (!scene || !gpuMemoryDirty) return;
    gpuMemoryEstimate = estimateCurrentGpuMemory(
      estimateSceneStorage(scene),
      renderPixels,
    );
    gpuMemoryDirty = false;
  };

  const collectPerformanceSample = (frameElapsedMs: number): void => {
    if (action !== "travel" || options.fixedQuality) return;
    frameSamples.push(frameElapsedMs);
    if (frameSamples.length < EXPERIENCE_CONFIG.performance.sampleWindow) return;

    frameP90Ms = percentile90(frameSamples);
    frameSamples.length = 0;
    const target = mobile
      ? EXPERIENCE_CONFIG.performance.mobileFrameTargetMs
      : EXPERIENCE_CONFIG.performance.desktopFrameTargetMs;
    const decision = decideQuality(quality, frameP90Ms, target, badFrameWindows);
    badFrameWindows = decision.badWindows;
    if (decision.downgraded) applyQuality(decision.quality);
  };

  const beginGateFormation = (triggerZ: number, now: number): void => {
    if (!camera || !door || doorMixers.length !== 14 || gateTriggerZ !== null) {
      return;
    }
    roadStopped = true;
    gateTriggerZ = triggerZ;
    gateDoorZ = triggerZ + UPSTREAM_ROAD.gateDoorOffset;
    gateStartedAt = now;
    gateCameraFromZ = camera.position.z;
    gateCameraToZ = triggerZ + UPSTREAM_ROAD.gateCameraOffset;
    doorFormationTime = 0;
    motionStage = "gate-forming";

    door.position.set(0, -34, gateDoorZ);
    door.visible = true;
    if (doorWhitePlane) {
      doorWhitePlane.position.set(0, -34, gateDoorZ);
      doorWhitePlane.visible = false;
    }
    doorMixers.forEach((mixer) => {
      mixer.stopAllAction();
      mixer.time = 0;
      mixer.timeScale = 1;
    });
    for (const doorAction of doorActions) {
      doorAction.reset();
      doorAction.paused = false;
      doorAction.timeScale = 1;
      doorAction.play();
    }
    emitMotionMilestone("gate-forming");
  };

  const updateRoad = (now: number): void => {
    if (!camera || !roadRoot) return;
    if (!roadStopped) {
      for (let index = 0; index < roadSegments.length; index += 1) {
        const segment = roadSegments[index];
        if (!segment || segment.object.position.z <= cameraCenter.z) continue;
        if (
          index % roadUnitLength === 0 &&
          (motionStage === "armed" || motionStage === "travelling")
        ) {
          beginGateFormation(segment.object.position.z, now);
        }
        segment.object.position.z -= UPSTREAM_ROAD.loopLength;
        segment.object.position.y = segment.settledY - UPSTREAM_ROAD.loweredY;
        segment.riseStartedAt = now;
        roadWrapCount += 1;
      }
    }

    for (const segment of roadSegments) {
      if (segment.riseStartedAt === null) continue;
      const elapsedSeconds = Math.max(0, now - segment.riseStartedAt) / 1_000;
      const progress = elapsedSeconds / UPSTREAM_ROAD.riseSeconds;
      segment.object.position.y = THREE.MathUtils.lerp(
        segment.settledY - UPSTREAM_ROAD.loweredY,
        segment.settledY,
        backOut(progress),
      );
      syncRoadSegment(segment);
      if (progress >= 1) {
        segment.object.position.y = segment.settledY;
        segment.riseStartedAt = null;
        syncRoadSegment(segment);
      }
    }
  };

  const updateCloudLoop = (): void => {
    if (!cloudBatch || cloudPositions.length === 0) return;
    const nearest = cloudPositions[cloudPositions.length - 1];
    if (!nearest || nearest.z <= cameraCenter.z) return;
    cloudPositions.pop();
    nearest.z -= 20_600;
    cloudPositions.unshift(nearest);
    const matrix = new THREE.Matrix4();
    cloudPositions.forEach((position, index) => {
      matrix.makeTranslation(position.x, position.y, position.z);
      cloudBatch?.setMatrixAt(index, matrix);
    });
    cloudBatch.instanceMatrix.needsUpdate = true;
  };

  const updateGateFormation = (now: number): void => {
    if (!camera || gateTriggerZ === null) return;
    const gateElapsedSeconds = Math.max(0, now - gateStartedAt) / 1_000;
    const stopProgress = gateElapsedSeconds / UPSTREAM_GATE.cameraStopSeconds;
    camera.position.z = THREE.MathUtils.lerp(
      gateCameraFromZ,
      gateCameraToZ,
      cubicOut(stopProgress),
    );

    if (motionStage !== "gate-forming" || doorMixers.length !== 14) return;
    doorFormationTime = Math.min(
      UPSTREAM_GATE.formationSeconds,
      gateElapsedSeconds,
    );
    for (const mixer of doorMixers) mixer.setTime(doorFormationTime);
    if (gateElapsedSeconds < UPSTREAM_GATE.formationSeconds) return;

    for (const doorAction of doorActions) doorAction.paused = true;
    if (doorWhitePlane) doorWhitePlane.visible = true;
    motionStage = "gate-ready";
    emitMotionMilestone("gate-ready");
  };

  const updateEntering = (now: number): void => {
    if (!camera) return;
    const elapsedSeconds = Math.max(0, now - enterStartedAt) / 1_000;
    camera.position.z = THREE.MathUtils.lerp(
      enterCameraFromZ,
      enterCameraToZ,
      cubicIn(elapsedSeconds / UPSTREAM_GATE.enterRushSeconds),
    );

    if (
      !doorOpeningStarted &&
      elapsedSeconds >= UPSTREAM_GATE.doorOpenDelaySeconds
    ) {
      doorOpeningStarted = true;
      for (const doorAction of doorActions) {
        doorAction.paused = false;
        doorAction.timeScale = UPSTREAM_GATE.doorOpenTimeScale;
      }
    }
    if (doorOpeningStarted) {
      const activeElapsedSeconds = Math.max(
        0,
        elapsedSeconds - UPSTREAM_GATE.doorOpenDelaySeconds,
      );
      const doorDeltaSeconds = Math.max(
        0,
        activeElapsedSeconds - doorOpeningElapsedSeconds,
      );
      doorOpeningElapsedSeconds = activeElapsedSeconds;
      for (const mixer of doorMixers) mixer.update(doorDeltaSeconds);
    }

    transitionValues = evaluateUpstreamTransition(elapsedSeconds);
    if (transitionPass) setTransitionValues(transitionPass, transitionValues);

    if (
      elapsedSeconds >= UPSTREAM_GATE.whiteDelaySeconds &&
      motionStage === "entering"
    ) {
      motionStage = "enter-white";
      emitMotionMilestone("enter-white");
    }
    if (
      elapsedSeconds >= UPSTREAM_GATE.completeSeconds &&
      motionStage !== "enter-complete"
    ) {
      motionStage = "enter-complete";
      emitMotionMilestone("enter-complete");
    }
  };

  const updateUpstreamMotion = (
    now: number,
    motionDeltaSeconds: number,
    shaderDeltaSeconds: number,
  ): void => {
    if (!camera) return;
    if (
      motionStage === "ready" ||
      motionStage === "armed" ||
      motionStage === "travelling"
    ) {
      cameraCenter.z = advanceUpstreamCameraZ(
        cameraCenter.z,
        motionDeltaSeconds,
      );
      camera.position.copy(cameraCenter);
    } else if (motionStage === "gate-forming" || motionStage === "gate-ready") {
      updateGateFormation(now);
    } else if (
      motionStage === "entering" ||
      motionStage === "enter-white" ||
      motionStage === "enter-complete"
    ) {
      updateEntering(now);
    }

    updateRoad(now);
    if (door?.visible) syncDoorGeometry();
    updateCloudLoop();

    if (directionalLight && directionalTarget) {
      directionalLight.position.set(
        cameraCenter.x + 10_000,
        cameraCenter.y + Math.sqrt(10_000 ** 2 + 6_000 ** 2) / 1.35,
        cameraCenter.z + 6_000,
      );
      directionalTarget.position.copy(cameraCenter);
    }
    if (hashFog) {
      hashFog.mesh.position.z = cameraCenter.z - 400;
      const timeUniform = hashFog.material.uniforms.time;
      if (timeUniform) timeUniform.value += shaderDeltaSeconds;
    }
  };

  const enforceDrawCallBudget = (): boolean => {
    if (!renderer) return false;
    const calls = renderer.info.render.calls;
    if (options.fixedQuality) return false;
    const mitigation = selectDrawCallMitigation(
      calls,
      drawCallLimit,
      drawCallMitigation,
    );
    if (mitigation === "none") return false;

    if (mitigation === "reduce-quality") {
      drawCallMitigation += 1;
      applyQuality(nextLowerQuality(quality));
      console.warn(
        `[yurisa-launch] draw-call guard reduced DPR, shadow and Bloom resolution at ${calls}/${drawCallLimit}`,
      );
      return false;
    }

    if (mitigation === "reduce-extras") {
      drawCallMitigation = 3;
      reduceDecorativeExtras();
      console.warn(
        `[yurisa-launch] draw-call guard reduced star and aurora counts at ${calls}/${drawCallLimit}`,
      );
      return false;
    }

    paused = true;
    if (!fatalSent) {
      fatalSent = true;
      onFatal(
        new Error(
          `Launch scene exceeds draw-call budget: ${calls}/${drawCallLimit}`,
        ),
      );
    }
    return true;
  };

  const enforceGpuMemoryBudget = (): boolean => {
    refreshGpuMemoryEstimate();
    if (options.fixedQuality) return false;
    const mitigation = selectGpuMemoryMitigation(
      gpuMemoryEstimate.estimatedBytes,
      gpuBudgetBytes,
      gpuMemoryMitigation,
    );
    if (mitigation === "none") return false;

    if (mitigation === "reduce-quality") {
      gpuMemoryMitigation += 1;
      applyQuality(nextLowerQuality(quality));
      console.warn(
        `[yurisa-launch] GPU-memory guard reduced DPR, shadow and Bloom resolution at ${(
          gpuMemoryEstimate.estimatedBytes /
          (1024 * 1024)
        ).toFixed(1)}/${(gpuBudgetBytes / (1024 * 1024)).toFixed(0)} MiB`,
      );
      return false;
    }

    if (mitigation === "reduce-extras") {
      gpuMemoryMitigation = 3;
      reduceDecorativeExtras();
      console.warn(
        `[yurisa-launch] GPU-memory guard reduced star and aurora counts at ${(
          gpuMemoryEstimate.estimatedBytes /
          (1024 * 1024)
        ).toFixed(1)}/${(gpuBudgetBytes / (1024 * 1024)).toFixed(0)} MiB`,
      );
      return false;
    }

    paused = true;
    if (!fatalSent) {
      fatalSent = true;
      onFatal(
        new Error(
          `Launch scene exceeds GPU-memory budget: ${(
            gpuMemoryEstimate.estimatedBytes /
            (1024 * 1024)
          ).toFixed(1)}/${(gpuBudgetBytes / (1024 * 1024)).toFixed(0)} MiB`,
        ),
      );
    }
    return true;
  };

  const render = (now: number): void => {
    if (disposed || paused || !renderer || !scene || !camera) return;
    rafId = 0;
    try {
      const elapsedMs = lastFrameAt ? Math.max(0, now - lastFrameAt) : 16.67;
      const shaderDeltaMs = Math.min(
        EXPERIENCE_CONFIG.performance.maxDeltaMs,
        elapsedMs,
      );
      lastFrameAt = now;

      updateUpstreamMotion(
        now,
        elapsedMs / 1_000,
        shaderDeltaMs / 1_000,
      );
      if (disposed || !renderer || !scene || !camera) return;

      if (bigCloud) {
        bigCloud.position.copy(cameraCenter);
      }
      for (const material of auroraMaterials) {
        const timeUniform = material.uniforms.time;
        if (timeUniform) timeUniform.value += shaderDeltaMs / 1_000;
      }
      const starTimeUniform = starMaterial?.uniforms.time;
      if (starTimeUniform) starTimeUniform.value += shaderDeltaMs / 1_000;

      const shouldDraw = options.shouldRenderFrame?.() ?? true;
      if (shouldDraw) {
        renderer.info.reset();
        composer
          ? composer.render(shaderDeltaMs / 1_000)
          : renderer.render(scene, camera);
        shaderFailure.throwIfFailed();
        collectPerformanceSample(elapsedMs);
        if (enforceDrawCallBudget()) return;
        if (enforceGpuMemoryBudget()) return;

        if (!firstFrameSent) {
          firstFrameSent = true;
          report({ stage: "first-frame", value: 1, label: "天空长廊已就绪" });
          onFirstFrame();
        }
      }
      if (!disposed && !paused) rafId = clock.requestAnimationFrame(render);
    } catch (error) {
      if (!firstFrameSent) throw error;
      paused = true;
      if (!fatalSent) {
        fatalSent = true;
        onFatal(error);
      }
    }
  };

  const load = async (): Promise<void> => {
    failIfDisposed();
    report({ stage: "scene", value: 0.04, label: "正在加载场景" });
    createRenderer();
    setupLoaders();
    report({ stage: "scene", value: 0.12, label: "正在加载场景" });

    const progressById = new Map<string, number>(
      READY_VISUAL_IDS.map((id) => [id, 0]),
    );
    let lastReadyProgress = 0.12;
    const reportReadyAsset = (id: string, fraction: number): void => {
      const previous = progressById.get(id) ?? 0;
      progressById.set(id, Math.max(previous, clamp01(fraction)));
      const aggregate =
        [...progressById.values()].reduce((sum, value) => sum + value, 0) /
        READY_VISUAL_IDS.length;
      lastReadyProgress = Math.max(lastReadyProgress, 0.12 + aggregate * 0.82);
      report({
        stage: "models",
        value: lastReadyProgress,
        label: "正在加载视觉资源",
        assetId: id,
      });
    };

    const roadPromise = loadModel("model.road", true, (value) =>
      reportReadyAsset("model.road", value),
    );
    const doorPromise = loadModel("model.door", true, (value) =>
      reportReadyAsset("model.door", value),
    );
    const whitePlanePromise = loadModel("model.whitePlane", true, (value) =>
      reportReadyAsset("model.whitePlane", value),
    );
    const bridgePromises = [1, 2, 3, 4].map((index) => {
      const id = `model.bridge0${index}`;
      return loadModel(id, true, (value) => reportReadyAsset(id, value));
    });
    const bigCloudPromise = loadModel("model.bigCloud", true, (value) =>
      reportReadyAsset("model.bigCloud", value),
    );
    const textureLoader = new THREE.TextureLoader();
    const cloudTexturePromise = Promise.all(
      ["texture.cloud", "texture.cloud0", "texture.cloud1"].map((id) =>
        loadRequiredTexture(
          textureLoader,
          id,
          assets[id],
          signal,
          (fraction) => reportReadyAsset(id, fraction),
        ),
      ),
    );
    const starTexturePromise = loadRequiredTexture(
      textureLoader,
      "texture.star",
      assets["texture.star"],
      signal,
      (fraction) => reportReadyAsset("texture.star", fraction),
    );

    const [
      roadModel,
      doorModel,
      whitePlaneModel,
      bridgeModels,
      bigCloudModel,
      cloudTextures,
      starTexture,
    ] =
      await Promise.all([
        roadPromise,
        doorPromise,
        whitePlanePromise,
        Promise.all(bridgePromises),
        bigCloudPromise,
        cloudTexturePromise,
        starTexturePromise,
      ]);
    failIfDisposed();
    if (
      !roadModel ||
      !doorModel ||
      !whitePlaneModel ||
      !bigCloudModel ||
      bridgeModels.some((model) => !model)
    ) {
      throw new Error("Required upstream launch models did not load");
    }

    addRoad(roadModel);
    addDoor(doorModel);
    addDoorWhitePlane(whitePlaneModel);
    addBridgeModels(bridgeModels);
    const [cloudAtlas, bigCloudTexture, bigCloudBackgroundTexture] = cloudTextures;
    if (!cloudAtlas || !bigCloudTexture || !bigCloudBackgroundTexture) {
      throw new Error("Required upstream cloud textures did not load");
    }
    addClouds(cloudAtlas);
    addStars(starTexture);
    addBigCloud(bigCloudModel, bigCloudTexture, bigCloudBackgroundTexture);

    await loadTierOne(reportReadyAsset);
    failIfDisposed();
    if (!renderer || !scene || !camera) throw new Error("Renderer did not initialize");
    await renderer.compileAsync(scene, camera);
    failIfDisposed();
    shaderFailure.throwIfFailed();
    resize();
    motionStage = "ready";
    render(clock.now());
  };

  const start = (nextAction: SceneAction): void => {
    if (disposed) return;
    if (nextAction === "travel") {
      if (motionStage !== "ready") return;
      action = "travel";
      motionStage = "armed";
      return;
    }
    if (
      nextAction === "enter" &&
      motionStage === "gate-ready" &&
      camera &&
      gateTriggerZ !== null
    ) {
      action = "enter";
      motionStage = "entering";
      enterStartedAt = clock.now();
      enterCameraFromZ = camera.position.z;
      enterCameraToZ = gateTriggerZ + UPSTREAM_ROAD.enterCameraOffset;
      doorOpeningStarted = false;
      doorOpeningElapsedSeconds = 0;
      transitionValues = { intensity: 0, whiteAlpha: 0 };
      if (transitionPass) setTransitionValues(transitionPass, transitionValues);
      if (door) door.visible = true;
    }
  };

  function resize(): void {
    if (!renderer || !camera) return;
    const parent = canvas.parentElement;
    const width = Math.max(1, parent?.clientWidth || window.innerWidth);
    const height = Math.max(1, parent?.clientHeight || window.innerHeight);
    if (scene) {
      const currentHeight = (
        gradientTexture?.image as { height?: number } | undefined
      )?.height;
      if (!gradientTexture || currentHeight !== height) {
        const previousGradient = gradientTexture;
        gradientTexture = createUpstreamGradientTexture(height);
        scene.background = gradientTexture;
        previousGradient?.dispose();
      }
    }
    const qualityScale = quality === "high" ? 1 : quality === "medium" ? 0.8 : 0.65;
    const maximumDpr = mobile
      ? EXPERIENCE_CONFIG.performance.mobileDpr
      : EXPERIENCE_CONFIG.performance.desktopDpr;
    const desiredDpr =
      Math.min(window.devicePixelRatio || 1, maximumDpr) * qualityScale;
    const baseRenderPixelBudget = mobile
      ? EXPERIENCE_CONFIG.performance.mobileRenderPixels
      : EXPERIENCE_CONFIG.performance.desktopRenderPixels;
    const renderPixelBudget = baseRenderPixelBudget * qualityScale * qualityScale;
    refreshGpuRenderPixelLimit(renderPixelBudget);
    const desiredRenderPixels = width * height * desiredDpr * desiredDpr;
    const safeRenderPixelLimit = Math.min(
      renderPixelBudget,
      gpuRenderPixelLimit ?? renderPixelBudget,
    );
    // When the estimator constrains DPR, reserve one row and one column for
    // WebGLRenderer's integer drawing-buffer rounding. Unconstrained reference
    // viewports retain the author's exact DPR and therefore remain byte-stable.
    const allocationPixelBudget = desiredRenderPixels <= safeRenderPixelLimit
      ? desiredRenderPixels
      : Math.max(1, safeRenderPixelLimit - width - height - 1);
    const pixelBudgetDpr = Math.sqrt(allocationPixelBudget / (width * height));
    const effectiveDpr = Math.max(0.5, Math.min(desiredDpr, pixelBudgetDpr));
    renderer.setPixelRatio(effectiveDpr);
    renderer.setSize(width, height, false);
    bloomPass?.setResolutionScale(bloomResolutionScale(quality));
    composer?.setPixelRatio(effectiveDpr);
    composer?.setSize(width, height);
    if (directionalLight) {
      const size = shadowResolution(quality);
      const shadow = directionalLight.shadow;
      if (shadow.mapSize.x !== size || shadow.mapSize.y !== size) {
        shadow.mapSize.set(size, size);
        shadow.map?.dispose();
        shadow.map = null;
      }
    }
    camera.aspect = width / height;
    camera.fov = UPSTREAM_CAMERA.fov;
    camera.updateProjectionMatrix();
    const drawingBufferSize = renderer.getDrawingBufferSize(new THREE.Vector2());
    const texelSizeUniform = transitionPass?.uniforms.texelSize;
    const fxaaTexelSize = texelSizeUniform?.value as
      | { set?: (x: number, y: number) => void }
      | undefined;
    if (fxaaTexelSize?.set) {
      fxaaTexelSize.set(
        1 / Math.max(1, drawingBufferSize.x),
        1 / Math.max(1, drawingBufferSize.y),
      );
    }
    renderPixels = Math.max(1, Math.floor(drawingBufferSize.x * drawingBufferSize.y));
    gpuMemoryDirty = true;
  }

  const pause = (shouldPause: boolean): void => {
    if (disposed || paused === shouldPause) return;
    paused = shouldPause;
    if (paused) {
      pausedAt = clock.now();
      if (rafId) clock.cancelAnimationFrame(rafId);
      rafId = 0;
    } else if (!paused) {
      const resumedAt = clock.now();
      const pauseDuration = pausedAt ? resumedAt - pausedAt : 0;
      if (pauseDuration > 0) {
        if (gateStartedAt) gateStartedAt += pauseDuration;
        if (enterStartedAt) enterStartedAt += pauseDuration;
        for (const segment of roadSegments) {
          if (segment.riseStartedAt !== null) {
            segment.riseStartedAt += pauseDuration;
          }
        }
      }
      pausedAt = 0;
      lastFrameAt = resumedAt;
      rafId = clock.requestAnimationFrame(render);
    }
  };

  const setMuted = (nextMuted: boolean): void => {
    muted = nextMuted;
  };

  const getDebugState = (): Omit<
    LaunchDebugState,
    "generation" | "phase" | "capabilities"
  > & FidelitySceneDebug => {
    refreshGpuMemoryEstimate();
    const drawCalls = renderer?.info.render.calls ?? 0;
    return {
      motionStage,
      cameraZ: camera?.position.z ?? 0,
      cameraCenterZ: cameraCenter.z,
      roadWrapCount,
      roadSegmentCount: roadSegments.length,
      gateTriggerZ,
      gateDoorZ,
      doorFormationTime,
      transitionIntensity: transitionValues.intensity,
      whiteAlpha: transitionValues.whiteAlpha,
      referenceProfile: UPSTREAM_REFERENCE_PROFILE,
      postprocessOrder: UPSTREAM_POSTPROCESS_ORDER,
      quality,
      paused,
      disposed,
      activeRaf: rafId !== 0,
      frameP90Ms,
      drawCalls,
      drawCallBudget: {
        limit: drawCallLimit,
        overBudget: drawCalls > drawCallLimit,
        mitigationStage: drawCallMitigation,
      },
      triangles: renderer?.info.render.triangles ?? 0,
      doorAnimationClips: doorActions.length,
      rendererMemory: {
        geometries: renderer?.info.memory.geometries ?? 0,
        textures: renderer?.info.memory.textures ?? 0,
      },
      gpuMemory: {
        ...gpuMemoryEstimate,
        budgetBytes: gpuBudgetBytes,
        renderPixels,
        overBudget: gpuMemoryEstimate.estimatedBytes > gpuBudgetBytes,
        mitigationStage: gpuMemoryMitigation,
      },
    };
  };

  const contextLostHandler = (event: Event): void => {
    event.preventDefault();
    if (!disposed) onFatal(new Error("WebGL context lost"));
  };
  canvas.addEventListener("webglcontextlost", contextLostHandler, false);

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    paused = true;
    const activeRaf = rafId;
    rafId = 0;
    const activeDoorActions = doorActions;
    const activeDoorMixers = doorMixers;
    const activeScene = scene;
    const activeGradient = gradientTexture;
    const activeDracoLoader = dracoLoader;
    const activeRenderer = renderer;

    doorMixers = [];
    doorActions = [];
    doorGeometrySlices.length = 0;
    scene = null;
    camera = null;
    gradientTexture = null;
    hashFog = null;
    directionalLight = null;
    directionalTarget = null;
    dracoLoader = null;
    loader = null;
    renderer = null;
    shaderFailure.clear();
    door = null;
    doorWhitePlane = null;
    roadRoot = null;
    roadUnitLength = 0;
    roadSegments.length = 0;
    cloudPositions.length = 0;
    cloudBatch = null;
    bigCloud = null;
    stars = null;
    starMaterial = null;
    auroraMaterials.length = 0;
    scalableInstances.length = 0;

    runBestEffortCleanup([
      ...(activeRaf
        ? [{ label: "animation frame", run: () => clock.cancelAnimationFrame(activeRaf) }]
        : []),
      {
        label: "WebGL context-loss listener",
        run: () =>
          canvas.removeEventListener("webglcontextlost", contextLostHandler, false),
      },
      ...activeDoorActions.map((doorAction, index) => ({
        label: `door action ${index}`,
        run: () => doorAction.stop(),
      })),
      ...activeDoorMixers.map((mixer, index) => ({
        label: `door mixer ${index}`,
        run: () => mixer.stopAllAction(),
      })),
      { label: "postprocessing", run: () => void disposePostprocessing() },
      ...(activeGradient
        ? [{ label: "gradient texture", run: () => activeGradient.dispose() }]
        : []),
      ...(activeRenderer
        ? [
            {
              label: "shader error hook",
              run: () => {
                activeRenderer.debug.onShaderError = null;
              },
            },
          ]
        : []),
      ...(activeScene
        ? [{ label: "Three.js scene", run: () => disposeObject3D(activeScene) }]
        : []),
      ...(activeDracoLoader
        ? [{ label: "Draco loader", run: () => activeDracoLoader.dispose() }]
        : []),
      ...(activeRenderer
        ? [
            {
              label: "renderer render lists",
              run: () => activeRenderer.renderLists.dispose(),
            },
            { label: "renderer", run: () => activeRenderer.dispose() },
          ]
        : []),
      { label: "canonical texture registry", run: () => canonicalTextures.clear() },
    ]);
  };

  return {
    load,
    start,
    resize,
    pause,
    dispose,
    setMuted,
    getDebugState,
  };
}
