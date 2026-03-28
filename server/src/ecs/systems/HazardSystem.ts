// ─────────────────────────────────────────────────────────────
// Hazard System — Processes Active Hazards Each Tick
// ─────────────────────────────────────────────────────────────
// Hazards are server-owned entities spawned when a Feature Target
// is killed. They autonomously destroy standard targets until their
// payout budget is exhausted, then self-destruct.
//
// SECURITY: Hazard kills bypass RtpEngine — the budget IS the
// payout cap, rolled via CSPRNG at spawn time.
//
// SAFETY: Hazards CANNOT destroy other Feature Targets or
// Supernova Bombs. Only standard targets are affected.
// ─────────────────────────────────────────────────────────────

import type { EntityId, SpaceObjectType } from '@space-shooter/shared';
import {
  FIXED_TIMESTEP_SEC,
  GAME_WIDTH,
  GAME_HEIGHT,
  BLACKHOLE_PULL_RADIUS,
  BLACKHOLE_PULL_SPEED,
  DRILL_MAX_DURATION_SEC,
  ORBITAL_LASER_DURATION_SEC,
  FEATURE_TARGET_TYPES,
} from '@space-shooter/shared';
import type { World } from '../World.js';
import type { HazardComponent, SpaceObjectComponent } from '../components.js';
import type { WalletManager } from '../../services/WalletManager.js';
import type { RoomEconomyManager } from '../../services/RoomEconomyManager.js';
import type { IGameBalanceConfig } from '../../config/GameBalanceConfig.js';

// ─── Context Bundle (reduces parameter count) ───

interface HazardContext {
  world: World;
  wallet: WalletManager;
  economy: RoomEconomyManager;
  config: IGameBalanceConfig;
  events: HazardEvent[];
  payouts: HazardTickResult['payouts'];
}

// ─── Event Types ───

export interface HazardEvent {
  type: 'blackholeTick' | 'drillBounce' | 'hazardEnd' | 'hazardKill';
  hazardId: EntityId;
  ownerSessionId: string;
}

export interface BlackholeTickEvent extends HazardEvent {
  type: 'blackholeTick';
  x: number;
  y: number;
  capturedTargetIds: EntityId[];
}

export interface DrillBounceEvent extends HazardEvent {
  type: 'drillBounce';
  x: number;
  y: number;
  angle: number;
}

export interface HazardEndEvent extends HazardEvent {
  type: 'hazardEnd';
  totalPayout: number;
}

export interface HazardKillEvent extends HazardEvent {
  type: 'hazardKill';
  targetId: EntityId;
  payout: number;
}

export interface HazardTickResult {
  events: HazardEvent[];
  payouts: Array<{
    playerId: string;
    objectId: string;
    objectType: SpaceObjectType;
    payout: number;
    multiplier: number;
    betAmount: number;
    hazardType?: string;
  }>;
}

// ─── Core System ───

function isStandardTarget(type: string): boolean {
  return !FEATURE_TARGET_TYPES.has(type as import('@space-shooter/shared').SpaceObjectType);
}

/**
 * Process all active hazards for one tick.
 */
export function hazardSystem(
  world: World,
  wallet: WalletManager,
  economy: RoomEconomyManager,
  config: IGameBalanceConfig,
): HazardTickResult {
  const events: HazardEvent[] = [];
  const payouts: HazardTickResult['payouts'] = [];
  const delta = FIXED_TIMESTEP_SEC;
  const ctx: HazardContext = { world, wallet, economy, config, events, payouts };

  for (const [hazardId, hazard] of world.hazards) {
    hazard.timeAlive += delta;

    switch (hazard.hazardType) {
      case 'blackhole':
        processBlackhole(ctx, hazardId, hazard, delta);
        break;
      case 'drill':
        processDrill(ctx, hazardId, hazard, delta);
        break;
      case 'emp':
        processEmp(ctx, hazardId, hazard);
        break;
      case 'orbital_laser':
        processOrbitalLaser(ctx, hazardId, hazard);
        break;
    }

    // Budget check (non-timer hazards)
    if (hazard.hazardType !== 'orbital_laser' && hazard.currentPayout >= hazard.payoutBudget) {
      endHazard(ctx, hazardId, hazard);
    }
  }

  // Tick down player buffs
  for (const [, buff] of world.playerBuffs) {
    if (buff.buff === 'none') continue;
    buff.timeLeft -= delta;
    if (buff.timeLeft <= 0) {
      buff.buff = 'none';
      buff.timeLeft = 0;
      buff.lockedBet = 0;
    }
  }

  return { events, payouts };
}

