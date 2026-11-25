/**
 * Zero-dependency Web Audio API synthesizer + haptic helper
 * Instant playback on mobile browsers with no external audio files to break.
 */
(function (global) {
  const SoundEngine = {
    enabled: true,
    ctx: null,

    ensureCtx() {
      if (!this.enabled) return null;
      if (!this.ctx) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return null;
        this.ctx = new AudioCtx();
      }
      if (this.ctx.state === "suspended") {
        this.ctx.resume().catch(() => {});
      }
      return this.ctx;
    },

    vibrate(pattern) {
      if (navigator.vibrate) {
        try {
          navigator.vibrate(pattern);
        } catch (_) {}
      }
    },

    playTone(freq, duration, type = "sine", volume = 0.08, delay = 0) {
      const ctx = this.ensureCtx();
      if (!ctx) return;
      const now = ctx.currentTime + delay;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, now);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(volume, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + duration + 0.02);
    },

    tick() {
      this.playTone(720, 0.035, "triangle", 0.06);
      this.vibrate(8);
    },

    click() {
      this.playTone(520, 0.045, "sine", 0.05);
    },

    flip() {
      this.playTone(340, 0.07, "triangle", 0.06, 0);
      this.playTone(560, 0.08, "sine", 0.05, 0.04);
      this.vibrate(14);
    },

    win() {
      this.playTone(523.25, 0.14, "triangle", 0.09, 0);
      this.playTone(659.25, 0.14, "triangle", 0.09, 0.09);
      this.playTone(783.99, 0.22, "triangle", 0.1, 0.18);
      this.playTone(1046.5, 0.34, "sine", 0.09, 0.28);
      this.vibrate([25, 40, 35]);
    },

    alert() {
      this.playTone(260, 0.12, "sawtooth", 0.05, 0);
      this.playTone(210, 0.18, "sawtooth", 0.05, 0.11);
      this.vibrate([40, 30, 40]);
    },

    dice() {
      for (let i = 0; i < 6; i++) {
        const f = 260 + Math.random() * 440;
        this.playTone(f, 0.045, "square", 0.035, i * 0.055);
      }
      this.vibrate([18, 28, 18, 28, 22]);
    },
  };

  global.SoundEngine = SoundEngine;
})(window);
