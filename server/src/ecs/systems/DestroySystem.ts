// ─────────────────────────────────────────────────────────────
// Destroy System — 4-Layer RTP Roll + Piñata + First-Kill Mutex
// + Chain Lightning + Supernova AoE Blast
// ─────────────────────────────────────────────────────────────
// SECURITY: Uses first-kill mutex (isDead) to prevent double-payout
// when multiple projectiles hit the same target in the same tick.
// AUDIT: Returns IHitEvaluation with full modifier breakdown.
// CONFIG-DRIVEN: All math flows through RtpEngine → GameBalanceConfig.
//
// CHAIN LIGHTNING: Lightning projectiles survive after hit and redirect
// to the nearest target within range. Each chain is one tick.
//
// SUPERNOVA AoE: When a SUPERNOVA_BOMB is killed, it triggers a blast
// that evaluates all targets within radius. Recursive bombs do NOT
// trigger secondary AoE (infinite-loop protection).
// ─────────────────────────────────────────────────────────────

import { SpaceObjectType, CHAIN_LIGHTNING_RADIUS, AOE_BLAST_RADIUS, BLACKHOLE_PULL_RADIUS, GAME_WIDTH, GAME_HEIGHT, HAZARD_BUDGET_MIN, HAZARD_BUDGET_MAX, VAULT_MULTIPLIERS, FEATURE_TARGET_TYPES } from '@space-shooter/shared';
import type { IPayoutEvent, EntityId, HazardType } from '@space-shooter/shared';
import type { World } from '../World.js';
import type { CollisionEvent } from './CollisionSystem.js';
import type { RtpEngine, IHitEvaluation } from '../../services/RtpEngine.js';
import type { WalletManager } from '../../services/WalletManager.js';
import type { RoomEconomyManager } from '../../services/RoomEconomyManager.js';
import type { IRngService } from '../../services/CsprngService.js';
import { Quadtree } from '../../spatial/Quadtree.js';
import type { IReservePoolProvider } from './SystemRunner.js';

/** Extended payout event with audit data */
export interface IAuditedPayoutEvent extends IPayoutEvent {
  readonly hitEvaluation: IHitEvaluation;
}

/** Result of a single collision resolution (hit or miss) */
export interface ICollisionResolution {
  readonly playerId: string;
  readonly targetEntityId: number;
  readonly betAmount: number;
  readonly hitEvaluation: IHitEvaluation;
}

/** Chain hit event for frontend lightning trail rendering */
export interface ChainHitEvent {
  readonly projectileOwnerId: string;
  readonly fromX: number;
  readonly fromY: number;
  readonly toX: number;
  readonly toY: number;
  readonly targetId: EntityId;
  readonly payout: number;
}

/** AoE blast event for frontend supernova visualization */
export interface AoeDestroyedEvent {
  readonly x: number;
  readonly y: number;
  readonly totalPayout: number;
  readonly playerId: string;
  readonly destroyedTargetIds: EntityId[];
}

/** Context bundle for AoE resolution (avoids excessive parameter count) */
interface DestroyContext {
  world: World;
  rtpEngine: RtpEngine;
  rng: IRngService;
  wallet: WalletManager;
  economy: RoomEconomyManager;
  reservePool: IReservePoolProvider;
  payouts: IPayoutEvent[];
  resolutions: ICollisionResolution[];
}

/** Feature target spawned a hazard (or instant effect) */
export interface FeatureSpawnEvent {
  hazardType: HazardType | 'vault';
  playerId: string;
  betAmount: number;
  x: number;
  y: number;
  /** CSPRNG-rolled payout budget (×bet). Not used for vault. */
  budget: number;
  /** Vault-only: the selected multiplier */
  vaultMultiplier?: number;
}

// Reusable quadtree for AoE / chain lightning spatial queries
const aoeQueryTree = new Quadtree({ x: 0, y: 0, width: GAME_WIDTH, height: GAME_HEIGHT });

