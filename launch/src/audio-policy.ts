import type { RuntimeAsset } from "./types";

export const AUDIO_IDS = [
  "audio.bgm",
  "audio.duang",
  "audio.doorComeout",
  "audio.doorThrough",
] as const;

export interface AudioControlPresentation {
  disabled: boolean;
  pressed: boolean;
  label: string;
}

export interface AudioInitializationState {
  available: boolean;
  contextCreated: boolean;
  disposed: boolean;
}

export interface AudioPlaybackState {
  available: boolean;
  contextReady: boolean;
  gainReady: boolean;
  disposed: boolean;
}

export function hasAudioAssets(assets: Readonly<Record<string, RuntimeAsset>>): boolean {
  return AUDIO_IDS.some((id) => Boolean(assets[id]?.url));
}

export function shouldInitializeAudio(state: AudioInitializationState): boolean {
  if (!state.available) return false;
  if (state.contextCreated) return false;
  return !state.disposed;
}

export function shouldPlayAudio(state: AudioPlaybackState): boolean {
  if (!state.available) return false;
  if (!state.contextReady) return false;
  if (!state.gainReady) return false;
  return !state.disposed;
}

export function getAudioControlPresentation(
  available: boolean,
  muted: boolean,
): AudioControlPresentation {
  if (!available) {
    return { disabled: true, pressed: false, label: "声音不可用" };
  }
  if (muted) {
    return { disabled: false, pressed: true, label: "开启声音" };
  }
  return { disabled: false, pressed: false, label: "静音" };
}
