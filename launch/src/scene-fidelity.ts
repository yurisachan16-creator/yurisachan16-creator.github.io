import {
  Color,
  DataTexture,
  FloatType,
  HalfFloatType,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  MeshStandardMaterial,
  NoBlending,
  NoColorSpace,
  PlaneGeometry,
  RGBAFormat,
  ShaderChunk,
  ShaderMaterial,
  RGBFormat,
  UnsignedInt101111Type,
  Vector2,
  WebGLRenderTarget,
  type Texture,
  type WebGLRenderer,
} from "three";
import { FullScreenQuad, Pass } from "three/addons/postprocessing/Pass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";

export const UPSTREAM_REFERENCE_PROFILE =
  "090cb90-r150";

export const UPSTREAM_CAMERA = Object.freeze({
  fov: 45,
  near: 50,
  far: 100_000,
  pitchDegrees: 5.5,
  forwardSpeed: -88,
});

export const UPSTREAM_ROAD = Object.freeze({
  unitLength: 212.4027,
  sourceSegments: 12,
  loopLength: 424.8054,
  loweredY: 70,
  riseSeconds: 2,
  gateCameraOffset: -165,
  gateDoorOffset: -438.8054,
  enterCameraOffset: -400,
});

export const UPSTREAM_GATE = Object.freeze({
  formationSeconds: 1.4583333333333333,
  cameraStopSeconds: 5,
  enterRushSeconds: 0.6,
  doorOpenDelaySeconds: 0.1,
  doorOpenTimeScale: 1.6,
  transitionSeconds: 0.84,
  whiteDelaySeconds: 0.5,
  whiteSeconds: 0.2,
  completeSeconds: 2.1,
});

export const UPSTREAM_POSTPROCESS_ORDER = Object.freeze([
  "render",
  "fxaa",
  "bloom",
  "transition",
  "output",
] as const);

/**
 * Three r150 WebGLLights multiplies artist-authored light intensities by PI
 * when `renderer.useLegacyLights` is true (its default). r185 removed that
 * switch, so the material shaders apply the same uniform-side compensation
 * while the public light objects retain the author's 6 / 35 intensities.
 */
export const UPSTREAM_LIGHTS = Object.freeze({
  ambientColor: 0x0f6eff,
  ambientIntensity: 6,
  directionalColor: 0xff6222,
  directionalIntensity: 35,
  legacyUniformScale: Math.PI,
});

export const UPSTREAM_BLOOM = Object.freeze({
  threshold: 2,
  smoothing: 0.025,
  intensity: 0.6,
  radius: 0.85,
  levels: 8,
  // With mipmapBlur enabled, postprocessing@6.30.2 renders its luminance
  // target at the full EffectComposer resolution. The first downsampled MIP
  // is the half-resolution buffer; BloomEffect's legacy resolutionScale=0.5
  // only applies to the disabled Kawase path and must not scale this pyramid.
  resolutionScale: 1,
});

/**
 * R11F_G11F_B10F retains HDR values for the author's threshold-2 Bloom while
 * halving render-target storage versus RGBA16F. The launch canvas is opaque
 * and none of the locked passes consume alpha, so the discarded channel does
 * not alter the reference composition.
 */
export const UPSTREAM_HDR_COLOR_BYTES_PER_PIXEL = 4;
const UPSTREAM_BLOOM_COLOR_BYTES_PER_PIXEL = 8;

/**
 * The locked app consumes UUID/procedural randomness before Stars is created.
 * Keep that exact offset so a fixed test seed reproduces the upstream field.
 */
export const UPSTREAM_RANDOM_WARMUP_CALLS = 1_402;

export type UpstreamMaterialVariant = "road" | "door" | "scenery";

/** Author-assigned HDR color for WHITE_PLANE in Road._creatBackground(). */
export const UPSTREAM_WHITE_PLANE_COLOR_SCALE = 3;

/**
 * Three r150's default legacy color management interpreted CSS/hex colors as
 * working-space RGB values. r185 converts hex input from sRGB, so using
 * Color#setHex would materially shift the locked blue/orange lighting palette.
 */
export function createUpstreamLegacyColor(hex: number): Color {
  return new Color().setRGB(
    ((hex >> 16) & 0xff) / 255,
    ((hex >> 8) & 0xff) / 255,
    (hex & 0xff) / 255,
  );
}

export function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function cubicIn(value: number): number {
  const t = clampUnit(value);
  return t * t * t;
}

export function cubicOut(value: number): number {
  const t = 1 - clampUnit(value);
  return 1 - t * t * t;
}

/** Tween.js' Easing.Back.Out used by the locked upstream road component. */
export function backOut(value: number): number {
  const t = clampUnit(value) - 1;
  const overshoot = 1.70158;
  return t * t * ((overshoot + 1) * t + overshoot) + 1;
}

export function advanceUpstreamCameraZ(
  cameraZ: number,
  deltaSeconds: number,
): number {
  return cameraZ + UPSTREAM_CAMERA.forwardSpeed * Math.max(0, deltaSeconds);
}

function inverseRrtOdtFit(value: number): number {
  const radicand =
    -187_248_350 * value * value + 232_585_567 * value + 241_290;
  const numerator = -(
    Math.sqrt(10) * Math.sqrt(Math.max(0, radicand)) +
    21_650 * value -
    1_230
  );
  return numerator / (98_370 * value - 100_000);
}

function multiplyRows(
  rows: readonly [
    readonly [number, number, number],
    readonly [number, number, number],
    readonly [number, number, number],
  ],
  value: readonly [number, number, number],
): [number, number, number] {
  return [
    rows[0][0] * value[0] + rows[0][1] * value[1] + rows[0][2] * value[2],
    rows[1][0] * value[0] + rows[1][1] * value[1] + rows[1][2] * value[2],
    rows[2][0] * value[0] + rows[2][1] * value[1] + rows[2][2] * value[2],
  ];
}

const ACES_INVERSE_OUTPUT_ROWS = [
  [0.64304, 0.31119, 0.04578],
  [0.05926, 0.93144, 0.00929],
  [0.00596, 0.06393, 0.93012],
] as const;

const ACES_INVERSE_INPUT_ROWS = [
  [1.76474, -0.67577, -0.08896],
  [-0.14702, 1.16025, -0.01322],
  [-0.03633, -0.16243, 1.19877],
] as const;

