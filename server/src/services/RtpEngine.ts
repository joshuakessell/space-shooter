// ─────────────────────────────────────────────────────────────
// RTP Engine v2 — 4-Layer Dynamic Volatility Casino Math
// ─────────────────────────────────────────────────────────────
// Replaces flat destroyProbability RNG with a multi-layered
// formula that creates engaging, fish-table-genre mechanics:
//
// Layer 1: Global Volatility (Room Tides)
// Layer 2: Hot-Seat Rotation (Invisible Boost)
// Layer 3: Piñata Boss (Sunk-Cost Escalation)
// Layer 4: Pity Timer (Churn Prevention)
//
// Formula:
//   BaseChance = (1 / TargetMultiplier) × Room_RTP
//   FinalThreshold = BaseChance × GlobalVol × HotSeat × Piñata × Pity
//   Clamped to maxSuccessThreshold (0.85)
//   Roll: CSPRNG ∈ [0, 1) < FinalThreshold → KILL
//
// CONFIG-DRIVEN: All modifiers come from GameBalanceConfig.
// SECURITY: Uses CsprngService for the cryptographic roll.
// AUDIT: Returns full breakdown for logging every shot.
// ─────────────────────────────────────────────────────────────

import type { SpaceObjectType, EntityId } from '@space-shooter/shared';
import type { IRngService } from './CsprngService.js';
import type { RoomEconomyManager } from './RoomEconomyManager.js';
import type { IGameBalanceConfig } from '../config/GameBalanceConfig.js';
import type { IReservePoolProvider } from '../ecs/systems/SystemRunner.js';

// ─── Hit Evaluation Result (Rich Audit Data) ───

export interface IHitEvaluation {
  /** Whether the target was destroyed */
  readonly destroyed: boolean;
  /** Payout amount (0 if not destroyed) */
  readonly payout: number;
  /** The multiplier of the target */
  readonly multiplier: number;
  /** Raw CSPRNG roll value [0, 1) */
  readonly rngRoll: number;
  /** Final clamped success threshold the roll was compared against */
  readonly finalThreshold: number;
  /** Breakdown of each modifier layer for auditing */
  readonly modifiers: IModifierBreakdown;
}

export interface IModifierBreakdown {
  readonly baseChance: number;
  readonly globalVolatility: number;
  readonly hotSeatModifier: number;
  readonly pinataModifier: number;
  readonly pityModifier: number;
  readonly unclamped: number;
  readonly clamped: number;
}

/**
 * RTP Engine v2 — 4-layer dynamic volatility calculation.
 *
 * This replaces the flat `roll < destroyProbability` check with
 * a context-aware formula that accounts for room economy,
 * player engagement, target absorption, and churn prevention.
 *
 * All modifier values are read from GameBalanceConfig at evaluation
 * time — no hardcoded math in the engine itself.
 */
export class RtpEngine {
  // ─── Hot-Seat State ───
  private hotSeatSessionId: string | null = null;
  private hotSeatRotatedAtTick = 0;

  // ─── Pity Timer State ───
  /** Per-player consecutive miss counter */
  private readonly consecutiveMisses: Map<string, number> = new Map();

  constructor(
    private readonly rng: IRngService,
    private readonly economy: RoomEconomyManager,
    private readonly config: IGameBalanceConfig,
  ) {}

  // ─── Core Evaluation ───

