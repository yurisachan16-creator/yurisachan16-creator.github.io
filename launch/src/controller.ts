import {
  createClock,
  EXPERIENCE_CONFIG,
  transition,
  type LaunchTransitionEvent,
} from "./config";
import {
  AUDIO_IDS,
  getAudioControlPresentation,
  hasAudioAssets,
  shouldInitializeAudio,
  shouldPlayAudio,
} from "./audio-policy";
import { runBestEffortCleanup } from "./lifecycle";
import { ResourceScope } from "./resource-scope";
import { createLaunchScene } from "./scene";
import type {
  LaunchCapability,
  LaunchDebugState,
  LaunchExperienceHandle,
  LaunchMotionMilestonePayload,
  LaunchOutcome,
  LaunchPhase,
  LaunchProgress,
  LaunchSceneAdapter,
  MountLaunchExperienceOptions,
  RuntimeAsset,
} from "./types";
import { normalizeAssetMap } from "./types";

interface ScheduledTask {
  id: number;
  deadline: number;
  remaining: number;
  callback: () => void;
}

const CAPABILITIES: readonly LaunchCapability[] = [
  "audio",
  "bloom",
  "particles",
  "bridge",
  "cloud",
  "pillars",
  "aurora",
];

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function ensurePrimaryStructure(button: HTMLButtonElement): HTMLElement {
  for (const node of [...button.childNodes]) {
    if (node.nodeType === 3) node.remove();
  }
  let surface = button.querySelector<HTMLElement>("[data-launch-primary-surface]");
  if (!surface) {
    surface = button.ownerDocument.createElement("span");
    surface.className = "yurisa-launch__primary-surface";
    surface.dataset.launchPrimarySurface = "true";
    button.append(surface);
  }

  if (!surface.querySelector(".yurisa-launch__primary-icon--start")) {
    const icon = button.ownerDocument.createElement("i");
    icon.className =
      "yurisa-launch__icon yurisa-launch__icon--play yurisa-launch__primary-icon yurisa-launch__primary-icon--start";
    icon.setAttribute("aria-hidden", "true");
    surface.prepend(icon);
  }
  if (!surface.querySelector(".yurisa-launch__primary-icon--enter")) {
    const icon = button.ownerDocument.createElement("i");
    icon.className =
      "yurisa-launch__icon yurisa-launch__icon--arrow yurisa-launch__primary-icon yurisa-launch__primary-icon--enter";
    icon.setAttribute("aria-hidden", "true");
    surface.append(icon);
  }
  const existingLabel = button.querySelector<HTMLElement>(
    "[data-launch-button-label]",
  );
  if (existingLabel && existingLabel.parentElement !== surface) {
    const enterIcon = surface.querySelector(".yurisa-launch__primary-icon--enter");
    surface.insertBefore(existingLabel, enterIcon);
  }
  return surface;
}

function setButtonLabel(button: HTMLButtonElement, label: string): void {
  const surface = ensurePrimaryStructure(button);
  let labelElement = surface.querySelector<HTMLElement>("[data-launch-button-label]");
  if (!labelElement) {
    labelElement = button.ownerDocument.createElement("span");
    labelElement.dataset.launchButtonLabel = "true";
    const enterIcon = surface.querySelector(".yurisa-launch__primary-icon--enter");
    surface.insertBefore(labelElement, enterIcon);
  }
  labelElement.textContent = label;
  button.setAttribute(
    "aria-label",
    label === "启动 / Press Start" ? "启动天空长廊" : label,
  );
}

function ensureToolContents(
  element: HTMLElement,
  iconClassName: string,
  label: string,
  mutableIcon = false,
): void {
  for (const node of [...element.childNodes]) {
    if (node.nodeType === 3) node.remove();
  }
  let icon = mutableIcon
    ? element.querySelector<HTMLElement>("[data-launch-control-icon]")
    : element.querySelector<HTMLElement>("i[aria-hidden='true']");
  if (!icon) {
    icon = element.ownerDocument.createElement("i");
    element.prepend(icon);
  }
  icon.className = iconClassName;
  icon.setAttribute("aria-hidden", "true");
  if (mutableIcon) icon.dataset.launchControlIcon = "true";

  let controlLabel = element.querySelector<HTMLElement>(
    "[data-launch-control-label]",
  );
  if (!controlLabel) {
    controlLabel = element.ownerDocument.createElement("span");
    controlLabel.className = "yurisa-launch__sr-only";
    controlLabel.dataset.launchControlLabel = "true";
    element.append(controlLabel);
  }
  controlLabel.textContent = label;
}

function createElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  parent: HTMLElement,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.className = className;
  element.dataset.launchRuntimeOwned = "true";
  parent.append(element);
  return element;
}

export class LaunchController implements LaunchExperienceHandle {
  private readonly options: MountLaunchExperienceOptions;
  private readonly host: HTMLElement;
  private readonly scope: ResourceScope;
  private readonly clock;
  private readonly assets: Record<string, RuntimeAsset>;
  private readonly capabilities = Object.fromEntries(
    CAPABILITIES.map((capability) => [capability, true]),
  ) as Record<LaunchCapability, boolean>;
  private readonly tasks = new Map<string, ScheduledTask>();
  private readonly audioBuffers = new Map<string, Promise<AudioBuffer>>();
  private readonly audioSources = new Set<AudioBufferSourceNode>();

  private phase: LaunchPhase = "idle";
  private scene: LaunchSceneAdapter | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private sceneHost: HTMLElement | null = null;
  private progress: HTMLElement | null = null;
  private progressValue: HTMLElement | null = null;
  private status: HTMLElement | null = null;
  private loader: HTMLElement | null = null;
  private primaryButton: HTMLButtonElement | null = null;
  private skipButton: HTMLButtonElement | null = null;
  private muteButton: HTMLButtonElement | null = null;
  private title: HTMLElement | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private audioContext: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private muted = false;
  private paused = false;
  private disposed = false;
  private finalizeRequested = false;
  private readonly handledMotionMilestones = new Set<
    LaunchMotionMilestonePayload["milestone"]
  >();

  constructor(options: MountLaunchExperienceOptions) {
    this.options = options;
    this.host = options.host;
    this.scope = new ResourceScope(options.generation);
    this.clock = createClock(options.testConfig?.clock);
    this.assets = normalizeAssetMap(options.manifest);
    this.capabilities.audio = hasAudioAssets(this.assets);
    this.muted = this.readMutedPreference();
  }

  mount(): void {
    if (this.disposed) return;
    this.prepareDom();
    this.advance("MOUNT");
    this.installListeners();
    this.schedule("show-tools", EXPERIENCE_CONFIG.loading.skipDelayMs, () => {
      if (
        this.skipButton &&
        !["entering", "complete"].includes(this.phase)
      ) {
        this.skipButton.hidden = false;
        this.skipButton.dataset.visible = "true";
        const tools = this.host.querySelector<HTMLElement>(
          ".yurisa-launch__tools",
        );
        if (tools) {
          tools.dataset.visible = "true";
          tools.removeAttribute("inert");
          tools.setAttribute("aria-hidden", "false");
        }
      }
    });

    try {
      this.scene = createLaunchScene({
        canvas: this.canvas as HTMLCanvasElement,
        generation: this.options.generation,
        manifest: this.options.manifest,
        signal: this.options.signal,
        scope: this.scope,
        clock: this.clock,
        seed: this.options.testConfig?.seed ?? this.options.generation,
        ...(this.options.testConfig?.quality
          ? { fixedQuality: this.options.testConfig.quality }
          : {}),
        ...(this.options.testConfig?.shouldRenderFrame
          ? { shouldRenderFrame: this.options.testConfig.shouldRenderFrame }
          : {}),
        onProgress: (progress) => this.updateProgress(progress),
        onFirstFrame: () => {
          if (!this.disposed) {
            this.host.dataset.firstFrame = "true";
            this.options.onFirstFrame();
          }
        },
        onCapability: (capability, available) =>
          this.setCapability(capability, available),
        onMotionMilestone: (payload) => this.handleMotionMilestone(payload),
        onFatal: (reason) => {
          console.warn("[yurisa-launch] scene failed", reason);
          void this.requestFinalize("fallback");
        },
      });
      void this.loadScene();
    } catch (error) {
      console.warn("[yurisa-launch] renderer initialization failed", error);
      void this.requestFinalize("fallback");
    }
  }

