// ─────────────────────────────────────────────────────────────
// Generic Object Pool — Prevents GC Pressure
// Pre-allocates objects and recycles them.
// ─────────────────────────────────────────────────────────────

/**
 * Generic object pool for high-frequency entity recycling.
 * Used for projectiles and space objects to avoid
 * thousands of allocations/deallocations per minute.
 */
export class ObjectPool<T> {
  private readonly pool: T[] = [];
  private readonly factory: () => T;
  private readonly reset: (obj: T) => void;

  constructor(factory: () => T, reset: (obj: T) => void, initialSize: number) {
    this.factory = factory;
    this.reset = reset;

    // Pre-allocate
    for (let i = 0; i < initialSize; i++) {
      this.pool.push(factory());
    }
  }

  /** Acquire an object from the pool (or create a new one if empty) */
  acquire(): T {
    if (this.pool.length > 0) {
      return this.pool.pop()!;
    }
    return this.factory();
  }

  /** Release an object back to the pool */
  release(obj: T): void {
    this.reset(obj);
    this.pool.push(obj);
  }

  /** Get the number of available objects in the pool */
  get available(): number {
    return this.pool.length;
  }

  /** Drain the pool completely */
  clear(): void {
    this.pool.length = 0;
  }
}
