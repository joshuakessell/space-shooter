// ─────────────────────────────────────────────────────────────
// System Runner — Orchestrates ECS System Execution Order
// ─────────────────────────────────────────────────────────────
// SECURITY: Rate limiting, hot-seat rotation, economy tracking.
// CONFIG-DRIVEN: All thresholds from GameBalanceConfig.
// ─────────────────────────────────────────────────────────────

import type { EntityId, IPayoutEvent, WeaponType } from '@space-shooter/shared';
import {
  FIXED_TIMESTEP_SEC,
  FIXED_TIMESTEP_MS,
  PROJECTILE_RADIUS,
  MAX_PROJECTILES_PER_PLAYER,
  MAX_BOUNCES,
  BET_TIERS,
  TURRET_POSITIONS,
  WEAPON_COST,
  SPREAD_ANGLE_OFFSET,
  CHAIN_LIGHTNING_MAX_CHAINS,
} from '@space-shooter/shared';
import type { World } from '../World.js';
import type { FireIntentComponent } from '../components.js';
import { movementSystem } from './MovementSystem.js';
import { projectileSystem } from './ProjectileSystem.js';
import { collisionSystem } from './CollisionSystem.js';
import type { CollisionEvent } from './CollisionSystem.js';
import { destroySystem } from './DestroySystem.js';
import type { ICollisionResolution, ChainHitEvent, AoeDestroyedEvent } from './DestroySystem.js';
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
  /** Chain lightning hit events for frontend trail rendering */
  readonly chainHits: readonly ChainHitEvent[];
  /** AoE blast events for frontend supernova visualization */
  readonly aoeBlasts: readonly AoeDestroyedEvent[];
}

export interface NewProjectileInfo {
  readonly entityId: EntityId;
  readonly ownerId: string;
  readonly x: number;
  readonly y: number;
  readonly angle: number;
  readonly lockedTargetId?: number;
  readonly weaponType: WeaponType;
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
      const results = this.processFireIntent(intent);
      if ('reason' in results) {
        rejectedShots.push(results);
      } else {
        for (const proj of results) {
          newProjectiles.push(proj);
        }
        // Track bet in room economy (total cost for weapon)
        this.economy.recordBet(intent.betAmount * WEAPON_COST[intent.weaponType]);
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

    // ─── 7. Destroy: 4-layer RTP roll + first-kill mutex + piñata + chain + AoE ───
    const { payouts, resolutions, chainHits, aoeBlasts } = destroySystem(
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
      chainHits,
      aoeBlasts,
    };
  }

  /**
   * Process a single fire intent: validate, deduct bet, create projectile entity(ies).
   * Returns array of NewProjectileInfo (1 for standard/lightning, 3 for spread)
   * or a RejectedShot if validation fails.
   */
  private processFireIntent(intent: FireIntentComponent): NewProjectileInfo[] | RejectedShot {
    const { playerId, angle, betAmount, lockedTargetId, weaponType } = intent;

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

    // Deduct total weapon cost atomically
    const totalCost = betAmount * WEAPON_COST[weaponType];
    if (!this.wallet.deductBet(playerId, totalCost)) {
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

    // Spawn projectile(s) based on weapon type
    const results: NewProjectileInfo[] = [];

    switch (weaponType) {
      case 'spread': {
        // 3 projectiles at -15°, 0°, +15° offsets
        const offsets = [-SPREAD_ANGLE_OFFSET, 0, SPREAD_ANGLE_OFFSET];
        for (const offset of offsets) {
          const projAngle = angle + offset;
          results.push(this.spawnProjectile(playerId, turretX, turretY, projAngle, betAmount, weaponType, lockedTargetId));
        }
        break;
      }
      case 'lightning': {
        // 1 projectile with chain lightning fields
        results.push(this.spawnProjectile(playerId, turretX, turretY, angle, betAmount, weaponType, lockedTargetId));
        break;
      }
      default: {
        // standard: 1 projectile
        results.push(this.spawnProjectile(playerId, turretX, turretY, angle, betAmount, weaponType, lockedTargetId));
        break;
      }
    }

    return results;
  }

  /**
   * Create a single projectile entity with pooled components.
   */
  private spawnProjectile(
    playerId: string,
    turretX: number, turretY: number,
    angle: number,
    betAmount: number,
    weaponType: WeaponType,
    lockedTargetId?: number,
  ): NewProjectileInfo {
    const entityId = this.world.createEntity();

    const pos = this.world.positionPool.acquire();
    pos.x = turretX;
    pos.y = turretY;
    this.world.positions.set(entityId, pos);

    const projData = this.world.projectilePool.acquire();
    (projData as { ownerId: string }).ownerId = playerId;
    (projData as { betAmount: number }).betAmount = betAmount;
    projData.angle = angle;
    projData.bouncesRemaining = MAX_BOUNCES;
    (projData as { weaponType: WeaponType }).weaponType = weaponType;
    projData.chainCount = 0;
    (projData as { maxChains: number }).maxChains = weaponType === 'lightning' ? CHAIN_LIGHTNING_MAX_CHAINS : 0;
    projData.hitTargetIds.clear();
    if (lockedTargetId !== undefined) {
      projData.lockedTargetId = lockedTargetId;
    }
    this.world.projectiles.set(entityId, projData);

    const bound = this.world.boundsPool.acquire();
    (bound as { radius: number }).radius = PROJECTILE_RADIUS;
    this.world.bounds.set(entityId, bound);

    const result: NewProjectileInfo = { entityId, ownerId: playerId, x: turretX, y: turretY, angle, weaponType };
    if (lockedTargetId !== undefined) {
      (result as { lockedTargetId?: number }).lockedTargetId = lockedTargetId;
    }
    return result;
  }
}
