// ─────────────────────────────────────────────────────────────
// Wallet Manager — Atomic Credit Operations
// Phase 1: In-memory with mutex locks for race condition prevention.
// Phase 2: Backed by PostgreSQL ACID transactions with Write-Behind caching.
// ─────────────────────────────────────────────────────────────

import { prisma } from './prisma.js';
import { AuditAction } from '../../generated/prisma/index.js';

/**
 * Manages player credit balances with atomic operations.
 * Uses a simple lock pattern to prevent race conditions when
 * two projectiles hit a target on the same tick.
 */
export class WalletManager {
  private readonly balances: Map<string, number> = new Map();
  private readonly pendingDeltas: Map<string, number> = new Map();
  private readonly locks: Set<string> = new Set();
  
  // Track sync status to avoid overlapping syncs for the same player
  private readonly syncingPlayers: Set<string> = new Set();

  /** Initialize a player's wallet */
  initPlayer(playerId: string, startingBalance: number): void {
    this.balances.set(playerId, startingBalance);
    this.pendingDeltas.set(playerId, 0);
  }

  /** Remove a player's wallet */
  removePlayer(playerId: string): void {
    this.balances.delete(playerId);
    this.pendingDeltas.delete(playerId);
    this.locks.delete(playerId);
    this.syncingPlayers.delete(playerId);
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
      const currentDelta = this.pendingDeltas.get(playerId) ?? 0;
      this.pendingDeltas.set(playerId, currentDelta - amount);
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
      const currentDelta = this.pendingDeltas.get(playerId) ?? 0;
      this.pendingDeltas.set(playerId, currentDelta + amount);
    } finally {
      this.locks.delete(playerId);
    }
  }

  /**
   * Synchronously logs a high-value win to the AuditLog and forces an immediate sync
   * to guarantee the big win is permanently recorded in case of a server crash.
   * Assumes the payout was already added via awardPayout incrementally.
   */
  async logHighValueWin(userId: string, amount: number, actionType: AuditAction, details?: any): Promise<void> {
    if (amount <= 0) return;
    
    try {
      await this.syncToDatabase(userId, actionType, { ...details, specificPayoutAmount: amount });
    } catch (err) {
      console.error(`[WalletManager] Failed to log high value win for ${userId}:`, err);
    }
  }

  /**
   * Syncs pending deltas to the Prisma PostgreSQL database.
   * If a playerId is provided, it only syncs that player.
   * Otherwise, it processes all active players.
   */
  async syncToDatabase(specificPlayerId?: string, forceAction?: AuditAction, forceDetails?: any): Promise<void> {
    const playersToSync = specificPlayerId 
      ? [specificPlayerId] 
      : Array.from(this.pendingDeltas.keys());

    for (const playerId of playersToSync) {
      if (this.syncingPlayers.has(playerId)) continue;
      
      const delta = this.pendingDeltas.get(playerId);
      if (!delta || delta === 0) continue; // Nothing to sync

      this.syncingPlayers.add(playerId);
      
      // Attempt to clear exactly this delta
      try {
        await prisma.$transaction(async (tx) => {
          const action: AuditAction = forceAction || (delta > 0 ? AuditAction.WIN_BATCH : AuditAction.BET_BATCH);
          
          let updatedUser;
          if (delta > 0) {
            updatedUser = await tx.user.update({
              where: { id: playerId },
              data: { balance: { increment: delta } }
            });
          } else {
            updatedUser = await tx.user.update({
              where: { id: playerId },
              data: { balance: { decrement: Math.abs(delta) } }
            });
          }
          
          if (updatedUser.balance < 0) {
            throw new Error(`Critical Security Alert: Attempted to push balance below 0 for user ${playerId}`);
          }
          
          // Write audit log inside transaction
          await tx.auditLog.create({
            data: {
              userId: playerId,
              action: action,
              amount: delta,
              resultingBalance: updatedUser.balance,
              details: forceDetails ?? { batchSync: true },
            }
          });
        });
        
        // Transaction successful, reduce pending delta by the exactly synced amount
        // Handle race conditions where delta changed during async gap
        const currentDelta = this.pendingDeltas.get(playerId) ?? 0;
        this.pendingDeltas.set(playerId, currentDelta - delta);
        
      } catch (err) {
        console.error(`[WalletManager] write-behind sync failed for ${playerId}`, err);
        // Do not clear the delta, we will retry on the next batch
      } finally {
        this.syncingPlayers.delete(playerId);
      }
    }
  }

  /** Get all balances (for state sync) */
  getAllBalances(): ReadonlyMap<string, number> {
    return this.balances;
  }

  /** Clear all wallets */
  clear(): void {
    this.balances.clear();
    this.pendingDeltas.clear();
    this.locks.clear();
    this.syncingPlayers.clear();
  }
}
