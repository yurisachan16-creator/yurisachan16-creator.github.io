export interface CleanupStep {
  label: string;
  run: () => void;
}

export type CleanupErrorReporter = (label: string, error: unknown) => void;

function reportCleanupError(label: string, error: unknown): void {
  console.warn(`[yurisa-launch] ${label} cleanup failed`, error);
}

/**
 * Runs every teardown step even when an earlier resource has a broken disposer.
 * The reporter is isolated too: diagnostics must never become a second blocker.
 */
export function runBestEffortCleanup(
  steps: readonly CleanupStep[],
  reportError: CleanupErrorReporter = reportCleanupError,
): void {
  for (const step of steps) {
    try {
      step.run();
    } catch (error) {
      try {
        reportError(step.label, error);
      } catch {
        // Cleanup remains best-effort even when a host replaces console/reporting.
      }
    }
  }
}

export function createShaderCompilationError(
  programLog: string,
  vertexLog: string,
  fragmentLog: string,
): Error {
  return new Error(
    [
      "WebGL shader program failed to compile or link",
      `Program: ${programLog}`,
      `Vertex: ${vertexLog}`,
      `Fragment: ${fragmentLog}`,
    ].join("\n"),
  );
}

/** Stores the first shader failure until the synchronous compile/render boundary checks it. */
export class ShaderFailureLatch {
  private failure: Error | null = null;

  capture(programLog: string, vertexLog: string, fragmentLog: string): void {
    if (this.failure) return;
    this.failure = createShaderCompilationError(
      programLog,
      vertexLog,
      fragmentLog,
    );
  }

  throwIfFailed(): void {
    if (this.failure) throw this.failure;
  }

  clear(): void {
    this.failure = null;
  }
}