  pause(shouldPause = true): void {
    if (
      this.disposed ||
      this.paused === shouldPause ||
      (!shouldPause && (this.finalizeRequested || !this.host.isConnected))
    ) return;
    this.paused = shouldPause;
    this.scene?.pause(shouldPause);
    if (shouldPause) {
      this.resizeObserver?.disconnect();
      this.pauseTasks();
      if (this.masterGain && this.audioContext) {
        this.masterGain.gain.cancelScheduledValues(this.audioContext.currentTime);
        this.masterGain.gain.setValueAtTime(0, this.audioContext.currentTime);
      }
      void this.audioContext?.suspend().catch(() => undefined);
    } else {
      if (this.resizeObserver && this.sceneHost) {
        this.resizeObserver.observe(this.sceneHost);
      }
      this.resumeTasks();
      if (this.masterGain && this.audioContext) {
        this.masterGain.gain.setTargetAtTime(
          this.muted ? 0 : 1,
          this.audioContext.currentTime,
          0.025,
        );
      }
      void this.audioContext?.resume().catch(() => undefined);
    }
  }

  resize(): void {
    if (!this.disposed && !this.paused) this.scene?.resize();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.phase = "complete";
    this.host.dataset.phase = "complete";

    const scheduledTasks = [...this.tasks.values()];
    this.tasks.clear();
    const resizeObserver = this.resizeObserver;
    this.resizeObserver = null;
    const scene = this.scene;
    this.scene = null;
    const runtimeOwnedElements = [
      ...this.host.querySelectorAll<HTMLElement>(
        "[data-launch-runtime-owned='true']",
      ),
    ];

    this.canvas = null;
    this.sceneHost = null;
    this.progress = null;
    this.progressValue = null;
    this.status = null;
    this.loader = null;
    this.primaryButton = null;
    this.skipButton = null;
    this.muteButton = null;
    this.title = null;
    this.handledMotionMilestones.clear();

    runBestEffortCleanup([
      ...scheduledTasks
        .filter((task) => task.id !== 0)
        .map((task) => ({
          label: `scheduled task ${task.id}`,
          run: () => this.clock.clearTimeout(task.id),
        })),
      ...(resizeObserver
        ? [{ label: "resize observer", run: () => resizeObserver.disconnect() }]
        : []),
      ...(scene ? [{ label: "scene", run: () => scene.dispose() }] : []),
      { label: "resource scope", run: () => this.scope.dispose() },
      { label: "audio", run: () => this.disposeAudio() },
      ...runtimeOwnedElements.map((element, index) => ({
        label: `runtime element ${index}`,
        run: () => element.remove(),
      })),
    ]);
  }

  getDebugState(): LaunchDebugState {
    const sceneState = this.scene?.getDebugState() ?? {
      quality: this.options.testConfig?.quality ?? ("high" as const),
      paused: this.paused,
      disposed: this.disposed,
      activeRaf: false,
      frameP90Ms: 0,
      drawCalls: 0,
      drawCallBudget: {
        limit: 0,
        overBudget: false,
        mitigationStage: 0,
      },
      triangles: 0,
      rendererMemory: { geometries: 0, textures: 0 },
      gpuMemory: {
        textureBytes: 0,
        geometryBytes: 0,
        renderTargetBytes: 0,
        rawBytes: 0,
        estimatedBytes: 0,
        budgetBytes: 0,
        renderPixels: 0,
        overBudget: false,
        mitigationStage: 0,
      },
    };
    return {
      generation: this.options.generation,
      phase: this.phase,
      capabilities: { ...this.capabilities },
      ...sceneState,
      paused: this.paused || sceneState.paused,
      disposed: this.disposed || sceneState.disposed,
    };
  }

