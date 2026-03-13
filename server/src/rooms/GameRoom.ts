// ─────────────────────────────────────────────────────────────
// GameRoom — Authoritative Server-Side Game Room
// ─────────────────────────────────────────────────────────────
// SECURITY: Server is the single source of truth. Client is
// a dumb renderer. All economy, RTP, and hit resolution
// happens here. absorbedCredits and hot-seat ID never leave
// server memory.
// CONFIG-DRIVEN: Economy behavior flows through GameBalanceConfig.
// AUDIT: Every collision resolution is available in tick results.
// ─────────────────────────────────────────────────────────────

import { Room, Client, type CloseCode } from 'colyseus';
import {
  MAX_PLAYERS,
  FIXED_TIMESTEP_MS,
  STARTING_CREDITS,
  SEAT_COORDINATES,
  TurretPosition,
  DEFAULT_BET,
  BET_TIERS,
  CLIENT_MESSAGES,
  SERVER_MESSAGES,
} from '@space-shooter/shared';
import type { FireWeaponMessage, ChangeBetMessage, PointerMoveMessage } from '@space-shooter/shared';

import {
  GameRoomState,
  PlayerSchema,
  SpaceObjectSchema,
} from './schema/GameRoomState.js';

import { World } from '../ecs/World.js';
import { SystemRunner } from '../ecs/systems/SystemRunner.js';
import { SpawnSystem } from '../ecs/systems/SpawnSystem.js';
import { CsprngService } from '../services/CsprngService.js';
import { RtpEngine } from '../services/RtpEngine.js';
import { WalletManager } from '../services/WalletManager.js';
import { RoomEconomyManager } from '../services/RoomEconomyManager.js';
import { GAME_BALANCE_CONFIG } from '../config/GameBalanceConfig.js';

/**
 * Seat management: 6 fixed seats indexed 0–5.
 * null = vacant, string = occupied by sessionId.
 */
type SeatArray = (string | null)[];

export class GameRoom extends Room<{ state: GameRoomState }> {
  maxClients = MAX_PLAYERS;

  // ─── ECS + Services ───
  private world!: World;
  private systemRunner!: SystemRunner;
  private wallet!: WalletManager;
  private rng!: CsprngService;
  private rtpEngine!: RtpEngine;
  private economy!: RoomEconomyManager;

  // ─── Tick loop ───
  private simulationInterval: ReturnType<typeof setInterval> | null = null;

  // ─── Seat management ───
  private readonly seats: SeatArray = new Array<string | null>(MAX_PLAYERS).fill(null);
  private readonly playerBets: Map<string, number> = new Map();

  // ─── Message handlers ───
  messages = {
    [CLIENT_MESSAGES.FIRE_WEAPON]: (client: Client, message: FireWeaponMessage) => {
      this.handleFireWeapon(client, message);
    },
    [CLIENT_MESSAGES.CHANGE_BET]: (client: Client, message: ChangeBetMessage) => {
      this.handleChangeBet(client, message);
    },
    [CLIENT_MESSAGES.POINTER_MOVE]: (client: Client, message: PointerMoveMessage) => {
      this.handlePointerMove(client, message);
    },
  };

  // ─── Lifecycle ───

  onCreate(_options: Record<string, unknown>): void {
    this.state = new GameRoomState();

    // Initialize services
    this.rng = new CsprngService();
    this.wallet = new WalletManager();
    this.economy = new RoomEconomyManager(GAME_BALANCE_CONFIG);
    this.rtpEngine = new RtpEngine(this.rng, this.economy, GAME_BALANCE_CONFIG);

    // Initialize ECS
    this.world = new World();
    const spawnSystem = new SpawnSystem(this.rng, GAME_BALANCE_CONFIG);
    this.systemRunner = new SystemRunner(
      this.world,
      this.rtpEngine,
      this.wallet,
      this.economy,
      spawnSystem,
    );

    // Start the fixed-timestep simulation loop
    this.simulationInterval = setInterval(() => {
      this.simulateTick();
    }, FIXED_TIMESTEP_MS);

    console.log(`[GameRoom] Room ${this.roomId} created. Tick rate: ${1000 / FIXED_TIMESTEP_MS} Hz`);
    console.log(`[GameRoom] RTP target: ${GAME_BALANCE_CONFIG.targetRtp * 100}%`);
    console.log(`[GameRoom] Max success threshold: ${GAME_BALANCE_CONFIG.maxSuccessThreshold * 100}%`);
  }

