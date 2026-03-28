import { Howl, Howler } from 'howler';
import { GAME_WIDTH } from '@space-shooter/shared';

const MAX_EXPLOSIONS = 5;

export class AudioManager {
  // Music
  private bgm: Howl;

  // Laser sounds by type
  private laserStandard: Howl;
  private laserSpread: Howl;
  private laserLightning: Howl;

  // Explosion sounds by size
  private explosionSmall: Howl;
  private explosionMedium: Howl;
  private explosionBoss: Howl;

  // Utility sounds
  private coinCollect: Howl;
  private jackpotSiren: Howl;
  private impactHit: Howl;

  // Special ability sounds
  private blackholeActivate: Howl;
  private empDischarge: Howl;
  private drillLaunch: Howl;
  private orbitalLaser: Howl;
  private vaultOpen: Howl;
  private supernovaBlast: Howl;

  // Volume controls
  private masterVolume = 1.0;
  private musicVolume = 1.0;
  private sfxVolume = 1.0;

  // State management
  private isInitialized = false;
  private lastCoinTime = 0;
  private coinCombo = 0;
  private coinDebounceTimer: number | null = null;
  private activeExplosions = 0;
  private failedLoads: string[] = [];

  /** Optional callback fired when a sound file fails to load */
  public onLoadError: ((soundName: string) => void) | null = null;

  private trackLoadError(name: string): void {
    this.failedLoads.push(name);
    console.warn(`[AudioManager] Failed to load: ${name}`);
    this.onLoadError?.(name);
  }

  /** Returns list of sound files that failed to load */
  public getFailedLoads(): readonly string[] {
    return this.failedLoads;
  }

  constructor() {
    // Initialize music
    this.bgm = new Howl({
      src: ['assets/audio/music/bgm.mp3'],
      loop: true,
      volume: 0.4,
      onloaderror: () => this.trackLoadError('bgm.mp3'),
      onplayerror: () => console.warn('[Howler] Play error: bgm.mp3'),
    });

    // Initialize laser sounds
    this.laserStandard = new Howl({
      src: ['assets/audio/sfx/laser_standard.mp3'],
      volume: 0.3,
      onloaderror: () => this.trackLoadError('laser_standard.mp3'),
    });

    this.laserSpread = new Howl({
      src: ['assets/audio/sfx/laser_spread.mp3'],
      volume: 0.3,
      onloaderror: () => this.trackLoadError('laser_spread.mp3'),
    });

    this.laserLightning = new Howl({
      src: ['assets/audio/sfx/laser_lightning.mp3'],
      volume: 0.3,
      onloaderror: () => this.trackLoadError('laser_lightning.mp3'),
    });

    // Initialize explosion sounds
    this.explosionSmall = new Howl({
      src: ['assets/audio/sfx/explosion_small.mp3'],
      volume: 0.5,
      onloaderror: () => this.trackLoadError('explosion_small.mp3'),
      onend: () => {
        this.activeExplosions = Math.max(0, this.activeExplosions - 1);
      },
    });

    this.explosionMedium = new Howl({
      src: ['assets/audio/sfx/explosion_medium.mp3'],
      volume: 0.5,
      onloaderror: () => this.trackLoadError('explosion_medium.mp3'),
      onend: () => {
        this.activeExplosions = Math.max(0, this.activeExplosions - 1);
      },
    });

    this.explosionBoss = new Howl({
      src: ['assets/audio/sfx/explosion_boss.mp3'],
      volume: 0.5,
      onloaderror: () => this.trackLoadError('explosion_boss.mp3'),
      onend: () => {
        this.activeExplosions = Math.max(0, this.activeExplosions - 1);
      },
    });

    // Initialize utility sounds
    this.coinCollect = new Howl({
      src: ['assets/audio/sfx/coin_collect.mp3'],
      volume: 0.4,
      onloaderror: () => this.trackLoadError('coin_collect.mp3'),
    });

    this.jackpotSiren = new Howl({
      src: ['assets/audio/sfx/jackpot_siren.mp3'],
      volume: 0.6,
      onloaderror: () => this.trackLoadError('jackpot_siren.mp3'),
    });

    this.impactHit = new Howl({
      src: ['assets/audio/sfx/impact_hit.mp3'],
      volume: 0.4,
      onloaderror: () => this.trackLoadError('impact_hit.mp3'),
    });

    // Initialize special ability sounds
    this.blackholeActivate = new Howl({
      src: ['assets/audio/sfx/blackhole_activate.mp3'],
      volume: 0.5,
      onloaderror: () => this.trackLoadError('blackhole_activate.mp3'),
    });

    this.empDischarge = new Howl({
      src: ['assets/audio/sfx/emp_discharge.mp3'],
      volume: 0.5,
      onloaderror: () => this.trackLoadError('emp_discharge.mp3'),
    });

    this.drillLaunch = new Howl({
      src: ['assets/audio/sfx/drill_launch.mp3'],
      volume: 0.5,
      onloaderror: () => this.trackLoadError('drill_launch.mp3'),
    });

    this.orbitalLaser = new Howl({
      src: ['assets/audio/sfx/orbital_laser.mp3'],
      volume: 0.5,
      onloaderror: () => this.trackLoadError('orbital_laser.mp3'),
    });

    this.vaultOpen = new Howl({
      src: ['assets/audio/sfx/vault_open.mp3'],
      volume: 0.5,
      onloaderror: () => this.trackLoadError('vault_open.mp3'),
    });

    this.supernovaBlast = new Howl({
      src: ['assets/audio/sfx/supernova_blast.mp3'],
      volume: 0.5,
      onloaderror: () => this.trackLoadError('supernova_blast.mp3'),
    });
  }