  /**
   * Evaluate whether a projectile hit destroys a target.
   *
   * This is the ONLY place in the codebase where kill/no-kill
   * decisions are made. Every call produces a full audit trail.
   *
   * @param objectType - Type of space object that was hit
   * @param betAmount  - Bet bound to the projectile at fire time
   * @param playerId   - Session ID of the owning player
   * @param targetEntityId - Entity ID of the target (for piñata lookup)
   * @param absorbedCredits - Credits absorbed by this target from failed hits
   * @param reservePool - Global reserve pool provider to tap into for subsidized wins
   */
  evaluateHit(
    objectType: SpaceObjectType,
    betAmount: number,
    playerId: string,
    targetEntityId: EntityId,
    absorbedCredits: number,
    reservePool: IReservePoolProvider,
  ): IHitEvaluation & { newAbsorbedCredits: number } {
    const objConfig = this.config.objectTypes[objectType];
    if (!objConfig) {
      throw new Error(`[RtpEngine] Unknown SpaceObjectType: ${objectType}`);
    }

    // Guard against NaN before any coercion — NaN inputs indicate corrupted economy state
    if (!Number.isFinite(betAmount) || !Number.isFinite(absorbedCredits) || !Number.isFinite(reservePool.globalReservePool)) {
      throw new Error(
        `[RTP CRITICAL] Non-finite value detected in RtpEngine — economy state corrupted. ` +
        `bet=${betAmount}, absorbed=${absorbedCredits}, pool=${reservePool.globalReservePool}`
      );
    }

    const bet = betAmount;
    const mult = objConfig.multiplier;
    const payout = bet * mult;

    const multiplier = mult;

    // ─── Layer 0: Base Chance ───
    // BaseChance = (1 / multiplier) × targetRtp
    const baseChance = (1 / multiplier) * this.config.targetRtp;

    // ─── Layer 1: Global Volatility (Room Tides) ───
    const globalVolatility = this.economy.getCurrentMultiplier();

    // ─── Layer 2: Hot-Seat Modifier ───
    const hotSeatModifier = this.getHotSeatModifier(playerId);

    // ─── Layer 3: Piñata Modifier (Sunk-Cost Escalation) ───
    const pinataModifier = this.calculatePinataModifier(multiplier, betAmount, absorbedCredits);

    // ─── Layer 4: Pity Timer ───
    const pityModifier = this.calculatePityModifier(playerId, multiplier);

    // ─── Compose Final Threshold ───
    const unclamped = baseChance * globalVolatility * hotSeatModifier * pinataModifier * pityModifier;
    const clamped = Math.min(unclamped, this.config.maxSuccessThreshold);

    // ─── CSPRNG Roll (sole kill gate) ───
    // The RNG roll is the ONLY kill decision. Reserve pools are used
    // for funding payouts (economic recycling), never for forcing kills.
    let destroyed = false;
    let rngRoll = this.rng.random();
    let newAbsorbedCredits = absorbedCredits;

    destroyed = rngRoll < clamped;

    if (destroyed) {
      // Kill: drain absorbed credits and reserve pool to fund the payout
      if (newAbsorbedCredits >= payout) {
        newAbsorbedCredits -= payout;
      } else {
        const remainder = payout - newAbsorbedCredits;
        newAbsorbedCredits = 0;
        reservePool.globalReservePool = Math.max(0, reservePool.globalReservePool - remainder);
      }
    } else {
      // Miss: absorb bet into target's piñata counter
      newAbsorbedCredits += betAmount;
    }

    // ─── Update Pity Counter ───
    if (destroyed) {
      this.consecutiveMisses.set(playerId, 0);
    } else {
      const current = this.consecutiveMisses.get(playerId) ?? 0;
      this.consecutiveMisses.set(playerId, current + 1);
    }

    const modifiers: IModifierBreakdown = {
      baseChance,
      globalVolatility,
      hotSeatModifier,
      pinataModifier,
      pityModifier,
      unclamped,
      clamped,
    };

    return {
      destroyed,
      payout: destroyed ? betAmount * multiplier : 0,
      multiplier,
      rngRoll,
      finalThreshold: clamped,
      modifiers,
      newAbsorbedCredits,
    };
  }

  // ─── Hot-Seat Management ───

  /**
   * Rotate the hot-seat to a random active player.
   * Called by GameRoom on a timer. The selected player gets a
   * boost; all others get a penalty to balance room RTP.
   *
   * SECURITY: Hot-seat ID is NEVER sent to clients.
   */
  rotateHotSeat(activePlayers: readonly string[], currentTick: number): void {
    if (activePlayers.length === 0) {
      this.hotSeatSessionId = null;
      return;
    }

    const index = this.rng.randomRange(0, activePlayers.length);
    this.hotSeatSessionId = activePlayers[index];
    this.hotSeatRotatedAtTick = currentTick;
  }

