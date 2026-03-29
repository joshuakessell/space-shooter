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
  DRILL_SPEED,
  ORBITAL_LASER_DURATION_SEC,
  FEATURE_TARGET_TYPES,
} from '@space-shooter/shared';
import type { World } from '../World.js';
import type { FireIntentComponent } from '../components.js';
import { movementSystem } from './MovementSystem.js';
import { projectileSystem } from './ProjectileSystem.js';
import { collisionSystem } from './CollisionSystem.js';
import type { CollisionEvent } from './CollisionSystem.js';
import { destroySystem } from './DestroySystem.js';
import type { ICollisionResolution, ChainHitEvent, AoeDestroyedEvent, FeatureSpawnEvent } from './DestroySystem.js';
import { hazardSystem } from './HazardSystem.js';
import type { HazardEvent } from './HazardSystem.js';
import { SpawnSystem } from './SpawnSystem.js';
import { cleanupSystem } from './CleanupSystem.js';
import type { RtpEngine } from '../../services/RtpEngine.js';
import type { IRngService } from '../../services/CsprngService.js';
import type { WalletManager } from '../../services/WalletManager.js';
import type { RoomEconomyManager } from '../../services/RoomEconomyManager.js';
import type { IGameBalanceConfig } from '../../config/GameBalanceConfig.js';

// ─── Interfaces ───

export interface IReservePoolProvider {
  globalReservePool: number;
}

/** Result of a single simulation tick */
export interface SystemRunnerResult {
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
  /** Feature target spawn events (hazards / vault) */
  readonly featureSpawns: readonly FeatureSpawnEvent[];
  /** Hazard system events (blackhole tick, drill bounce, hazard end) */
  readonly hazardEvents: readonly HazardEvent[];
  /** Payouts from hazard kills (separate from RTP payouts) */
  readonly hazardPayouts: readonly IPayoutEvent[];
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
  constructor(
    private readonly world: World,
    private readonly rtpEngine: RtpEngine,
    private readonly rng: IRngService,
    private readonly wallet: WalletManager,
    private readonly economy: RoomEconomyManager,
    private readonly config: IGameBalanceConfig,
    private readonly spawnSystem: SpawnSystem,
    private readonly reservePool: IReservePoolProvider,
  ) {}

