// ─────────────────────────────────────────────────────────────
// AudioManager — Web Audio API Synthesizer
// Infrastructure adapter: read-only observer, never mutates ECS.
//
// All sounds are oscillator-synthesized (no asset files needed).
// Per-type concurrency caps prevent speaker distortion.
// Random pitch variation prevents repetitive rapid-fire sounds.
// ─────────────────────────────────────────────────────────────

/** Maximum concurrent plays per sound type */
const MAX_CONCURRENT = 4;

/** Pitch variation range (±cents, 100 cents = 1 semitone) */
const PITCH_VARIANCE = 100;

/**
 * Manages synthesized game audio with concurrency caps and pitch variation.
 * Resumes AudioContext on first pointerdown (browser autoplay policy).
 */
export class AudioManager {
  private ctx: AudioContext | null = null;
  private readonly activeCounts: Map<string, number> = new Map();
  private resumed = false;

  constructor() {
    // Defer creation until first interaction (autoplay policy)
    document.addEventListener('pointerdown', () => this.ensureContext(), { once: true });
  }

  /** Ensure AudioContext is created and resumed */
  private ensureContext(): void {
    if (this.ctx && this.resumed) return;

    if (!this.ctx) {
      this.ctx = new AudioContext();
    }

    if (this.ctx.state === 'suspended') {
      this.ctx.resume().then(() => {
        this.resumed = true;
        console.log('[AudioManager] AudioContext resumed');
      });
    } else {
      this.resumed = true;
    }
  }

  // ─── Concurrency Guard ───

  private canPlay(type: string): boolean {
    const count = this.activeCounts.get(type) ?? 0;
    return count < MAX_CONCURRENT;
  }

  private trackStart(type: string): void {
    this.activeCounts.set(type, (this.activeCounts.get(type) ?? 0) + 1);
  }

  private trackEnd(type: string): void {
    const count = this.activeCounts.get(type) ?? 1;
    this.activeCounts.set(type, Math.max(0, count - 1));
  }

  /** Random detune in cents for pitch variation */
  private randomDetune(): number {
    return (Math.random() * 2 - 1) * PITCH_VARIANCE;
  }

  // ─── Sound Helpers ───

  private playOscillator(
    type: OscillatorType,
    freq: number,
    durationMs: number,
    soundType: string,
    gain = 0.15,
    freqEnd?: number,
  ): void {
    this.ensureContext();
    if (!this.ctx || !this.canPlay(soundType)) return;

    this.trackStart(soundType);
    const now = this.ctx.currentTime;
    const dur = durationMs / 1000;

    const osc = this.ctx.createOscillator();
    const gainNode = this.ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    osc.detune.setValueAtTime(this.randomDetune(), now);
    if (freqEnd !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(freqEnd, 20), now + dur);
    }

    gainNode.gain.setValueAtTime(gain, now);
    gainNode.gain.exponentialRampToValueAtTime(0.001, now + dur);

    osc.connect(gainNode);
    gainNode.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + dur);

    osc.onended = () => this.trackEnd(soundType);
  }

  private playNoise(durationMs: number, soundType: string, gain = 0.1): void {
    this.ensureContext();
    if (!this.ctx || !this.canPlay(soundType)) return;

    this.trackStart(soundType);
    const now = this.ctx.currentTime;
    const dur = durationMs / 1000;
    const sampleRate = this.ctx.sampleRate;
    const samples = Math.floor(sampleRate * dur);

    const buffer = this.ctx.createBuffer(1, samples, sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < samples; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.max(0, 1 - i / samples);
    }

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;

    const gainNode = this.ctx.createGain();
    gainNode.gain.setValueAtTime(gain, now);
    gainNode.gain.exponentialRampToValueAtTime(0.001, now + dur);

    source.connect(gainNode);
    gainNode.connect(this.ctx.destination);
    source.start(now);

    source.onended = () => this.trackEnd(soundType);
  }

  // ─── Public API ───

  /** Laser chirp — short high-frequency sweep */
  playShoot(): void {
    console.log('PLAY SOUND: shoot');
    this.playOscillator('sawtooth', 880, 80, 'shoot', 0.08, 440);
  }

  /** Impact click — quick metallic ping */
  playHit(): void {
    console.log('PLAY SOUND: hit');
    this.playOscillator('square', 600, 50, 'hit', 0.06, 200);
  }

  /**
   * Explosion rumble — scaled by payout tier.
   * Low multiplier = small pop, high = deep boom.
   */
  playExplosion(multiplier: number): void {
    console.log(`PLAY SOUND: explosion (${multiplier}x)`);

    if (multiplier >= 50) {
      // Boss: deep rumble + noise
      this.playOscillator('sawtooth', 80, 500, 'explosion', 0.2, 20);
      this.playNoise(400, 'explosion_noise', 0.15);
    } else if (multiplier >= 10) {
      // Mid: medium boom
      this.playOscillator('sawtooth', 150, 300, 'explosion', 0.15, 40);
      this.playNoise(200, 'explosion_noise', 0.08);
    } else {
      // Small pop
      this.playOscillator('triangle', 300, 150, 'explosion', 0.1, 80);
    }
  }

  /** Coin collect — bright ding with ascending pitch */
  playCoinCollect(): void {
    console.log('PLAY SOUND: coin');
    this.playOscillator('sine', 1200, 100, 'coin', 0.06, 1800);
  }

  /** Jackpot siren — dramatic ascending sweep */
  playJackpotSiren(): void {
    console.log('PLAY SOUND: jackpot');
    this.playOscillator('sawtooth', 200, 1500, 'jackpot', 0.12, 1200);
    setTimeout(() => {
      this.playOscillator('square', 800, 800, 'jackpot2', 0.08, 1600);
    }, 300);
  }
}