/**
 * For each collision event:
 * 1. Check isDead mutex — skip if target already dead this tick
 * 2. Evaluate hit via 4-layer RtpEngine
 * 3. If miss: absorb betAmount into target's piñata counter
 * 4. If kill: award payout, set isDead=true, tag for removal
 *    - SUPERNOVA_BOMB: trigger AoE blast on kill
 * 5. Chain lightning: redirect projectile to next target (don't destroy)
 * 6. Standard/spread: tag projectile for removal
 *
 * Returns:
 * - payouts: for broadcasting to clients
 * - allResolutions: every collision result for audit logging
 * - chainHits: for frontend lightning trail rendering
 * - aoeBlasts: for frontend supernova visualization
 */
export function destroySystem(
  world: World,
  collisions: readonly CollisionEvent[],
  rtpEngine: RtpEngine,
  rng: IRngService,
  wallet: WalletManager,
  economy: RoomEconomyManager,
  reservePool: IReservePoolProvider,
): {
  payouts: IPayoutEvent[];
  resolutions: ICollisionResolution[];
  chainHits: ChainHitEvent[];
  aoeBlasts: AoeDestroyedEvent[];
  featureSpawns: FeatureSpawnEvent[];
} {
  const payouts: IPayoutEvent[] = [];
  const resolutions: ICollisionResolution[] = [];
  const chainHits: ChainHitEvent[] = [];
  const aoeBlasts: AoeDestroyedEvent[] = [];
  const featureSpawns: FeatureSpawnEvent[] = [];
  const ctx: DestroyContext = { world, rtpEngine, rng, wallet, economy, reservePool, payouts, resolutions };

  for (const collision of collisions) {
    processCollision(ctx, collision, chainHits, aoeBlasts, featureSpawns);
  }

  return { payouts, resolutions, chainHits, aoeBlasts, featureSpawns };
}

/** Process a single collision: RTP roll, piñata, chain lightning, AoE */
function processCollision(
  ctx: DestroyContext,
  collision: CollisionEvent,
  chainHits: ChainHitEvent[],
  aoeBlasts: AoeDestroyedEvent[],
  featureSpawns: FeatureSpawnEvent[],
): void {
  const { world, rtpEngine, wallet, economy, payouts, resolutions } = ctx;
  const { projectileId, objectId, projectileOwnerId, betAmount } = collision;

  if (world.pendingDestroy.has(projectileId)) return;

  const spaceObj = world.spaceObjects.get(objectId);
  if (!spaceObj) return;

  // Captured targets cannot be hit by bullets
  if (spaceObj.isCaptured) return;

  // First-kill mutex
  if (spaceObj.isDead || world.pendingDestroy.has(objectId)) {
    // Overkill: refund the wasted bullet into the ecosystem
    ctx.reservePool.globalReservePool += betAmount;
    world.pendingDestroy.set(projectileId, { markedAtTick: world.currentTick });
    return;
  }

  const proj = world.projectiles.get(projectileId);
  const isLightning = proj?.weaponType === 'lightning';

  // Tag non-lightning projectiles for removal
  if (!isLightning) {
    world.pendingDestroy.set(projectileId, { markedAtTick: world.currentTick });
  }

  // 4-Layer RTP evaluation
  const hitEval = rtpEngine.evaluateHit(
    spaceObj.type, betAmount, projectileOwnerId, objectId, spaceObj.absorbedCredits, ctx.reservePool,
  );
  
  // Apply any absorbed credit adjustments from subsidized wins
  spaceObj.absorbedCredits = hitEval.newAbsorbedCredits;

  resolutions.push({ playerId: projectileOwnerId, targetEntityId: objectId, betAmount, hitEvaluation: hitEval });

  if (hitEval.destroyed) {
    spaceObj.isDead = true;
    world.pendingDestroy.set(objectId, { markedAtTick: world.currentTick });
    wallet.awardPayout(projectileOwnerId, hitEval.payout);
    economy.recordPayout(hitEval.payout);

    payouts.push({
      objectId: String(objectId), playerId: projectileOwnerId,
      objectType: spaceObj.type, betAmount,
      multiplier: hitEval.multiplier, payout: hitEval.payout,
    });

    // Jackpot logging
    if (hitEval.multiplier >= 100) {
      wallet.logHighValueWin(projectileOwnerId, hitEval.payout, 'JACKPOT' as any, { objectType: spaceObj.type, multiplier: hitEval.multiplier });
    }

    // Supernova AoE
    if (spaceObj.type === SpaceObjectType.SUPERNOVA_BOMB) {
      const targetPos = world.positions.get(objectId);
      if (targetPos) {
        const aoe = resolveAoEBlast(ctx, targetPos.x, targetPos.y, AOE_BLAST_RADIUS, projectileOwnerId, betAmount);
        if (aoe.totalPayout > 0) aoeBlasts.push(aoe);
      }
    }

    // Feature target → spawn hazard
    resolveFeatureSpawn(ctx, spaceObj.type, projectileOwnerId, betAmount, objectId, featureSpawns);
  }

  // Chain lightning
  if (isLightning && proj) {
    handleChainLightning(world, proj, projectileId, objectId, projectileOwnerId, hitEval.payout, chainHits);
  }
}