  /**
   * Initialize the AudioManager and start BGM after first user interaction.
   * Must be called after user interacts with the page (click, touch, etc).
   */
  public init(): void {
    if (this.isInitialized) return;
    this.isInitialized = true;
    console.log('[AudioManager] Initialized, starting BGM');

    // Enable autoUnlock for iOS and other browsers requiring user interaction
    Howler.autoUnlock = true;

    // Start BGM with fade-in
    this.bgm.play();
    this.bgm.fade(0, this.musicVolume * this.masterVolume * 0.4, 2000);
  }

  /**
   * Calculate stereo pan position based on X coordinate.
   * -1 = left, 0 = center, 1 = right
   */
  private getPan(x: number): number {
    return Math.max(-1, Math.min(1, (x - (GAME_WIDTH / 2)) / (GAME_WIDTH / 2)));
  }

  /**
   * Play a sound with spatial panning and rate control.
   */
  private playSpatialSound(sound: Howl, x?: number, rate = 1.0): number | undefined {
    if (!this.isInitialized) return undefined;

    const id = sound.play();
    if (id === undefined) return undefined;

    // Apply playback rate
    sound.rate(rate, id);

    // Apply spatial panning if X position provided
    if (x !== undefined) {
      const pan = this.getPan(x);
      sound.stereo(pan, id);
    }

    return id;
  }

  /**
   * Play a laser sound based on weapon type.
   * Supports: 'standard', 'spread', 'lightning'
   */
  public playShoot(x?: number, weaponType: string = 'standard'): void {
    if (!this.isInitialized) return;

    let laserSound: Howl;
    switch (weaponType) {
      case 'spread':
        laserSound = this.laserSpread;
        break;
      case 'lightning':
        laserSound = this.laserLightning;
        break;
      case 'standard':
      default:
        laserSound = this.laserStandard;
        break;
    }

    this.playSpatialSound(laserSound, x);
  }

  /**
   * Play an explosion sound based on enemy multiplier.
   * small: mult < 8
   * medium: mult 8-24
   * boss: mult 25+
   */
  public playExplosion(multiplier: number, x?: number): void {
    if (!this.isInitialized) return;
    if (this.activeExplosions >= MAX_EXPLOSIONS) return;

    this.activeExplosions++;

    let explosionSound: Howl;
    if (multiplier >= 25) {
      explosionSound = this.explosionBoss;
    } else if (multiplier >= 8) {
      explosionSound = this.explosionMedium;
    } else {
      explosionSound = this.explosionSmall;
    }

    this.playSpatialSound(explosionSound, x);
  }

  /**
   * Play impact/hit sound at optional X position.
   */
  public playHit(x?: number): void {
    if (!this.isInitialized) return;
    this.playSpatialSound(this.impactHit, x);
  }

  /**
   * Play coin collect sound with ascending pitch on rapid collects (combo).
   */
  public playCoinCollect(x?: number): void {
    if (!this.isInitialized) return;

    if (this.coinDebounceTimer !== null) {
      clearTimeout(this.coinDebounceTimer);
    }

    const now = performance.now();
    if (now - this.lastCoinTime <= 150 && this.lastCoinTime !== 0) {
      this.coinCombo++;
    } else if (now - this.lastCoinTime > 250) {
      this.coinCombo = 0;
    }
    this.lastCoinTime = now;

    // Calculate pitch increase: 1.0 + (combo * 0.05), capped at 2.0
    const currentRate = 1.0 + (this.coinCombo * 0.05);
    const cappedRate = Math.min(currentRate, 2.0);

    this.playSpatialSound(this.coinCollect, x, cappedRate);

    this.coinDebounceTimer = window.setTimeout(() => {
      this.coinCombo = 0;
      this.lastCoinTime = 0;
    }, 250);
  }

