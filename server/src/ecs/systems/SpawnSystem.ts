// ─────────────────────────────────────────────────────────────
// Spawn System — Wave-Driven Space Object Spawning
// ─────────────────────────────────────────────────────────────
// Delegates wave selection and path generation to WaveManager.
// Processes SpawnRequests (including staggered delays) to create
// ECS entities with PathComponent for curve-based movement.
//
// CONFIG-DRIVEN: All spawn rates, speeds, and types from
// GameBalanceConfig via the objectTypes map.
// ─────────────────────────────────────────────────────────────

import {
  MAX_SPACE_OBJECTS,
  SPAWN_MIN_INTERVAL_TICKS,
  SPAWN_MAX_INTERVAL_TICKS,
  SpaceObjectType,
  FEATURE_TARGET_TYPES,
} from '@space-shooter/shared';
import type { World } from '../World.js';
import type { IRngService } from '../../services/CsprngService.js';
import type { IGameBalanceConfig, IObjectTypeConfig } from '../../config/GameBalanceConfig.js';
import { WaveManager } from '../../services/WaveManager.js';
import type { SpawnRequest } from '../../services/WaveManager.js';

/**
 * Manages the spawning of space objects onto the playing field.
 * Delegates to WaveManager for formation-based wave generation.
 * All multipliers, radii, and spawn weights are read from config.
 */
export class SpawnSystem {
  private ticksUntilNextSpawn = 0;
  private readonly waveManager: WaveManager;

  /** Pending spawn requests with remaining delay ticks */
  private readonly pendingSpawns: Array<{ request: SpawnRequest; remainingTicks: number }> = [];

  constructor(
    private readonly rng: IRngService,
    private readonly config: IGameBalanceConfig,
  ) {
    this.ticksUntilNextSpawn = SPAWN_MIN_INTERVAL_TICKS;
    this.waveManager = new WaveManager(rng);
  }

  /**
   * Called every tick. Manages wave timing, processes pending
   * delayed spawns, and creates entities with PathComponents.
   */
  update(world: World): void {
    // ─── Process pending delayed spawns ───
    for (let i = this.pendingSpawns.length - 1; i >= 0; i--) {
      const pending = this.pendingSpawns[i];
      pending.remainingTicks--;

      if (pending.remainingTicks <= 0) {
        // Check capacity before spawning
        if (world.spaceObjects.size < MAX_SPACE_OBJECTS) {
          this.instantiateSpawnRequest(world, pending.request);
        }
        this.pendingSpawns[i] = this.pendingSpawns.at(-1)!;
        this.pendingSpawns.pop();
      }
    }

    // ─── Wave timer ───
    this.ticksUntilNextSpawn--;
    if (this.ticksUntilNextSpawn > 0) return;

    // Check capacity
    if (world.spaceObjects.size >= MAX_SPACE_OBJECTS) {
      this.ticksUntilNextSpawn = SPAWN_MIN_INTERVAL_TICKS;
      return;
    }

    // Select and generate a wave
    const waveType = this.waveManager.selectWaveType();
    const requests = this.waveManager.generateWave(waveType);

    // Queue spawn requests (some may have delay > 0)
    for (const request of requests) {
      if (request.delayTicks <= 0) {
        // Spawn immediately
        if (world.spaceObjects.size < MAX_SPACE_OBJECTS) {
          this.instantiateSpawnRequest(world, request);
        }
      } else {
        // Queue for later
        this.pendingSpawns.push({
          request,
          remainingTicks: request.delayTicks,
        });
      }
    }

    // Schedule next wave
    this.ticksUntilNextSpawn = this.rng.randomRange(
      SPAWN_MIN_INTERVAL_TICKS,
      SPAWN_MAX_INTERVAL_TICKS + 1,
    );
  }

  /**
   * Instantiate a single SpawnRequest into the World.
   * Creates entity with Position, SpaceObject, Path, and Bounds components.
   */
  private instantiateSpawnRequest(world: World, request: SpawnRequest): void {
    // For RANDOM_SINGLE, override the placeholder type with weighted selection
    const type = request.type === SpaceObjectType.ASTEROID && request.delayTicks === 0
      ? this.selectWeightedType()
      : request.type;

    const objConfig = this.config.objectTypes[type];

    // Create the entity
    const entityId = world.createEntity();

    // Initial position = first control point + offset (pooled)
    const startPt = request.controlPoints[0];
    const pos = world.positionPool.acquire();
    pos.x = startPt.x + request.offset.x;
    pos.y = startPt.y + request.offset.y;
    world.positions.set(entityId, pos);

    const so = world.spaceObjectPool.acquire();
    (so as { type: string }).type = type;
    (so as { multiplier: number }).multiplier = objConfig.multiplier;
    (so as { destroyProbability: number }).destroyProbability = objConfig.destroyProbability;
    so.absorbedCredits = 0;
    so.isDead = false;
    world.spaceObjects.set(entityId, so);

    // Game balance: feature targets (blackhole, drill, emp, orbital, vault) stay on
    // screen 2.5× longer than normal objects to give players enough time to shoot them,
    // since they are rarer and trigger valuable hazard/bonus mechanics on kill.
    const isFeature = FEATURE_TARGET_TYPES.has(type as any);
    const FEATURE_DURATION_MULTIPLIER = 2.5;
    const finalDuration = isFeature ? request.duration * FEATURE_DURATION_MULTIPLIER : request.duration;

    // Asteroids always travel in straight lines regardless of wave path type
    const pathType = type === SpaceObjectType.ASTEROID ? 'linear' : request.pathType;

    world.paths.set(entityId, {
      pathType,
      controlPoints: request.controlPoints,
      duration: finalDuration,
      timeAlive: 0,
      offset: request.offset,
      sineAmplitude: pathType === 'linear' ? 0 : request.sineAmplitude,
      sineFrequency: pathType === 'linear' ? 0 : request.sineFrequency,
    });

    const bound = world.boundsPool.acquire();
    (bound as { radius: number }).radius = objConfig.collisionRadius;
    world.bounds.set(entityId, bound);
  }

  /**
   * Weighted random selection of space object type.
   * Weights come from GameBalanceConfig.objectTypes[type].spawnWeight.
   */
  private selectWeightedType(): SpaceObjectType {
    const entries = Object.entries(this.config.objectTypes) as Array<[SpaceObjectType, IObjectTypeConfig]>;

    let totalWeight = 0;
    for (const [, objConfig] of entries) {
      totalWeight += objConfig.spawnWeight;
    }

    let roll = this.rng.randomFloat(0, totalWeight);
    for (const [type, objConfig] of entries) {
      roll -= objConfig.spawnWeight;
      if (roll <= 0) return type;
    }

    return SpaceObjectType.ASTEROID; // fallback
  }

  /** Reset spawn timer and clear pending spawns */
  reset(): void {
    this.ticksUntilNextSpawn = SPAWN_MIN_INTERVAL_TICKS;
    this.pendingSpawns.length = 0;
  }
}