  onJoin(client: Client, _options: Record<string, unknown>): void {
    // Assign the lowest available seat index
    const seatIndex = this.getAvailableSeat();
    if (seatIndex === -1) {
      client.leave(4000); // No seats available
      return;
    }

    this.seats[seatIndex] = client.sessionId;
    this.playerBets.set(client.sessionId, DEFAULT_BET);

    // Get turret coordinates from seat
    const coords = SEAT_COORDINATES[seatIndex];

    // Initialize wallet
    this.wallet.initPlayer(client.sessionId, STARTING_CREDITS);

    // Register player in RTP engine (pity timer tracking)
    this.rtpEngine.addPlayer(client.sessionId);

    // Create turret entity in ECS
    const turretId = this.world.createEntity();
    this.world.positions.set(turretId, { x: coords.x, y: coords.y });
    this.world.turrets.set(turretId, {
      playerId: client.sessionId,
      position: this.seatIndexToPosition(seatIndex),
    });

    // Add to Colyseus state
    const playerSchema = new PlayerSchema();
    playerSchema.sessionId = client.sessionId;
    playerSchema.position = this.seatIndexToPosition(seatIndex);
    playerSchema.seatIndex = seatIndex;
    playerSchema.betAmount = DEFAULT_BET;
    playerSchema.credits = STARTING_CREDITS;
    playerSchema.turretX = coords.x;
    playerSchema.turretY = coords.y;
    this.state.players.set(client.sessionId, playerSchema);

    console.log(`[GameRoom] Player ${client.sessionId} joined at seat ${seatIndex} (${coords.x}, ${coords.y})`);
  }

  onLeave(client: Client, _code: CloseCode): void {
    // Free the seat
    const seatIndex = this.seats.indexOf(client.sessionId);

    // Clean up turret entity
    for (const [entityId, turret] of this.world.turrets) {
      if (turret.playerId === client.sessionId) {
        this.world.destroyEntity(entityId);
        break;
      }
    }

    // IMPORTANT: Do NOT destroy mid-air projectiles.
    // Per fish-table genre rules, bullets fired by a disconnected
    // player continue to simulate and resolve. Payouts credit
    // their server-side wallet even while offline.
    // The wallet survives until the player's seat reservation expires.

    if (seatIndex >= 0) this.seats[seatIndex] = null;
    this.playerBets.delete(client.sessionId);
    this.rtpEngine.removePlayer(client.sessionId);
    this.wallet.removePlayer(client.sessionId);
    this.state.players.delete(client.sessionId);

    console.log(`[GameRoom] Player ${client.sessionId} left (was at seat ${seatIndex})`);
  }

  onDispose(): void {
    if (this.simulationInterval) {
      clearInterval(this.simulationInterval);
      this.simulationInterval = null;
    }
    this.world.clear();
    this.wallet.clear();
    this.economy.reset();
    this.rtpEngine.reset();
    console.log(`[GameRoom] Room ${this.roomId} disposed.`);
  }

  // ─── Message Handlers ───

  private handleFireWeapon(client: Client, message: FireWeaponMessage): void {
    const betAmount = this.playerBets.get(client.sessionId) ?? DEFAULT_BET;

    // ─── Security: Out-of-funds pre-check (fast-fail) ───
    const balance = this.wallet.getBalance(client.sessionId);
    if (balance < betAmount) {
      client.send(SERVER_MESSAGES.OUT_OF_FUNDS, {
        type: SERVER_MESSAGES.OUT_OF_FUNDS,
        currentCredits: balance,
        requiredBet: betAmount,
      });
      return; // Do NOT create a fire intent
    }

    // Parse optional lock-on target
    const lockedTargetId = message.lockedTargetId
      ? Number(message.lockedTargetId)
      : undefined;

    // Queue a fire intent for the next tick (never mutate ECS mid-tick)
    const intentId = this.world.createEntity();
    const intent: import('../ecs/components.js').FireIntentComponent = {
      playerId: client.sessionId,
      angle: message.angle,
      betAmount,
    };
    if (lockedTargetId !== undefined) {
      (intent as { lockedTargetId?: number }).lockedTargetId = lockedTargetId;
    }
    this.world.fireIntents.set(intentId, intent);
  }

