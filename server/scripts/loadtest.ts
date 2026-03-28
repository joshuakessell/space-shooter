import { Client, Room } from '@colyseus/sdk';
import { SERVER_MESSAGES, CLIENT_MESSAGES, BET_TIERS } from '@space-shooter/shared';

const BOTS_COUNT = 30;
const ENDPOINT = process.env.SERVER_URL || 'http://127.0.0.1:2567';

// Global Trackers
const MAX_SHOTS = 50000;

const stats = {
  shotsFired: 0,
  totalWagered: 0,
  totalWon: 0,
  targetsDestroyed: 0
};

// Track payouts by target type
const distribution: Record<string, { kills: number, totalPayout: number, maxPayout: number }> = {};

let activeBots = 0;
let isStopping = false;
const bots: BotManager[] = [];

function extractWin(msg: any, source: string): { payout: number, targetType: string } {
  let payout = 0;
  let targetType = 'unknown';

  if (typeof msg === 'number') {
    payout = msg;
  } else {
    payout = Number(msg?.payout) || Number(msg?.totalPayout) || Number(msg?.amount) || Number(msg?.win) || 0;
    targetType = String(msg?.targetType || msg?.objectType || msg?.type || msg?.hazardType || 'UNKNOWN').toUpperCase();
  }

  if (Number.isNaN(payout) || payout === 0) {
    if (payout !== 0) console.error(`[LOADTEST ERROR] Received NaN from ${source}! Raw payload:`, msg);
    return { payout: 0, targetType };
  }
  return { payout, targetType };
}

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
        this.trackWin(message, 'objectDestroyed');
      }
    });

    this.room.onMessage(SERVER_MESSAGES.CHAIN_HIT, (message: any) => {
      if (message.projectileOwnerId === this.room.sessionId) {
        this.trackWin(message, SERVER_MESSAGES.CHAIN_HIT);
      }
    });

    this.room.onMessage(SERVER_MESSAGES.AOE_DESTROYED, (message: any) => {
      if (message.playerId === this.room.sessionId) {
        this.trackWin(message, SERVER_MESSAGES.AOE_DESTROYED);
      }
    });

    this.room.onMessage(SERVER_MESSAGES.FEATURE_VAULT_ROULETTE, (message: any) => {
      if (message.playerId === this.room.sessionId) {
        this.trackWin(message, SERVER_MESSAGES.FEATURE_VAULT_ROULETTE);
      }
    });

    this.room.onMessage('target_destroyed', (message: any) => {
      if (message.playerId === this.room.sessionId) {
        this.trackWin(message, 'target_destroyed');
      }
    });

    this.room.onMessage('aoe_destroyed', (message: any) => {
      if (message.playerId === this.room.sessionId) {
        this.trackWin(message, 'aoe_destroyed');
      }
    });

    this.room.onMessage(SERVER_MESSAGES.FEATURE_ENDED, (message: any) => {
      if (message.playerId === this.room.sessionId) {
        this.trackWin(message, SERVER_MESSAGES.FEATURE_ENDED);
      }
    });

    // Dummy listeners to clear console warnings
    this.room.onMessage('remoteShoot', () => {});
    this.room.onMessage('shotRejected', () => {});
    
    // Log feature events
    this.room.onMessage(SERVER_MESSAGES.FEATURE_ACTIVATED, (message: any) => {
      // Feature targets don't normally pay out immediately on activation except through budget
    });
    this.room.onMessage(SERVER_MESSAGES.FEATURE_EMP_CHAIN, (message: any) => {
      if (message.playerId === this.room.sessionId) {
        this.trackWin(message, SERVER_MESSAGES.FEATURE_EMP_CHAIN);
      }
    });
    this.room.onMessage(SERVER_MESSAGES.FEATURE_DRILL_BOUNCE, (message: any) => {
      if (message.playerId === this.room.sessionId) {
        this.trackWin(message, SERVER_MESSAGES.FEATURE_DRILL_BOUNCE);
      }
    });
  }

  private trackWin(message: any, source: string) {
    const { payout, targetType } = extractWin(message, source);
    if (payout === 0) return;

    stats.totalWon += payout;
    stats.targetsDestroyed++;

    if (!distribution[targetType]) {
      distribution[targetType] = { kills: 0, totalPayout: 0, maxPayout: 0 };
    }
    distribution[targetType].kills++;
    distribution[targetType].totalPayout += payout;
    if (payout > distribution[targetType].maxPayout) {
      distribution[targetType].maxPayout = payout;
    }
  }

  private startLoop() {
    // Phase 6 rate limit is 200ms
    this.shootInterval = setInterval(() => {
      if (stats.shotsFired >= MAX_SHOTS) return; // Stop firing

      const player = this.room.state.players.get(this.room.sessionId);
      if (!player) return;

      const spaceObjects = Array.from(this.room.state.spaceObjects.values());
      if (spaceObjects.length === 0) {
        // Pause firing if there are no targets
        return;
      }

      // Pick a random target to aim at
      const target: any = spaceObjects[Math.floor(Math.random() * spaceObjects.length)];
      const angle = Math.atan2(target.y - player.turretY, target.x - player.turretX);

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
      
      const safeBet = Number(betAmount) || 0;
      const safeMult = Number(multiplier) || 1;
      
      stats.totalWagered += (safeBet * safeMult);
      stats.shotsFired++;

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

console.log(`Starting ${BOTS_COUNT} headless bots...`);

for (let i = 0; i < BOTS_COUNT; i++) {
  const bot = new BotManager(i);
  bots.push(bot);
  await bot.connect();
  // Stagger connections
  await new Promise(resolve => setTimeout(resolve, 100));
}

// Dashboard interval
const dashboardInterval = setInterval(() => {
  if (isStopping) return; // Freeze output while waiting for physics

  console.clear();
  const rtp = stats.totalWagered > 0 ? ((stats.totalWon / stats.totalWagered) * 100).toFixed(2) : '0.00';
  
  console.log('='.repeat(40));
  console.log('🚀 SPACE SHOOTER RTP VERIFICATION 🚀');
  console.log('='.repeat(40));
  console.log(`Active Bots:     ${activeBots}`);
  console.log(`Shots Fired:     ${stats.shotsFired.toLocaleString()} / ${MAX_SHOTS.toLocaleString()}`);
  console.log(`Total Wagered:   $${(stats.totalWagered / 100).toLocaleString()}`);
  console.log(`Total Won (Out): $${(stats.totalWon / 100).toLocaleString()}`);
  console.log(`Current RTP:     ${rtp}%`);
  console.log(`Target RTP:      98.00%`);
  console.log('='.repeat(40));
  
  if (stats.shotsFired >= MAX_SHOTS) {
    isStopping = true;
    clearInterval(dashboardInterval);
    console.log(`\n${MAX_SHOTS.toLocaleString()} shots reached, waiting 5 seconds for physics to resolve...`);
    
    // Shut down firing immediately
    for (const bot of bots) {
      if ((bot as any).shootInterval) clearInterval((bot as any).shootInterval);
      if ((bot as any).weaponInterval) clearInterval((bot as any).weaponInterval);
    }

    setTimeout(() => {
      generateFinalReport();
      process.exit(0);
    }, 5000);
  }
}, 5000);

function generateFinalReport() {
  const rtp = stats.totalWagered > 0 ? ((stats.totalWon / stats.totalWagered) * 100).toFixed(2) : '0.00';
  
  console.log('\n=================================================');
  console.log(`🚀 SIMULATION COMPLETE (${MAX_SHOTS.toLocaleString()} SHOTS) 🚀`);
  console.log('=================================================');
  console.log(`Total Shots:      ${stats.shotsFired.toLocaleString()}`);
  console.log(`Total Wagered:    $${(stats.totalWagered / 100).toLocaleString()}`);
  console.log(`Total Won:        $${(stats.totalWon / 100).toLocaleString()}`);
  console.log(`Actual RTP:       ${rtp}%`);
  console.log(`Targets Killed:   ${stats.targetsDestroyed.toLocaleString()}\n`);
  
  console.log('📊 PAYOUT DISTRIBUTION BY TARGET TYPE');
  
  const formattedArray = [];
  for (const [type, data] of Object.entries(distribution)) {
    const percentOfRtp = stats.totalWon > 0 ? ((data.totalPayout / stats.totalWon) * 100).toFixed(2) : '0.00';
    formattedArray.push({
      "Target Type": type,
      "Kills": data.kills.toLocaleString(),
      "Total Paid": `$${(data.totalPayout / 100).toLocaleString()}`,
      "Max Payout": `$${(data.maxPayout / 100).toLocaleString()}`,
      "% of RTP": `${percentOfRtp}%`
    });
  }
  
  // Sort descending by numeric payout (which is stringified in the struct, so we sort by the raw data)
  const sortedArray = Object.entries(distribution)
    .sort((a, b) => b[1].totalPayout - a[1].totalPayout)
    .map(([type]) => formattedArray.find(item => item["Target Type"] === type));

  console.table(sortedArray);
}
