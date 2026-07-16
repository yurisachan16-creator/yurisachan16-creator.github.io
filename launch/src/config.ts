import type { LaunchClock, LaunchPhase, QualityLevel } from "./types";

export type LaunchTransitionEvent =
  | "MOUNT"
  | "TIER0_READY"
  | "START"
  | "TRAVEL_COMPLETE"
  | "ENTER"
  | "FINALIZE";

const PHASE_TRANSITIONS: Readonly<
  Partial<Record<LaunchPhase, Partial<Record<LaunchTransitionEvent, LaunchPhase>>>>
> = Object.freeze({
  idle: Object.freeze({ MOUNT: "loading", FINALIZE: "complete" }),
  loading: Object.freeze({ TIER0_READY: "ready", FINALIZE: "complete" }),
  ready: Object.freeze({ START: "travelling", FINALIZE: "complete" }),
  travelling: Object.freeze({ TRAVEL_COMPLETE: "gate-ready", FINALIZE: "complete" }),
  "gate-ready": Object.freeze({ ENTER: "entering", FINALIZE: "complete" }),
  entering: Object.freeze({ FINALIZE: "complete" }),
  complete: Object.freeze({ FINALIZE: "complete" }),
});

export const EXPERIENCE_CONFIG = Object.freeze({
  travel: Object.freeze({
    roadLoopLength: 424.8054,
    speed: 88,
    seamMaxMs: 2_414,
  }),
  entering: Object.freeze({
    rushMs: 600,
    bloomMs: 840,
    whiteDelayMs: 500,
    whiteMs: 200,
    holdCompleteMs: 2_100,
  }),
  loading: Object.freeze({
    skipDelayMs: 2_000,
  }),
  camera: Object.freeze({
    fov: 45,
    pitch: 5.5,
    near: 50,
    far: 100_000,
  }),
  performance: Object.freeze({
    desktopFrameTargetMs: 22.2,
    mobileFrameTargetMs: 33.3,
    sampleWindow: 60,
    badWindowsBeforeDowngrade: 2,
    maxDeltaMs: 50,
    desktopDpr: 1.5,
    mobileDpr: 1,
    desktopRenderPixels: 1_700_000,
    mobileRenderPixels: 1_000_000,
    desktopGpuBytes: 192 * 1024 * 1024,
    mobileGpuBytes: 96 * 1024 * 1024,
    desktopDrawCalls: 120,
    mobileDrawCalls: 80,
    gpuSafetyFactor: 1.1,
  }),
});

export interface GpuMemoryInputs {
  textureBytes: number;
  geometryBytes: number;
  renderPixels: number;
  composer: boolean;
  composerColorBytesPerPixel?: number;
  composerDepthBufferCount?: number;
  bloom: boolean;
  bloomScale?: number;
  shadowPixels?: number;
  safetyFactor?: number;
}

export interface GpuMemoryEstimate {
  textureBytes: number;
  geometryBytes: number;
  renderTargetBytes: number;
  rawBytes: number;
  estimatedBytes: number;
}

export type GpuByteEstimator = (renderPixels: number) => number;

export type GpuMemoryMitigation =
  | "none"
  | "reduce-quality"
  | "reduce-extras"
  | "fallback";

export type DrawCallMitigation =
  | "none"
  | "reduce-quality"
  | "reduce-extras"
  | "fallback";

const nativeClock: LaunchClock = {
  now: () => performance.now(),
  setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
  clearTimeout: (id) => window.clearTimeout(id),
  requestAnimationFrame: (callback) => window.requestAnimationFrame(callback),
  cancelAnimationFrame: (id) => window.cancelAnimationFrame(id),
};

export function createClock(overrides: Partial<LaunchClock> = {}): LaunchClock {
  return Object.freeze({ ...nativeClock, ...overrides });
}

export function isMobileViewport(): boolean {
  return (
    window.innerWidth <= 767 ||
    window.matchMedia("(pointer: coarse)").matches
  );
}

export function qualityIndex(quality: QualityLevel): 0 | 1 | 2 {
  return quality === "high" ? 0 : quality === "medium" ? 1 : 2;
}

export function nextLowerQuality(quality: QualityLevel): QualityLevel {
  if (quality === "high") return "medium";
  return "low";
}

export function estimateTextureStorageBytes(
  width: number,
  height: number,
  bytesPerPixel = 4,
  mipmapped = true,
  layers = 1,
): number {
  const mipFactor = mipmapped ? 4 / 3 : 1;
  return Math.ceil(width * height * bytesPerPixel * layers * mipFactor);
}

