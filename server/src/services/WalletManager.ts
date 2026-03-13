// ─────────────────────────────────────────────────────────────
// Wallet Manager — Atomic Credit Operations
// Phase 1: In-memory with mutex locks for race condition prevention.
// Phase 2: Will be backed by PostgreSQL ACID transactions.
// ─────────────────────────────────────────────────────────────

/**
 * Manages player credit balances with atomic operations.
 * Uses a simple lock pattern to prevent race conditions when
 * two projectiles hit a target on the same tick.
 */
export class WalletManager {
  private readonly balances: Map<string, number> = new Map();
  private readonly locks: Set<string> = new Set();

  /** Initialize a player's wallet */
  initPlayer(playerId: string, startingBalance: number): void {
    this.balances.set(playerId, startingBalance);
  }

  /** Remove a player's wallet */
  removePlayer(playerId: string): void {
    this.balances.delete(playerId);
    this.locks.delete(playerId);
  }

  /** Get current balance (returns 0 if player not found) */
  getBalance(playerId: string): number {
    return this.balances.get(playerId) ?? 0;
  }

  /**
   * Atomically deduct a bet from the player's balance.
   * Returns true if deduction succeeded, false if insufficient funds.
   * Uses a spin-wait lock to prevent concurrent modification.
   */
  deductBet(playerId: string, amount: number): boolean {
    if (amount <= 0) return false;

    // Acquire lock
    if (this.locks.has(playerId)) {
      // In single-threaded Node.js, this is a logic error — should not happen
      // in normal flow. But guard against it.
      return false;
    }

    this.locks.add(playerId);

    try {
      const balance = this.balances.get(playerId);
      if (balance === undefined || balance < amount) {
        return false;
      }
      this.balances.set(playerId, balance - amount);
      return true;
    } finally {
      this.locks.delete(playerId);
    }
  }

  /**
   * Atomically award a payout to the player.
   * This is the credit-side of a destruction event.
   */
  awardPayout(playerId: string, amount: number): void {
    if (amount <= 0) return;

    this.locks.add(playerId);
    try {
      const balance = this.balances.get(playerId) ?? 0;
      this.balances.set(playerId, balance + amount);
    } finally {
      this.locks.delete(playerId);
    }
  }

  /** Get all balances (for state sync) */
  getAllBalances(): ReadonlyMap<string, number> {
    return this.balances;
  }

  /** Clear all wallets */
  clear(): void {
    this.balances.clear();
    this.locks.clear();
  }
}