// ─── Black Hole ───

function processBlackhole(
  ctx: HazardContext,
  hazardId: EntityId,
  hazard: HazardComponent,
  delta: number,
): void {
  const hazardPos = ctx.world.positions.get(hazardId);
  if (!hazardPos) return;

  for (const [entityId, obj] of ctx.world.spaceObjects) {
    if (obj.isDead || !isStandardTarget(obj.type)) continue;
    if (hazard.currentPayout >= hazard.payoutBudget) break;

    const targetPos = ctx.world.positions.get(entityId);
    if (!targetPos) continue;

    const dx = hazardPos.x - targetPos.x;
    const dy = hazardPos.y - targetPos.y;
    const dist = Math.hypot(dx, dy);

    if (dist > BLACKHOLE_PULL_RADIUS) continue;

    // Capture target
    obj.isCaptured = true;
    hazard.capturedTargetIds.add(entityId);

    // Pull toward center
    const pullDist = BLACKHOLE_PULL_SPEED * delta;
    if (dist <= pullDist + 10) {
      killTargetForHazard(ctx, targetId(entityId), obj, hazard);
    } else {
      const nx = dx / dist;
      const ny = dy / dist;
      targetPos.x += nx * pullDist;
      targetPos.y += ny * pullDist;
    }
  }

  ctx.events.push({
    type: 'blackholeTick',
    hazardId,
    ownerSessionId: hazard.ownerSessionId,
    x: hazardPos.x,
    y: hazardPos.y,
    capturedTargetIds: [...hazard.capturedTargetIds],
  } as BlackholeTickEvent);
}

// ─── Quantum Drill ───

function processDrill(
  ctx: HazardContext,
  hazardId: EntityId,
  hazard: HazardComponent,
  delta: number,
): void {
  const drillPos = ctx.world.positions.get(hazardId);
  const drillVel = ctx.world.velocities.get(hazardId);
  if (!drillPos || !drillVel) return;

  if (hazard.timeAlive > DRILL_MAX_DURATION_SEC) {
    endHazard(ctx, hazardId, hazard);
    return;
  }

  // Move
  drillPos.x += drillVel.vx * delta;
  drillPos.y += drillVel.vy * delta;

  // Bounce
  let bounced = false;
  if (drillPos.x <= 0 || drillPos.x >= GAME_WIDTH) {
    drillVel.vx = -drillVel.vx;
    drillPos.x = Math.max(0, Math.min(GAME_WIDTH, drillPos.x));
    bounced = true;
  }
  if (drillPos.y <= 0 || drillPos.y >= GAME_HEIGHT) {
    drillVel.vy = -drillVel.vy;
    drillPos.y = Math.max(0, Math.min(GAME_HEIGHT, drillPos.y));
    bounced = true;
  }

  if (bounced) {
    ctx.events.push({
      type: 'drillBounce',
      hazardId,
      ownerSessionId: hazard.ownerSessionId,
      x: drillPos.x,
      y: drillPos.y,
      angle: Math.atan2(drillVel.vy, drillVel.vx),
    } as DrillBounceEvent);
  }

  // Collide with standard targets
  const drillRadius = 30;
  for (const [entityId, obj] of ctx.world.spaceObjects) {
    if (obj.isDead || obj.isCaptured || !isStandardTarget(obj.type)) continue;
    if (hazard.currentPayout >= hazard.payoutBudget) break;

    const tPos = ctx.world.positions.get(entityId);
    const tBounds = ctx.world.bounds.get(entityId);
    if (!tPos || !tBounds) continue;

    if (Math.hypot(drillPos.x - tPos.x, drillPos.y - tPos.y) < drillRadius + tBounds.radius) {
      killTargetForHazard(ctx, entityId, obj, hazard);
    }
  }
}

