import {
  ShaderMaterial,
  Texture,
  type BufferGeometry,
  type Material,
  type Mesh,
  type Object3D,
} from "three";

type Disposer = () => void;

function disposeMaterial(
  material: Material,
  textures: Set<Texture>,
  materials: Set<Material>,
): void {
  if (materials.has(material)) return;
  materials.add(material);

  for (const value of Object.values(material)) {
    if (value instanceof Texture && !textures.has(value)) {
      textures.add(value);
      value.dispose();
    }
  }
  if (material instanceof ShaderMaterial) {
    for (const uniform of Object.values(material.uniforms)) {
      const value = uniform.value;
      const values = Array.isArray(value) ? value : [value];
      for (const candidate of values) {
        if (candidate instanceof Texture && !textures.has(candidate)) {
          textures.add(candidate);
          candidate.dispose();
        }
      }
    }
  }
  material.dispose();
}

export function disposeObject3D(root: Object3D): void {
  const geometries = new Set<BufferGeometry>();
  const materials = new Set<Material>();
  const textures = new Set<Texture>();

  root.traverse((object) => {
    const mesh = object as Mesh;
    if (mesh.geometry && !geometries.has(mesh.geometry)) {
      geometries.add(mesh.geometry);
      mesh.geometry.dispose();
    }

    if (!mesh.material) return;
    const meshMaterials = Array.isArray(mesh.material)
      ? mesh.material
      : [mesh.material];
    for (const material of meshMaterials) {
      disposeMaterial(material, textures, materials);
    }
  });

  root.removeFromParent();
  root.clear();
}

export class ResourceScope {
  readonly generation: number;
  private disposers: Disposer[] = [];
  private timers = new Set<number>();
  private audios = new Set<HTMLAudioElement>();
  private disposed = false;

  constructor(generation: number) {
    this.generation = generation;
  }

  get alive(): boolean {
    return !this.disposed;
  }

  add(disposer: Disposer): Disposer {
    if (this.disposed) {
      try {
        disposer();
      } catch {
        // A late resource must never resurrect a disposed generation.
      }
      return disposer;
    }
    this.disposers.push(disposer);
    return disposer;
  }

  listen<K extends keyof WindowEventMap>(
    target: Window,
    type: K,
    listener: (event: WindowEventMap[K]) => void,
    options?: AddEventListenerOptions | boolean,
  ): void;
  listen<K extends keyof DocumentEventMap>(
    target: Document,
    type: K,
    listener: (event: DocumentEventMap[K]) => void,
    options?: AddEventListenerOptions | boolean,
  ): void;
  listen(
    target: EventTarget,
    type: string,
    listener: EventListener,
    options?: AddEventListenerOptions | boolean,
  ): void;
  listen(
    target: EventTarget,
    type: string,
    listener: EventListener,
    options?: AddEventListenerOptions | boolean,
  ): void {
    target.addEventListener(type, listener, options);
    this.add(() => target.removeEventListener(type, listener, options));
  }

  timeout(callback: () => void, delayMs: number): number {
    const id = window.setTimeout(() => {
      this.timers.delete(id);
      if (this.alive) callback();
    }, delayMs);
    this.timers.add(id);
    return id;
  }

  clearTimeout(id: number): void {
    window.clearTimeout(id);
    this.timers.delete(id);
  }

  trackAudio(audio: HTMLAudioElement): HTMLAudioElement {
    this.audios.add(audio);
    return audio;
  }

  trackObject(root: Object3D): Object3D {
    this.add(() => disposeObject3D(root));
    return root;
  }

  guard<T>(value: T, disposeLate?: (value: T) => void): T {
    if (!this.alive) {
      disposeLate?.(value);
      throw new DOMException("Launch generation was disposed", "AbortError");
    }
    return value;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    for (const id of this.timers) window.clearTimeout(id);
    this.timers.clear();

    for (const audio of this.audios) {
      try {
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
      } catch {
        // Best-effort audio teardown must not block page unlock.
      }
    }
    this.audios.clear();

    for (let index = this.disposers.length - 1; index >= 0; index -= 1) {
      try {
        this.disposers[index]?.();
      } catch (error) {
        console.warn("[yurisa-launch] resource cleanup failed", error);
      }
    }
    this.disposers.length = 0;
  }
}