  private prepareDom(): void {
    this.host.classList.add("yurisa-launch");
    this.host.setAttribute("role", "dialog");
    this.host.setAttribute("aria-modal", "true");
    this.host.setAttribute("aria-labelledby", "yurisa-launch-title");
    this.host.dataset.generation = String(this.options.generation);

    let shell = this.host.querySelector<HTMLElement>(".yurisa-launch__shell");
    if (!shell) shell = createElement("div", "yurisa-launch__shell", this.host);

    if (!this.host.querySelector(".yurisa-launch__sky")) {
      const sky = createElement("div", "yurisa-launch__sky", shell);
      sky.setAttribute("aria-hidden", "true");
    }

    this.sceneHost = this.host.querySelector<HTMLElement>(".yurisa-launch__scene");
    if (!this.sceneHost) {
      this.sceneHost = createElement("div", "yurisa-launch__scene", shell);
    }

    this.canvas = this.sceneHost.querySelector<HTMLCanvasElement>("canvas");
    if (!this.canvas) {
      this.canvas = createElement(
        "canvas",
        "yurisa-launch__canvas",
        this.sceneHost,
      );
    }
    this.canvas.setAttribute("aria-hidden", "true");
    this.canvas.tabIndex = -1;

    this.title = this.host.querySelector<HTMLElement>(
      "[data-launch-title], .yurisa-launch__title",
    );
    if (!this.title) {
      this.title = createElement("h1", "yurisa-launch__title", shell);
      this.title.textContent = "通往天空之门";
    }
    this.title.id ||= "yurisa-launch-title";
    this.title.tabIndex = -1;

    this.loader = this.host.querySelector<HTMLElement>(".yurisa-launch__loader");
    if (!this.loader) {
      this.loader = createElement("section", "yurisa-launch__loader", shell);
      this.loader.setAttribute("aria-labelledby", "yurisa-launch-title");
    }
    if (!this.loader.querySelector(".yurisa-launch__brand")) {
      const brand = createElement("header", "yurisa-launch__brand", this.loader);
      brand.setAttribute("aria-hidden", "true");
      const logo = createElement("img", "yurisa-launch__brand-logo", brand);
      logo.src = "/img/pixel-logo.png";
      logo.alt = "";
      const brandName = createElement("span", "", brand);
      brandName.textContent = "YURISACHAN";
    }

    let statusRow = this.loader.querySelector<HTMLElement>(
      ".yurisa-launch__status-row",
    );
    if (!statusRow) {
      statusRow = createElement("div", "yurisa-launch__status-row", this.loader);
    }

    this.status = this.host.querySelector<HTMLElement>(
      "[data-launch-status], .yurisa-launch__status",
    );
    if (!this.status) {
      this.status = createElement("p", "yurisa-launch__status", statusRow);
      this.status.dataset.launchStatus = "true";
    } else if (this.status.parentElement !== statusRow) {
      statusRow.prepend(this.status);
    }
    this.status.textContent ||= "正在连接天空长廊";

    this.progressValue = this.host.querySelector<HTMLElement>(
      "[data-launch-progress-value]",
    );
    if (!this.progressValue) {
      this.progressValue = createElement(
        "span",
        "yurisa-launch__progress-value",
        statusRow,
      );
      this.progressValue.dataset.launchProgressValue = "true";
      this.progressValue.setAttribute("aria-hidden", "true");
      this.progressValue.textContent = "0%";
    }

    this.progress = this.host.querySelector<HTMLElement>(
      "[data-launch-progress], .yurisa-launch__progress",
    );
    if (!this.progress) {
      this.progress = createElement("div", "yurisa-launch__progress", this.loader);
      this.progress.dataset.launchProgress = "true";
    }
    this.progress.setAttribute("role", "progressbar");
    this.progress.setAttribute("aria-valuemin", "0");
    this.progress.setAttribute("aria-valuemax", "100");
    this.progress.setAttribute("aria-valuenow", "0");
    this.progress.setAttribute("aria-valuetext", "正在连接天空长廊");
    if (!this.progress.querySelector(".yurisa-launch__progress-fill")) {
      createElement("span", "yurisa-launch__progress-fill", this.progress);
    }
    if (!this.loader.querySelector(".yurisa-launch__loader-hint")) {
      const hint = createElement("p", "yurisa-launch__loader-hint", this.loader);
      const key = createElement("span", "", hint);
      key.textContent = "ESC";
      const hintLabel = createElement("span", "", hint);
      hintLabel.textContent = "随时跳过";
    }

    this.primaryButton = this.host.querySelector<HTMLButtonElement>(
      "[data-action='primary']",
    );
    if (!this.primaryButton) {
      this.primaryButton = createElement(
        "button",
        "yurisa-launch__primary",
        shell,
      );
      this.primaryButton.type = "button";
      this.primaryButton.dataset.action = "primary";
    }
    ensurePrimaryStructure(this.primaryButton);
    setButtonLabel(this.primaryButton, "启动 / Press Start");
    this.primaryButton.hidden = true;

    let tools = this.host.querySelector<HTMLElement>(".yurisa-launch__tools");
    if (!tools) {
      tools = createElement("nav", "yurisa-launch__tools", shell);
    }
    tools.setAttribute("aria-label", "启动辅助工具");
    if (!tools.dataset.visible) {
      tools.dataset.visible = "false";
      tools.setAttribute("aria-hidden", "true");
      tools.setAttribute("inert", "");
    }

    this.skipButton = this.host.querySelector<HTMLButtonElement>(
      "[data-action='skip']",
    );
    if (!this.skipButton) {
      this.skipButton = createElement(
        "button",
        "yurisa-launch__tool yurisa-launch__skip",
        tools,
      );
      this.skipButton.type = "button";
      this.skipButton.dataset.action = "skip";
      this.skipButton.hidden = true;
    }
    this.skipButton.classList.add("yurisa-launch__tool", "yurisa-launch__skip");
    this.skipButton.dataset.tooltip = "跳过";
    this.skipButton.setAttribute("aria-label", "跳过启动画面，进入博客");
    ensureToolContents(
      this.skipButton,
      "yurisa-launch__icon yurisa-launch__icon--skip",
      "跳过",
    );

    this.muteButton = this.host.querySelector<HTMLButtonElement>(
      "[data-action='mute']",
    );
    if (!this.muteButton) {
      this.muteButton = createElement("button", "yurisa-launch__tool", tools);
      this.muteButton.type = "button";
      this.muteButton.dataset.action = "mute";
    }
    this.muteButton.classList.add("yurisa-launch__tool");
    ensureToolContents(
      this.muteButton,
      "yurisa-launch__icon yurisa-launch__icon--volume",
      "静音",
      true,
    );
    this.updateMuteButton();

    if (!this.host.querySelector(".yurisa-launch__whiteout")) {
      const whiteout = createElement("div", "yurisa-launch__whiteout", shell);
      whiteout.setAttribute("aria-hidden", "true");
    }

    let credits = this.host.querySelector<HTMLAnchorElement>(
      "[data-launch-credits]",
    );
    if (!credits) {
      credits = createElement(
        "a",
        "yurisa-launch__tool yurisa-launch__credits",
        tools,
      );
      credits.dataset.launchCredits = "true";
    }
    credits.classList.add("yurisa-launch__tool", "yurisa-launch__credits");
    credits.href = "/credits/";
    credits.target = "_blank";
    credits.rel = "noopener";
    credits.dataset.tooltip = "来源";
    credits.setAttribute("aria-label", "查看非官方演示的素材与实现来源");
    ensureToolContents(
      credits,
      "yurisa-launch__icon yurisa-launch__icon--external",
      "来源",
    );

    tools.append(this.skipButton, this.muteButton, credits);
    shell.append(tools, this.primaryButton);

    this.title.focus({ preventScroll: true });
  }

