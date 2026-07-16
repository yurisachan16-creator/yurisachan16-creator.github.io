import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  LaunchMotionMilestonePayload,
  LaunchRuntimeManifest,
  LaunchSceneAdapter,
} from "./types";

const sceneFactory = vi.hoisted(() => vi.fn());

vi.mock("./scene", () => ({
  createLaunchScene: sceneFactory,
}));

import { LaunchController } from "./controller";

const TEST_MANIFEST: LaunchRuntimeManifest = {
  version: 1,
  sourceRepository: "https://github.com/gamemcu/www-genshin",
  sourceCommit: "090cb905a53a078fb192fc7e3da2a7a679d35ff4",
  requiredAssetIds: [],
  entry: "/assets/launch/assets/runtime.test.js",
  entryBytes: 0,
  entrySha256: "test",
  dracoDecoderPath: "/assets/launch/assets/draco-r185/",
  assets: {},
};

function createSceneAdapter(): LaunchSceneAdapter {
  return {
    load: vi.fn(() => new Promise<void>(() => undefined)),
    start: vi.fn(),
    resize: vi.fn(),
    pause: vi.fn(),
    dispose: vi.fn(),
    setMuted: vi.fn(),
    getDebugState: vi.fn(() => ({
      quality: "high" as const,
      paused: false,
      disposed: false,
      activeRaf: false,
      frameP90Ms: 0,
      drawCalls: 0,
      drawCallBudget: { limit: 120, overBudget: false, mitigationStage: 0 },
      triangles: 0,
      rendererMemory: { geometries: 0, textures: 0 },
      gpuMemory: {
        textureBytes: 0,
        geometryBytes: 0,
        renderTargetBytes: 0,
        rawBytes: 0,
        estimatedBytes: 0,
        budgetBytes: 1,
        renderPixels: 1,
        overBudget: false,
        mitigationStage: 0,
      },
    })),
  };
}

function getSceneCallbacks(): {
  generation: number;
  onMotionMilestone: (payload: LaunchMotionMilestonePayload) => void;
} {
  return sceneFactory.mock.calls[0]?.[0] as {
    generation: number;
    onMotionMilestone: (payload: LaunchMotionMilestonePayload) => void;
  };
}

async function mountReadyController(
  generation = 11,
  manifest: LaunchRuntimeManifest = TEST_MANIFEST,
): Promise<{
  controller: LaunchController;
  host: HTMLElement;
  scene: LaunchSceneAdapter;
  onRequestFinalize: ReturnType<typeof vi.fn>;
}> {
  const scene = createSceneAdapter();
  vi.mocked(scene.load).mockResolvedValue();
  sceneFactory.mockReturnValue(scene);
  const host = document.createElement("div");
  document.body.append(host);
  const onRequestFinalize = vi.fn();
  const controller = new LaunchController({
    host,
    generation,
    manifest,
    signal: new AbortController().signal,
    onRequestFinalize,
    onFirstFrame: vi.fn(),
    onProgress: vi.fn(),
  });
  controller.mount();
  await Promise.resolve();
  await Promise.resolve();
  expect(controller.getDebugState().phase).toBe("ready");
  return { controller, host, scene, onRequestFinalize };
}

