// ─────────────────────────────────────────────────────────────
// RoomEconomyManager — Table Volatility State Machine (Tides)
// ─────────────────────────────────────────────────────────────
// SECURITY: Tracks real-time room economy to dynamically adjust
// kill rates. State transitions are config-driven, not hardcoded.
// ─────────────────────────────────────────────────────────────

import { VolatilityPhase } from '../config/GameBalanceConfig.js';
import type { IGameBalanceConfig } from '../config/GameBalanceConfig.js';

/**
 * Tracks the room's aggregate credit flow and calculates the
 * current global volatility modifier.
 *
 * State Machine:
 *   EATING (0.7x) ←→ BASELINE (1.0x) ←→ FRENZY (1.5x)
 *
 * Transitions:
 *   EATING → BASELINE: when profit ratio drops below threshold
 *   BASELINE → FRENZY: when profit ratio exceeds threshold
 *   FRENZY → BASELINE: after frenzy duration expires
 *   BASELINE → EATING: when profit ratio is negative (house losing)
 *
 * CONFIG-DRIVEN: All thresholds from GameBalanceConfig.
 */
export class RoomEconomyManager {
  /** Total credits bet by all players since room creation */
  private creditsIn = 0;
  /** Total credits paid out since room creation */
  private creditsOut = 0;

  /** Current volatility phase */
  private phase: VolatilityPhase = VolatilityPhase.BASELINE;
  /** Tick when the current phase started */
  private phaseStartTick = 0;
  /** Tick when frenzy was entered (for duration tracking) */
  private frenzyStartTick = 0;

  constructor(private readonly config: IGameBalanceConfig) {}

  // ─── Credit Tracking ───

  /** Record a bet placed (credits flowing IN to the house) */
  recordBet(amount: number): void {
    this.creditsIn += amount;
  }

  /** Record a payout awarded (credits flowing OUT from the house) */
  recordPayout(amount: number): void {
    this.creditsOut += amount;
  }

  // ─── State Machine ───

  /**
   * Evaluate state transitions. Called once per tick.
   * Returns the current global volatility multiplier.
   */
  tick(currentTick: number): number {
    const { volatility } = this.config;

    // FRENZY has its own dedicated timer (frenzyStartTick) and
    // must ALWAYS be checked regardless of the general cooldown.
    if (this.phase === VolatilityPhase.FRENZY) {
      if (currentTick - this.frenzyStartTick >= volatility.frenzyDurationTicks) {
        this.transitionTo(VolatilityPhase.BASELINE, currentTick);
      }
      return this.getCurrentMultiplier();
    }

    // General cooldown: don't transition EATING/BASELINE too rapidly
    const ticksSinceTransition = currentTick - this.phaseStartTick;
    if (ticksSinceTransition < volatility.minTicksBetweenTransitions) {
      return this.getCurrentMultiplier();
    }

    const profitRatio = this.getProfitRatio();

    switch (this.phase) {
      case VolatilityPhase.EATING:
        // Exit EATING when profit margin normalizes
        if (profitRatio < volatility.eatingToBaselineProfitRatio) {
          this.transitionTo(VolatilityPhase.BASELINE, currentTick);
        }
        break;

      case VolatilityPhase.BASELINE:
        if (profitRatio > volatility.baselineToFrenzyProfitRatio) {
          // House profiting too much → trigger FRENZY to give back
          this.transitionTo(VolatilityPhase.FRENZY, currentTick);
          this.frenzyStartTick = currentTick;
        } else if (profitRatio < 0) {
          // House losing → tighten via EATING
          this.transitionTo(VolatilityPhase.EATING, currentTick);
        }
        break;
    }

    return this.getCurrentMultiplier();
  }

  // ─── Getters ───

  /** Current volatility multiplier */
  getCurrentMultiplier(): number {
    return this.config.volatility.phases[this.phase];
  }

  /** Current phase */
  getCurrentPhase(): VolatilityPhase {
    return this.phase;
  }

  /**
   * Profit ratio: (creditsIn - creditsOut) / creditsIn
   * 0.0 = break-even, >0 = house profit, <0 = house loss
   */
  getProfitRatio(): number {
    if (this.creditsIn === 0) return 0;
    return (this.creditsIn - this.creditsOut) / this.creditsIn;
  }

  getCreditsIn(): number {
    return this.creditsIn;
  }

  getCreditsOut(): number {
    return this.creditsOut;
  }

  // ─── Internal ───

  private transitionTo(newPhase: VolatilityPhase, tick: number): void {
    this.phase = newPhase;
    this.phaseStartTick = tick;
  }

  /** Reset (for tests or room restart) */
  reset(): void {
    this.creditsIn = 0;
    this.creditsOut = 0;
    this.phase = VolatilityPhase.BASELINE;
    this.phaseStartTick = 0;
    this.frenzyStartTick = 0;
  }
}
