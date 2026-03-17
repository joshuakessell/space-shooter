// ─────────────────────────────────────────────────────────────
// ECS World — Entity Registry & Component Storage
// Engine-agnostic, headless-safe. No Phaser/Colyseus imports.
// ─────────────────────────────────────────────────────────────

import type { EntityId } from '@space-shooter/shared';
import type {
  PositionComponent,
  VelocityComponent,
  SpaceObjectComponent,
  ProjectileComponent,
  TurretComponent,
  BoundsComponent,
  PendingDestroyComponent,
  FireIntentComponent,
  PathComponent,
  HazardComponent,
  PlayerBuffState,
  ComponentStore,
} from './components.js';
import { ObjectPool } from '../pool/ObjectPool.js';

/**
 * The ECS World: owns all component stores and the entity ID allocator.
 * Entities are just integer IDs. Components are plain data in Map stores.
 */
export class World {
  // ─── Entity Management ───
  private nextEntityId: EntityId = 1;
  private readonly recycledIds: EntityId[] = [];
  private readonly activeEntities: Set<EntityId> = new Set();

  // ─── Component Stores (sparse Map-based) ───
  public readonly positions: ComponentStore<PositionComponent> = new Map();
  public readonly velocities: ComponentStore<VelocityComponent> = new Map();
  public readonly spaceObjects: ComponentStore<SpaceObjectComponent> = new Map();
  public readonly projectiles: ComponentStore<ProjectileComponent> = new Map();
  public readonly turrets: ComponentStore<TurretComponent> = new Map();
  public readonly bounds: ComponentStore<BoundsComponent> = new Map();
  public readonly pendingDestroy: ComponentStore<PendingDestroyComponent> = new Map();
  public readonly fireIntents: ComponentStore<FireIntentComponent> = new Map();
  public readonly paths: ComponentStore<PathComponent> = new Map();
  public readonly hazards: ComponentStore<HazardComponent> = new Map();

  /** Per-player buff state (orbital laser, vault pause) */
  public readonly playerBuffs: Map<string, PlayerBuffState> = new Map();

  /** Current simulation tick */
  public currentTick = 0;

  // ─── Component Pools (prevents GC pressure) ───

  public readonly positionPool = new ObjectPool<PositionComponent>(
    () => ({ x: 0, y: 0 }),
    (p) => { p.x = 0; p.y = 0; },
    200,
  );

  public readonly projectilePool = new ObjectPool<ProjectileComponent>(
    () => ({ ownerId: '', betAmount: 0, angle: 0, bouncesRemaining: 0, weaponType: 'standard' as const, chainCount: 0, maxChains: 0, hitTargetIds: new Set<number>() }),
    (p) => {
      const m = p as { ownerId: string; betAmount: number; angle: number; bouncesRemaining: number; lockedTargetId?: number; weaponType: string; chainCount: number; maxChains: number; hitTargetIds: Set<number> };
      m.ownerId = ''; m.betAmount = 0; m.angle = 0; m.bouncesRemaining = 0;
      delete m.lockedTargetId;
      m.weaponType = 'standard'; m.chainCount = 0; m.maxChains = 0;
      m.hitTargetIds.clear();
    },
    100,
  );

  public readonly spaceObjectPool = new ObjectPool<SpaceObjectComponent>(
    () => ({ type: '' as SpaceObjectComponent['type'], multiplier: 1, destroyProbability: 0, absorbedCredits: 0, isDead: false, isCaptured: false }),
    (s) => {
      const m = s as { type: string; multiplier: number; destroyProbability: number; absorbedCredits: number; isDead: boolean; isCaptured: boolean };
      m.type = ''; m.multiplier = 1; m.destroyProbability = 0; m.absorbedCredits = 0; m.isDead = false; m.isCaptured = false;
    },
    50,
  );

  public readonly boundsPool = new ObjectPool<BoundsComponent>(
    () => ({ radius: 0 }),
    (b) => { (b as { radius: number }).radius = 0; },
    200,
  );

  // ─── Entity Lifecycle ───

  /** Acquire a new entity ID (recycled or fresh) */
  createEntity(): EntityId {
    let id: EntityId;
    if (this.recycledIds.length > 0) {
      id = this.recycledIds.pop()!;
    } else {
      id = this.nextEntityId++;
    }
    this.activeEntities.add(id);
    return id;
  }

  /** Check if an entity is alive */
  isAlive(id: EntityId): boolean {
    return this.activeEntities.has(id);
  }

  /**
   * Hard-remove an entity and all its components.
   * Called by CleanupSystem at the end of each tick for
   * entities tagged with PendingDestroy.
   */
  destroyEntity(id: EntityId): void {
    // Release pooled components before deleting
    const pos = this.positions.get(id);
    if (pos) this.positionPool.release(pos);

    const proj = this.projectiles.get(id);
    if (proj) this.projectilePool.release(proj);

    const so = this.spaceObjects.get(id);
    if (so) this.spaceObjectPool.release(so);

    const bound = this.bounds.get(id);
    if (bound) this.boundsPool.release(bound);

    this.positions.delete(id);
    this.velocities.delete(id);
    this.spaceObjects.delete(id);
    this.projectiles.delete(id);
    this.turrets.delete(id);
    this.bounds.delete(id);
    this.pendingDestroy.delete(id);
    this.fireIntents.delete(id);
    this.paths.delete(id);
    this.hazards.delete(id);
    this.activeEntities.delete(id);
    this.recycledIds.push(id);
  }

  /** Get count of active entities */
  getEntityCount(): number {
    return this.activeEntities.size;
  }

  /** Get all active entity IDs */
  getActiveEntities(): ReadonlySet<EntityId> {
    return this.activeEntities;
  }

  /**
   * Clear all entities flagged for pending destruction,
   * returning the list of destroyed entity IDs.
   */
  purgeDestroyed(): EntityId[] {
    const destroyed: EntityId[] = [];
    for (const [id] of this.pendingDestroy) {
      destroyed.push(id);
      this.destroyEntity(id);
    }
    return destroyed;
  }

  /** Wipe the entire world (e.g., on room dispose) */
  clear(): void {
    this.positions.clear();
    this.velocities.clear();
    this.spaceObjects.clear();
    this.projectiles.clear();
    this.turrets.clear();
    this.bounds.clear();
    this.pendingDestroy.clear();
    this.fireIntents.clear();
    this.paths.clear();
    this.hazards.clear();
    this.playerBuffs.clear();
    this.activeEntities.clear();
    this.recycledIds.length = 0;
    this.nextEntityId = 1;
    this.currentTick = 0;
  }
}