/** Handle chain lightning: add to hitTargetIds, redirect or destroy */
function handleChainLightning(
  world: World,
  proj: import('../components.js').ProjectileComponent,
  projectileId: EntityId,
  objectId: EntityId,
  ownerId: string,
  payout: number,
  chainHits: ChainHitEvent[],
): void {
  const projPos = world.positions.get(projectileId);
  if (!projPos) {
    world.pendingDestroy.set(projectileId, { markedAtTick: world.currentTick });
    return;
  }

  proj.hitTargetIds.add(objectId);

  if (proj.chainCount >= proj.maxChains) {
    world.pendingDestroy.set(projectileId, { markedAtTick: world.currentTick });
    return;
  }

  const nextTarget = findNearestChainTarget(world, projPos.x, projPos.y, CHAIN_LIGHTNING_RADIUS, proj.hitTargetIds);

  if (!nextTarget) {
    world.pendingDestroy.set(projectileId, { markedAtTick: world.currentTick });
    return;
  }

  const fromX = projPos.x;
  const fromY = projPos.y;
  proj.angle = Math.atan2(nextTarget.y - projPos.y, nextTarget.x - projPos.x);
  proj.chainCount++;

  chainHits.push({ projectileOwnerId: ownerId, fromX, fromY, toX: nextTarget.x, toY: nextTarget.y, targetId: nextTarget.entityId, payout });
}

/**
 * Find the nearest space object within radius that hasn't been hit yet.
 * Uses brute-force distance check (few objects, fast enough).
 */
function findNearestChainTarget(
  world: World,
  fromX: number, fromY: number,
  radius: number,
  excludeIds: ReadonlySet<number>,
): { entityId: EntityId; x: number; y: number } | null {
  let bestDist = radius * radius;
  let best: { entityId: EntityId; x: number; y: number } | null = null;

  for (const [entityId, spaceObj] of world.spaceObjects) {
    if (spaceObj.isDead) continue;
    if (world.pendingDestroy.has(entityId)) continue;
    if (excludeIds.has(entityId)) continue;

    const pos = world.positions.get(entityId);
    if (!pos) continue;

    const dx = pos.x - fromX;
    const dy = pos.y - fromY;
    const distSq = dx * dx + dy * dy;

    if (distSq < bestDist) {
      bestDist = distSq;
      best = { entityId, x: pos.x, y: pos.y };
    }
  }

  return best;
}

/**
 * Resolve an AoE blast from a Supernova Bomb kill.
 *
 * Queries all space objects within radius, evaluates RTP for each,
 * and awards aggregate payout atomically.
 *
 * INFINITE LOOP PROTECTION: If another bomb is caught in the blast,
 * it awards its base multiplier but does NOT trigger a recursive AoE.
 */