describe("LaunchController disposal", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    sceneFactory.mockReset();
    document.body.replaceChildren();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  it("forwards the test-only frame render gate to the scene", () => {
    const scene = createSceneAdapter();
    sceneFactory.mockReturnValue(scene);
    const shouldRenderFrame = vi.fn(() => true);
    const host = document.createElement("div");
    document.body.append(host);
    const controller = new LaunchController({
      host,
      generation: 8,
      manifest: TEST_MANIFEST,
      signal: new AbortController().signal,
      onRequestFinalize: vi.fn(),
      onFirstFrame: vi.fn(),
      onProgress: vi.fn(),
      testConfig: { shouldRenderFrame },
    });

    controller.mount();

    expect(sceneFactory).toHaveBeenCalledWith(
      expect.objectContaining({ shouldRenderFrame }),
    );
    controller.dispose();
  });

  it("continues scope, audio and DOM cleanup when scene disposal throws", () => {
    const scene = createSceneAdapter();
    const sceneFailure = new Error("GPU disposer failed");
    vi.mocked(scene.dispose).mockImplementation(() => {
      throw sceneFailure;
    });
    sceneFactory.mockReturnValue(scene);

    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const removeDocumentListener = vi.spyOn(document, "removeEventListener");
    const removeWindowListener = vi.spyOn(window, "removeEventListener");
    const closeAudio = vi.fn(() => Promise.resolve());
    const cancelScheduledValues = vi.fn();
    const setValueAtTime = vi.fn();
    const disconnectMasterGain = vi.fn();
    const stopSource = vi.fn();
    const disconnectSource = vi.fn();
    const host = document.createElement("div");
    document.body.append(host);
    const controller = new LaunchController({
      host,
      generation: 7,
      manifest: TEST_MANIFEST,
      signal: new AbortController().signal,
      onRequestFinalize: vi.fn(),
      onFirstFrame: vi.fn(),
      onProgress: vi.fn(),
    });
    controller.mount();
    Object.assign(controller, {
      audioContext: {
        state: "running",
        currentTime: 0,
        close: closeAudio,
      },
      masterGain: {
        gain: {
          cancelScheduledValues,
          setValueAtTime,
        },
        disconnect: disconnectMasterGain,
      },
      audioSources: new Set([
        {
          stop: stopSource,
          disconnect: disconnectSource,
        },
      ]),
    });

    expect(() => controller.dispose()).not.toThrow();

    expect(scene.dispose).toHaveBeenCalledOnce();
    expect(removeDocumentListener).toHaveBeenCalled();
    expect(removeWindowListener).toHaveBeenCalled();
    expect(cancelScheduledValues).toHaveBeenCalledWith(0);
    expect(setValueAtTime).toHaveBeenCalledWith(0, 0);
    expect(stopSource).toHaveBeenCalledOnce();
    expect(disconnectSource).toHaveBeenCalledOnce();
    expect(disconnectMasterGain).toHaveBeenCalledOnce();
    expect(closeAudio).toHaveBeenCalledOnce();
    expect(host.querySelector("[data-launch-runtime-owned='true']")).toBeNull();
    expect(controller.getDebugState().disposed).toBe(true);
    expect(warning).toHaveBeenCalledWith(
      "[yurisa-launch] scene cleanup failed",
      sceneFailure,
    );

    controller.dispose();
    expect(scene.dispose).toHaveBeenCalledOnce();
    expect(stopSource).toHaveBeenCalledOnce();
    expect(disconnectSource).toHaveBeenCalledOnce();
    expect(disconnectMasterGain).toHaveBeenCalledOnce();
    expect(closeAudio).toHaveBeenCalledOnce();
  });

  it("quiesces resize, keyboard focus trapping and audio while paused", async () => {
    const { controller, host, scene } = await mountReadyController(9);
    const disconnect = vi.fn();
    const observe = vi.fn();
    const cancelScheduledValues = vi.fn();
    const setValueAtTime = vi.fn();
    const setTargetAtTime = vi.fn();
    const suspend = vi.fn(() => Promise.resolve());
    const resume = vi.fn(() => Promise.resolve());
    Object.assign(controller, {
      resizeObserver: { disconnect, observe },
      masterGain: {
        gain: { cancelScheduledValues, setValueAtTime, setTargetAtTime },
      },
      audioContext: { currentTime: 4, suspend, resume },
    });
    vi.mocked(scene.resize).mockClear();

    controller.pause(true);
    controller.resize();
    const pausedTab = new KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(pausedTab);

    expect(scene.pause).toHaveBeenCalledWith(true);
    expect(scene.resize).not.toHaveBeenCalled();
    expect(disconnect).toHaveBeenCalledOnce();
    expect(cancelScheduledValues).toHaveBeenCalledWith(4);
    expect(setValueAtTime).toHaveBeenCalledWith(0, 4);
    expect(suspend).toHaveBeenCalledOnce();
    expect(pausedTab.defaultPrevented).toBe(false);

    Object.assign(controller, { paused: false, finalizeRequested: true });
    const finalizingTab = new KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(finalizingTab);
    expect(finalizingTab.defaultPrevented).toBe(false);

    Object.assign(controller, { paused: true, finalizeRequested: true });
    controller.pause(false);
    expect(scene.pause).not.toHaveBeenCalledWith(false);
    expect(observe).not.toHaveBeenCalled();
    expect(resume).not.toHaveBeenCalled();

    Object.assign(controller, { paused: true, finalizeRequested: false });
    host.remove();
    controller.pause(false);
    expect(scene.pause).not.toHaveBeenCalledWith(false);
    document.body.append(host);
    controller.pause(false);
    expect(scene.pause).toHaveBeenCalledWith(false);
    expect(observe).toHaveBeenCalledOnce();
    expect(setTargetAtTime).toHaveBeenCalledWith(1, 4, 0.025);
    expect(resume).toHaveBeenCalledOnce();
    expect(host.querySelector("[data-action='mute']")?.getAttribute("aria-label"))
      .toBe("声音不可用");

    Object.assign(controller, { masterGain: null, audioContext: null });
    controller.dispose();
  });
});