  /** Should we rotate? Check interval. */
  shouldRotateHotSeat(currentTick: number): boolean {
    return (currentTick - this.hotSeatRotatedAtTick) >= this.config.hotSeat.rotationIntervalTicks;
  }

  /** Get hot-seat modifier for a specific player */
  private getHotSeatModifier(playerId: string): number {
    if (this.hotSeatSessionId === null) return 1;
    return playerId === this.hotSeatSessionId
      ? this.config.hotSeat.boostMultiplier
      : this.config.hotSeat.penaltyMultiplier;
  }

  // ─── Piñata Boss Modifier ───

  /**
   * Calculates the sunk-cost escalation modifier.
   *
   * As a target absorbs more credits from failed hits, its
   * kill chance increases. This creates the "piñata" feel where
   * players sense a target is "ready to pop."
   *
   * Formula: modifier = 1.0 + (maxMod - 1.0) × (absorbed / maxPayout)^exponent
   * Clamped to [1.0, maxModifier].
   *
   * SECURITY: absorbedCredits is server-only; never in Colyseus schema.
   */
  private calculatePinataModifier(
    multiplier: number,
    betAmount: number,
    absorbedCredits: number,
  ): number {
    if (absorbedCredits <= 0) return 1;

    // Max expected payout = the most a single hit could pay
    // Using the current bet × multiplier as reference
    const maxExpectedPayout = betAmount * multiplier;
    if (maxExpectedPayout <= 0) return 1;

    // Progress: how close absorbed credits are to max expected payout
    const progress = Math.min(absorbedCredits / maxExpectedPayout, 1);

    // Apply curve: linear → quadratic → sqrt depending on exponent
    const curved = Math.pow(progress, this.config.pinata.curveExponent);

    // Scale from 1.0 to maxModifier
    const modifier = 1 + (this.config.pinata.maxModifier - 1) * curved;

    return Math.min(modifier, this.config.pinata.maxModifier);
  }

  // ─── Pity Timer Modifier ───

  /**
   * If a player has missed too many times in a row, boost their
   * kill chance on low-tier targets to prevent churn.
   *
   * Only applies to targets with multiplier ≤ appliesToMaxMultiplier.
   * Resets on any successful kill (handled in evaluateHit).
   */
  private calculatePityModifier(playerId: string, targetMultiplier: number): number {
    const misses = this.consecutiveMisses.get(playerId) ?? 0;

    if (misses < this.config.pity.missThreshold) return 1;
    if (targetMultiplier > this.config.pity.appliesToMaxMultiplier) return 1;

    return this.config.pity.pityModifier;
  }

  // ─── Player Lifecycle ───

  /** Register a new player */
  addPlayer(playerId: string): void {
    this.consecutiveMisses.set(playerId, 0);
  }

  /** Remove a player */
  removePlayer(playerId: string): void {
    this.consecutiveMisses.delete(playerId);
    if (this.hotSeatSessionId === playerId) {
      this.hotSeatSessionId = null;
    }
  }

  // ─── Getters (for tests / debugging) ───

  getConsecutiveMisses(playerId: string): number {
    return this.consecutiveMisses.get(playerId) ?? 0;
  }

  getHotSeatPlayerId(): string | null {
    return this.hotSeatSessionId;
  }

  getMultiplier(objectType: SpaceObjectType): number {
    const objConfig = this.config.objectTypes[objectType];
    if (!objConfig) {
      throw new Error(`[RtpEngine] Unknown SpaceObjectType: ${objectType}`);
    }
    return objConfig.multiplier;
  }

  /** Reset all state (for tests or room restart) */
  reset(): void {
    this.hotSeatSessionId = null;
    this.hotSeatRotatedAtTick = 0;
    this.consecutiveMisses.clear();
  }
}
