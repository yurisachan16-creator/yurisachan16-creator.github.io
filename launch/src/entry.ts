import { LaunchController } from "./controller";
import type {
  LaunchExperienceHandle,
  MountLaunchExperienceOptions,
} from "./types";

export type {
  LaunchDebugState,
  LaunchExperienceHandle,
  LaunchOutcome,
  LaunchPhase,
  LaunchProgress,
  LaunchRuntimeManifest,
  LaunchTestConfig,
  MountLaunchExperienceOptions,
} from "./types";

/**
 * Mounts one isolated launch generation. The promise resolves as soon as the
 * controller and fail-open hooks exist; model loading continues behind the
 * returned handle so Escape/Skip work during the loading phase.
 */
export async function mountLaunchExperience(
  options: MountLaunchExperienceOptions,
): Promise<LaunchExperienceHandle> {
  if (!(options.host instanceof HTMLElement)) {
    throw new TypeError("mountLaunchExperience requires an HTMLElement host");
  }
  if (options.signal.aborted) {
    throw new DOMException("Launch generation was aborted", "AbortError");
  }

  const controller = new LaunchController(options);
  controller.mount();
  return controller;
}