export function inverseAcesRgb(
  value: readonly [number, number, number],
): [number, number, number] {
  const output = multiplyRows(ACES_INVERSE_OUTPUT_ROWS, value);
  const fitted: [number, number, number] = [
    inverseRrtOdtFit(output[0]),
    inverseRrtOdtFit(output[1]),
    inverseRrtOdtFit(output[2]),
  ];
  return multiplyRows(ACES_INVERSE_INPUT_ROWS, fitted);
}

/**
 * Recreates gradientBackground.ts from the locked source. The texture is kept
 * in linear working space so the one OutputPass applies ACES and sRGB exactly
 * once at the end of the r185 composer chain.
 */
export function createUpstreamGradientTexture(height: number): DataTexture {
  const safeHeight = Math.max(2, Math.round(height));
  const data = new Float32Array(safeHeight * 4);
  const top = createUpstreamLegacyColor(0x001c54);
  const middle = createUpstreamLegacyColor(0x023fa1);
  const bottom = createUpstreamLegacyColor(0x26a8ff);

  for (let y = 0; y < safeHeight; y += 1) {
    const l = 1 - y / (safeHeight - 1);
    // Despite its name, upstream smoothstep() returns the clamped linear t.
    const topMiddle = clampUnit(l / 0.2);
    const middleBottom = clampUnit((l - 0.2) / 0.4);
    const topWeight = 1 - topMiddle;
    const middleWeight = topMiddle * (1 - middleBottom);
    const bottomWeight = middleBottom;
    const linear: [number, number, number] = [
      topWeight * top.r + middleWeight * middle.r + bottomWeight * bottom.r,
      topWeight * top.g + middleWeight * middle.g + bottomWeight * bottom.g,
      topWeight * top.b + middleWeight * middle.b + bottomWeight * bottom.b,
    ];
    const color = inverseAcesRgb(linear);
    const offset = y * 4;
    data[offset] = color[0];
    data[offset + 1] = color[1];
    data[offset + 2] = color[2];
    data[offset + 3] = 1;
  }

  const texture = new DataTexture(data, 1, safeHeight, RGBAFormat, FloatType);
  texture.name = "yurisa-upstream-gradient";
  texture.colorSpace = NoColorSpace;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

const FULLSCREEN_VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 1.0, 1.0);
  }
`;

const BLOOM_LUMINANCE_FRAGMENT_SHADER = /* glsl */ `
  uniform mediump sampler2D inputBuffer;
  uniform float threshold;
  uniform float smoothing;
  varying vec2 vUv;

  void main() {
    vec4 texel = texture2D(inputBuffer, vUv);
    float luminance = dot(
      texel.rgb,
      vec3(0.2126729, 0.7151522, 0.0721750)
    );
    float mask = smoothstep(threshold, threshold + smoothing, luminance);
    gl_FragColor = vec4(texel.rgb * mask, mask);
  }
`;

// postprocessing@6.30.2 MipmapBlurPass / DownsamplingMaterial, embedded in
// the locked xviewer bundle. Keeping these exact taps matters: UnrealBloomPass
// uses separable Gaussian kernels and produces a visibly different halo.
const BLOOM_DOWNSAMPLE_FRAGMENT_SHADER = /* glsl */ `
  uniform mediump sampler2D inputBuffer;
  uniform vec2 texelSize;
  varying vec2 vUv;

  float clampToBorder(vec2 coord) {
    return float(
      coord.x >= 0.0 && coord.x <= 1.0 &&
      coord.y >= 0.0 && coord.y <= 1.0
    );
  }

  vec4 sampleBorder(vec2 coord, float weight) {
    return texture2D(inputBuffer, coord) * clampToBorder(coord) * weight;
  }

  void main() {
    vec4 color = vec4(0.0);
    color += sampleBorder(vUv + texelSize * vec2(-1.0,  1.0), 0.125);
    color += sampleBorder(vUv + texelSize * vec2( 1.0,  1.0), 0.125);
    color += sampleBorder(vUv + texelSize * vec2(-1.0, -1.0), 0.125);
    color += sampleBorder(vUv + texelSize * vec2( 1.0, -1.0), 0.125);

    color += sampleBorder(vUv + texelSize * vec2(-2.0,  2.0), 0.0555555);
    color += sampleBorder(vUv + texelSize * vec2( 0.0,  2.0), 0.0555555);
    color += sampleBorder(vUv + texelSize * vec2( 2.0,  2.0), 0.0555555);
    color += sampleBorder(vUv + texelSize * vec2(-2.0,  0.0), 0.0555555);
    color += sampleBorder(vUv + texelSize * vec2( 2.0,  0.0), 0.0555555);
    color += sampleBorder(vUv + texelSize * vec2(-2.0, -2.0), 0.0555555);
    color += sampleBorder(vUv + texelSize * vec2( 0.0, -2.0), 0.0555555);
    color += sampleBorder(vUv + texelSize * vec2( 2.0, -2.0), 0.0555555);
    color += sampleBorder(vUv, 0.0555555);
    gl_FragColor = color;
  }
`;

const BLOOM_UPSAMPLE_FRAGMENT_SHADER = /* glsl */ `
  uniform mediump sampler2D inputBuffer;
  uniform mediump sampler2D supportBuffer;
  uniform vec2 texelSize;
  uniform float radius;
  varying vec2 vUv;

  void main() {
    vec4 color = vec4(0.0);
    color += texture2D(inputBuffer, vUv + texelSize * vec2(-1.0,  1.0)) * 0.0625;
    color += texture2D(inputBuffer, vUv + texelSize * vec2( 0.0,  1.0)) * 0.125;
    color += texture2D(inputBuffer, vUv + texelSize * vec2( 1.0,  1.0)) * 0.0625;
    color += texture2D(inputBuffer, vUv + texelSize * vec2(-1.0,  0.0)) * 0.125;
    color += texture2D(inputBuffer, vUv) * 0.25;
    color += texture2D(inputBuffer, vUv + texelSize * vec2( 1.0,  0.0)) * 0.125;
    color += texture2D(inputBuffer, vUv + texelSize * vec2(-1.0, -1.0)) * 0.0625;
    color += texture2D(inputBuffer, vUv + texelSize * vec2( 0.0, -1.0)) * 0.125;
    color += texture2D(inputBuffer, vUv + texelSize * vec2( 1.0, -1.0)) * 0.0625;
    vec4 baseColor = texture2D(supportBuffer, vUv);
    gl_FragColor = mix(baseColor, color, radius);
  }
