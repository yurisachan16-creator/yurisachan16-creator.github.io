import { describe, expect, it } from "vitest";

import {
  AUDIO_IDS,
  getAudioControlPresentation,
  hasAudioAssets,
  shouldInitializeAudio,
  shouldPlayAudio,
} from "./audio-policy";

describe("launch audio policy", () => {
  it("detects launch audio only when a configured asset has a URL", () => {
    expect(AUDIO_IDS).toEqual([
      "audio.bgm",
      "audio.duang",
      "audio.doorComeout",
      "audio.doorThrough",
    ]);
    expect(hasAudioAssets({})).toBe(false);
    expect(hasAudioAssets({ "audio.bgm": { url: "" } })).toBe(false);
    expect(
      hasAudioAssets({ "audio.doorThrough": { url: "/door-through.mp3" } }),
    ).toBe(true);
  });

  it("initializes audio once, from a live and available generation", () => {
    expect(
      shouldInitializeAudio({
        available: false,
        contextCreated: false,
        disposed: false,
      }),
    ).toBe(false);
    expect(
      shouldInitializeAudio({
        available: true,
        contextCreated: true,
        disposed: false,
      }),
    ).toBe(false);
    expect(
      shouldInitializeAudio({
        available: true,
        contextCreated: false,
        disposed: true,
      }),
    ).toBe(false);
    expect(
      shouldInitializeAudio({
        available: true,
        contextCreated: false,
        disposed: false,
      }),
    ).toBe(true);
  });

  it("plays only while the full Web Audio chain belongs to a live generation", () => {
    expect(
      shouldPlayAudio({
        available: false,
        contextReady: true,
        gainReady: true,
        disposed: false,
      }),
    ).toBe(false);
    expect(
      shouldPlayAudio({
        available: true,
        contextReady: false,
        gainReady: true,
        disposed: false,
      }),
    ).toBe(false);
    expect(
      shouldPlayAudio({
        available: true,
        contextReady: true,
        gainReady: false,
        disposed: false,
      }),
    ).toBe(false);
    expect(
      shouldPlayAudio({
        available: true,
        contextReady: true,
        gainReady: true,
        disposed: true,
      }),
    ).toBe(false);
    expect(
      shouldPlayAudio({
        available: true,
        contextReady: true,
        gainReady: true,
        disposed: false,
      }),
    ).toBe(true);
  });

  it("derives every mute-button presentation without touching the DOM", () => {
    expect(getAudioControlPresentation(false, false)).toEqual({
      disabled: true,
      pressed: false,
      label: "声音不可用",
    });
    expect(getAudioControlPresentation(false, true)).toEqual({
      disabled: true,
      pressed: false,
      label: "声音不可用",
    });
    expect(getAudioControlPresentation(true, true)).toEqual({
      disabled: false,
      pressed: true,
      label: "开启声音",
    });
    expect(getAudioControlPresentation(true, false)).toEqual({
      disabled: false,
      pressed: false,
      label: "静音",
    });
  });
});
