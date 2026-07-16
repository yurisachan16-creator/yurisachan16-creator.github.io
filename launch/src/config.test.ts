import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createClock,
  decideQuality,
  estimateGpuMemory,
  estimateTextureStorageBytes,
  EXPERIENCE_CONFIG,
  isMobileViewport,
  nextLowerQuality,
  percentile90,
  qualityIndex,
  seededRandom,
  selectDrawCallMitigation,
  selectGpuMemoryMitigation,
  selectGpuSafeRenderPixelLimit,
  transition,
} from "./config";
import type { LaunchPhase } from "./types";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("launch state machine", () => {
  it.each([
    ["idle", "MOUNT", "loading"],
    ["loading", "TIER0_READY", "ready"],
    ["ready", "START", "travelling"],
    ["travelling", "TRAVEL_COMPLETE", "gate-ready"],
    ["gate-ready", "ENTER", "entering"],
    ["entering", "FINALIZE", "complete"],
    ["complete", "FINALIZE", "complete"],
  ] as const)("moves %s + %s to %s", (phase, event, expected) => {
    expect(transition(phase, event)).toBe(expected);
  });

  it.each([
    "idle",
    "loading",
    "ready",
    "travelling",
    "gate-ready",
  ] as LaunchPhase[])("allows fail-open finalization from %s", (phase) => {
    expect(transition(phase, "FINALIZE")).toBe("complete");
  });

  it("rejects illegal transitions instead of silently corrupting phase", () => {
    expect(() => transition("loading", "ENTER")).toThrow(
      "Illegal launch transition",
    );
  });
});

describe("reference event-driven timeline", () => {
  it("pins the upstream road loop and next-seam arming window", () => {
    expect(EXPERIENCE_CONFIG.travel).toEqual({
      roadLoopLength: 424.8054,
      speed: 88,
      seamMaxMs: 2_414,
    });
    expect(
      (EXPERIENCE_CONFIG.travel.roadLoopLength /
        (EXPERIENCE_CONFIG.travel.speed * 2)) *
        1_000,
    ).toBeCloseTo(EXPERIENCE_CONFIG.travel.seamMaxMs, 0);
  });

  it("pins the reference door transition and white-hold timings", () => {
    expect(EXPERIENCE_CONFIG.entering).toEqual({
      rushMs: 600,
      bloomMs: 840,
      whiteDelayMs: 500,
      whiteMs: 200,
      holdCompleteMs: 2_100,
    });
  });

  it("uses the single reference camera profile on every viewport", () => {
    expect(EXPERIENCE_CONFIG.camera).toEqual({
      fov: 45,
      pitch: 5.5,
      near: 50,
      far: 100_000,
    });
  });
});

describe("adaptive quality", () => {
  it("does not downgrade after one bad window", () => {
    expect(decideQuality("high", 24, 22.2, 0)).toEqual({
      quality: "high",
      badWindows: 1,
      downgraded: false,
    });
  });

  it("downgrades only after two consecutive bad windows", () => {
    expect(decideQuality("high", 24, 22.2, 1)).toEqual({
      quality: "medium",
      badWindows: 0,
      downgraded: true,
    });
  });

  it("resets the streak after a healthy window and never upgrades", () => {
    expect(decideQuality("medium", 20, 22.2, 1)).toEqual({
      quality: "medium",
      badWindows: 0,
      downgraded: false,
    });
    expect(decideQuality("low", 99, 22.2, 9)).toEqual({
      quality: "low",
      badWindows: 0,
      downgraded: false,
    });
  });

  it("maps every level and the one-way downgrade order", () => {
    expect(qualityIndex("high")).toBe(0);
    expect(qualityIndex("medium")).toBe(1);
    expect(qualityIndex("low")).toBe(2);
    expect(nextLowerQuality("high")).toBe("medium");
    expect(nextLowerQuality("medium")).toBe("low");
  });
});