function resolveAoEBlast(
  ctx: DestroyContext,
  blastX: number, blastY: number, blastRadius: number,
  playerId: string, betAmount: number,
): AoeDestroyedEvent {
  const { world, rtpEngine, wallet, economy, payouts, resolutions } = ctx;
  let totalPayout = 0;
  const destroyedTargetIds: EntityId[] = [];

  // Build spatial query tree for space objects in blast zone
  // Wrapped in try-finally to ensure tree is cleared even on exception
  aoeQueryTree.clear();
  let blastCandidates: ReturnType<typeof aoeQueryTree.query>;
  try {
    for (const [entityId, _spaceObj] of world.spaceObjects) {
      if (world.pendingDestroy.has(entityId)) continue;
      const pos = world.positions.get(entityId);
      const bound = world.bounds.get(entityId);
      if (!pos || !bound) continue;
      if (_spaceObj.isDead) continue;

      aoeQueryTree.insert({
        entityId,
        x: pos.x,
        y: pos.y,
        radius: bound.radius,
      });
    }

    // Query all targets within blast radius
    blastCandidates = aoeQueryTree.query({
      entityId: -1,
      x: blastX,
      y: blastY,
      radius: blastRadius,
    });
  } catch (err) {
    console.error('[DestroySystem] Quadtree error during AoE blast:', err);
    aoeQueryTree.clear();
    return { x: blastX, y: blastY, totalPayout: 0, playerId, destroyedTargetIds: [] };
  }

  for (const candidate of blastCandidates) {
    const spaceObj = world.spaceObjects.get(candidate.entityId);
    if (!spaceObj || spaceObj.isDead || world.pendingDestroy.has(candidate.entityId)) continue;

    // Distance check (quadtree returns rectangle overlaps, need circle check)
    const dx = candidate.x - blastX;
    const dy = candidate.y - blastY;
    if (dx * dx + dy * dy > blastRadius * blastRadius) continue;

    // Evaluate RTP hit for this target using original betAmount
    const hitEval = rtpEngine.evaluateHit(
      spaceObj.type,
      betAmount,
      playerId,
      candidate.entityId,
      spaceObj.absorbedCredits,
      ctx.reservePool
    );

    spaceObj.absorbedCredits = hitEval.newAbsorbedCredits;

    resolutions.push({
      playerId,
      targetEntityId: candidate.entityId,
      betAmount,
      hitEvaluation: hitEval,
    });

    if (hitEval.destroyed) {
      // Mark dead BEFORE checking for further bombs (infinite-loop protection)
      spaceObj.isDead = true;
      world.pendingDestroy.set(candidate.entityId, { markedAtTick: world.currentTick });

      totalPayout += hitEval.payout;
      destroyedTargetIds.push(candidate.entityId);

      // Record individual payout event for client notifications
      payouts.push({
        objectId: String(candidate.entityId),
        playerId,
        objectType: spaceObj.type,
        betAmount,
        multiplier: hitEval.multiplier,
        payout: hitEval.payout,
      });

      // NOTE: If this target is ALSO a SUPERNOVA_BOMB, we do NOT
      // trigger recursive AoE. The isDead flag prevents it, and we
      // explicitly do NOT call resolveAoEBlast recursively here.
      // The player still gets the base multiplier payout for the bomb.

      economy.recordPayout(hitEval.payout);
    } else {
      // Handled inside evaluateHit now
    }
  }

    if (totalPayout > 0) {
      wallet.awardPayout(playerId, totalPayout);
      if (totalPayout / betAmount >= 100) {
        wallet.logHighValueWin(playerId, totalPayout, 'JACKPOT' as any, { reason: 'supernova_aoe' });
      }
    }

  return {
    x: blastX,
    y: blastY,
    totalPayout,
    playerId,
    destroyedTargetIds,
  };
}

// ─── Feature Target → Hazard Spawn ───

function isStandardTarget(type: string): boolean {
  return !FEATURE_TARGET_TYPES.has(type as SpaceObjectType);
}

