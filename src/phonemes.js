// Female Japanese vowel targets with F4.
// Q increases with formant number (narrower bandwidth at higher frequencies).
// Gains: F1 loudest, decreasing with formant number.
export const VOWEL_FORMANTS = {
  a: { f1:950,  f2:1400, f3:2800, f4:3400, q1:5,  q2:9,  q3:14, q4:18, g1:4,  g2:2,  g3:-2,  g4:-6  },
  i: { f1:300,  f2:2800, f3:3400, f4:4000, q1:6,  q2:14, q3:18, q4:20, g1:4,  g2:3,  g3:0,   g4:-4  },
  u: { f1:380,  f2:950,  f3:2800, f4:3400, q1:6,  q2:8,  q3:14, q4:18, g1:4,  g2:0,  g3:-4,  g4:-8  },
  e: { f1:700,  f2:2600, f3:3100, f4:3700, q1:5,  q2:12, q3:16, q4:20, g1:4,  g2:2,  g3:-1,  g4:-5  },
  o: { f1:550,  f2:950,  f3:2800, f4:3400, q1:5,  q2:7,  q3:14, q4:18, g1:4,  g2:1,  g3:-4,  g4:-8  },
  n: { f1:250,  f2:1000, f3:2200, f4:3000, q1:4,  q2:4,  q3:6,  q4:8,  g1:2,  g2:-2, g3:-6,  g4:-10 },
};

// Consonant data. Plosives are defined by closure+burst+F2 locus (not noise
// frequency). Fricatives are sustained noise. Glides are pure F2 transitions.
export const CONSONANTS = {
  // PLOSIVES — identity comes from F2 locus at vowel onset, not burst frequency.
  // closureMs: silence before burst. burstFreq: broadband center. f2Locus: where
  // F2 appears to originate from, which is the primary perceptual cue for /k/ vs /t/.
  k: { type: 'plosive',        closureMs: 35, burstMs: 25, burstFreq: 1400, burstQ: 1.2, f2Locus:  800, noiseGain: 3.0 },
  t: { type: 'plosive',        closureMs: 30, burstMs: 30, burstFreq: 2500, burstQ: 1.0, f2Locus: 1800, noiseGain: 2.5 },

  // VOICED PLOSIVES — prevoiced (voice reduced but not silent during closure).
  b: { type: 'voiced_plosive', closureMs: 20, burstMs: 25, burstFreq:  800, burstQ: 0.8, f2Locus:  700, noiseGain: 1.2 },
  d: { type: 'voiced_plosive', closureMs: 20, burstMs: 25, burstFreq: 1800, burstQ: 0.9, f2Locus: 1800, noiseGain: 1.2 },
  g: { type: 'voiced_plosive', closureMs: 20, burstMs: 25, burstFreq: 1200, burstQ: 0.8, f2Locus: 1000, noiseGain: 1.2 },

  // AFFRICATE — stop closure followed by high-frequency fricative burst.
  ch: { type: 'affricate',     closureMs: 25, burstMs: 50, burstFreq: 3500, burstQ: 1.2, f2Locus: 2200, noiseGain: 2.0 },

  // FRICATIVES — sustained noise at characteristic frequencies, voice nearly off.
  s:  { type: 'fricative', noiseFreq: 6000, noiseQ: 10.0, noiseGain: 1.4, durationMs: 110 },
  sh: { type: 'fricative', noiseFreq: 3200, noiseQ: 7.0,  noiseGain: 1.8, durationMs: 100 },

  // ASPIRATE — breathy version of the following vowel's formant structure.
  h:  { type: 'aspirate',  noiseFreq: 1500, noiseQ: 0.8,  noiseGain: 1.0, durationMs:  80 },

  // NASALS — fully voiced, formants shift to nasal pole positions.
  n:  { type: 'nasal', nasalFreq: 250, f1Suppress: true, durationMs: 140, f1Locus: 220, f2Locus: 1100 },
  m:  { type: 'nasal', nasalFreq: 250, f1Suppress: true, durationMs: 90,  f1Locus: 180, f2Locus: 900  },

  // GLIDES — pure F2 transition, no noise at all.
  w:  { type: 'glide',     f1Start: 300, f2Start:  700, durationMs: 80 },
  y:  { type: 'glide',     f1Start: 260, f2Start: 2800, durationMs: 55 },
  r:  { type: 'tap',       f1Dip: 250, dipDurationMs: 18, durationMs: 22 },
};

export function parseSyllable(syllable) {
  const lower = syllable.toLowerCase();
  
  // Catch standalone "n" or "nn" immediately
  if (lower === 'n' || lower === 'nn') {
    return { consonant: 'n', vowel: 'u' }; // /u/ is most neutral — least vowel-like
  }

  // Check for two-character consonants first (sh, ng, etc.)
  const twoCharConsonants = ['sh', 'ng', 'ch'];
  let consonant = null;
  let vowelStr = lower;
  
  for (const tc of twoCharConsonants) {
    if (lower.startsWith(tc)) {
      consonant = tc;
      vowelStr = lower.slice(tc.length);
      break;
    }
  }
  
  // If no two-char consonant, try single char
  if (!consonant) {
    const match = lower.match(/^([^aeiou]*)(.*)$/i);
    const consStr = match[1];
    vowelStr = match[2];
    consonant = consStr.length > 0 ? consStr[0] : null;
  }
  
  // Extract the actual vowel safely
  let vowel = 'a'; // default
  for (let i = vowelStr.length - 1; i >= 0; i--) {
    if ('aeiou'.includes(vowelStr[i])) {
      vowel = vowelStr[i];
      break;
    }
  }

  return { consonant, vowel };
}