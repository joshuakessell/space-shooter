// ─────────────────────────────────────────────────────────────
// System Runner — Orchestrates ECS System Execution Order
// Strict top-down pipeline per Phaser 4 skill contract.
// ─────────────────────────────────────────────────────────────

import type { EntityId, IPayoutEvent, IVector2 } from '@space-shooter/shared';
import {
  FIXED_TIMESTEP_SEC,
  PROJECTILE_SPEED,
  PROJECTILE_RADIUS,
  MAX_PROJECTILES_PER_PLAYER,
  TURRET_POSITIONS,
  MIN_BET,
  MAX_BET,
} from '@space-shooter/shared';
import type { World } from '../World.js';
import type { FireIntentComponent } from '../components.js';
import { movementSystem } from './MovementSystem.js';
import { projectileSystem } from './ProjectileSystem.js';
import { collisionSystem } from './CollisionSystem.js';
import type { CollisionEvent } from './CollisionSystem.js';
import { destroySystem } from './DestroySystem.js';
import { SpawnSystem } from './SpawnSystem.js';
import { cleanupSystem } from './CleanupSystem.js';
import type { RtpEngine } from '../../services/RtpEngine.js';
import type { WalletManager } from '../../services/WalletManager.js';

/** Result of a single simulation tick */
export interface TickResult {
  readonly payouts: readonly IPayoutEvent[];
  readonly destroyedIds: readonly EntityId[];
  readonly newProjectiles: readonly NewProjectileInfo[];
  readonly rejectedShots: readonly RejectedShot[];
}

export interface NewProjectileInfo {
  readonly entityId: EntityId;
  readonly ownerId: string;
  readonly x: number;
  readonly y: number;
  readonly angle: number;
}

export interface RejectedShot {
  readonly playerId: string;
  readonly reason: string;
}

/**
 * Orchestrates the ECS system pipeline in strict order:
 *
 * 1. Input    — Process fire intents (create projectiles)
 * 2. Spawn    — Create new space objects
 * 3. Movement — Move space objects along paths
 * 4. Projectile — Move lasers + handle ricochets
 * 5. Collision — Quadtree broad-phase + circle narrow-phase
 * 6. Destroy  — CSPRNG roll + payout
 * 7. Cleanup  — Purge PendingDestroy entities
 *
 * Systems must never call each other directly.
 * Data flows via Components only.
 */
export class SystemRunner {
  private readonly spawnSystem: SpawnSystem;

  constructor(
    private readonly world: World,
    private readonly rtpEngine: RtpEngine,
    private readonly wallet: WalletManager,
    spawnSystem: SpawnSystem,
  ) {
    this.spawnSystem = spawnSystem;
  }

  /**
   * Execute one full simulation tick.
   * Returns events for the room to broadcast.
   */
  tick(): TickResult {
    const delta = FIXED_TIMESTEP_SEC;
    const newProjectiles: NewProjectileInfo[] = [];
    const rejectedShots: RejectedShot[] = [];

    // ─── 1. Input: Process Fire Intents ───
    for (const [intentId, intent] of this.world.fireIntents) {
      const result = this.processFireIntent(intent);
      if ('reason' in result) {
        rejectedShots.push(result);
      } else {
        newProjectiles.push(result);
      }
      // Intents are consumed immediately
      this.world.fireIntents.delete(intentId);
    }

    // ─── 2. Spawn: Create new space objects ───
    this.spawnSystem.update(this.world);

    // ─── 3. Movement: Advance space objects along paths ───
    movementSystem(this.world, delta);

    // ─── 4. Projectile: Move lasers + ricochets ───
    projectileSystem(this.world, delta);

    // ─── 5. Collision: Detect hits ───
    const collisions: CollisionEvent[] = collisionSystem(this.world);

    // ─── 6. Destroy: RNG roll + payouts ───
    const payouts = destroySystem(this.world, collisions, this.rtpEngine, this.wallet);

    // ─── 7. Cleanup: Purge destroyed entities ───
    const destroyedIds = cleanupSystem(this.world);

    // Advance tick counter
    this.world.currentTick++;

    return { payouts, destroyedIds, newProjectiles, rejectedShots };
  }

  /**
   * Process a single fire intent: validate, deduct bet, create projectile entity.
   */
  private processFireIntent(intent: FireIntentComponent): NewProjectileInfo | RejectedShot {
    const { playerId, angle, betAmount } = intent;

    // Validate bet range
    if (betAmount < MIN_BET || betAmount > MAX_BET) {
      return { playerId, reason: `Bet must be between ${MIN_BET} and ${MAX_BET}` };
    }

    // Check projectile cap for this player
    let playerProjectileCount = 0;
    for (const [, proj] of this.world.projectiles) {
      if (proj.ownerId === playerId) playerProjectileCount++;
    }
    if (playerProjectileCount >= MAX_PROJECTILES_PER_PLAYER) {
      return { playerId, reason: 'Maximum active projectiles reached' };
    }

    // Deduct bet from wallet (atomic)
    if (!this.wallet.deductBet(playerId, betAmount)) {
      return { playerId, reason: 'Insufficient credits' };
    }

    // Find turret position for this player
    let turretX = 960;
    let turretY = 540;
    for (const [, turret] of this.world.turrets) {
      if (turret.playerId === playerId) {
        const tpos = TURRET_POSITIONS[turret.position];
        if (tpos) {
          turretX = tpos.x;
          turretY = tpos.y;
        }
        break;
      }
    }

    // Create projectile entity
    const entityId = this.world.createEntity();
    this.world.positions.set(entityId, { x: turretX, y: turretY });
    this.world.projectiles.set(entityId, {
      ownerId: playerId,
      betAmount,
      angle,
      bouncesRemaining: 10,
    });
    this.world.bounds.set(entityId, { radius: PROJECTILE_RADIUS });

    return { entityId, ownerId: playerId, x: turretX, y: turretY, angle };
  }
}