describe("hard performance budgets", () => {
  it("pins the mobile and desktop GPU, draw-call and render-pixel ceilings", () => {
    expect(EXPERIENCE_CONFIG.performance).toMatchObject({
      mobileGpuBytes: 96 * 1024 * 1024,
      desktopGpuBytes: 192 * 1024 * 1024,
      mobileDrawCalls: 80,
      desktopDrawCalls: 120,
      mobileRenderPixels: 1_000_000,
      desktopRenderPixels: 1_700_000,
    });
  });

  it("estimates decoded texture storage with and without mipmaps", () => {
    expect(estimateTextureStorageBytes(1024, 1024)).toBe(5_592_406);
    expect(estimateTextureStorageBytes(512, 256, 8, false, 2)).toBe(2_097_152);
  });

  it("reports conservative framebuffer, composer, Bloom and safety bytes", () => {
    expect(
      estimateGpuMemory({
        textureBytes: 100,
        geometryBytes: 200,
        renderPixels: 1_000,
        composer: true,
        bloom: true,
      }),
    ).toEqual({
      textureBytes: 100,
      geometryBytes: 200,
      renderTargetBytes: 39_329,
      rawBytes: 39_629,
      estimatedBytes: 43_592,
    });
    expect(
      estimateGpuMemory({
        textureBytes: 100,
        geometryBytes: 200,
        renderPixels: 1_000,
        composer: true,
        bloom: false,
        safetyFactor: 1,
      }).renderTargetBytes,
    ).toBe(32_000);
    expect(
      estimateGpuMemory({
        textureBytes: 100,
        geometryBytes: 200,
        renderPixels: 1_000,
        composer: true,
        composerColorBytesPerPixel: 4,
        bloom: false,
        safetyFactor: 1,
      }).renderTargetBytes,
    ).toBe(24_000);
    expect(
      estimateGpuMemory({
        textureBytes: 100,
        geometryBytes: 200,
        renderPixels: 1_000,
        composer: true,
        composerColorBytesPerPixel: 4,
        composerDepthBufferCount: 1,
        bloom: false,
        safetyFactor: 1,
      }).renderTargetBytes,
    ).toBe(20_000);
    expect(
      estimateGpuMemory({
        textureBytes: 100,
        geometryBytes: 200,
        renderPixels: 1_000,
        composer: false,
        bloom: false,
        safetyFactor: 1,
      }).renderTargetBytes,
    ).toBe(8_000);
    expect(
      estimateGpuMemory({
        textureBytes: 0,
        geometryBytes: 0,
        renderPixels: 1_000,
        composer: true,
        bloom: true,
        bloomScale: 0.5,
        safetyFactor: 1,
      }).renderTargetBytes,
    ).toBe(33_833);
  });

  it("selects the largest estimator-safe render-pixel limit", () => {
    const estimate = (renderPixels: number): number => 100 + renderPixels * 4;

    expect(selectGpuSafeRenderPixelLimit(1_000, 4_100, estimate)).toBe(1_000);
    expect(selectGpuSafeRenderPixelLimit(1_000, 2_102, estimate)).toBe(500);
    expect(selectGpuSafeRenderPixelLimit(0, 104, estimate)).toBe(1);
    expect(selectGpuSafeRenderPixelLimit(1_000, 100, estimate)).toBe(1);
  });

  it("selects every staged GPU mitigation and ultimately fails open", () => {
    expect(selectGpuMemoryMitigation(90, 100, 0)).toBe("none");
    expect(selectGpuMemoryMitigation(110, 100, 0)).toBe(
      "reduce-quality",
    );
    expect(selectGpuMemoryMitigation(110, 100, 1)).toBe("reduce-quality");
    expect(selectGpuMemoryMitigation(110, 100, 2)).toBe("reduce-extras");
    expect(selectGpuMemoryMitigation(110, 100, 3)).toBe("fallback");
  });

  it("rechecks draw calls through quality and decorative extras only", () => {
    expect(selectDrawCallMitigation(80, 80, 0)).toBe("none");
    expect(selectDrawCallMitigation(81, 80, 0)).toBe("reduce-quality");
    expect(selectDrawCallMitigation(81, 80, 1)).toBe("reduce-quality");
    expect(selectDrawCallMitigation(81, 80, 2)).toBe("reduce-extras");
    expect(selectDrawCallMitigation(81, 80, 3)).toBe("fallback");
  });
});