  private handleChangeBet(client: Client, message: ChangeBetMessage): void {
    // Snap to nearest valid bet tier
    const requestedAmount = Math.floor(message.amount);
    let bestTier: number = BET_TIERS[0];
    for (const tier of BET_TIERS) {
      if (tier <= requestedAmount) bestTier = tier;
    }

    this.playerBets.set(client.sessionId, bestTier);

    // Update Colyseus state for UI sync
    const player = this.state.players.get(client.sessionId);
    if (player) {
      player.betAmount = bestTier;
    }
  }

  private handlePointerMove(client: Client, message: PointerMoveMessage): void {
    const player = this.state.players.get(client.sessionId);
    if (player) {
      player.turretAngle = message.angle;
    }
  }

  // ─── Simulation ───

  private simulateTick(): void {
    // Gather active player session IDs for hot-seat rotation
    const activePlayers = this.seats.filter((s): s is string => s !== null);

    // Run the full ECS pipeline
    const result = this.systemRunner.tick(activePlayers);

    // ─── Sync ECS state → Colyseus schema (delta broadcasting) ───
    // NOTE: absorbedCredits and isDead are NEVER synced to clients.
    // NOTE: Projectiles are NOT synced via schema — they use
    //       event-driven "remote_shoot" broadcasts instead.

    // Update space objects
    // SECURITY: Only sync type, position, multiplier. Never absorbedCredits.
    this.state.spaceObjects.clear();
    for (const [entityId, obj] of this.world.spaceObjects) {
      const pos = this.world.positions.get(entityId);
      if (!pos) continue;

      const schema = new SpaceObjectSchema();
      schema.id = String(entityId);
      schema.x = Math.round(pos.x * 10) / 10;
      schema.y = Math.round(pos.y * 10) / 10;
      schema.objectType = obj.type;
      schema.multiplier = obj.multiplier;
      this.state.spaceObjects.set(String(entityId), schema);
    }

    // Update player credits
    for (const [playerId, player] of this.state.players) {
      player.credits = this.wallet.getBalance(playerId);
    }

    // Update tick counter
    this.state.tick = this.world.currentTick;

    // ─── Broadcast events via messages ───

    // Remote shoot events (ghost projectile visuals for other clients)
    for (const proj of result.newProjectiles) {
      const seatIndex = this.seats.indexOf(proj.ownerId);
      const targetClient = this.clients.find(c => c.sessionId === proj.ownerId);
      if (targetClient && seatIndex >= 0) {
        this.broadcast(SERVER_MESSAGES.REMOTE_SHOOT, {
          type: SERVER_MESSAGES.REMOTE_SHOOT,
          sessionId: proj.ownerId,
          seatIndex,
          angle: proj.angle,
          lockedTargetId: proj.lockedTargetId !== undefined ? String(proj.lockedTargetId) : undefined,
        }, { except: targetClient });
      }
    }

    // Payouts (object destroyed events)
    for (const payout of result.payouts) {
      const seatIndex = this.seats.indexOf(payout.playerId);
      this.broadcast('objectDestroyed', {
        objectId: payout.objectId,
        playerId: payout.playerId,
        objectType: payout.objectType,
        payout: payout.payout,
        multiplier: payout.multiplier,
        seatIndex,
      });
    }

    // Rejected shots
    for (const rejected of result.rejectedShots) {
      const targetClient = this.clients.find(c => c.sessionId === rejected.playerId);
      if (targetClient) {
        targetClient.send('shotRejected', { reason: rejected.reason });
      }
    }

    // NOTE: result.collisionResolutions contains every shot's full
    // modifier breakdown for audit logging. In production, pipe this
    // to AuditLogger.logResolutions(result.collisionResolutions).
  }

  // ─── Helpers ───

  /** Get the lowest available seat index, or -1 if full */
  private getAvailableSeat(): number {
    for (let i = 0; i < this.seats.length; i++) {
      if (this.seats[i] === null) return i;
    }
    return -1;
  }

  /** Map seat index to TurretPosition enum value */
  private seatIndexToPosition(seatIndex: number): TurretPosition {
    const positions: TurretPosition[] = [
      TurretPosition.BOTTOM_LEFT, TurretPosition.BOTTOM_MIDDLE, TurretPosition.BOTTOM_RIGHT,
      TurretPosition.TOP_LEFT, TurretPosition.TOP_MIDDLE, TurretPosition.TOP_RIGHT,
    ];
    return positions[seatIndex] ?? TurretPosition.BOTTOM_LEFT;
  }
}