export function estimateGpuMemory({
  textureBytes,
  geometryBytes,
  renderPixels,
  composer,
  composerColorBytesPerPixel = 8,
  composerDepthBufferCount = 2,
  bloom,
  bloomScale = 1,
  shadowPixels = 0,
  safetyFactor = EXPERIENCE_CONFIG.performance.gpuSafetyFactor,
}: GpuMemoryInputs): GpuMemoryEstimate {
  // Conservative WebGL2 accounting: color + depth backbuffer (8 B/px), two
  // full-resolution composer targets, their explicitly retained depth buffers,
  // the Bloom bright target / ten
  // downsampled mip targets (7.328125 B/px for the default RGBA16F path), and
  // one directional depth shadow map (4 B/px).
  const backbufferBytes = renderPixels * 8;
  const normalizedComposerDepthBufferCount = Math.min(
    2,
    Math.max(0, Math.floor(composerDepthBufferCount)),
  );
  const composerBytes = composer
    ? renderPixels *
      (2 * composerColorBytesPerPixel + normalizedComposerDepthBufferCount * 4)
    : 0;
  const normalizedBloomScale = Math.min(1, Math.max(0, bloomScale));
  const bloomBytes = composer && bloom
    ? renderPixels * 7.328125 * normalizedBloomScale * normalizedBloomScale
    : 0;
  const shadowBytes = Math.max(0, shadowPixels) * 4;
  const renderTargetBytes = Math.ceil(
    backbufferBytes + composerBytes + bloomBytes + shadowBytes,
  );
  const rawBytes = textureBytes + geometryBytes + renderTargetBytes;
  return {
    textureBytes,
    geometryBytes,
    renderTargetBytes,
    rawBytes,
    estimatedBytes: Math.ceil(rawBytes * safetyFactor),
  };
}

/**
 * Finds the largest render-pixel count that satisfies the complete GPU
 * estimator. Keeping the estimator as an argument lets the scene include its
 * exact packed-HDR Bloom pyramid instead of relying on an approximate
 * bytes-per-pixel constant.
 *
 * A one-pixel result means the fixed scene storage alone is over budget; the
 * runtime guard will then continue through the normal quality/extras/fallback
 * ladder.
 */
export function selectGpuSafeRenderPixelLimit(
  configuredLimit: number,
  budgetBytes: number,
  estimateBytes: GpuByteEstimator,
): number {
  const ceiling = Math.max(1, Math.floor(configuredLimit));
  if (estimateBytes(ceiling) <= budgetBytes) return ceiling;

  let low = 1;
  let high = ceiling - 1;
  let safeLimit = 1;
  while (low <= high) {
    const candidate = low + Math.floor((high - low) / 2);
    if (estimateBytes(candidate) <= budgetBytes) {
      safeLimit = candidate;
      low = candidate + 1;
    } else {
      high = candidate - 1;
    }
  }
  return safeLimit;
}

export function selectGpuMemoryMitigation(
  estimatedBytes: number,
  budgetBytes: number,
  mitigationStage: number,
): GpuMemoryMitigation {
  if (estimatedBytes <= budgetBytes) return "none";
  if (mitigationStage <= 1) return "reduce-quality";
  if (mitigationStage === 2) return "reduce-extras";
  return "fallback";
}

export function selectDrawCallMitigation(
  drawCalls: number,
  limit: number,
  mitigationStage: number,
): DrawCallMitigation {
  if (drawCalls <= limit) return "none";
  if (mitigationStage <= 1) return "reduce-quality";
  if (mitigationStage === 2) return "reduce-extras";
  return "fallback";
}

export function transition(
  phase: LaunchPhase,
  event: LaunchTransitionEvent,
): LaunchPhase {
  const next = PHASE_TRANSITIONS[phase]?.[event];
  if (!next) {
    throw new Error(`Illegal launch transition: ${phase} + ${event}`);
  }
  return next;
}

export interface QualityDecision {
  quality: QualityLevel;
  badWindows: number;
  downgraded: boolean;
}

export function decideQuality(
  quality: QualityLevel,
  p90Ms: number,
  targetMs: number,
  previousBadWindows: number,
  requiredBadWindows = EXPERIENCE_CONFIG.performance.badWindowsBeforeDowngrade,
): QualityDecision {
  if (quality === "low") {
    return { quality, badWindows: 0, downgraded: false };
  }
  const badWindows = p90Ms > targetMs ? previousBadWindows + 1 : 0;
  if (badWindows < requiredBadWindows) {
    return { quality, badWindows, downgraded: false };
  }
  return {
    quality: nextLowerQuality(quality),
    badWindows: 0,
    downgraded: true,
  };
}

export function seededRandom(seed: number): () => number {
  let state = seed >>> 0 || 0x6d2b79f5;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 4_294_967_296;
  };
}

export function percentile90(samples: readonly number[]): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * 0.9) - 1]!;
}