`;

export function createUpstreamHdrTarget(
  name: string,
  depthBuffer = false,
): WebGLRenderTarget {
  const target = new WebGLRenderTarget(1, 1, {
    type: UnsignedInt101111Type,
    format: RGBFormat,
    minFilter: LinearFilter,
    magFilter: LinearFilter,
    depthBuffer,
    stencilBuffer: false,
  });
  target.texture.name = name;
  target.texture.colorSpace = NoColorSpace;
  target.texture.generateMipmaps = false;
  return target;
}

function createBloomTarget(name: string): WebGLRenderTarget {
  const target = new WebGLRenderTarget(1, 1, {
    type: HalfFloatType,
    format: RGBAFormat,
    minFilter: LinearFilter,
    magFilter: LinearFilter,
    depthBuffer: false,
    stencilBuffer: false,
  });
  target.texture.name = name;
  target.texture.colorSpace = NoColorSpace;
  target.texture.generateMipmaps = false;
  return target;
}

function createBloomMaterial(
  name: string,
  uniforms: ShaderMaterial["uniforms"],
  fragmentShader: string,
): ShaderMaterial {
  return new ShaderMaterial({
    name,
    uniforms,
    vertexShader: FULLSCREEN_VERTEX_SHADER,
    fragmentShader,
    blending: NoBlending,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
}

/** Exact packed-HDR storage used by the luminance + mip pyramid. */
export function estimateUpstreamBloomTargetBytes(
  renderPixels: number,
  resolutionScale = 1,
  levels = UPSTREAM_BLOOM.levels,
): number {
  const safePixels = Math.max(0, renderPixels);
  const safeScale = Math.min(1, Math.max(0, resolutionScale));
  const safeLevels = Math.max(1, Math.floor(levels));
  let normalizedMipPixels = 1;
  for (let level = 1; level <= safeLevels; level += 1) {
    normalizedMipPixels += 1 / 4 ** level;
  }
  for (let level = 1; level < safeLevels; level += 1) {
    normalizedMipPixels += 1 / 4 ** level;
  }
  return Math.ceil(
    safePixels *
      safeScale *
      safeScale *
      normalizedMipPixels *
      UPSTREAM_BLOOM_COLOR_BYTES_PER_PIXEL,
  );
}

/**
 * A minimal EffectComposer pass that ports the exact mipmap Bloom algorithm
 * from the pinned xviewer/postprocessing bundle. It intentionally works in
 * pre-ACES packed-float space so threshold 2.0 still selects HDR highlights.
 */
export class UpstreamMipmapBloomPass extends Pass {
  readonly isUpstreamMipmapBloomPass = true;

  private readonly levels: number;
  private readonly luminanceTarget = createBloomTarget(
    "YurisaBloom.Luminance",
  );
  private readonly downsamplingTargets: WebGLRenderTarget[];
  private readonly upsamplingTargets: WebGLRenderTarget[];
  private readonly luminanceMaterial: ShaderMaterial;
  private readonly downsamplingMaterial: ShaderMaterial;
  private readonly upsamplingMaterial: ShaderMaterial;
  private readonly fullscreenQuad: FullScreenQuad;
  private baseWidth = 1;
  private baseHeight = 1;
  private resolutionScale = 1;
  private disposed = false;

  constructor(options: Partial<typeof UPSTREAM_BLOOM> = {}) {
    super();
    const threshold = options.threshold ?? UPSTREAM_BLOOM.threshold;
    const smoothing = options.smoothing ?? UPSTREAM_BLOOM.smoothing;
    const radius = options.radius ?? UPSTREAM_BLOOM.radius;
    this.levels = Math.max(
      1,
      Math.floor(options.levels ?? UPSTREAM_BLOOM.levels),
    );
    this.downsamplingTargets = Array.from(
      { length: this.levels },
      (_, index) => createBloomTarget(`YurisaBloom.Downsample${index}`),
    );
    this.upsamplingTargets = Array.from(
      { length: Math.max(0, this.levels - 1) },
      (_, index) => createBloomTarget(`YurisaBloom.Upsample${index}`),
    );
    this.luminanceMaterial = createBloomMaterial(
      "YurisaBloom.LuminanceMaterial",
      {
        inputBuffer: { value: null as Texture | null },
        threshold: { value: threshold },
        smoothing: { value: smoothing },
      },
      BLOOM_LUMINANCE_FRAGMENT_SHADER,
    );
    this.downsamplingMaterial = createBloomMaterial(
      "YurisaBloom.DownsamplingMaterial",
      {
        inputBuffer: { value: null as Texture | null },
        texelSize: { value: new Vector2(1, 1) },
      },
      BLOOM_DOWNSAMPLE_FRAGMENT_SHADER,
    );
    this.upsamplingMaterial = createBloomMaterial(
      "YurisaBloom.UpsamplingMaterial",
      {
        inputBuffer: { value: null as Texture | null },
        supportBuffer: { value: null as Texture | null },
        texelSize: { value: new Vector2(1, 1) },
        radius: { value: radius },
      },
      BLOOM_UPSAMPLE_FRAGMENT_SHADER,
    );
    this.fullscreenQuad = new FullScreenQuad(this.luminanceMaterial);
    // Like BloomEffect.update(), this pass only prepares the off-screen bloom
    // map. Its ADD blend is fused into the following EffectPass-equivalent so
    // BloomTransition never reads a quantized intermediate composite.
    this.needsSwap = false;
  }

  get texture(): Texture {
    return (
      this.upsamplingTargets[0]?.texture ??
      this.downsamplingTargets[0]?.texture ??
      this.luminanceTarget.texture
    );
  }

  setResolutionScale(scale: number): void {
    const nextScale = Math.min(1, Math.max(0.25, scale));
    if (nextScale === this.resolutionScale) return;
    this.resolutionScale = nextScale;
    this.setSize(this.baseWidth, this.baseHeight);
  }

  override setSize(width: number, height: number): void {
    this.baseWidth = Math.max(1, Math.round(width));
    this.baseHeight = Math.max(1, Math.round(height));
    let mipWidth = Math.max(
      1,
      Math.round(this.baseWidth * this.resolutionScale),
    );
    let mipHeight = Math.max(
      1,
      Math.round(this.baseHeight * this.resolutionScale),
    );
    this.luminanceTarget.setSize(mipWidth, mipHeight);
    for (let index = 0; index < this.levels; index += 1) {
      mipWidth = Math.max(1, Math.round(mipWidth * 0.5));
      mipHeight = Math.max(1, Math.round(mipHeight * 0.5));
      this.downsamplingTargets[index]?.setSize(mipWidth, mipHeight);
      this.upsamplingTargets[index]?.setSize(mipWidth, mipHeight);
    }
  }

  override render(
    renderer: WebGLRenderer,
    _writeBuffer: WebGLRenderTarget,
    readBuffer: WebGLRenderTarget,
  ): void {
    const renderMaterial = (
      material: ShaderMaterial,
      target: WebGLRenderTarget | null,
    ): void => {
      this.fullscreenQuad.material = material;
      renderer.setRenderTarget(target);
      this.fullscreenQuad.render(renderer);
    };

    this.luminanceMaterial.uniforms.inputBuffer!.value = readBuffer.texture;
    renderMaterial(this.luminanceMaterial, this.luminanceTarget);

    let source = this.luminanceTarget;
    for (const target of this.downsamplingTargets) {
      this.downsamplingMaterial.uniforms.inputBuffer!.value = source.texture;
      const texelSize = this.downsamplingMaterial.uniforms.texelSize!
        .value as Vector2;
      texelSize.set(1 / source.width, 1 / source.height);
      renderMaterial(this.downsamplingMaterial, target);
      source = target;
    }

    for (let index = this.upsamplingTargets.length - 1; index >= 0; index -= 1) {
      const target = this.upsamplingTargets[index];
      const support = this.downsamplingTargets[index];
      if (!target || !support) continue;
      this.upsamplingMaterial.uniforms.inputBuffer!.value = source.texture;
      this.upsamplingMaterial.uniforms.supportBuffer!.value = support.texture;
      const texelSize = this.upsamplingMaterial.uniforms.texelSize!
        .value as Vector2;
      texelSize.set(1 / source.width, 1 / source.height);
      renderMaterial(this.upsamplingMaterial, target);
      source = target;
    }

  }

  override dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.luminanceTarget.dispose();
    for (const target of this.downsamplingTargets) target.dispose();
    for (const target of this.upsamplingTargets) target.dispose();
    this.luminanceMaterial.dispose();
    this.downsamplingMaterial.dispose();
    this.upsamplingMaterial.dispose();
    this.fullscreenQuad.dispose();
  }
}

export const ACES_FIDELITY_SHADER = /* glsl */ `
  vec3 yurisaRrtOdtFit(vec3 value) {
    vec3 a = value * (value + 0.0245786) - 0.000090537;
    vec3 b = value * (0.983729 * value + 0.4329510) + 0.238081;
    return a / b;
  }
  vec3 yurisaInvRrtOdtFit(vec3 value) {
    vec3 numerator = -(
      sqrt(10.0) * sqrt(
        -187248350.0 * pow(value, vec3(2.0))
        + 232585567.0 * value
        + 241290.0
      ) + 21650.0 * value - 1230.0
    );
    return numerator / (98370.0 * value - 100000.0);
  }
  mat3 yurisaMatrixFromRows(vec3 row0, vec3 row1, vec3 row2) {
    return transpose(mat3(row0, row1, row2));
  }
  vec3 yurisaAcesFitted(vec3 color) {
    mat3 inputMatrix = yurisaMatrixFromRows(
      vec3(0.59719, 0.35458, 0.04823),
      vec3(0.07600, 0.90834, 0.01566),
      vec3(0.02840, 0.13383, 0.83777)
    );
    mat3 outputMatrix = yurisaMatrixFromRows(
      vec3(1.60475, -0.53108, -0.07367),
      vec3(-0.10208, 1.10813, -0.00605),
      vec3(-0.00327, -0.07276, 1.07602)
    );
    return outputMatrix * yurisaRrtOdtFit(inputMatrix * color);
  }
  vec3 yurisaInverseAces(vec3 color) {
    mat3 outputMatrix = yurisaMatrixFromRows(
      vec3(0.64304, 0.31119, 0.04578),
      vec3(0.05926, 0.93144, 0.00929),
      vec3(0.00596, 0.06393, 0.93012)
    );
    mat3 inputMatrix = yurisaMatrixFromRows(
      vec3(1.76474, -0.67577, -0.08896),
      vec3(-0.14702, 1.16025, -0.01322),
      vec3(-0.03633, -0.16243, 1.19877)
    );
    return inputMatrix * yurisaInvRrtOdtFit(outputMatrix * color);
  }
