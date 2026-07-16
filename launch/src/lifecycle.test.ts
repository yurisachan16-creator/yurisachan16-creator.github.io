import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createShaderCompilationError,
  runBestEffortCleanup,
  ShaderFailureLatch,
} from "./lifecycle";

describe("runBestEffortCleanup", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("continues through a throwing disposer and reports its label", () => {
    const order: string[] = [];
    const failure = new Error("broken pass");
    const report = vi.fn();

    runBestEffortCleanup(
      [
        { label: "first", run: () => order.push("first") },
        {
          label: "bloom-pass",
          run: () => {
            order.push("bloom-pass");
            throw failure;
          },
        },
        { label: "renderer", run: () => order.push("renderer") },
      ],
      report,
    );

    expect(order).toEqual(["first", "bloom-pass", "renderer"]);
    expect(report).toHaveBeenCalledWith("bloom-pass", failure);
  });

  it("continues even when the cleanup reporter throws", () => {
    const finalStep = vi.fn();

    expect(() =>
      runBestEffortCleanup(
        [
          {
            label: "scene",
            run: () => {
              throw new Error("scene dispose failed");
            },
          },
          { label: "scope", run: finalStep },
        ],
        () => {
          throw new Error("reporter failed");
        },
      ),
    ).not.toThrow();
    expect(finalStep).toHaveBeenCalledOnce();
  });

  it("uses the default diagnostic reporter", () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const failure = new Error("audio dispose failed");

    runBestEffortCleanup([
      {
        label: "audio",
        run: () => {
          throw failure;
        },
      },
    ]);

    expect(warning).toHaveBeenCalledWith(
      "[yurisa-launch] audio cleanup failed",
      failure,
    );
  });
});

describe("createShaderCompilationError", () => {
  it("preserves program, vertex and fragment diagnostics", () => {
    const error = createShaderCompilationError(
      "link failed",
      "bad vertex token",
      "bad fragment token",
    );

    expect(error.message).toContain("failed to compile or link");
    expect(error.message).toContain("Program: link failed");
    expect(error.message).toContain("Vertex: bad vertex token");
    expect(error.message).toContain("Fragment: bad fragment token");
  });

  it("latches the first shader failure until cleanup clears it", () => {
    const latch = new ShaderFailureLatch();

    expect(() => latch.throwIfFailed()).not.toThrow();
    latch.capture("first program", "first vertex", "first fragment");
    latch.capture("second program", "second vertex", "second fragment");
    expect(() => latch.throwIfFailed()).toThrowError(/first program/);
    expect(() => latch.throwIfFailed()).not.toThrowError(/second program/);

    latch.clear();
    expect(() => latch.throwIfFailed()).not.toThrow();
  });
});