  /**
   * Execute one full simulation tick.
   * Returns events for the room to broadcast + audit data.
   */
  tick(activePlayers: readonly string[]): SystemRunnerResult {
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
    movementSystem(this.world, FIXED_TIMESTEP_MS, this.reservePool);

    // ─── 5. Projectile: Move lasers + ricochets ───
    projectileSystem(this.world, delta, this.reservePool);

    // ─── 6. Collision: Detect hits ───
    const collisions: CollisionEvent[] = collisionSystem(this.world);

    // ─── 7. Destroy: 4-layer RTP roll + first-kill mutex + piñata + chain + AoE ───
    const { payouts, resolutions, chainHits, aoeBlasts, featureSpawns } = destroySystem(
      this.world,
      collisions,
      this.rtpEngine,
      this.rng,
      this.wallet,
      this.economy,
      this.reservePool,
    );

    // ─── 7.5. Feature Spawns: Create hazard entities from feature target kills ───
    this.processFeatureSpawns(featureSpawns);

    // ─── 7.6. Hazard: Process active hazards (blackhole pull, drill move, EMP chain, orbital timer) ───
    const hazardResult = hazardSystem(this.world, this.wallet, this.economy, this.config, this.reservePool);

    // ─── 8. Cleanup: Purge destroyed entities ───
    const destroyedIds = cleanupSystem(this.world);

    // Advance tick counter
    this.world.currentTick++;

    return {
      payouts: [...payouts, ...hazardResult.payouts],
      destroyedIds,
      newProjectiles,
      rejectedShots,
      collisionResolutions: resolutions,
      chainHits,
      aoeBlasts,
      featureSpawns,
      hazardEvents: hazardResult.events,
      hazardPayouts: hazardResult.payouts,
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

  /**
   * Process feature spawn events: create hazard entities or handle instant effects.
   */
  private processFeatureSpawns(spawns: readonly FeatureSpawnEvent[]): void {
    for (const spawn of spawns) {
      if (spawn.hazardType === 'vault') {
        this.handleVaultSpawn(spawn);
        continue;
      }
      this.createHazardEntity(spawn);
    }
  }

  /** Create a hazard entity from a feature spawn event. */
  private createHazardEntity(spawn: FeatureSpawnEvent): void {
    const entityId = this.world.createEntity();
    const pos = this.world.positionPool.acquire();
    pos.x = spawn.x;
    pos.y = spawn.y;
    this.world.positions.set(entityId, pos);

    // Common hazard component
    this.world.hazards.set(entityId, {
      ownerSessionId: spawn.playerId,
      hazardType: spawn.hazardType as import('@space-shooter/shared').HazardType,
      payoutBudget: spawn.budget,
      currentPayout: 0,
      timeAlive: 0,
      lockedBetAmount: spawn.betAmount,
      capturedTargetIds: new Set(),
      pendingVictimIds: [],
    });

    // Type-specific setup
    switch (spawn.hazardType) {
      case 'drill': {
        const angle = this.rng.randomFloat(0, Math.PI * 2);
        this.world.velocities.set(entityId, {
          vx: Math.cos(angle) * DRILL_SPEED,
          vy: Math.sin(angle) * DRILL_SPEED,
        });
        const bound = this.world.boundsPool.acquire();
        (bound as { radius: number }).radius = 30;
        this.world.bounds.set(entityId, bound);
        break;
      }
      case 'emp':
        this.captureAllStandardTargets(entityId);
        break;
      case 'orbital_laser':
        this.world.playerBuffs.set(spawn.playerId, {
          buff: 'orbital_laser',
          timeLeft: ORBITAL_LASER_DURATION_SEC,
          lockedBet: spawn.betAmount,
        });
        break;
      case 'blackhole':
        break;
    }
  }

  /** EMP: capture all standard targets for staggered kills. */
  private captureAllStandardTargets(hazardEntityId: EntityId): void {
    const hazard = this.world.hazards.get(hazardEntityId);
    if (!hazard) return;
    for (const [targetId, obj] of this.world.spaceObjects) {
      if (obj.isDead || obj.isCaptured) continue;
      if (FEATURE_TARGET_TYPES.has(obj.type as import('@space-shooter/shared').SpaceObjectType)) continue;
      obj.isCaptured = true;
      hazard.capturedTargetIds.add(targetId);
      hazard.pendingVictimIds.push(targetId);
    }
  }

  /**
   * Handle Cosmic Vault instant payout — no hazard entity needed.
   * ECONOMY: Vault payout is funded from the reserve pool, not created from nothing.
   */
  private handleVaultSpawn(spawn: FeatureSpawnEvent): void {
    if (!spawn.vaultMultiplier) return;
    const payout = spawn.betAmount * spawn.vaultMultiplier;

    // Fund from reserve pool — if pool can't cover it, cap the payout
    const fundedPayout = Math.min(payout, this.reservePool.globalReservePool);
    if (fundedPayout <= 0) return; // Pool empty — vault fizzles

    this.reservePool.globalReservePool -= fundedPayout;
    this.wallet.awardPayout(spawn.playerId, fundedPayout);
    this.economy.recordPayout(fundedPayout);

    // Update the spawn event so GameRoom broadcasts the actual payout
    spawn.vaultMultiplier = fundedPayout / spawn.betAmount;

    this.world.playerBuffs.set(spawn.playerId, {
      buff: 'paused',
      timeLeft: 4,
      lockedBet: spawn.betAmount,
    });
  }
}
