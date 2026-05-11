import { ensureAudio, getAudioCtx, getAnalyser, createSource, createFormantBandpass, createFormantGain, createPreEmphasis, createNoiseSource, createGlottalSource } from './audioGraph.js';
import { VOWEL_FORMANTS, CONSONANTS, parseSyllable } from './phonemes.js';
import { noteToHz } from './noteUtils.js';

const FORMANT_TC    = 0.025;
const VIBRATO_RATE  = 5.5;
const VIBRATO_DEPTH = 8;

let activeNodes        = [];
let stopTimer          = null;
let _highlightTimers   = [];
let _sourceType        = 'synth';
let _onSyllablePlay    = null;

export function setSourceType(type) { _sourceType = type; }
export function getSourceType()     { return _sourceType; }
export function setOnSyllablePlay(fn) { _onSyllablePlay = fn; }

function setStatus(msg) {
  document.getElementById('status').textContent = msg;
}

export function stopAudio() {
  if (stopTimer) {
    clearTimeout(stopTimer);
    stopTimer = null;
  }
  activeNodes.forEach(node => {
    try { node.stop(); } catch (e) {}
    try { node.disconnect(); } catch (e) {}
  });
  activeNodes = [];
  _highlightTimers.forEach(id => clearTimeout(id));
  _highlightTimers = [];
  if (_onSyllablePlay) _onSyllablePlay(-1);
  document.getElementById('singBtn').disabled = false;
  setStatus('ready');
}

