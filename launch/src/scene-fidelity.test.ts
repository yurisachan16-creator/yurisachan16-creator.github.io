import { describe, expect, it } from "vitest";

import {
  MeshStandardMaterial,
  Texture,
  type WebGLRenderer,
} from "three";

import {
  UPSTREAM_CAMERA,
  UPSTREAM_BLOOM,
  UPSTREAM_GATE,
  UPSTREAM_LIGHTS,
  UPSTREAM_POSTPROCESS_ORDER,
  UPSTREAM_RANDOM_WARMUP_CALLS,
  UPSTREAM_REFERENCE_PROFILE,
  UPSTREAM_ROAD,
  UPSTREAM_WHITE_PLANE_COLOR_SCALE,
  advanceUpstreamCameraZ,
  backOut,
  createUpstreamLegacyColor,
  createUpstreamGradientTexture,
  cubicIn,
  cubicOut,
  estimateUpstreamBloomTargetBytes,
  createUpstreamHdrTarget,
  evaluateUpstreamTransition,
  patchUpstreamLegacyAmbientIrradiance,
  tuneUpstreamMaterial,
  tuneUpstreamWhitePlaneMaterial,
} from "./scene-fidelity";

describe("locked upstream scene profile", () => {
  it("pins the www-genshin 090cb90 camera, road, gate, and post chain", () => {
    expect(UPSTREAM_REFERENCE_PROFILE).toBe("090cb90-r150");
    expect(UPSTREAM_CAMERA).toEqual({
      fov: 45,
      near: 50,
      far: 100_000,
      pitchDegrees: 5.5,
      forwardSpeed: -88,
    });
    expect(UPSTREAM_ROAD).toMatchObject({
      unitLength: 212.4027,
      sourceSegments: 12,
      loopLength: 424.8054,
      loweredY: 70,
      riseSeconds: 2,
    });
    expect(UPSTREAM_GATE).toMatchObject({
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
    expect(UPSTREAM_POSTPROCESS_ORDER).toEqual([
      "render",
      "fxaa",
      "bloom",
      "transition",
      "output",
    ]);
    expect(UPSTREAM_RANDOM_WARMUP_CALLS).toBe(1_402);
    expect(UPSTREAM_LIGHTS).toMatchObject({
      ambientColor: 0x0f6eff,
      ambientIntensity: 6,
      directionalColor: 0xff6222,
      directionalIntensity: 35,
      legacyUniformScale: Math.PI,
    });
    expect(UPSTREAM_BLOOM).toEqual({
      threshold: 2,
      smoothing: 0.025,
      intensity: 0.6,
      radius: 0.85,
      levels: 8,
      resolutionScale: 1,
    });
  });

  it("compounds shared Road tint while installing its shader hook once", () => {
    const material = new MeshStandardMaterial({ color: 0xffffff });
    material.map = new Texture();
    const renderer = {
      capabilities: { getMaxAnisotropy: () => 16 },
    } as unknown as WebGLRenderer;

    tuneUpstreamMaterial(material, "road", renderer);
    const firstHook = material.onBeforeCompile;
    const firstCacheKey = material.customProgramCacheKey;
    const firstColor = material.color.clone();
    tuneUpstreamMaterial(material, "road", renderer);

    expect(material.color.toArray()).toEqual([
      firstColor.r * 1.015,
      firstColor.g * (0xfc / 0xff),
      firstColor.b * (0xfe / 0xff),
    ]);
    expect(material.onBeforeCompile).toBe(firstHook);
    expect(material.customProgramCacheKey).toBe(firstCacheKey);
    expect(material.map.anisotropy).toBe(8);
    material.dispose();
    material.map.dispose();
  });

  it("expands the r185 light chunk with legacy PI scaling before compile", () => {
    const material = new MeshStandardMaterial();
    const renderer = {
      capabilities: { getMaxAnisotropy: () => 16 },
    } as unknown as WebGLRenderer;
    tuneUpstreamMaterial(material, "scenery", renderer);
    const shader = {
      uniforms: {},
      vertexShader: "void main() {}",
      fragmentShader: [
        "#include <lights_physical_pars_fragment>",
        "#include <lights_fragment_begin>",
        "#include <fog_fragment>",
      ].join("\n"),
    } as unknown as Parameters<typeof material.onBeforeCompile>[0];

    material.onBeforeCompile(shader, renderer);

    expect(shader.fragmentShader).not.toContain(
      "#include <lights_fragment_begin>",
    );
    expect(shader.fragmentShader).toContain(
      "getAmbientLightIrradiance( ambientLightColor ) * yurisaLegacyLightScale",
    );
    expect(shader.fragmentShader).toContain(
      "directLight.color\n        * yurisaLegacyLightScale",
    );
    material.dispose();
  });

  it("restores the r150 single-scatter WHITE_PLANE direct BRDF", () => {
    const material = new MeshStandardMaterial({
      color: UPSTREAM_WHITE_PLANE_COLOR_SCALE,
    });
    const renderer = {} as WebGLRenderer;

    tuneUpstreamWhitePlaneMaterial(material);
    const firstHook = material.onBeforeCompile;
    tuneUpstreamWhitePlaneMaterial(material);

    const shader = {
      uniforms: {},
      vertexShader: "void main() {}",
      fragmentShader: "#include <lights_physical_pars_fragment>",
    } as unknown as Parameters<typeof material.onBeforeCompile>[0];
    material.onBeforeCompile(shader, renderer);

    expect(UPSTREAM_WHITE_PLANE_COLOR_SCALE).toBe(3);
    expect(material.onBeforeCompile).toBe(firstHook);
    expect(shader.fragmentShader).toContain(
      "#define RE_Direct RE_Direct_YurisaR150Standard",
    );
    expect(shader.fragmentShader).toContain("* BRDF_GGX(");
    expect(shader.fragmentShader).not.toContain("BRDF_GGX_Multiscatter");
    expect(shader.fragmentShader).toContain(
      `directLight.color * ${Math.PI.toFixed(16)}`,
    );
    expect(material.customProgramCacheKey()).toBe(
      "yurisa-upstream-r150-white-plane-r185",
    );
    material.dispose();
  });

  it("matches the upstream cubic and Back.Out curves", () => {
    expect(cubicIn(-1)).toBe(0);
    expect(cubicIn(0.5)).toBeCloseTo(0.125, 8);
    expect(cubicIn(2)).toBe(1);
    expect(cubicOut(-1)).toBe(0);
    expect(cubicOut(0.5)).toBeCloseTo(0.875, 8);
    expect(cubicOut(2)).toBe(1);
    expect(backOut(0)).toBeCloseTo(0, 12);
    expect(backOut(0.5)).toBeGreaterThan(1);
    expect(backOut(1)).toBe(1);
    expect(advanceUpstreamCameraZ(0, 1)).toBe(-88);
    expect(advanceUpstreamCameraZ(-88, 0.5)).toBe(-132);
    expect(advanceUpstreamCameraZ(-132, -1)).toBe(-132);
  });

  it("ports r150 legacy light uniforms and exact mipmap Bloom storage", () => {
    const source =
      "vec3 irradiance = getAmbientLightIrradiance( ambientLightColor );";
    expect(patchUpstreamLegacyAmbientIrradiance(source)).toContain(
      "* yurisaLegacyLightScale",
    );
    expect(() => patchUpstreamLegacyAmbientIrradiance("void main() {}"))
      .toThrow(/shader ABI changed/);
    expect(estimateUpstreamBloomTargetBytes(1_000)).toBe(13_334);
    expect(estimateUpstreamBloomTargetBytes(1_000, 0.5)).toBe(3_334);
    const target = createUpstreamHdrTarget("test-hdr", true);
    expect(target.texture.name).toBe("test-hdr");
    expect(target.depthBuffer).toBe(true);
    expect(target.stencilBuffer).toBe(false);
    expect(target.texture.format).toBe(1022);
    expect(target.texture.type).toBe(35899);
    target.dispose();
  });

  it("builds the upstream one-pixel-wide inverse-ACES sky ramp", () => {
    const texture = createUpstreamGradientTexture(5);
    const image = texture.image as {
      data: Float32Array;
      width: number;
      height: number;
    };
    expect(image.width).toBe(1);
    expect(image.height).toBe(5);
    expect(image.data).toHaveLength(20);
    expect([...image.data].every(Number.isFinite)).toBe(true);
    expect(image.data[3]).toBe(1);
    expect(image.data[19]).toBe(1);
    texture.dispose();
  });

  it("preserves Three r150 legacy hex color semantics under r185", () => {
    expect(createUpstreamLegacyColor(0xff6222).toArray()).toEqual([
      1,
      0x62 / 255,
      0x22 / 255,
    ]);
  });
});

describe("upstream entering transition", () => {
  it("begins white at 0.5s, reaches full white at 0.7s, and peaks at 0.84s", () => {
    expect(evaluateUpstreamTransition(0)).toEqual({
      intensity: 0,
      whiteAlpha: 0,
    });
    expect(evaluateUpstreamTransition(0.488).intensity).toBeCloseTo(
      0.588224165856819,
      12,
    );
    expect(evaluateUpstreamTransition(0.5)).toEqual({
      intensity: 0.6326935536119209,
      whiteAlpha: 0,
    });
    expect(evaluateUpstreamTransition(0.6).whiteAlpha).toBeCloseTo(0.5, 8);
    expect(evaluateUpstreamTransition(0.696).intensity).toBeCloseTo(
      1.7065189504373173,
      12,
    );
    const atFullWhite = evaluateUpstreamTransition(0.7);
    expect(atFullWhite.intensity).toBeCloseTo(1.7361111111111105, 12);
    expect(atFullWhite.whiteAlpha).toBeCloseTo(1, 12);
    expect(evaluateUpstreamTransition(0.84)).toEqual({
      intensity: 3,
      whiteAlpha: 1,
    });
    expect(evaluateUpstreamTransition(2.1)).toEqual({
      intensity: 3,
      whiteAlpha: 1,
    });
  });
});