/** Map feature target type to hazard type */
const FEATURE_TO_HAZARD: Partial<Record<SpaceObjectType, HazardType | 'vault' | 'blackhole_jackpot'>> = {
  [SpaceObjectType.BLACKHOLE_GEN]: 'blackhole_jackpot', // Instant AoE jackpot, not a hazard
  [SpaceObjectType.QUANTUM_DRILL]: 'drill',
  [SpaceObjectType.EMP_RELAY]: 'emp',
  [SpaceObjectType.ORBITAL_CORE]: 'orbital_laser',
  [SpaceObjectType.COSMIC_VAULT]: 'vault',
};

/** Resolve feature target kill → spawn event */
function resolveFeatureSpawn(
  ctx: DestroyContext,
  objectType: SpaceObjectType,
  playerId: string,
  betAmount: number,
  objectId: EntityId,
  featureSpawns: FeatureSpawnEvent[],
): void {
  const hazardType = FEATURE_TO_HAZARD[objectType];
  if (!hazardType) return; // Not a feature target

  const pos = ctx.world.positions.get(objectId);
  if (!pos) return;

  if (hazardType === 'blackhole_jackpot') {
    // Blackhole Jackpot: instant AoE that destroys all standard targets in
    // BLACKHOLE_PULL_RADIUS. Total payout = count × bet × 5, funded from pool.
    const BLACKHOLE_PER_KILL_MULT = 5;
    let killCount = 0;
    const destroyedIds: EntityId[] = [];

    for (const [eid, obj] of ctx.world.spaceObjects) {
      if (obj.isDead || !isStandardTarget(obj.type)) continue;
      if (eid === objectId) continue; // Don't count self
      const epos = ctx.world.positions.get(eid);
      if (!epos) continue;
      const dx = epos.x - pos.x;
      const dy = epos.y - pos.y;
      if (dx * dx + dy * dy > BLACKHOLE_PULL_RADIUS * BLACKHOLE_PULL_RADIUS) continue;

      const killPayout = betAmount * BLACKHOLE_PER_KILL_MULT;
      // Fund from reserve pool
      if (ctx.reservePool.globalReservePool < killPayout) continue;
      ctx.reservePool.globalReservePool -= killPayout;

      obj.isDead = true;
      ctx.world.pendingDestroy.set(eid, { markedAtTick: ctx.world.currentTick });
      ctx.wallet.awardPayout(playerId, killPayout);
      ctx.economy.recordPayout(killPayout);
      killCount++;
      destroyedIds.push(eid);
    }

    if (killCount > 0) {
      const totalPayout = killCount * betAmount * BLACKHOLE_PER_KILL_MULT;
      ctx.payouts.push({
        objectId: String(objectId), playerId,
        objectType: SpaceObjectType.BLACKHOLE_GEN, betAmount,
        multiplier: killCount * BLACKHOLE_PER_KILL_MULT, payout: totalPayout,
      });
    }

    featureSpawns.push({
      hazardType: 'blackhole' as HazardType,
      playerId,
      betAmount,
      x: pos.x,
      y: pos.y,
      budget: killCount * betAmount * BLACKHOLE_PER_KILL_MULT,
    });
    return;
  }

  if (hazardType === 'vault') {
    // Cosmic Vault: weighted CSPRNG selection from fixed multipliers
    const roll = ctx.rng.randomRange(0, VAULT_MULTIPLIERS.length);
    const multiplier = VAULT_MULTIPLIERS[roll];

    featureSpawns.push({
      hazardType: 'vault',
      playerId,
      betAmount,
      x: pos.x,
      y: pos.y,
      budget: 0,
      vaultMultiplier: multiplier,
    });

    ctx.wallet.logHighValueWin(playerId, betAmount * multiplier, 'FEATURE_WIN' as any, { hazardType: 'vault', multiplier });
  } else {
    // Roll payout budget
    const budgetMultiplier = ctx.rng.randomRange(HAZARD_BUDGET_MIN, HAZARD_BUDGET_MAX + 1);
    const budget = betAmount * budgetMultiplier;

    featureSpawns.push({
      hazardType,
      playerId,
      betAmount,
      x: pos.x,
      y: pos.y,
      budget,
    });
  }
}