  private installListeners(): void {
    if (!this.primaryButton || !this.skipButton || !this.muteButton) return;
    this.scope.listen(this.primaryButton, "click", () => this.activatePrimary());
    this.scope.listen(this.skipButton, "click", () => {
      void this.requestFinalize("skipped");
    });
    this.scope.listen(this.muteButton, "click", () => this.toggleMuted());
    this.scope.listen(document, "keydown", (event) => {
      if (this.paused || this.finalizeRequested) return;
      if (event.key === "Escape") {
        event.preventDefault();
        void this.requestFinalize("skipped");
      } else if (event.key === "Tab") {
        this.trapFocus(event);
      }
    });
    this.scope.listen(document, "visibilitychange", () => this.pause(document.hidden));
    this.scope.listen(window, "resize", () => this.resize(), { passive: true });
    this.scope.listen(this.options.signal, "abort", () => this.dispose(), { once: true });

    if (typeof ResizeObserver !== "undefined" && this.sceneHost) {
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(this.sceneHost);
    }
  }

  private async loadScene(): Promise<void> {
    try {
      await this.scene?.load();
      if (!this.disposed && this.phase === "loading") this.advance("TIER0_READY");
    } catch (error) {
      if (!this.disposed && !isAbortError(error)) {
        console.warn("[yurisa-launch] critical scene load failed", error);
        await this.requestFinalize("fallback");
      }
    }
  }