describe("LaunchController scene milestones", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    sceneFactory.mockReset();
    document.body.replaceChildren();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  it("arms travel and waits for a matching scene milestone instead of eight seconds", async () => {
    const { controller, host, scene } = await mountReadyController(11);
    const primary = host.querySelector<HTMLButtonElement>("[data-action='primary']");
    const primaryIcons = [...(primary?.querySelectorAll("i") ?? [])];
    const readyIconClasses = primaryIcons.map((icon) => icon.className);
    expect(primary).not.toBeNull();
    expect(primaryIcons).toHaveLength(2);
    expect(primaryIcons.every((icon) => icon.getAttribute("aria-hidden") === "true"))
      .toBe(true);
    primary?.click();

    expect(scene.start).toHaveBeenCalledWith("travel");
    expect(controller.getDebugState().phase).toBe("travelling");
    vi.advanceTimersByTime(30_000);
    expect(controller.getDebugState().phase).toBe("travelling");

    const callbacks = getSceneCallbacks();
    expect(callbacks.generation).toBe(11);
    callbacks.onMotionMilestone({ generation: 10, milestone: "gate-ready" });
    expect(controller.getDebugState().phase).toBe("travelling");

    callbacks.onMotionMilestone({ generation: 11, milestone: "gate-forming" });
    expect(controller.getDebugState().phase).toBe("travelling");
    callbacks.onMotionMilestone({ generation: 11, milestone: "gate-ready" });
    callbacks.onMotionMilestone({ generation: 11, milestone: "gate-ready" });

    expect(controller.getDebugState().phase).toBe("gate-ready");
    expect(primary?.textContent).toContain("点击进入博客");
    expect([...(primary?.querySelectorAll("i") ?? [])]).toEqual(primaryIcons);
    expect(primaryIcons.map((icon) => icon.className)).toEqual(readyIconClasses);
    controller.dispose();
  });

  it("updates mute presentation without replacing its Font Awesome icon", async () => {
    const audioManifest: LaunchRuntimeManifest = {
      ...TEST_MANIFEST,
      assets: { "audio.bgm": { url: "/assets/launch/audio/bgm.mp3" } },
    };
    const { controller, host, scene } = await mountReadyController(
      18,
      audioManifest,
    );
    const mute = host.querySelector<HTMLButtonElement>("[data-action='mute']");
    const icon = mute?.querySelector("i") ?? null;
    const unmutedIconClass = icon?.className;

    expect(mute?.disabled).toBe(false);
    expect(mute?.getAttribute("aria-pressed")).toBe("false");
    expect(mute?.getAttribute("aria-label")).toBe("静音");
    expect(icon?.getAttribute("aria-hidden")).toBe("true");

    mute?.click();
    expect(mute?.getAttribute("aria-pressed")).toBe("true");
    expect(mute?.getAttribute("aria-label")).toBe("开启声音");
    expect(mute?.querySelector("i")).toBe(icon);
    expect(icon?.className).not.toBe(unmutedIconClass);
    expect(scene.setMuted).toHaveBeenCalledWith(true);

    mute?.click();
    expect(mute?.getAttribute("aria-pressed")).toBe("false");
    expect(mute?.getAttribute("aria-label")).toBe("静音");
    expect(mute?.querySelector("i")).toBe(icon);
    expect(icon?.className).toBe(unmutedIconClass);
    expect(scene.setMuted).toHaveBeenLastCalledWith(false);
    controller.dispose();
  });

  it("uses enter milestones for whiteout and finalization", async () => {
    const { controller, host, scene, onRequestFinalize } =
      await mountReadyController(27);
    const primary = host.querySelector<HTMLButtonElement>("[data-action='primary']");
    const callbacks = getSceneCallbacks();
    primary?.click();
    callbacks.onMotionMilestone({ generation: 27, milestone: "gate-ready" });
    primary?.click();

    expect(scene.start).toHaveBeenNthCalledWith(1, "travel");
    expect(scene.start).toHaveBeenNthCalledWith(2, "enter");
    expect(controller.getDebugState().phase).toBe("entering");
    vi.advanceTimersByTime(30_000);
    expect(onRequestFinalize).not.toHaveBeenCalled();

    callbacks.onMotionMilestone({ generation: 26, milestone: "enter-white" });
    expect(host.dataset.whiteout).toBeUndefined();
    callbacks.onMotionMilestone({ generation: 27, milestone: "enter-white" });
    expect(host.dataset.whiteout).toBe("active");
    expect(host.querySelector(".yurisa-launch__whiteout")?.classList).toContain(
      "is-active",
    );

    callbacks.onMotionMilestone({ generation: 26, milestone: "enter-complete" });
    expect(onRequestFinalize).not.toHaveBeenCalled();
    callbacks.onMotionMilestone({ generation: 27, milestone: "enter-complete" });
    callbacks.onMotionMilestone({ generation: 27, milestone: "enter-complete" });
    await Promise.resolve();

    expect(onRequestFinalize).toHaveBeenCalledOnce();
    expect(onRequestFinalize).toHaveBeenCalledWith("entered");
    expect(controller.getDebugState().phase).toBe("complete");
    expect(scene.pause).toHaveBeenCalledWith(true);
    controller.dispose();
  });

  it("ignores late milestones after the generation is disposed", async () => {
    const { controller, host } = await mountReadyController(31);
    const callbacks = getSceneCallbacks();
    host.querySelector<HTMLButtonElement>("[data-action='primary']")?.click();
    controller.dispose();

    expect(() =>
      callbacks.onMotionMilestone({ generation: 31, milestone: "gate-ready" }),
    ).not.toThrow();
    expect(controller.getDebugState().phase).toBe("complete");
  });

  it("forwards optional reference motion diagnostics from the scene", async () => {
    const scene = createSceneAdapter();
    vi.mocked(scene.load).mockResolvedValue();
    vi.mocked(scene.getDebugState).mockReturnValue({
      ...scene.getDebugState(),
      motionStage: "armed",
      cameraZ: -181.25,
      roadWrapCount: 2,
      referenceProfile: "090cb90-r150",
    });
    sceneFactory.mockReturnValue(scene);
    const host = document.createElement("div");
    document.body.append(host);
    const controller = new LaunchController({
      host,
      generation: 42,
      manifest: TEST_MANIFEST,
      signal: new AbortController().signal,
      onRequestFinalize: vi.fn(),
      onFirstFrame: vi.fn(),
      onProgress: vi.fn(),
    });
    controller.mount();
    await Promise.resolve();

    expect(controller.getDebugState()).toMatchObject({
      generation: 42,
      motionStage: "armed",
      cameraZ: -181.25,
      roadWrapCount: 2,
      referenceProfile: "090cb90-r150",
    });
    controller.dispose();
  });
});