describe("deterministic helpers", () => {
  it("calculates p90 without mutating the sample set", () => {
    const samples = [20, 10, 40, 30, 50];
    expect(percentile90(samples)).toBe(50);
    expect(samples).toEqual([20, 10, 40, 30, 50]);
    expect(percentile90([])).toBe(0);
  });

  it("replays an identical procedural sequence for a fixed seed", () => {
    const first = seededRandom(42);
    const second = seededRandom(42);
    const expected = [
      0.2523451747838408,
      0.08812504541128874,
      0.5772811982315034,
    ];
    expect([first(), first(), first()]).toEqual(expected);
    expect([
      second(),
      second(),
      second(),
    ]).toEqual(expected);
  });

  it("uses a stable non-zero fallback seed", () => {
    const first = seededRandom(0);
    const second = seededRandom(0);
    expect(first()).toBe(second());
  });
});

describe("browser helpers", () => {
  it("merges clock overrides without replacing untouched browser methods", () => {
    const now = vi.fn(() => 123);
    const clock = createClock({ now });
    expect(clock.now()).toBe(123);
    expect(now).toHaveBeenCalledOnce();
    expect(Object.isFrozen(clock)).toBe(true);
    expect(typeof clock.clearTimeout).toBe("function");
  });

  it("delegates every native clock operation", () => {
    vi.useFakeTimers();
    const requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      callback(456);
      return 17;
    });
    const cancelAnimationFrame = vi.fn();
    vi.stubGlobal("requestAnimationFrame", requestAnimationFrame);
    vi.stubGlobal("cancelAnimationFrame", cancelAnimationFrame);
    const now = vi.spyOn(performance, "now").mockReturnValue(99);
    const callback = vi.fn();
    const frame = vi.fn();
    const clock = createClock();

    expect(clock.now()).toBe(99);
    const timerId = clock.setTimeout(callback, 25);
    vi.advanceTimersByTime(25);
    expect(callback).toHaveBeenCalledOnce();
    clock.clearTimeout(timerId);
    expect(clock.requestAnimationFrame(frame)).toBe(17);
    expect(frame).toHaveBeenCalledWith(456);
    clock.cancelAnimationFrame(17);
    expect(cancelAnimationFrame).toHaveBeenCalledWith(17);
    expect(now).toHaveBeenCalled();
  });

  it("keeps a wide fine-pointer viewport on desktop budgets", () => {
    vi.stubGlobal("innerWidth", 1280);
    const matchMedia = vi.fn(() => ({
      matches: false,
    })) as unknown as typeof window.matchMedia;
    vi.stubGlobal("matchMedia", matchMedia);

    expect(isMobileViewport()).toBe(false);
    expect(matchMedia).toHaveBeenCalledWith("(pointer: coarse)");
  });

  it("uses mobile budgets for an 844px landscape coarse-pointer phone", () => {
    vi.stubGlobal("innerWidth", 844);
    const matchMedia = vi.fn(() => ({
      matches: true,
    })) as unknown as typeof window.matchMedia;
    vi.stubGlobal("matchMedia", matchMedia);

    expect(isMobileViewport()).toBe(true);
    expect(matchMedia).toHaveBeenCalledWith("(pointer: coarse)");
  });

  it("uses mobile budgets for a narrow viewport without querying pointer", () => {
    vi.stubGlobal("innerWidth", 390);
    const matchMedia = vi.fn(() => ({
      matches: false,
    })) as unknown as typeof window.matchMedia;
    vi.stubGlobal("matchMedia", matchMedia);

    expect(isMobileViewport()).toBe(true);
    expect(matchMedia).not.toHaveBeenCalled();
  });
});