  private setPhase(nextPhase: LaunchPhase): void {
    if (this.disposed && nextPhase !== "complete") return;
    this.phase = nextPhase;
    this.host.dataset.phase = nextPhase;
    document.documentElement.dataset.launchState = nextPhase;

    if (!this.primaryButton || !this.loader || !this.status) return;
    this.loader.hidden = nextPhase !== "loading";
    this.primaryButton.hidden = !["ready", "gate-ready"].includes(nextPhase);
    this.primaryButton.disabled = !["ready", "gate-ready"].includes(nextPhase);

    if (nextPhase === "ready") {
      setButtonLabel(this.primaryButton, "启动 / Press Start");
      this.status.textContent = "天空长廊已就绪";
      this.primaryButton.focus({ preventScroll: true });
    } else if (nextPhase === "travelling") {
      this.status.textContent = "正在前往光门…";
    } else if (nextPhase === "gate-ready") {
      setButtonLabel(this.primaryButton, "点击进入博客");
      this.status.textContent = "光门已开启";
      this.primaryButton.focus({ preventScroll: true });
    } else if (nextPhase === "entering") {
      this.status.textContent = "正在穿越光门…";
    }

    const tools = this.host.querySelector<HTMLElement>(".yurisa-launch__tools");
    if (tools && ["entering", "complete"].includes(nextPhase)) {
      tools.setAttribute("inert", "");
      tools.setAttribute("aria-hidden", "true");
    }
  }

  private advance(event: LaunchTransitionEvent): void {
    this.setPhase(transition(this.phase, event));
  }

  private activatePrimary(): void {
    if (this.phase === "ready") this.beginTravel();
    else if (this.phase === "gate-ready") this.beginEntering();
  }

  private beginTravel(): void {
    if (this.phase !== "ready" || this.disposed) return;
    this.startAudioFromGesture();
    this.advance("START");
    this.scene?.start("travel");
  }

  private beginEntering(): void {
    if (this.phase !== "gate-ready" || this.disposed) return;
    this.advance("ENTER");
    this.scene?.start("enter");
    this.schedule("door-through-sound", 150, () => {
      void this.playSound("audio.doorThrough", false, 0.92);
    });
  }

  private handleMotionMilestone({
    generation,
    milestone,
  }: LaunchMotionMilestonePayload): void {
    if (
      this.disposed ||
      generation !== this.options.generation ||
      this.handledMotionMilestones.has(milestone)
    ) {
      return;
    }

    if (milestone === "gate-forming") {
      if (this.phase !== "travelling") return;
      this.handledMotionMilestones.add(milestone);
      this.schedule("door-formation-sound", 150, () => {
        void this.playSound("audio.doorComeout", false, 0.72);
      });
      return;
    }

    if (milestone === "gate-ready") {
      if (this.phase !== "travelling") return;
      this.handledMotionMilestones.add(milestone);
      this.advance("TRAVEL_COMPLETE");
      return;
    }

    if (milestone === "enter-white") {
      if (this.phase !== "entering") return;
      this.handledMotionMilestones.add(milestone);
      this.host.dataset.whiteout = "active";
      this.host
        .querySelector<HTMLElement>(".yurisa-launch__whiteout")
        ?.classList.add("is-active");
      return;
    }

    if (milestone !== "enter-complete" || this.phase !== "entering") return;
    this.handledMotionMilestones.add(milestone);
    void this.requestFinalize("entered");
  }

  private updateProgress(progress: LaunchProgress): void {
    if (this.disposed || !this.progress || !this.status) return;
    const percentage = Math.max(0, Math.min(100, Math.round(progress.value * 100)));
    this.progress.style.setProperty("--launch-progress", `${percentage}%`);
    this.progress.setAttribute("aria-valuenow", String(percentage));
    this.progress.setAttribute("aria-valuetext", progress.label);
    if (this.progressValue) this.progressValue.textContent = `${percentage}%`;
    this.status.textContent = progress.label;
    this.options.onProgress(progress);
  }