`;

function toonDirectShader(variant: UpstreamMaterialVariant): string {
  const roadLike = variant !== "scenery";
  const fresnel =
    variant === "scenery"
      ? "vec3(17.0, 46.0, 174.0) / 255.0 * 5.0"
      : variant === "door"
        ? "vec3(254.0, 103.0, 57.0) / 255.0"
        : "vec3(0.0)";
  const toonBand = roadLike
    ? `
      float toonDot = smoothstep(0.25, 0.27, dotNL) * pow(dotNL, 0.5) * 1.4;
      toonDot += smoothstep(0.75, 0.8, dotNL) * dotNL;
    `
    : "float toonDot = smoothstep(0.25, 0.27, dotNL);";
  const roughness = roadLike
    ? `
      float toonRoughness = (1.0 - material.metalness) * pow(material.roughness, 0.4);
      toonRoughness += material.metalness * pow(material.roughness, 1.2);
    `
    : `
      float metalStep = step(0.01, material.metalness);
      float toonRoughness = (1.0 - metalStep) * pow(material.roughness, 0.4);
      toonRoughness += metalStep * pow(material.roughness, 1.4);
    `;
  const fresnelPower = roadLike ? "5.0" : "4.5";

  return /* glsl */ `
    ${ACES_FIDELITY_SHADER}
    const vec3 yurisaFresnelColor = ${fresnel};
    const float yurisaLegacyLightScale = ${UPSTREAM_LIGHTS.legacyUniformScale};
    void RE_Direct_YurisaToon(
      const in IncidentLight directLight,
      const in vec3 geometryPosition,
      const in vec3 geometryNormal,
      const in vec3 geometryViewDir,
      const in vec3 geometryClearcoatNormal,
      const in PhysicalMaterial material,
      inout ReflectedLight reflectedLight
    ) {
      float dotNLNoSaturate = dot(geometryNormal, directLight.direction);
      float dotNL = saturate(dotNLNoSaturate);
      ${toonBand}
      vec3 irradiance = toonDot * directLight.color
        * yurisaLegacyLightScale;

      #ifdef USE_CLEARCOAT
        float dotNLcc = saturate(dot(geometryClearcoatNormal, directLight.direction));
        vec3 ccIrradiance = dotNLcc * directLight.color
          * yurisaLegacyLightScale;
        clearcoatSpecularDirect += ccIrradiance * BRDF_GGX_Clearcoat(
          directLight.direction,
          geometryViewDir,
          geometryClearcoatNormal,
          material
        );
      #endif

      #ifdef USE_SHEEN
        sheenSpecularDirect += irradiance * BRDF_Sheen(
          directLight.direction,
          geometryViewDir,
          geometryNormal,
          material.sheenColor,
          material.sheenRoughness
        );
      #endif

      ${roughness}
      PhysicalMaterial toonMaterial = material;
      toonMaterial.roughness = toonRoughness;
      reflectedLight.directSpecular += irradiance * BRDF_GGX(
        directLight.direction,
        geometryViewDir,
        geometryNormal,
        toonMaterial
      );
      reflectedLight.directDiffuse += irradiance * BRDF_Lambert(
        material.diffuseContribution
      );

      float reflectionMask = 1.0 - smoothstep(0.0, 0.3, dotNLNoSaturate);
      float fresnelTerm = clamp(
        1.0 - dot(geometryViewDir, geometryNormal),
        0.0,
        1.0
      ) * reflectionMask;
      reflectedLight.directDiffuse += yurisaFresnelColor
        * pow(fresnelTerm, ${fresnelPower}) * 0.8;
    }
    #undef RE_Direct
    #define RE_Direct RE_Direct_YurisaToon
  `;
}

const ACES_FOG_FRAGMENT = /* glsl */ `
  #ifdef USE_FOG
    #ifdef FOG_EXP2
      float fogFactor = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
    #else
      float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
    #endif
    vec3 linearFragment = yurisaAcesFitted(gl_FragColor.rgb);
    gl_FragColor.rgb = mix(linearFragment, fogColor, fogFactor);
    gl_FragColor.rgb = yurisaInverseAces(gl_FragColor.rgb);
  #endif
