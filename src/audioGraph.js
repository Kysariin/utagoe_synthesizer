let _ctx      = null;
let _analyser = null;
let _voiceBuffer = null;

export const getAudioCtx = () => _ctx;
export const getAnalyser = () => _analyser;

function makeReverb(ctx, duration = 0.6, decay = 2.5) {
  const len = ctx.sampleRate * duration;
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++)
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  const conv = ctx.createConvolver();
  conv.buffer = buf;
  return conv;
}

function makeHarmonicEnricher(ctx) {
  const ws = ctx.createWaveShaper();
  const n  = 256;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i * 2 / (n - 1)) - 1;
    curve[i] = Math.tanh(x * 3) / Math.tanh(3);
  }
  ws.curve = curve;
  ws.oversample = '4x';
  return ws;
}

async function loadVoiceBuffer(ctx) {
  try {
    const response = await fetch('ahhh_normalized.wav');
    const arrayBuffer = await response.arrayBuffer();
    _voiceBuffer = await ctx.decodeAudioData(arrayBuffer);
  } catch (e) {
    console.warn('Failed to load voice buffer:', e);
  }
}

// Lazily create the AudioContext and persistent AnalyserNode on first call.
export function ensureAudio() {
  if (_ctx) {
    if (_ctx.state === 'suspended') _ctx.resume();
    return;
  }
  _ctx = new AudioContext();
  _analyser = _ctx.createAnalyser();
  _analyser.fftSize = 2048;
  _analyser.smoothingTimeConstant = 0.8;

  const reverb  = makeReverb(_ctx);
  const dryGain = _ctx.createGain();
  const wetGain = _ctx.createGain();
  dryGain.gain.value = 0.55;
  wetGain.gain.value = 0.45;
  const limiter = _ctx.createDynamicsCompressor();
  limiter.threshold.value = -3;
  limiter.knee.value      = 0;
  limiter.ratio.value     = 20;
  limiter.attack.value    = 0.001;
  limiter.release.value   = 0.1;

  _analyser.connect(dryGain);
  _analyser.connect(reverb);
  reverb.connect(wetGain);
  dryGain.connect(limiter);
  wetGain.connect(limiter);
  limiter.connect(_ctx.destination);

  loadVoiceBuffer(_ctx); // fire-and-forget background load
}

// Abstract excitation source. For 'voice', returns null if the buffer hasn't
// loaded yet — caller should check and surface a "try again" message.
export function createSource(type, targetHz) {
  if (type === 'voice') {
    if (!_voiceBuffer) return null;
    const src = _ctx.createBufferSource();
    src.buffer = _voiceBuffer;
    src.loop = true;
    src.loopStart = 0.70;
    src.loopEnd = 4.00;
    src.playbackRate.value = targetHz / 265.7;

    // Harmonic enrichment: ahhh drops off after H5 (~1330 Hz); soft saturation
    // regenerates upper partials so F2/F3 filters have energy to shape.
    const enricher = makeHarmonicEnricher(_ctx);
    src.connect(enricher);

    // High-pass to cut low-frequency rumble from the recording
    const rumbleCut = _ctx.createBiquadFilter();
    rumbleCut.type = 'highpass';
    rumbleCut.frequency.value = 180;
    rumbleCut.Q.value = 0.7;

    // Mid boost — lifts F2/F3 region where vowel identity lives
    const midBoost = _ctx.createBiquadFilter();
    midBoost.type = 'peaking';
    midBoost.frequency.value = 1800;
    midBoost.Q.value = 0.8;
    midBoost.gain.value = 10;

    // High shelf — adds air and presence above 3kHz
    const airShelf = _ctx.createBiquadFilter();
    airShelf.type = 'highshelf';
    airShelf.frequency.value = 3000;
    airShelf.gain.value = 7;

    enricher.connect(rumbleCut);
    rumbleCut.connect(midBoost);
    midBoost.connect(airShelf);
    src._voiceChainOutput = airShelf;

    // Subtle pitch jitter for naturalness — 7 Hz sine at 0.3% depth
    const lfo     = _ctx.createOscillator();
    const lfoGain = _ctx.createGain();
    lfo.type = 'sine';
    lfo.frequency.value = 7;
    lfoGain.gain.value  = 0.003;
    lfo.connect(lfoGain);
    lfoGain.connect(src.playbackRate);
    lfo.start(_ctx.currentTime);
    src._voiceLFONodes = [lfo, lfoGain, enricher, rumbleCut, midBoost, airShelf];

    return src;
  }
  const osc = _ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.value = targetHz;
  return osc;
}

// Parallel bandpass filter for one formant.
// Parallel topology (not series) is acoustically correct for formant synthesis —
// each formant independently amplifies its frequency region without interacting.
export function createFormantBandpass(freq, q) {
  const f = _ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = freq;
  f.Q.value = q;
  return f;
}

// Gain staging for each formant branch in the parallel bank.
export function createFormantGain(dbGain) {
  const g = _ctx.createGain();
  // Convert dB to linear gain
  g.gain.value = Math.pow(10, dbGain / 20);
  return g;
}

export function createVocalWaveShaper() {
  const shaper = _ctx.createWaveShaper();
  const curve = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const x = (i * 2) / 256 - 1;
    // Soft saturation — rounds off harsh sawtooth edges
    curve[i] = (Math.PI + 80) * x / (Math.PI + 80 * Math.abs(x));
  }
  shaper.curve = curve;
  shaper.oversample = '4x';
  return shaper;
}

export function createPreEmphasis() {
  const shelf = _ctx.createBiquadFilter();
  shelf.type = 'highshelf';
  shelf.frequency.value = 1000; // was 3000 — start boosting from F2 range upward
  shelf.gain.value = 8;         // was 5 — lift F2/F3 region where vowel identity lives
  return shelf;
}

export function createGlottalSource(frequency) {
  const N = 64;
  const real = new Float32Array(N);
  const imag = new Float32Array(N);
  // Approximate glottal flow derivative: harmonic amplitude ~ 1/n^1.5
  // This gives -9dB/octave rolloff vs sawtooth's -6dB, closer to real voice
  for (let n = 1; n < N; n++) {
    imag[n] = 1.0 / Math.pow(n, 1.2); // was 1.5 — flatter rolloff, more upper harmonics
    real[n] = imag[n] * 0.15;
  }
  const wave = _ctx.createPeriodicWave(real, imag, { disableNormalization: false });
  const osc = _ctx.createOscillator();
  osc.setPeriodicWave(wave);
  osc.frequency.value = frequency;
  return osc;
}

// White noise buffer for synthesizing 's', 'k', 't', etc.
export function createNoiseSource() {
  const bufferSize = _ctx.sampleRate * 2;
  const buffer = _ctx.createBuffer(1, bufferSize, _ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  const noise = _ctx.createBufferSource();
  noise.buffer = buffer;
  noise.loop = true;
  return noise;
}