  private setCapability(
    capability: LaunchCapability,
    available: boolean,
  ): void {
    this.capabilities[capability] = available;
    this.host.dataset[`capability${capability[0]?.toUpperCase()}${capability.slice(1)}`] =
      String(available);
    if (capability === "audio" && !available) this.updateMuteButton();
  }

  private schedule(key: string, delayMs: number, callback: () => void): void {
    const existing = this.tasks.get(key);
    if (existing?.id) this.clock.clearTimeout(existing.id);
    const task: ScheduledTask = {
      id: 0,
      deadline: this.clock.now() + delayMs,
      remaining: delayMs,
      callback,
    };
    const run = (): void => {
      this.tasks.delete(key);
      if (!this.disposed) callback();
    };
    if (!this.paused) task.id = this.clock.setTimeout(run, delayMs);
    this.tasks.set(key, task);
  }

  private pauseTasks(): void {
    const now = this.clock.now();
    for (const task of this.tasks.values()) {
      if (task.id) this.clock.clearTimeout(task.id);
      task.id = 0;
      task.remaining = Math.max(0, task.deadline - now);
    }
  }

  private resumeTasks(): void {
    const now = this.clock.now();
    for (const [key, task] of this.tasks) {
      task.deadline = now + task.remaining;
      task.id = this.clock.setTimeout(() => {
        this.tasks.delete(key);
        if (!this.disposed) task.callback();
      }, task.remaining);
    }
  }

  private async requestFinalize(outcome: LaunchOutcome): Promise<void> {
    if (this.finalizeRequested || this.disposed) return;
    this.finalizeRequested = true;
    this.advance("FINALIZE");
    this.pause(true);
    try {
      await this.options.onRequestFinalize(outcome);
    } catch (error) {
      console.warn("[yurisa-launch] host finalizer failed", error);
      this.dispose();
    }
  }

