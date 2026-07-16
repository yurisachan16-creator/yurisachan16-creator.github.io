import { describe, expect, it } from "vitest";

import { selectSceneRuntimeAsset } from "./scene";
import type { RuntimeAsset } from "./types";

describe("scene asset quality selection", () => {
  const asset: RuntimeAsset = {
    url: "/texture-original.png",
    bytes: 4_096,
    sha256: "original",
    mobileUrl: "/texture-mobile.webp",
    mobileBytes: 1_024,
    mobileSha256: "mobile",
  };

  it("keeps original PNG payloads for high and medium phone sessions", () => {
    expect(selectSceneRuntimeAsset(asset, true, "high")).toBe(asset);
    expect(selectSceneRuntimeAsset(asset, true, "medium")).toBe(asset);
    expect(selectSceneRuntimeAsset(asset, false, "low")).toBe(asset);
  });

  it("uses the derived 512px payload only when initial quality is low", () => {
    expect(selectSceneRuntimeAsset(asset, true, "low")).toMatchObject({
      url: "/texture-mobile.webp",
      bytes: 1_024,
      sha256: "mobile",
    });
    expect(
      selectSceneRuntimeAsset(
        { url: "/texture-original.png", mobileUrl: "/texture-mobile.webp" },
        true,
        "low",
      ),
    ).toMatchObject({ url: "/texture-mobile.webp" });
    expect(
      selectSceneRuntimeAsset({ url: "/texture-original.png" }, true, "low"),
    ).toEqual({ url: "/texture-original.png" });
  });
});
