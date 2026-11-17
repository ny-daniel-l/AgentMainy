// The radar's sonar ping, synthesised with Web Audio (no sound files).
let ctx: AudioContext | undefined;

export function ping(volume: number): void {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    const t = ctx.currentTime;
    // the ping and one softer echo
    for (const [delay, gain] of [[0, 1], [0.32, 0.25]] as const) {
      const osc = ctx.createOscillator();
      const amp = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(1320, t + delay);
      osc.frequency.exponentialRampToValueAtTime(1180, t + delay + 1.2);
      amp.gain.setValueAtTime(0.0001, t + delay);
      amp.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume * gain * 0.5), t + delay + 0.012);
      amp.gain.exponentialRampToValueAtTime(0.0001, t + delay + 1.3);
      osc.connect(amp).connect(ctx.destination);
      osc.start(t + delay);
      osc.stop(t + delay + 1.35);
    }
  } catch {
    // no audio device: stay silent
  }
}