// ─── EMP Relay ───

function processEmp(
  ctx: HazardContext,
  hazardId: EntityId,
  hazard: HazardComponent,
): void {
  if (hazard.pendingVictimIds.length === 0 || hazard.currentPayout >= hazard.payoutBudget) {
    releaseRemainingTargets(ctx.world, hazard);
    endHazard(ctx, hazardId, hazard);
    return;
  }

  // Kill one per tick (staggered cadence)
  const victimId = hazard.pendingVictimIds.shift()!;
  const obj = ctx.world.spaceObjects.get(victimId);
  if (obj && !obj.isDead) {
    killTargetForHazard(ctx, victimId, obj, hazard);
  }
}

// ─── Orbital Laser ───

function processOrbitalLaser(
  ctx: HazardContext,
  hazardId: EntityId,
  hazard: HazardComponent,
): void {
  if (hazard.timeAlive > ORBITAL_LASER_DURATION_SEC) {
    const buff = ctx.world.playerBuffs.get(hazard.ownerSessionId);
    if (buff) {
      buff.buff = 'none';
      buff.timeLeft = 0;
      buff.lockedBet = 0;
    }
    endHazard(ctx, hazardId, hazard);
  }
}

// ─── Shared Helpers ───

/** Identity function for readability — clarifies that a number IS an EntityId */
function targetId(id: EntityId): EntityId {
  return id;
}

function killTargetForHazard(
  ctx: HazardContext,
  entityId: EntityId,
  obj: SpaceObjectComponent,
  hazard: HazardComponent,
): void {
  const objConfig = ctx.config.objectTypes[obj.type];
  if (!objConfig) return;

  const payout = hazard.lockedBetAmount * objConfig.multiplier;

  ctx.wallet.awardPayout(hazard.ownerSessionId, payout);
  ctx.economy.recordPayout(payout);
  hazard.currentPayout += payout;

  obj.isDead = true;
  obj.isCaptured = false;
  ctx.world.pendingDestroy.set(entityId, { markedAtTick: ctx.world.currentTick });

  ctx.payouts.push({
    playerId: hazard.ownerSessionId,
    objectId: String(entityId),
    objectType: obj.type,
    payout,
    multiplier: objConfig.multiplier,
    betAmount: hazard.lockedBetAmount,
    hazardType: hazard.hazardType,
  });
}

function releaseRemainingTargets(
  world: World,
  hazard: HazardComponent,
): void {
  for (const tid of hazard.capturedTargetIds) {
    const obj = world.spaceObjects.get(tid);
    if (obj && !obj.isDead) {
      obj.isCaptured = false;
    }
  }
  hazard.capturedTargetIds.clear();
}

function endHazard(
  ctx: HazardContext,
  hazardId: EntityId,
  hazard: HazardComponent,
): void {
  releaseRemainingTargets(ctx.world, hazard);

  ctx.events.push({
    type: 'hazardEnd',
    hazardId,
    ownerSessionId: hazard.ownerSessionId,
    totalPayout: hazard.currentPayout,
  } as HazardEndEvent);

  // Force DB Sync for the accumulated Feature Win
  if (hazard.currentPayout > 0) {
    ctx.wallet.logHighValueWin(hazard.ownerSessionId, hazard.currentPayout, 'FEATURE_WIN' as any, { hazardType: hazard.hazardType });
  }

  ctx.world.pendingDestroy.set(hazardId, { markedAtTick: ctx.world.currentTick });
}