`;

const AMBIENT_IRRADIANCE_SOURCE =
  "vec3 irradiance = getAmbientLightIrradiance( ambientLightColor );";

/** Applies r150's legacy-light PI scale to the ambient uniform in r185. */
export function patchUpstreamLegacyAmbientIrradiance(
  fragmentShader: string,
): string {
  if (!fragmentShader.includes(AMBIENT_IRRADIANCE_SOURCE)) {
    throw new Error(
      "Three r185 ambient-light shader ABI changed; upstream light fidelity cannot be guaranteed",
    );
  }
  return fragmentShader.replace(
    AMBIENT_IRRADIANCE_SOURCE,
    "vec3 irradiance = getAmbientLightIrradiance( ambientLightColor ) * yurisaLegacyLightScale;",
  );
}

/** Ports the locked r150 shader substitutions onto r185's PhysicalMaterial ABI. */
export function tuneUpstreamMaterial(
  material: MeshStandardMaterial,
  variant: UpstreamMaterialVariant,
  renderer: WebGLRenderer,
): void {
  const fidelityVariant = material.userData.yurisaUpstreamMaterialVariant as
    | UpstreamMaterialVariant
    | undefined;
  const alreadyTuned = fidelityVariant === variant;

  if (variant === "door") {
    material.color.copy(createUpstreamLegacyColor(0x454545));
    material.metalness = 0.15;
  } else if (variant === "road") {
    const tint = createUpstreamLegacyColor(0xfffcfe).add(
      new Color().setRGB(0.015, 0, 0),
    );
    material.color.multiply(tint);
    material.roughness = 5;
    material.metalness = 0;
    const anisotropy = renderer.capabilities.getMaxAnisotropy() / 2;
    for (const texture of [material.normalMap, material.roughnessMap, material.map]) {
      if (!texture) continue;
      texture.minFilter = LinearMipmapLinearFilter;
      texture.anisotropy = anisotropy;
      texture.needsUpdate = true;
    }
  } else {
    material.metalness = 0.3;
  }

  // The 12 Road nodes share two material instances. The r150 source traverses
  // every node and therefore compounds its tint 12 times, while the shader
  // patch itself must only be installed once on each shared material.
  if (alreadyTuned) {
    material.needsUpdate = true;
    return;
  }
  material.userData.yurisaUpstreamMaterialVariant = variant;

  const previousCompile = material.onBeforeCompile;
  material.onBeforeCompile = (shader, rendererInstance) => {
    previousCompile.call(material, shader, rendererInstance);
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <lights_physical_pars_fragment>",
      `#include <lights_physical_pars_fragment>\n${toonDirectShader(variant)}`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <lights_fragment_begin>",
      patchUpstreamLegacyAmbientIrradiance(
        ShaderChunk.lights_fragment_begin,
      ),
    );
    if (variant === "scenery") {
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <fog_fragment>",
        ACES_FOG_FRAGMENT,
      );
    }
  };
  material.customProgramCacheKey = () => `yurisa-upstream-r150-${variant}-r185`;
  material.needsUpdate = true;
}

/**
 * Ports Three r150's single-scatter MeshStandard direct BRDF for WHITE_PLANE.
 *
 * r185 switched RE_Direct_Physical to BRDF_GGX_Multiscatter. That energy
 * compensation assumes a bounded Fresnel F0 and explosively amplifies the
 * author's intentional color=3 metallic backdrop. The locked r150 path used
 * single-scatter BRDF_GGX and legacy-light PI scaling. Keeping the source
 * color intact and restoring those two shader semantics reproduces the HDR
 * value that feeds Bloom without a visual calibration multiplier.
 */
