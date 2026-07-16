export type LaunchPhase =
  | "idle"
  | "loading"
  | "ready"
  | "travelling"
  | "gate-ready"
  | "entering"
  | "complete";

export type LaunchOutcome = "entered" | "skipped" | "fallback" | "navigation";

export type LaunchCapability =
  | "audio"
  | "bloom"
  | "particles"
  | "bridge"
  | "cloud"
  | "pillars"
  | "aurora";

export type QualityLevel = "high" | "medium" | "low";

export type LaunchMotionMilestone =
  | "gate-forming"
  | "gate-ready"
  | "enter-white"
  | "enter-complete";

export type LaunchMotionStage =
  | "idle"
  | "ready"
  | "armed"
  | "travelling"
  | "gate-forming"
  | "gate-ready"
  | "entering"
  | "enter-white"
  | "enter-complete";

export interface LaunchMotionMilestonePayload {
  generation: number;
  milestone: LaunchMotionMilestone;
}

export interface RuntimeAsset {
  url: string;
  bytes?: number;
  sha256?: string;
  mobileUrl?: string;
  mobileBytes?: number;
  mobileSha256?: string;
  tier?: 0 | 1 | 2;
  critical?: boolean;
}

export interface RuntimeAssetListItem extends RuntimeAsset {
  id: string;
}

export interface LaunchRuntimeManifest {
  version: string | number;
  sourceRepository: string;
  sourceCommit: string;
  requiredAssetIds: string[];
  entry: string;
  entryBytes: number;
  entrySha256: string;
  dracoDecoderPath: string;
  assets: Record<string, RuntimeAsset> | RuntimeAssetListItem[];
}

export interface LaunchClock {
  now(): number;
  setTimeout(callback: () => void, delayMs: number): number;
  clearTimeout(id: number): void;
  requestAnimationFrame(callback: FrameRequestCallback): number;
  cancelAnimationFrame(id: number): void;
}

export interface LaunchTestConfig {
  /** Deterministic seed used by particles and procedural scenery. */
  seed?: number;
  /** A fake clock can drive the full experience without waiting in tests. */
  clock?: Partial<LaunchClock>;
  /** Pins quality so visual snapshots do not depend on CI frame timing. */
  quality?: QualityLevel;
  /**
   * Allows deterministic visual tests to advance the real scene timeline
   * without paying for discarded intermediate WebGL draws.
   */
  shouldRenderFrame?: () => boolean;
}

export interface LaunchProgress {
  stage: "scene" | "models" | "lighting" | "first-frame";
  value: number;
  label: string;
  assetId?: string;
}

export interface MountLaunchExperienceOptions {
  host: HTMLElement;
  generation: number;
  manifest: LaunchRuntimeManifest;
  signal: AbortSignal;
  onRequestFinalize: (outcome: LaunchOutcome) => void | Promise<void>;
  onFirstFrame: () => void;
  onProgress: (progress: LaunchProgress) => void;
  testConfig?: LaunchTestConfig;
}

export interface LaunchDebugState {
  generation: number;
  phase: LaunchPhase;
  capabilities: Record<LaunchCapability, boolean>;
  /** Current author-reference motion stage reported by the scene adapter. */
  motionStage?: LaunchMotionStage;
  /** Current camera position on the forward travel axis. */
  cameraZ?: number;
  /** Number of completed upstream road-loop wraps. */
  roadWrapCount?: number;
  /** Stable identifier for the visual/timing reference profile in use. */
  referenceProfile?: "090cb90-r150";
  quality: QualityLevel;
  paused: boolean;
  disposed: boolean;
  activeRaf: boolean;
  frameP90Ms: number;
  drawCalls: number;
  drawCallBudget: {
    limit: number;
    overBudget: boolean;
    mitigationStage: number;
  };
  triangles: number;
  /** Number of clips instantiated from the required Door GLB. */
  doorAnimationClips?: number;
  /** Optional deterministic scene diagnostics used by release visual gates. */
  roadSegmentCount?: number;
  gateTriggerZ?: number | null;
  gateDoorZ?: number | null;
  doorFormationTime?: number;
  transitionIntensity?: number;
  whiteAlpha?: number;
  postprocessOrder?: readonly string[];
  rendererMemory: {
    geometries: number;
    textures: number;
  };
  gpuMemory: {
    textureBytes: number;
    geometryBytes: number;
    renderTargetBytes: number;
    rawBytes: number;
    estimatedBytes: number;
    budgetBytes: number;
    renderPixels: number;
    overBudget: boolean;
    mitigationStage: number;
  };
}

export interface LaunchExperienceHandle {
  pause(paused?: boolean): void;
  resize(): void;
  dispose(): void;
  getDebugState(): LaunchDebugState;
}

export type SceneAction = "travel" | "enter";

export interface LaunchSceneAdapter {
  load(): Promise<void>;
  start(action: SceneAction): void;
  resize(): void;
  pause(paused: boolean): void;
  dispose(): void;
  setMuted(muted: boolean): void;
  getDebugState(): Omit<LaunchDebugState, "generation" | "phase" | "capabilities">;
}

export function normalizeAssetMap(
  manifest: LaunchRuntimeManifest,
): Record<string, RuntimeAsset> {
  if (!Array.isArray(manifest.assets)) {
    return manifest.assets;
  }

  return Object.fromEntries(
    manifest.assets.map(({ id, ...asset }) => [id, asset]),
  );
}