  /**
   * Play jackpot siren sound.
   */
  public playJackpotSiren(x?: number): void {
    if (!this.isInitialized) return;
    this.playSpatialSound(this.jackpotSiren, x);
  }

  /**
   * Play blackhole activation sound.
   */
  public playBlackholeActivate(x?: number): void {
    if (!this.isInitialized) return;
    this.playSpatialSound(this.blackholeActivate, x);
  }

  /**
   * Play EMP discharge sound.
   */
  public playEmpDischarge(x?: number): void {
    if (!this.isInitialized) return;
    this.playSpatialSound(this.empDischarge, x);
  }

  /**
   * Play drill launch sound.
   */
  public playDrillLaunch(x?: number): void {
    if (!this.isInitialized) return;
    this.playSpatialSound(this.drillLaunch, x);
  }

  /**
   * Play orbital laser sound.
   */
  public playOrbitalLaser(x?: number): void {
    if (!this.isInitialized) return;
    this.playSpatialSound(this.orbitalLaser, x);
  }

  /**
   * Play vault open sound.
   */
  public playVaultOpen(x?: number): void {
    if (!this.isInitialized) return;
    this.playSpatialSound(this.vaultOpen, x);
  }

  /**
   * Play supernova blast sound.
   */
  public playSupernovaBlast(x?: number): void {
    if (!this.isInitialized) return;
    this.playSpatialSound(this.supernovaBlast, x);
  }

  /**
   * Duck (reduce) music volume temporarily during intense moments.
   */
  public duckMusic(durationMs: number): void {
    if (!this.isInitialized) return;

    const targetMusicVol = this.musicVolume * this.masterVolume * 0.05;
    const normalMusicVol = this.musicVolume * this.masterVolume * 0.3;

    this.bgm.fade(this.bgm.volume(), targetMusicVol, 200);

    setTimeout(() => {
      this.bgm.fade(this.bgm.volume(), normalMusicVol, 500);
    }, durationMs);
  }

  /**
   * Set master volume (affects all sounds: music and SFX).
   * Range: 0 to 1
   */
  public setMasterVolume(volume: number): void {
    this.masterVolume = Math.max(0, Math.min(1, volume));
    Howler.volume(this.masterVolume);
  }

  /**
   * Set music volume.
   * Range: 0 to 1
   */
  public setMusicVolume(volume: number): void {
    this.musicVolume = Math.max(0, Math.min(1, volume));
    this.bgm.volume(this.musicVolume * this.masterVolume);
  }

  /**
   * Set SFX volume.
   * Range: 0 to 1
   */
  public setSfxVolume(volume: number): void {
    this.sfxVolume = Math.max(0, Math.min(1, volume));
    // Apply SFX volume to all sound effects
    this.laserStandard.volume(0.3 * this.sfxVolume * this.masterVolume);
    this.laserSpread.volume(0.3 * this.sfxVolume * this.masterVolume);
    this.laserLightning.volume(0.3 * this.sfxVolume * this.masterVolume);
    this.explosionSmall.volume(0.5 * this.sfxVolume * this.masterVolume);
    this.explosionMedium.volume(0.5 * this.sfxVolume * this.masterVolume);
    this.explosionBoss.volume(0.5 * this.sfxVolume * this.masterVolume);
    this.coinCollect.volume(0.4 * this.sfxVolume * this.masterVolume);
    this.jackpotSiren.volume(0.6 * this.sfxVolume * this.masterVolume);
    this.impactHit.volume(0.4 * this.sfxVolume * this.masterVolume);
    this.blackholeActivate.volume(0.5 * this.sfxVolume * this.masterVolume);
    this.empDischarge.volume(0.5 * this.sfxVolume * this.masterVolume);
    this.drillLaunch.volume(0.5 * this.sfxVolume * this.masterVolume);
    this.orbitalLaser.volume(0.5 * this.sfxVolume * this.masterVolume);
    this.vaultOpen.volume(0.5 * this.sfxVolume * this.masterVolume);
    this.supernovaBlast.volume(0.5 * this.sfxVolume * this.masterVolume);
  }

  /**
   * Get current master volume.
   */
  public getMasterVolume(): number {
    return this.masterVolume;
  }

  /**
   * Get current music volume.
   */
  public getMusicVolume(): number {
    return this.musicVolume;
  }

  /**
   * Get current SFX volume.
   */
  public getSfxVolume(): number {
    return this.sfxVolume;
  }
}