export function tuneUpstreamWhitePlaneMaterial(
  material: MeshStandardMaterial,
): void {
  if (material.userData.yurisaUpstreamWhitePlaneR150 === true) return;
  material.userData.yurisaUpstreamWhitePlaneR150 = true;

  const previousCompile = material.onBeforeCompile;
  material.onBeforeCompile = (shader, rendererInstance) => {
    previousCompile.call(material, shader, rendererInstance);
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <lights_physical_pars_fragment>",
      `#include <lights_physical_pars_fragment>
      void RE_Direct_YurisaR150Standard(
        const in IncidentLight directLight,
        const in vec3 geometryPosition,
        const in vec3 geometryNormal,
        const in vec3 geometryViewDir,
        const in vec3 geometryClearcoatNormal,
        const in PhysicalMaterial material,
        inout ReflectedLight reflectedLight
      ) {
        float dotNL = saturate(dot(geometryNormal, directLight.direction));
        vec3 irradiance = dotNL * directLight.color * ${UPSTREAM_LIGHTS.legacyUniformScale.toFixed(16)};
        reflectedLight.directSpecular += irradiance * BRDF_GGX(
          directLight.direction,
          geometryViewDir,
          geometryNormal,
          material
        );
        reflectedLight.directDiffuse += irradiance * BRDF_Lambert(
          material.diffuseContribution
        );
      }
      #undef RE_Direct
      #define RE_Direct RE_Direct_YurisaR150Standard`,
    );
  };
  material.customProgramCacheKey = () =>
    "yurisa-upstream-r150-white-plane-r185";
  material.needsUpdate = true;
}

const HASH_FOG_NOISE = /* glsl */ `
  const float F3 = 0.3333333;
  const float G3 = 0.1666667;
  vec3 yurisaRandom3(vec3 cell) {
    float value = 4096.0 * sin(dot(cell, vec3(17.0, 59.4, 15.0)));
    vec3 result;
    result.z = fract(512.0 * value);
    value *= 0.125;
    result.x = fract(512.0 * value);
    value *= 0.125;
    result.y = fract(512.0 * value);
    return result - 0.5;
  }
  float yurisaNoise3d(vec3 point) {
    vec3 cell = floor(point + dot(point, vec3(F3)));
    vec3 position = point - cell + dot(cell, vec3(G3));
    vec3 edge = step(vec3(0.0), position - position.yzx);
    vec3 i1 = edge * (1.0 - edge.zxy);
    vec3 i2 = 1.0 - edge.zxy * (1.0 - edge);
    vec3 p1 = position - i1 + G3;
    vec3 p2 = position - i2 + 2.0 * G3;
    vec3 p3 = position - 1.0 + 3.0 * G3;
    vec4 weights = vec4(
      dot(position, position),
      dot(p1, p1),
      dot(p2, p2),
      dot(p3, p3)
    );
    vec4 dots = vec4(
      dot(yurisaRandom3(cell), position),
      dot(yurisaRandom3(cell + i1), p1),
      dot(yurisaRandom3(cell + i2), p2),
      dot(yurisaRandom3(cell + 1.0), p3)
    );
    weights = max(0.6 - weights, 0.0);
    weights *= weights;
    weights *= weights;
    return dot(dots * weights, vec4(52.0));
  }
`;

export interface UpstreamHashFog {
  mesh: Mesh<PlaneGeometry, ShaderMaterial>;
  material: ShaderMaterial;
}