  private trapFocus(event: KeyboardEvent): void {
    const focusable = [...this.host.querySelectorAll<HTMLElement>(
      "button:not([disabled]):not([hidden]), a[href]:not([hidden]), [tabindex]:not([tabindex='-1']):not([hidden])",
    )].filter(
      (element) =>
        element.getClientRects().length > 0 &&
        element.getAttribute("aria-hidden") !== "true" &&
        !element.closest("[inert], [aria-hidden='true']"),
    );
    if (focusable.length === 0) {
      event.preventDefault();
      this.title?.focus({ preventScroll: true });
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }

  private readMutedPreference(): boolean {
    try {
      return localStorage.getItem("yurisa_launch_muted_v1") === "true";
    } catch {
      return false;
    }
  }

  private toggleMuted(): void {
    if (!this.capabilities.audio) return;
    this.muted = !this.muted;
    this.scene?.setMuted(this.muted);
    if (this.masterGain && this.audioContext) {
      this.masterGain.gain.setTargetAtTime(
        this.muted ? 0 : 1,
        this.audioContext.currentTime,
        0.025,
      );
    }
    try {
      localStorage.setItem("yurisa_launch_muted_v1", String(this.muted));
    } catch {
      // Muting remains valid for the current generation without persistence.
    }
    this.updateMuteButton();
  }

  private updateMuteButton(): void {
    if (!this.muteButton) return;
    const presentation = getAudioControlPresentation(
      this.capabilities.audio,
      this.muted,
    );
    this.muteButton.disabled = presentation.disabled;
    this.muteButton.setAttribute("aria-pressed", String(presentation.pressed));
    this.muteButton.setAttribute("aria-label", presentation.label);
    this.muteButton.dataset.tooltip = presentation.label;
    const icon = this.muteButton.querySelector<HTMLElement>(
      "[data-launch-control-icon]",
    );
    if (icon) {
      icon.className = presentation.pressed || presentation.disabled
        ? "yurisa-launch__icon yurisa-launch__icon--volume-muted"
        : "yurisa-launch__icon yurisa-launch__icon--volume";
    }
    const label = this.muteButton.querySelector<HTMLElement>(
      "[data-launch-control-label]",
    );
    if (label) label.textContent = presentation.label;
  }

  private startAudioFromGesture(): void {
    if (
      !shouldInitializeAudio({
        available: this.capabilities.audio,
        contextCreated: Boolean(this.audioContext),
        disposed: this.disposed,
      })
    ) {
      return;
    }
    try {
      const AudioContextConstructor =
        window.AudioContext ||
        (window as typeof window & { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!AudioContextConstructor) throw new Error("Web Audio is unavailable");
      this.audioContext = new AudioContextConstructor();
      this.masterGain = this.audioContext.createGain();
      this.masterGain.gain.value = this.muted ? 0 : 1;
      this.masterGain.connect(this.audioContext.destination);
      void this.audioContext.resume().catch((error) => this.disableAudio(error));

      for (const id of AUDIO_IDS) {
        if (this.assets[id]?.url) void this.getAudioBuffer(id).catch(() => undefined);
      }
      void this.playSound("audio.bgm", true, 0.46);
      void this.playSound("audio.duang", false, 0.78);
    } catch (error) {
      this.disableAudio(error);
    }
  }

  private getAudioBuffer(id: string): Promise<AudioBuffer> {
    const existing = this.audioBuffers.get(id);
    if (existing) return existing;
    const asset = this.assets[id];
    const context = this.audioContext;
    if (!asset?.url || !context) {
      return Promise.reject(new Error(`Audio asset unavailable: ${id}`));
    }
    const promise = fetch(asset.url, {
      signal: this.options.signal,
      credentials: "same-origin",
    })
      .then((response) => {
        if (!response.ok) throw new Error(`Audio request failed: ${response.status}`);
        return response.arrayBuffer();
      })
      .then((buffer) => context.decodeAudioData(buffer));
    this.audioBuffers.set(id, promise);
    return promise;
  }

  private async playSound(
    id: string,
    loop: boolean,
    volume: number,
  ): Promise<void> {
    if (
      !shouldPlayAudio({
        available: this.capabilities.audio,
        contextReady: Boolean(this.audioContext),
        gainReady: Boolean(this.masterGain),
        disposed: this.disposed,
      })
    ) {
      return;
    }
    try {
      const buffer = await this.getAudioBuffer(id);
      const context = this.audioContext;
      const masterGain = this.masterGain;
      if (
        !shouldPlayAudio({
          available: this.capabilities.audio,
          contextReady: Boolean(context),
          gainReady: Boolean(masterGain),
          disposed: this.disposed,
        }) ||
        !context ||
        !masterGain
      ) {
        return;
      }
      const source = context.createBufferSource();
      const gain = context.createGain();
      source.buffer = buffer;
      source.loop = loop;
      gain.gain.value = volume;
      source.connect(gain);
      gain.connect(masterGain);
      source.onended = () => {
        this.audioSources.delete(source);
        source.disconnect();
        gain.disconnect();
      };
      this.audioSources.add(source);
      source.start();
    } catch (error) {
      if (!isAbortError(error)) this.disableAudio(error);
    }
  }

  private disableAudio(reason: unknown): void {
    if (!this.capabilities.audio) return;
    console.warn("[yurisa-launch] audio disabled", reason);
    this.setCapability("audio", false);
    for (const source of this.audioSources) {
      try {
        source.stop();
      } catch {
        // Already stopped.
      }
    }
    this.audioSources.clear();
    void this.audioContext?.close().catch(() => undefined);
    this.audioContext = null;
    this.masterGain = null;
  }

  private disposeAudio(): void {
    const context = this.audioContext;
    const gain = this.masterGain;
    const sources = [...this.audioSources];
    this.audioContext = null;
    this.masterGain = null;
    this.audioBuffers.clear();
    this.audioSources.clear();
    if (!context) return;
    if (gain && context.state !== "closed") {
      try {
        gain.gain.cancelScheduledValues(context.currentTime);
        gain.gain.setValueAtTime(0, context.currentTime);
      } catch {
        // Continue releasing sources even if an implementation rejects automation.
      }
    }
    for (const source of sources) {
      try {
        source.stop();
      } catch {
        // Already stopped.
      }
      try {
        source.disconnect();
      } catch {
        // Continue releasing the remaining audio graph.
      }
    }
    try {
      gain?.disconnect();
    } catch {
      // The context close below remains the final release boundary.
    }
    try {
      void context.close().catch(() => undefined);
    } catch {
      // Closing an already-closed or host-replaced context is best-effort.
    }
  }
}
