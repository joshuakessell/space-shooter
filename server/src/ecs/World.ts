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
  ComponentStore,
} from './components.js';

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

  /** Current simulation tick */
  public currentTick = 0;

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
    this.positions.delete(id);
    this.velocities.delete(id);
    this.spaceObjects.delete(id);
    this.projectiles.delete(id);
    this.turrets.delete(id);
    this.bounds.delete(id);
    this.pendingDestroy.delete(id);
    this.fireIntents.delete(id);
    this.paths.delete(id);
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
    this.activeEntities.clear();
    this.recycledIds.length = 0;
    this.nextEntityId = 1;
    this.currentTick = 0;
  }
}