export function createUpstreamHashFog(): UpstreamHashFog {
  const material = new ShaderMaterial({
    name: "yurisa-upstream-hash-fog-material",
    uniforms: { time: { value: 123 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vWorldPosition;
      void main() {
        vUv = vec2(uv.x, 1.0 - uv.y);
        vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vWorldPosition;
      uniform float time;
      ${HASH_FOG_NOISE}
      void main() {
        float fog = clamp(
          yurisaNoise3d(vWorldPosition * vec3(0.012, 0.012, 0.0) + vec3(time * 0.25)) + 0.2,
          0.0,
          1.0
        );
        fog += clamp(
          yurisaNoise3d(vWorldPosition * vec3(0.004, 0.004, 0.0) - vec3(time * 0.15)) + 0.1,
          0.0,
          1.0
        );
        fog = clamp(fog, 0.0, 1.0);
        fog *= 1.0 - smoothstep(-5.0, 45.0, vWorldPosition.y);
        fog *= smoothstep(-200.0, -35.0, vWorldPosition.y);
        fog *= smoothstep(0.0, 40.0, vWorldPosition.x)
          + (1.0 - smoothstep(-40.0, 0.0, vWorldPosition.x));
        gl_FragColor = vec4(vec3(3.0), fog * 0.3);
      }
    `,
    transparent: true,
    depthWrite: false,
  });
  const mesh = new Mesh(new PlaneGeometry(1_000, 1_000), material);
  mesh.name = "yurisa-upstream-hash-fog";
  mesh.frustumCulled = false;
  return { mesh, material };
}

const RGB_HSV_SHADER = /* glsl */ `
  vec3 yurisaRgbToHsv(vec3 color) {
    vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
    vec4 p = mix(vec4(color.bg, K.wz), vec4(color.gb, K.xy), step(color.b, color.g));
    vec4 q = mix(vec4(p.xyw, color.r), vec4(color.r, p.yzx), step(p.x, color.r));
    float d = q.x - min(q.w, q.y);
    float e = 1.0e-10;
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
  }
  vec3 yurisaHsvToRgb(vec3 color) {
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(color.xxx + K.xyz) * 6.0 - K.www);
    return color.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), color.y);
  }
`;

// FXAAEffect from the pinned postprocessing@6.30.2 EffectPass. Bloom's
// off-screen update intentionally still reads the unfiltered scene buffer;
// this function only changes the EffectPass input color before Bloom ADD.
const UPSTREAM_FXAA_FRAGMENT_SHADER = /* glsl */ `
  #define YURISA_FXAA_ONE_OVER_TWELVE 0.08333333333333333
  varying vec2 vUvDown;
  varying vec2 vUvUp;
  varying vec2 vUvLeft;
  varying vec2 vUvRight;
  varying vec2 vUvDownLeft;
  varying vec2 vUvUpRight;
  varying vec2 vUvUpLeft;
  varying vec2 vUvDownRight;

  float yurisaFxaaLuminance(vec3 value) {
    return dot(value, vec3(0.2126729, 0.7151522, 0.0721750));
  }

  float yurisaFxaaQuality(int sampleIndex) {
    if (sampleIndex < 5) return 1.0;
    if (sampleIndex == 5) return 1.5;
    if (sampleIndex < 10) return 2.0;
    if (sampleIndex == 10) return 4.0;
    return 8.0;
  }

  vec4 yurisaFxaa(vec4 inputColor, vec2 uv) {
    float lumaCenter = yurisaFxaaLuminance(inputColor.rgb);
    float lumaDown = yurisaFxaaLuminance(texture2D(tDiffuse, vUvDown).rgb);
    float lumaUp = yurisaFxaaLuminance(texture2D(tDiffuse, vUvUp).rgb);
    float lumaLeft = yurisaFxaaLuminance(texture2D(tDiffuse, vUvLeft).rgb);
    float lumaRight = yurisaFxaaLuminance(texture2D(tDiffuse, vUvRight).rgb);
    float lumaMin = min(
      lumaCenter,
      min(min(lumaDown, lumaUp), min(lumaLeft, lumaRight))
    );
    float lumaMax = max(
      lumaCenter,
      max(max(lumaDown, lumaUp), max(lumaLeft, lumaRight))
    );
    float lumaRange = lumaMax - lumaMin;
    if (lumaRange < max(0.0312, lumaMax * 0.125)) return inputColor;

    float lumaDownLeft = yurisaFxaaLuminance(
      texture2D(tDiffuse, vUvDownLeft).rgb
    );
    float lumaUpRight = yurisaFxaaLuminance(
      texture2D(tDiffuse, vUvUpRight).rgb
    );
    float lumaUpLeft = yurisaFxaaLuminance(
      texture2D(tDiffuse, vUvUpLeft).rgb
    );
    float lumaDownRight = yurisaFxaaLuminance(
      texture2D(tDiffuse, vUvDownRight).rgb
    );
    float lumaDownUp = lumaDown + lumaUp;
    float lumaLeftRight = lumaLeft + lumaRight;
    float lumaLeftCorners = lumaDownLeft + lumaUpLeft;
    float lumaDownCorners = lumaDownLeft + lumaDownRight;
    float lumaRightCorners = lumaDownRight + lumaUpRight;
    float lumaUpCorners = lumaUpRight + lumaUpLeft;
    float edgeHorizontal =
      abs(-2.0 * lumaLeft + lumaLeftCorners)
      + abs(-2.0 * lumaCenter + lumaDownUp) * 2.0
      + abs(-2.0 * lumaRight + lumaRightCorners);
    float edgeVertical =
      abs(-2.0 * lumaUp + lumaUpCorners)
      + abs(-2.0 * lumaCenter + lumaLeftRight) * 2.0
      + abs(-2.0 * lumaDown + lumaDownCorners);
    bool isHorizontal = edgeHorizontal >= edgeVertical;
    float stepLength = isHorizontal ? texelSize.y : texelSize.x;
    float luma1 = isHorizontal ? lumaDown : lumaLeft;
    float luma2 = isHorizontal ? lumaUp : lumaRight;
    float gradient1 = abs(luma1 - lumaCenter);
    float gradient2 = abs(luma2 - lumaCenter);
    bool is1Steepest = gradient1 >= gradient2;
    float gradientScaled = 0.25 * max(gradient1, gradient2);
    float lumaLocalAverage;
    if (is1Steepest) {
      stepLength = -stepLength;
      lumaLocalAverage = 0.5 * (luma1 + lumaCenter);
    } else {
      lumaLocalAverage = 0.5 * (luma2 + lumaCenter);
    }

    vec2 currentUv = uv;
    if (isHorizontal) currentUv.y += stepLength * 0.5;
    else currentUv.x += stepLength * 0.5;
    vec2 offset = isHorizontal
      ? vec2(texelSize.x, 0.0)
      : vec2(0.0, texelSize.y);
    vec2 uv1 = currentUv - offset;
    vec2 uv2 = currentUv + offset;
    float lumaEnd1 = yurisaFxaaLuminance(texture2D(tDiffuse, uv1).rgb)
      - lumaLocalAverage;
    float lumaEnd2 = yurisaFxaaLuminance(texture2D(tDiffuse, uv2).rgb)
      - lumaLocalAverage;
    bool reached1 = abs(lumaEnd1) >= gradientScaled;
    bool reached2 = abs(lumaEnd2) >= gradientScaled;
    bool reachedBoth = reached1 && reached2;
    if (!reached1) uv1 -= offset;
    if (!reached2) uv2 += offset;
    if (!reachedBoth) {
      for (int sampleIndex = 2; sampleIndex < 12; sampleIndex += 1) {
        if (!reached1) {
          lumaEnd1 = yurisaFxaaLuminance(texture2D(tDiffuse, uv1).rgb)
            - lumaLocalAverage;
        }
        if (!reached2) {
          lumaEnd2 = yurisaFxaaLuminance(texture2D(tDiffuse, uv2).rgb)
            - lumaLocalAverage;
        }
        reached1 = abs(lumaEnd1) >= gradientScaled;
        reached2 = abs(lumaEnd2) >= gradientScaled;
        reachedBoth = reached1 && reached2;
        if (!reached1) uv1 -= offset * yurisaFxaaQuality(sampleIndex);
        if (!reached2) uv2 += offset * yurisaFxaaQuality(sampleIndex);
        if (reachedBoth) break;
      }
    }

    float distance1 = isHorizontal ? uv.x - uv1.x : uv.y - uv1.y;
    float distance2 = isHorizontal ? uv2.x - uv.x : uv2.y - uv.y;
    bool isDirection1 = distance1 < distance2;
    float distanceFinal = min(distance1, distance2);
    float edgeThickness = distance1 + distance2;
    bool isLumaCenterSmaller = lumaCenter < lumaLocalAverage;
    bool correctVariation1 = (lumaEnd1 < 0.0) != isLumaCenterSmaller;
    bool correctVariation2 = (lumaEnd2 < 0.0) != isLumaCenterSmaller;
    bool correctVariation = isDirection1
      ? correctVariation1
      : correctVariation2;
    float pixelOffset = -distanceFinal / edgeThickness + 0.5;
    float finalOffset = correctVariation ? pixelOffset : 0.0;
    float lumaAverage = YURISA_FXAA_ONE_OVER_TWELVE * (
      2.0 * (lumaDownUp + lumaLeftRight)
      + lumaLeftCorners
      + lumaRightCorners
    );
    float subPixelOffset1 = clamp(
      abs(lumaAverage - lumaCenter) / lumaRange,
      0.0,
      1.0
    );
    float subPixelOffset2 =
      (-2.0 * subPixelOffset1 + 3.0)
      * subPixelOffset1
      * subPixelOffset1;
    float subPixelOffsetFinal =
      subPixelOffset2 * subPixelOffset2 * 0.75;
    finalOffset = max(finalOffset, subPixelOffsetFinal);
    vec2 finalUv = uv;
    if (isHorizontal) finalUv.y += finalOffset * stepLength;
    else finalUv.x += finalOffset * stepLength;
    return texture2D(tDiffuse, finalUv);
  }
`;

export function createUpstreamTransitionPass(bloomBuffer: Texture): ShaderPass {
  const pass = new ShaderPass({
    name: "YurisaUpstreamBloomTransition",
    uniforms: {
      tDiffuse: { value: null as Texture | null },
      // ShaderPass clones its shader-uniform object; bind the live render
      // target texture after construction instead of cloning it here.
      bloomBuffer: { value: null as Texture | null },
      bloomIntensity: { value: UPSTREAM_BLOOM.intensity },
      intensity: { value: 0 },
      whiteAlpha: { value: 0 },
      texelSize: { value: new Vector2(1, 1) },
    },
    vertexShader: /* glsl */ `
      uniform vec2 texelSize;
      varying vec2 vUv;
      varying vec2 vUvDown;
      varying vec2 vUvUp;
      varying vec2 vUvLeft;
      varying vec2 vUvRight;
      varying vec2 vUvDownLeft;
      varying vec2 vUvUpRight;
      varying vec2 vUvUpLeft;
      varying vec2 vUvDownRight;
      void main() {
        vUv = uv;
        vUvDown = uv + vec2(0.0, -1.0) * texelSize;
        vUvUp = uv + vec2(0.0, 1.0) * texelSize;
        vUvRight = uv + vec2(1.0, 0.0) * texelSize;
        vUvLeft = uv + vec2(-1.0, 0.0) * texelSize;
        vUvDownLeft = uv + vec2(-1.0, -1.0) * texelSize;
        vUvUpRight = uv + vec2(1.0, 1.0) * texelSize;
        vUvUpLeft = uv + vec2(-1.0, 1.0) * texelSize;
        vUvDownRight = uv + vec2(1.0, -1.0) * texelSize;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse;
      uniform mediump sampler2D bloomBuffer;
      uniform float bloomIntensity;
      uniform float intensity;
      uniform float whiteAlpha;
      uniform vec2 texelSize;
      varying vec2 vUv;
      ${RGB_HSV_SHADER}
      ${ACES_FIDELITY_SHADER}
      ${UPSTREAM_FXAA_FRAGMENT_SHADER}
      void main() {
        // xviewer's BloomPlugin overrides BloomEffect's SCREEN default with
        // ADD. In the locked EffectPass this blend runs immediately before
        // BloomTransition, without an intervening framebuffer write.
        vec4 inputColor = yurisaFxaa(texture2D(tDiffuse, vUv), vUv)
          + texture2D(bloomBuffer, vUv) * bloomIntensity;
        vec3 linear = yurisaAcesFitted(inputColor.rgb);
        vec3 hsv = yurisaRgbToHsv(linear);
        hsv.z += intensity;
        vec3 color = mix(yurisaHsvToRgb(hsv), vec3(1.0), whiteAlpha);
        color = clamp(color, vec3(0.0), vec3(1.0));
        color = yurisaInverseAces(color);
        // In the locked postprocessing EffectPass, BloomTransition and the
        // ACES_FILMIC ToneMappingEffect are fused into one fragment shader.
        // Keeping the inverse-ACES result in registers is essential near the
        // white transition: writing it through an HDR render target first
        // quantizes the curve close to its singularity and whites out +0.5s.
        color = yurisaAcesFitted(color / 0.6);
        gl_FragColor = vec4(clamp(color, vec3(0.0), vec3(1.0)), inputColor.a);
      }
    `,
  });
  // This pass already contains the author's final ACES operation and the
  // upstream renderer uses LinearEncoding, so no renderer transform follows.
  if (pass.uniforms.bloomBuffer) {
    pass.uniforms.bloomBuffer.value = bloomBuffer;
  }
  pass.material.toneMapped = false;
  // RenderPass, Bloom preparation and the terminal fused effect all retain the
  // same read buffer, matching the author's one EffectPass topology.
  pass.needsSwap = false;
  return pass;
}

export interface UpstreamTransitionValues {
  intensity: number;
  whiteAlpha: number;
}

export function evaluateUpstreamTransition(
  elapsedSeconds: number,
): UpstreamTransitionValues {
  const intensityElapsed = Math.min(
    UPSTREAM_GATE.transitionSeconds,
    Math.max(0, elapsedSeconds),
  );
  return {
    intensity:
      cubicIn(intensityElapsed / UPSTREAM_GATE.transitionSeconds) * 3,
    whiteAlpha: clampUnit(
      (elapsedSeconds - UPSTREAM_GATE.whiteDelaySeconds) /
        UPSTREAM_GATE.whiteSeconds,
    ),
  };
}

export function setTransitionValues(
  pass: ShaderPass,
  values: UpstreamTransitionValues,
): void {
  if (pass.uniforms.intensity) pass.uniforms.intensity.value = values.intensity;
  if (pass.uniforms.whiteAlpha) pass.uniforms.whiteAlpha.value = values.whiteAlpha;
}
