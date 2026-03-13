// ─────────────────────────────────────────────────────────────
// Spawn System — Space Object Wave Management
// Creates new space objects at configured intervals.
// ─────────────────────────────────────────────────────────────

import {
  GAME_WIDTH,
  GAME_HEIGHT,
  MAX_SPACE_OBJECTS,
  SPAWN_MIN_INTERVAL_TICKS,
  SPAWN_MAX_INTERVAL_TICKS,
  OBJECT_MIN_SPEED,
  OBJECT_MAX_SPEED,
  RTP_TABLE,
  OBJECT_RADII,
  SPAWN_WEIGHTS,
  SpaceObjectType,
} from '@space-shooter/shared';
import type { IVector2 } from '@space-shooter/shared';
import type { World } from '../World.js';
import type { IRngService } from '../../services/CsprngService.js';

/** All space object types as an array for weighted selection */
const OBJECT_TYPES = Object.values(SpaceObjectType);

/**
 * Manages the spawning of space objects onto the playing field.
 * Objects spawn from off-screen edges and follow winding paths.
 */
export class SpawnSystem {
  private ticksUntilNextSpawn = 0;

  constructor(private readonly rng: IRngService) {
    this.ticksUntilNextSpawn = SPAWN_MIN_INTERVAL_TICKS;
  }

  /**
   * Called every tick. Decrements spawn timer and creates
   * new space objects when the timer expires.
   */
  update(world: World): void {
    this.ticksUntilNextSpawn--;

    if (this.ticksUntilNextSpawn > 0) return;

    // Check capacity
    if (world.spaceObjects.size >= MAX_SPACE_OBJECTS) {
      this.ticksUntilNextSpawn = SPAWN_MIN_INTERVAL_TICKS;
      return;
    }

    // Pick a random type via weighted selection
    const type = this.selectWeightedType();
    const rtpEntry = RTP_TABLE.get(type);
    const radius = OBJECT_RADII.get(type) ?? 30;

    if (!rtpEntry) return;

    // Generate a winding path
    const path = this.generatePath();
    const speed = this.rng.randomFloat(OBJECT_MIN_SPEED, OBJECT_MAX_SPEED);

    // Create the entity
    const entityId = world.createEntity();

    world.positions.set(entityId, { x: path[0].x, y: path[0].y });
    world.spaceObjects.set(entityId, {
      type,
      multiplier: rtpEntry.multiplier,
      destroyProbability: rtpEntry.destroyProbability,
      pathIndex: 0,
      pathProgress: 0,
      path,
      speed,
    });
    world.bounds.set(entityId, { radius });

    // Schedule next spawn
    this.ticksUntilNextSpawn = this.rng.randomRange(
      SPAWN_MIN_INTERVAL_TICKS,
      SPAWN_MAX_INTERVAL_TICKS + 1,
    );
  }

  /**
   * Weighted random selection of space object type.
   * Common objects (Asteroid) appear more often than rare ones (CosmicWhale).
   */
  private selectWeightedType(): SpaceObjectType {
    let totalWeight = 0;
    for (const type of OBJECT_TYPES) {
      totalWeight += SPAWN_WEIGHTS.get(type) ?? 1;
    }

    let roll = this.rng.randomFloat(0, totalWeight);
    for (const type of OBJECT_TYPES) {
      const weight = SPAWN_WEIGHTS.get(type) ?? 1;
      roll -= weight;
      if (roll <= 0) return type;
    }

    return SpaceObjectType.ASTEROID; // fallback
  }

  /**
   * Generate a winding path from one edge to another.
   * Creates 5-8 waypoints that snake through the play area.
   */
  private generatePath(): IVector2[] {
    const path: IVector2[] = [];
    const numWaypoints = this.rng.randomRange(5, 9);

    // Pick entry edge (0=top, 1=right, 2=bottom, 3=left)
    const entryEdge = this.rng.randomRange(0, 4);
    // Exit from opposite-ish edge
    const exitEdge = (entryEdge + 2 + this.rng.randomRange(-1, 2)) % 4;

    // Start point on entry edge
    path.push(this.pointOnEdge(entryEdge));

    // Intermediate winding waypoints
    for (let i = 1; i < numWaypoints - 1; i++) {
      const t = i / (numWaypoints - 1);
      const margin = 100;
      path.push({
        x: margin + this.rng.randomFloat(0, GAME_WIDTH - 2 * margin),
        y: margin + this.rng.randomFloat(0, GAME_HEIGHT - 2 * margin),
      });
    }

    // End point on exit edge
    path.push(this.pointOnEdge(exitEdge));

    return path;
  }

  /** Generate a random point on the specified screen edge */
  private pointOnEdge(edge: number): IVector2 {
    const margin = 50; // Spawn slightly off-screen
    switch (edge) {
      case 0: // top
        return { x: this.rng.randomFloat(0, GAME_WIDTH), y: -margin };
      case 1: // right
        return { x: GAME_WIDTH + margin, y: this.rng.randomFloat(0, GAME_HEIGHT) };
      case 2: // bottom
        return { x: this.rng.randomFloat(0, GAME_WIDTH), y: GAME_HEIGHT + margin };
      case 3: // left
        return { x: -margin, y: this.rng.randomFloat(0, GAME_HEIGHT) };
      default:
        return { x: -margin, y: this.rng.randomFloat(0, GAME_HEIGHT) };
    }
  }

  /** Reset spawn timer (e.g., on room restart) */
  reset(): void {
    this.ticksUntilNextSpawn = SPAWN_MIN_INTERVAL_TICKS;
  }
}