export function sing(syllables, notes, velocities = [], tempo = 120) {
  stopAudio();
  ensureAudio();
  const ctx = getAudioCtx();

  const SYLLABLE_DUR = (60 / tempo) * 0.85;

  const firstParts    = parseSyllable(syllables[0]);
  const firstFormants = VOWEL_FORMANTS[firstParts.vowel] || VOWEL_FORMANTS.a;
  const firstHz       = noteToHz(notes[0] || 'C4');

  // === SOURCE — voice or glottal synth ===
  let source1, source2, voiceSource;
  const isVoice = _sourceType === 'voice';

  if (isVoice) {
    voiceSource = createSource('voice', firstHz);
    if (!voiceSource) {
      setStatus('voice buffer not loaded — switch to SYNTH');
      document.getElementById('singBtn').disabled = false;
      return;
    }
    source1 = voiceSource;
    source2 = null;
  } else {
    source1 = createGlottalSource(firstHz);
    source2 = createGlottalSource(firstHz * 1.004);
  }

  const preEmphasis = createPreEmphasis();
  const sourceGain1 = ctx.createGain(); sourceGain1.gain.value = 0.65;

  // voiceGain for consonant ducking — sits before preEmphasis
  const voiceGain = ctx.createGain(); voiceGain.gain.value = 1.0;

  if (isVoice) {
    const voiceOut = voiceSource._voiceChainOutput || voiceSource;
    voiceOut.connect(sourceGain1);
  } else {
    source1.connect(sourceGain1);
    if (source2) {
      const sourceGain2 = ctx.createGain(); sourceGain2.gain.value = 0.35;
      source2.connect(sourceGain2);
      sourceGain2.connect(voiceGain);
      activeNodes.push(source2, sourceGain2);
    }
  }
  sourceGain1.connect(voiceGain);
  voiceGain.connect(preEmphasis);

  // === PARALLEL FORMANT FILTER BANK ===
  // Each formant is a bandpass → gain branch, all summed at formantSum.
  // Parallel topology: formants don't interact, each amplifies its own region.
  const formantSum = ctx.createGain(); formantSum.gain.value = 1.4;

  const f1 = createFormantBandpass(firstFormants.f1, firstFormants.q1);
  const f2 = createFormantBandpass(firstFormants.f2, firstFormants.q2);
  const f3 = createFormantBandpass(firstFormants.f3, firstFormants.q3);
  const f4 = createFormantBandpass(firstFormants.f4, firstFormants.q4);
  const fg1 = createFormantGain(firstFormants.g1);
  const fg2 = createFormantGain(firstFormants.g2);
  const fg3 = createFormantGain(firstFormants.g3);
  const fg4 = createFormantGain(firstFormants.g4);

  preEmphasis.connect(f1); f1.connect(fg1); fg1.connect(formantSum);
  preEmphasis.connect(f2); f2.connect(fg2); fg2.connect(formantSum);
  preEmphasis.connect(f3); f3.connect(fg3); fg3.connect(formantSum);
  preEmphasis.connect(f4); f4.connect(fg4); fg4.connect(formantSum);

  // === SHIMMER (amplitude jitter ~4Hz, adds organic quality) ===
  const shimmerLfo  = ctx.createOscillator();
  const shimmerGain = ctx.createGain();
  shimmerLfo.type = 'sine';
  shimmerLfo.frequency.value = 4.2;
  shimmerGain.gain.value = 0.03;
  shimmerLfo.connect(shimmerGain);
  shimmerGain.connect(formantSum.gain);

  // === MASTER + NOISE CHAIN ===
  const master = ctx.createGain(); master.gain.value = 0.0;
  formantSum.connect(master);

  // Dry mix preserves the body of the voice; formants add resonance on top.
  // Pure parallel bandpass leaves gaps between formants (hollow/whispery).
  const dryMix = ctx.createGain();
  dryMix.gain.value = 0.25;
  preEmphasis.connect(dryMix);
  dryMix.connect(master);

  const noise       = createNoiseSource();
  const noiseFilter = ctx.createBiquadFilter();
  noiseFilter.type = 'bandpass';
  noiseFilter.Q.value = 1.5;
  const noiseGain = ctx.createGain(); noiseGain.gain.value = 0.0;
  noise.connect(noiseFilter);
  noiseFilter.connect(noiseGain);
  noiseGain.connect(master);
  master.connect(getAnalyser());

  // === BREATH NOISE ===
  const breathNoise  = createNoiseSource();
  const breathFilter = ctx.createBiquadFilter();
  breathFilter.type = 'highpass';
  breathFilter.frequency.value = 4000;
  const breathGain = ctx.createGain(); breathGain.gain.value = 0.008;
  breathNoise.connect(breathFilter);
  breathFilter.connect(breathGain);
  breathGain.connect(formantSum);

  // === PITCH VIBRATO ===
  const lfo     = ctx.createOscillator();
  const lfoGain = ctx.createGain();
  lfo.type = 'sine';
  lfo.frequency.value = VIBRATO_RATE;
  lfoGain.gain.value = 0;
  lfo.connect(lfoGain);

  if (isVoice) {
    const lfoPlaybackGain = ctx.createGain();
    lfoPlaybackGain.gain.value = 0.003;
    lfo.connect(lfoPlaybackGain);
    lfoPlaybackGain.connect(voiceSource.playbackRate);
    activeNodes.push(lfoPlaybackGain);
  } else {
    lfoGain.connect(source1.frequency);
    if (source2) lfoGain.connect(source2.frequency);
  }

  // Start all sources
  const startTime = ctx.currentTime + 0.02;
  if (!isVoice) source1.start(startTime);
  if (!isVoice && source2) source2.start(startTime);
  if (isVoice) voiceSource.start(startTime);
  lfo.start(startTime);
  shimmerLfo.start(startTime);
  breathNoise.start(startTime);
  noise.start(startTime);

  activeNodes.push(source1, sourceGain1, voiceGain, preEmphasis);
  if (isVoice && voiceSource._voiceLFONodes) activeNodes.push(...voiceSource._voiceLFONodes);
  activeNodes.push(
    f1, f2, f3, f4, fg1, fg2, fg3, fg4, formantSum, dryMix,
    shimmerLfo, shimmerGain,
    breathNoise, breathFilter, breathGain,
    noise, noiseFilter, noiseGain,
    master, lfo, lfoGain
  );

  // === PHRASE GAIN ENVELOPE ===
  const vel = (velocities[0] ?? velocities[velocities.length - 1] ?? 100) / 100;
  master.gain.setValueAtTime(0, startTime);
  master.gain.linearRampToValueAtTime(0.30 * vel, startTime + 0.03);

  // === SING EACH SYLLABLE ===
  syllables.forEach((syl, i) => {
    const t     = startTime + i * SYLLABLE_DUR;
    if (_onSyllablePlay) {
      const msUntil = (t - ctx.currentTime) * 1000;
      _highlightTimers.push(setTimeout(() => _onSyllablePlay(i), msUntil));
    }
    const parts = parseSyllable(syl);
    const fmts  = VOWEL_FORMANTS[parts.vowel] || VOWEL_FORMANTS.a;
    const hz    = noteToHz(notes[i] ?? notes[notes.length - 1] ?? 'C4');
    const c     = parts.consonant ? CONSONANTS[parts.consonant] : null;
    console.log(`syllable ${i}: ${syl} → consonant: ${parts.consonant ?? '—'}, vowel: ${parts.vowel}, hz: ${hz.toFixed(1)}`);

    // === PITCH ===
    const pitchAttack = 0.025;
    if (isVoice) {
      voiceSource.playbackRate.setValueAtTime(hz / 265.7 * 0.97, t);
      voiceSource.playbackRate.exponentialRampToValueAtTime(hz / 265.7, t + pitchAttack);
    } else {
      source1.frequency.setValueAtTime(hz * 0.97, t);
      source1.frequency.exponentialRampToValueAtTime(hz, t + pitchAttack);
      if (source2) {
        source2.frequency.setValueAtTime(hz * 0.97 * 1.004, t);
        source2.frequency.exponentialRampToValueAtTime(hz * 1.004, t + pitchAttack);
      }
    }

    // === VIBRATO ===
    lfoGain.gain.cancelAndHoldAtTime(t);
    lfoGain.gain.setValueAtTime(0, t);
    lfoGain.gain.linearRampToValueAtTime(VIBRATO_DEPTH, t + 0.2);

    // Brief articulation dip at syllable boundary — prevents same-pitch syllables blending
    if (i > 0) {
      master.gain.cancelAndHoldAtTime(t);
      master.gain.linearRampToValueAtTime(0.06, t + 0.015);
      master.gain.linearRampToValueAtTime(0.30 * vel, t + 0.05);
    }

    // Hard reset all consonant params to clean state at every syllable boundary
    noiseGain.gain.cancelAndHoldAtTime(t);
    noiseGain.gain.setValueAtTime(0, t);
    voiceGain.gain.cancelAndHoldAtTime(t);
    voiceGain.gain.setValueAtTime(1.0, t);
    breathGain.gain.cancelAndHoldAtTime(t);
    breathGain.gain.setValueAtTime(0.004, t);
    fg1.gain.cancelAndHoldAtTime(t);
    fg2.gain.cancelAndHoldAtTime(t);
    fg3.gain.cancelAndHoldAtTime(t);
    fg4.gain.cancelAndHoldAtTime(t);

    let vowelOnset = t;

    // === CONSONANT ===
    if (c) {
      if (c.type === 'plosive' || c.type === 'voiced_plosive') {
        const closureS = c.closureMs / 1000;
        const burstS   = c.burstMs / 1000;
        vowelOnset = t + closureS + burstS;
        const prevoice = c.type === 'voiced_plosive' ? 0.2 : 0.0;

        voiceGain.gain.setValueAtTime(prevoice, t);
        noiseFilter.frequency.setValueAtTime(c.burstFreq, t + closureS);
        noiseFilter.Q.setValueAtTime(c.burstQ, t + closureS);
        // Instantaneous burst onset — plosives are transients, not swells
        noiseGain.gain.setValueAtTime(c.noiseGain, t + closureS);
        noiseGain.gain.exponentialRampToValueAtTime(0.001, vowelOnset);
        voiceGain.gain.setValueAtTime(1.0, vowelOnset);

      } else if (c.type === 'affricate') {
        const closureS = c.closureMs / 1000;
        const burstS   = c.burstMs / 1000;
        vowelOnset = t + closureS + burstS;

        voiceGain.gain.setValueAtTime(0.0, t);
        noiseFilter.frequency.setValueAtTime(c.burstFreq, t + closureS);
        noiseFilter.Q.setValueAtTime(c.burstQ, t + closureS);
        noiseGain.gain.setValueAtTime(0, t + closureS);
        noiseGain.gain.linearRampToValueAtTime(c.noiseGain, t + closureS + 0.01);
        noiseGain.gain.linearRampToValueAtTime(0, vowelOnset);
        voiceGain.gain.setValueAtTime(1.0, vowelOnset);

      } else if (c.type === 'fricative') {
        const durS = c.durationMs / 1000;
        vowelOnset = t + durS;

        voiceGain.gain.setValueAtTime(0.0, t);
        noiseFilter.frequency.setValueAtTime(c.noiseFreq, t);
        noiseFilter.Q.setValueAtTime(c.noiseQ, t);
        noiseGain.gain.setValueAtTime(c.noiseGain, t);
        noiseGain.gain.setValueAtTime(c.noiseGain, vowelOnset - 0.01);
        noiseGain.gain.linearRampToValueAtTime(0, vowelOnset);
        voiceGain.gain.setValueAtTime(1.0, vowelOnset);
        // Mute breath noise through fricative + brief tail — prevents hiss bleeding into next syllable
        breathGain.gain.setValueAtTime(0.0, t);
        breathGain.gain.setValueAtTime(0.0, vowelOnset);
        breathGain.gain.linearRampToValueAtTime(0.004, vowelOnset + 0.08);

      } else if (c.type === 'aspirate') {
        const durS = c.durationMs / 1000;
        vowelOnset = t + durS;

        voiceGain.gain.setValueAtTime(0.15, t);
        noiseFilter.frequency.setValueAtTime(c.noiseFreq, t);
        noiseFilter.Q.setValueAtTime(c.noiseQ, t);
        noiseGain.gain.linearRampToValueAtTime(c.noiseGain, t + 0.02);
        noiseGain.gain.linearRampToValueAtTime(0, vowelOnset);
        voiceGain.gain.setValueAtTime(1.0, vowelOnset);

      } else if (c.type === 'nasal') {
        const durS = (c.durationMs ?? 90) / 1000;
        vowelOnset = t + durS;

        // Lip/tongue closure: silence then small nasal murmur bleed.
        // Ducking voiceGain (not just master) is what creates the closure feel —
        // reducing master downstream still lets fg1 pass plenty of signal.
        voiceGain.gain.setValueAtTime(0.0, t);
        voiceGain.gain.linearRampToValueAtTime(0.18, t + 0.025);
        voiceGain.gain.setValueAtTime(0.18, vowelOnset - 0.01);
        voiceGain.gain.linearRampToValueAtTime(1.0, vowelOnset + 0.02);

        // Suppress upper formants so murmur is muffled not vowel-like
        fg2.gain.cancelAndHoldAtTime(t);
        fg3.gain.cancelAndHoldAtTime(t);
        fg4.gain.cancelAndHoldAtTime(t);
        fg2.gain.setValueAtTime(0.04, t);
        fg3.gain.setValueAtTime(0.01, t);
        fg4.gain.setValueAtTime(0.005, t);
        // fg2/fg3/fg4 restored at vowelOnset in the formant scheduling block below

        // Mute breath noise
        breathGain.gain.setValueAtTime(0.0, t);
        breathGain.gain.setValueAtTime(0.008, vowelOnset);

      } else if (c.type === 'tap') {
        const dipS = c.dipDurationMs / 1000;
        vowelOnset = t + c.durationMs / 1000;

        voiceGain.gain.setValueAtTime(1.0, t);
        voiceGain.gain.linearRampToValueAtTime(0.15, t + dipS * 0.4);
        voiceGain.gain.linearRampToValueAtTime(1.0, t + dipS);

      } else if (c.type === 'glide') {
        vowelOnset = t + c.durationMs / 1000;
        // voiceGain stays 1.0 — glides are fully voiced throughout
      }
    }

    // === FORMANTS ===
    // Blanket cancelAndHoldAtTime at t freezes filters at their current value
    // so there's no jump or drift into the next scheduled event.
    f1.frequency.cancelAndHoldAtTime(t);
    f2.frequency.cancelAndHoldAtTime(t);
    f3.frequency.cancelAndHoldAtTime(t);
    f4.frequency.cancelAndHoldAtTime(t);
    f1.Q.cancelAndHoldAtTime(t);
    f2.Q.cancelAndHoldAtTime(t);

    // dB → linear for gain scheduling
    const g1Lin = Math.pow(10, (fmts.g1 ?? 0)   / 20);
    const g2Lin = Math.pow(10, (fmts.g2 ?? -2)  / 20);
    const g3Lin = Math.pow(10, (fmts.g3 ?? -6)  / 20);
    const g4Lin = Math.pow(10, (fmts.g4 ?? -10) / 20);

    if (c?.type === 'plosive' || c?.type === 'voiced_plosive' || c?.type === 'affricate') {
      f1.frequency.cancelAndHoldAtTime(vowelOnset);
      f2.frequency.cancelAndHoldAtTime(vowelOnset);
      f3.frequency.cancelAndHoldAtTime(vowelOnset);
      f4.frequency.cancelAndHoldAtTime(vowelOnset);
      // F1 locus ramp from 200 Hz — models rapid oral opening after burst
      f1.frequency.setValueAtTime(200, vowelOnset);
      f1.frequency.linearRampToValueAtTime(fmts.f1, vowelOnset + 0.040);
      // F2 locus: primary cue for place of articulation (/k/ vs /t/)
      f2.frequency.setValueAtTime(c.f2Locus, vowelOnset);
      f2.frequency.exponentialRampToValueAtTime(fmts.f2, vowelOnset + 0.060);
      f3.frequency.setTargetAtTime(fmts.f3, vowelOnset, FORMANT_TC);
      f4.frequency.setTargetAtTime(fmts.f4, vowelOnset, FORMANT_TC);
      f1.Q.cancelAndHoldAtTime(vowelOnset);
      f2.Q.cancelAndHoldAtTime(vowelOnset);
      f1.Q.setTargetAtTime(fmts.q1, vowelOnset, FORMANT_TC);
      f2.Q.setTargetAtTime(fmts.q2, vowelOnset, FORMANT_TC);
      f3.Q.setTargetAtTime(fmts.q3, vowelOnset, FORMANT_TC);
      f4.Q.setTargetAtTime(fmts.q4, vowelOnset, FORMANT_TC);
      fg1.gain.cancelAndHoldAtTime(vowelOnset);
      fg2.gain.cancelAndHoldAtTime(vowelOnset);
      fg3.gain.cancelAndHoldAtTime(vowelOnset);
      fg4.gain.cancelAndHoldAtTime(vowelOnset);
      fg1.gain.setTargetAtTime(g1Lin, vowelOnset, FORMANT_TC);
      fg2.gain.setTargetAtTime(g2Lin, vowelOnset, FORMANT_TC);
      fg3.gain.setTargetAtTime(g3Lin, vowelOnset, FORMANT_TC);
      fg4.gain.setTargetAtTime(g4Lin, vowelOnset, FORMANT_TC);

    } else if (c?.type === 'glide') {
      // F2 glide from consonant start position
      f3.frequency.cancelAndHoldAtTime(vowelOnset);
      f4.frequency.cancelAndHoldAtTime(vowelOnset);
      f2.frequency.setValueAtTime(c.f2Start, t);
      f2.frequency.setTargetAtTime(fmts.f2, t, 0.035);
      // F1 also glides from low position if defined (e.g. /w/)
      if (c.f1Start) {
        f1.frequency.cancelAndHoldAtTime(t);
        f1.frequency.setValueAtTime(c.f1Start, t);
        f1.frequency.setTargetAtTime(fmts.f1, t, 0.040);
      } else {
        f1.frequency.cancelAndHoldAtTime(vowelOnset);
        f1.frequency.setTargetAtTime(fmts.f1, vowelOnset, FORMANT_TC);
      }
      f3.frequency.setTargetAtTime(fmts.f3, vowelOnset, FORMANT_TC);
      f4.frequency.setTargetAtTime(fmts.f4, vowelOnset, FORMANT_TC);
      f1.Q.cancelAndHoldAtTime(vowelOnset);
      f2.Q.cancelAndHoldAtTime(vowelOnset);
      f1.Q.setTargetAtTime(fmts.q1, vowelOnset, FORMANT_TC);
      f2.Q.setTargetAtTime(fmts.q2, vowelOnset, FORMANT_TC);
      f3.Q.setTargetAtTime(fmts.q3, vowelOnset, FORMANT_TC);
      f4.Q.setTargetAtTime(fmts.q4, vowelOnset, FORMANT_TC);
      fg1.gain.cancelAndHoldAtTime(vowelOnset);
      fg2.gain.cancelAndHoldAtTime(vowelOnset);
      fg3.gain.cancelAndHoldAtTime(vowelOnset);
      fg4.gain.cancelAndHoldAtTime(vowelOnset);
      fg1.gain.setTargetAtTime(g1Lin, vowelOnset, FORMANT_TC);
      fg2.gain.setTargetAtTime(g2Lin, vowelOnset, FORMANT_TC);
      fg3.gain.setTargetAtTime(g3Lin, vowelOnset, FORMANT_TC);
      fg4.gain.setTargetAtTime(g4Lin, vowelOnset, FORMANT_TC);

    } else if (c?.type === 'nasal') {
      // Hold at vowel frequencies during closure, then sweep from locus at release
      f1.frequency.setTargetAtTime(fmts.f1, t, FORMANT_TC);
      f2.frequency.setTargetAtTime(fmts.f2, t, FORMANT_TC);
      f3.frequency.setTargetAtTime(fmts.f3, t, FORMANT_TC);
      f4.frequency.setTargetAtTime(fmts.f4, t, FORMANT_TC);
      f1.Q.setTargetAtTime(fmts.q1, t, FORMANT_TC);
      f2.Q.cancelAndHoldAtTime(vowelOnset);
      f2.Q.setTargetAtTime(fmts.q2, vowelOnset, FORMANT_TC);
      f3.Q.setTargetAtTime(fmts.q3, t, FORMANT_TC);
      f4.Q.setTargetAtTime(fmts.q4, t, FORMANT_TC);

      // F1 rises from closed oral cavity position into vowel
      if (c.f1Locus) {
        f1.frequency.cancelAndHoldAtTime(vowelOnset);
        f1.frequency.setValueAtTime(c.f1Locus, vowelOnset);
        f1.frequency.linearRampToValueAtTime(fmts.f1, vowelOnset + 0.045);
      }

      // F2 rises from bilabial/alveolar release position — this is the perceptual cue
      if (c.f2Locus) {
        f2.frequency.cancelAndHoldAtTime(vowelOnset);
        f2.frequency.setValueAtTime(c.f2Locus, vowelOnset);
        f2.frequency.exponentialRampToValueAtTime(fmts.f2, vowelOnset + 0.055);
      }

      fg1.gain.cancelAndHoldAtTime(vowelOnset);
      fg2.gain.cancelAndHoldAtTime(vowelOnset);
      fg3.gain.cancelAndHoldAtTime(vowelOnset);
      fg4.gain.cancelAndHoldAtTime(vowelOnset);
      fg1.gain.setTargetAtTime(g1Lin, vowelOnset, FORMANT_TC);
      fg2.gain.setTargetAtTime(g2Lin, vowelOnset, FORMANT_TC);
      fg3.gain.setTargetAtTime(g3Lin, vowelOnset, FORMANT_TC);
      fg4.gain.setTargetAtTime(g4Lin, vowelOnset, FORMANT_TC);

    } else if (c?.type === 'tap') {
      const dipS = c.dipDurationMs / 1000;
      // F1 briefly dips to near-closure position, then rises to vowel target
      f1.frequency.cancelAndHoldAtTime(t);
      f1.frequency.setValueAtTime(c.f1Dip, t);
      f1.frequency.setTargetAtTime(fmts.f1, t + dipS, FORMANT_TC);
      // F2/F3/F4 go straight to vowel targets — tap doesn't affect them much
      f2.frequency.cancelAndHoldAtTime(t);
      f3.frequency.cancelAndHoldAtTime(t);
      f4.frequency.cancelAndHoldAtTime(t);
      f2.frequency.setTargetAtTime(fmts.f2, t, FORMANT_TC);
      f3.frequency.setTargetAtTime(fmts.f3, t, FORMANT_TC);
      f4.frequency.setTargetAtTime(fmts.f4, t, FORMANT_TC);
      f1.Q.cancelAndHoldAtTime(t);
      f2.Q.cancelAndHoldAtTime(t);
      f1.Q.setTargetAtTime(fmts.q1, t, FORMANT_TC);
      f2.Q.setTargetAtTime(fmts.q2, t, FORMANT_TC);
      fg1.gain.cancelAndHoldAtTime(t);
      fg2.gain.cancelAndHoldAtTime(t);
      fg3.gain.cancelAndHoldAtTime(t);
      fg4.gain.cancelAndHoldAtTime(t);
      fg1.gain.setTargetAtTime(g1Lin, t, FORMANT_TC);
      fg2.gain.setTargetAtTime(g2Lin, t, FORMANT_TC);
      fg3.gain.setTargetAtTime(g3Lin, t, FORMANT_TC);
      fg4.gain.setTargetAtTime(g4Lin, t, FORMANT_TC);

    } else {
      // Fricatives, aspirates, and pure vowels glide directly to vowel target
      f1.frequency.cancelAndHoldAtTime(vowelOnset);
      f2.frequency.cancelAndHoldAtTime(vowelOnset);
      f3.frequency.cancelAndHoldAtTime(vowelOnset);
      f4.frequency.cancelAndHoldAtTime(vowelOnset);
      f1.frequency.setTargetAtTime(fmts.f1, vowelOnset, FORMANT_TC);
      f2.frequency.setTargetAtTime(fmts.f2, vowelOnset, FORMANT_TC);
      f3.frequency.setTargetAtTime(fmts.f3, vowelOnset, FORMANT_TC);
      f4.frequency.setTargetAtTime(fmts.f4, vowelOnset, FORMANT_TC);
      f1.Q.cancelAndHoldAtTime(vowelOnset);
      f2.Q.cancelAndHoldAtTime(vowelOnset);
      f1.Q.setTargetAtTime(fmts.q1, vowelOnset, FORMANT_TC);
      f2.Q.setTargetAtTime(fmts.q2, vowelOnset, FORMANT_TC);
      f3.Q.setTargetAtTime(fmts.q3, vowelOnset, FORMANT_TC);
      f4.Q.setTargetAtTime(fmts.q4, vowelOnset, FORMANT_TC);
      fg1.gain.cancelAndHoldAtTime(vowelOnset);
      fg2.gain.cancelAndHoldAtTime(vowelOnset);
      fg3.gain.cancelAndHoldAtTime(vowelOnset);
      fg4.gain.cancelAndHoldAtTime(vowelOnset);
      fg1.gain.setTargetAtTime(g1Lin, vowelOnset, FORMANT_TC);
      fg2.gain.setTargetAtTime(g2Lin, vowelOnset, FORMANT_TC);
      fg3.gain.setTargetAtTime(g3Lin, vowelOnset, FORMANT_TC);
      fg4.gain.setTargetAtTime(g4Lin, vowelOnset, FORMANT_TC);
    }
  });

  const endT = startTime + syllables.length * SYLLABLE_DUR;
  master.gain.setTargetAtTime(0.001, endT - 0.15, 0.06);

  stopTimer = setTimeout(stopAudio, (endT - ctx.currentTime + 0.8) * 1000);

  setStatus(`singing ${syllables.length} syllable${syllables.length !== 1 ? 's' : ''}…`);
  document.getElementById('singBtn').disabled = true;
}
