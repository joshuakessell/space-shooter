import { Client, Room } from 'colyseus.js';
import { SERVER_MESSAGES, CLIENT_MESSAGES, BET_TIERS } from '@space-shooter/shared';

const BOTS_COUNT = 30;
const ENDPOINT = process.env.SERVER_URL || 'http://127.0.0.1:2567';

// Global Trackers
let globalTotalWagered = 0;
let globalTotalWon = 0;
let totalShotsFired = 0;
let activeBots = 0;

class BotManager {
  private readonly client: Client;
  private room!: Room;
  private shootInterval: NodeJS.Timeout | null = null;
  private weaponInterval: NodeJS.Timeout | null = null;
  public id: number;

  constructor(id: number) {
    this.client = new Client(ENDPOINT);
    this.id = id;
  }

  async connect() {
    try {
      this.room = await this.client.joinOrCreate('game_room', { bot: true });
      activeBots++;
      this.setupListeners();
      this.startLoop();
    } catch (e) {
      console.error(`Bot ${this.id} failed to connect:`, e);
    }
  }

  private setupListeners() {
    this.room.onMessage(SERVER_MESSAGES.OUT_OF_FUNDS, () => {
      // Auto-refill if out of funds
      this.room.send(CLIENT_MESSAGES.ADMIN_REFILL, { amount: 10000 });
    });

    this.room.onMessage('objectDestroyed', (message: any) => {
      if (message.playerId === this.room.sessionId) {
        globalTotalWon += message.payout;
      }
    });

    this.room.onMessage(SERVER_MESSAGES.CHAIN_HIT, (message: any) => {
      if (message.projectileOwnerId === this.room.sessionId) {
        globalTotalWon += message.payout;
      }
    });

    this.room.onMessage(SERVER_MESSAGES.AOE_DESTROYED, (message: any) => {
      if (message.playerId === this.room.sessionId) {
        globalTotalWon += message.totalPayout;
      }
    });

    this.room.onMessage(SERVER_MESSAGES.FEATURE_VAULT_ROULETTE, (message: any) => {
      if (message.playerId === this.room.sessionId) {
        globalTotalWon += message.payout;
      }
    });

    this.room.onMessage(SERVER_MESSAGES.FEATURE_ENDED, (message: any) => {
      if (message.playerId === this.room.sessionId) {
        globalTotalWon += message.totalPayout;
      }
    });
  }

  private startLoop() {
    // Phase 6 rate limit is 200ms
    this.shootInterval = setInterval(() => {
      const angle = (Math.random() * Math.PI) - (Math.PI / 2); // Random aim upwards
      this.room.send(CLIENT_MESSAGES.POINTER_MOVE, { angle });
      
      const betAmount = BET_TIERS[0]; // 10 credits
      
      // We assume standard weapon cost is 1x.
      // The actual tracking of wagered amount should account for weapon multiplier if we switch.
      // We'll calculate that below.
      
      this.room.send(CLIENT_MESSAGES.FIRE_WEAPON, { angle });
      
      // Simple weapon tracking (we assume server accepted it if credits > 0)
      // The server multiplies the bet by the weapon cost
      const currentWeapon = this.room.state.players.get(this.room.sessionId)?.weaponType ?? 'standard';
      let multiplier = 1;
      if (currentWeapon === 'spread') multiplier = 3;
      if (currentWeapon === 'lightning') multiplier = 5;
      
      globalTotalWagered += (betAmount * multiplier);
      totalShotsFired++;

    }, 200);

    // Switch weapons occasionally to test all logic paths
    this.weaponInterval = setInterval(() => {
      const weaponTypes = ['standard', 'spread', 'lightning'];
      const randomWeapon = weaponTypes[Math.floor(Math.random() * weaponTypes.length)];
      this.room.send(CLIENT_MESSAGES.SWITCH_WEAPON, { weaponType: randomWeapon as any });
    }, 10000);
  }

  disconnect() {
    if (this.shootInterval) clearInterval(this.shootInterval);
    if (this.weaponInterval) clearInterval(this.weaponInterval);
    if (this.room) {
      activeBots--;
      this.room.leave();
    }
  }
}

const bots: BotManager[] = [];

console.log(`Starting ${BOTS_COUNT} headless bots...`);

for (let i = 0; i < BOTS_COUNT; i++) {
  const bot = new BotManager(i);
  bots.push(bot);
  await bot.connect();
  // Stagger connections
  await new Promise(resolve => setTimeout(resolve, 100));
}

// Dashboard interval
setInterval(() => {
  console.clear();
  const rtp = globalTotalWagered > 0 ? ((globalTotalWon / globalTotalWagered) * 100).toFixed(2) : '0.00';
  
  console.log('='.repeat(40));
  console.log('🚀 SPACE SHOOTER RTP VERIFICATION 🚀');
  console.log('='.repeat(40));
  console.log(`Active Bots:     ${activeBots}`);
  console.log(`Shots Fired:     ${totalShotsFired.toLocaleString()}`);
  console.log(`Total Wagered:   $${globalTotalWagered.toLocaleString()}`);
  console.log(`Total Won (Out): $${globalTotalWon.toLocaleString()}`);
  console.log(`Current RTP:     ${rtp}%`);
  console.log(`Target RTP:      98.00%`);
  console.log('='.repeat(40));
}, 5000);
