// ─────────────────────────────────────────────────────────────
// System Runner — Orchestrates ECS System Execution Order
// ─────────────────────────────────────────────────────────────
// SECURITY: Rate limiting, hot-seat rotation, economy tracking.
// CONFIG-DRIVEN: All thresholds from GameBalanceConfig.
// ─────────────────────────────────────────────────────────────

import type { EntityId, IPayoutEvent } from '@space-shooter/shared';
import {
  FIXED_TIMESTEP_SEC,
  FIXED_TIMESTEP_MS,
  PROJECTILE_RADIUS,
  MAX_PROJECTILES_PER_PLAYER,
  MAX_BOUNCES,
  BET_TIERS,
  TURRET_POSITIONS,
} from '@space-shooter/shared';
import type { World } from '../World.js';
import type { FireIntentComponent } from '../components.js';
import { movementSystem } from './MovementSystem.js';
import { projectileSystem } from './ProjectileSystem.js';
import { collisionSystem } from './CollisionSystem.js';
import type { CollisionEvent } from './CollisionSystem.js';
import { destroySystem } from './DestroySystem.js';
import type { ICollisionResolution } from './DestroySystem.js';
import { SpawnSystem } from './SpawnSystem.js';
import { cleanupSystem } from './CleanupSystem.js';
import type { RtpEngine } from '../../services/RtpEngine.js';
import type { WalletManager } from '../../services/WalletManager.js';
import type { RoomEconomyManager } from '../../services/RoomEconomyManager.js';

/** Result of a single simulation tick */
export interface TickResult {
  readonly payouts: readonly IPayoutEvent[];
  readonly destroyedIds: readonly EntityId[];
  readonly newProjectiles: readonly NewProjectileInfo[];
  readonly rejectedShots: readonly RejectedShot[];
  /** Every collision resolution this tick — for audit logging */
  readonly collisionResolutions: readonly ICollisionResolution[];
}

export interface NewProjectileInfo {
  readonly entityId: EntityId;
  readonly ownerId: string;
  readonly x: number;
  readonly y: number;
  readonly angle: number;
  readonly lockedTargetId?: number;
}

export interface RejectedShot {
  readonly playerId: string;
  readonly reason: string;
}

/**
 * Orchestrates the ECS system pipeline in strict order:
 *
 * 0. Economy  — Update volatility tide state machine
 * 1. HotSeat  — Rotate hot-seat if interval elapsed
 * 2. Input    — Process fire intents (create projectiles)
 * 3. Spawn    — Create new space objects
 * 4. Movement — Move space objects along paths
 * 5. Projectile — Move lasers + handle ricochets
 * 6. Collision — Quadtree broad-phase + circle narrow-phase
 * 7. Destroy  — 4-layer RTP roll + first-kill mutex + piñata absorption
 * 8. Cleanup  — Purge PendingDestroy entities
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
    private readonly economy: RoomEconomyManager,
    spawnSystem: SpawnSystem,
  ) {
    this.spawnSystem = spawnSystem;
  }

  /**
   * Execute one full simulation tick.
   * Returns events for the room to broadcast + audit data.
   */
  tick(activePlayers: readonly string[]): TickResult {
    const delta = FIXED_TIMESTEP_SEC;
    const newProjectiles: NewProjectileInfo[] = [];
    const rejectedShots: RejectedShot[] = [];

    // ─── 0. Economy: Update volatility tide ───
    this.economy.tick(this.world.currentTick);

    // ─── 1. HotSeat: Rotate if interval elapsed ───
    if (this.rtpEngine.shouldRotateHotSeat(this.world.currentTick)) {
      this.rtpEngine.rotateHotSeat(activePlayers, this.world.currentTick);
    }

    // ─── 2. Input: Process Fire Intents ───
    for (const [intentId, intent] of this.world.fireIntents) {
      const result = this.processFireIntent(intent);
      if ('reason' in result) {
        rejectedShots.push(result);
      } else {
        newProjectiles.push(result);
        // Track bet in room economy
        this.economy.recordBet(intent.betAmount);
      }
      // Intents are consumed immediately
      this.world.fireIntents.delete(intentId);
    }

    // ─── 3. Spawn: Create new space objects ───
    this.spawnSystem.update(this.world);

    // ─── 4. Movement: Advance space objects along curves ───
    movementSystem(this.world, FIXED_TIMESTEP_MS);

    // ─── 5. Projectile: Move lasers + ricochets ───
    projectileSystem(this.world, delta);

    // ─── 6. Collision: Detect hits ───
    const collisions: CollisionEvent[] = collisionSystem(this.world);

    // ─── 7. Destroy: 4-layer RTP roll + first-kill mutex + piñata ───
    const { payouts, resolutions } = destroySystem(
      this.world,
      collisions,
      this.rtpEngine,
      this.wallet,
      this.economy,
    );

    // ─── 8. Cleanup: Purge destroyed entities ───
    const destroyedIds = cleanupSystem(this.world);

    // Advance tick counter
    this.world.currentTick++;

    return {
      payouts,
      destroyedIds,
      newProjectiles,
      rejectedShots,
      collisionResolutions: resolutions,
    };
  }

  /**
   * Process a single fire intent: validate, deduct bet, create projectile entity.
   */
  private processFireIntent(intent: FireIntentComponent): NewProjectileInfo | RejectedShot {
    const { playerId, angle, betAmount, lockedTargetId } = intent;

    // Validate bet is a valid tier
    if (!(BET_TIERS as readonly number[]).includes(betAmount)) {
      return { playerId, reason: `Bet must be a valid tier: ${BET_TIERS.join(', ')}` };
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
    const projData: import('../components.js').ProjectileComponent = {
      ownerId: playerId,
      betAmount,
      angle,
      bouncesRemaining: MAX_BOUNCES,
    };
    if (lockedTargetId !== undefined) {
      projData.lockedTargetId = lockedTargetId;
    }
    this.world.projectiles.set(entityId, projData);
    this.world.bounds.set(entityId, { radius: PROJECTILE_RADIUS });

    const result: NewProjectileInfo = { entityId, ownerId: playerId, x: turretX, y: turretY, angle };
    if (lockedTargetId !== undefined) {
      (result as { lockedTargetId?: number }).lockedTargetId = lockedTargetId;
    }
    return result;
  }
}
