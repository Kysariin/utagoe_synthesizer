const CHROMATIC = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// Map of flat notes to their sharp equivalents
const FLAT_TO_SHARP = {
  'DB': 'C#',
  'EB': 'D#',
  'GB': 'F#',
  'AB': 'G#',
  'BB': 'A#'
};

export function noteToHz(name) {
  let cleanName = name.toUpperCase();
  
  // If the note contains a flat (B), swap it for the sharp equivalent
  const flatMatch = cleanName.match(/([A-G]B)(\d+)/);
  if (flatMatch && FLAT_TO_SHARP[flatMatch[1]]) {
    cleanName = FLAT_TO_SHARP[flatMatch[1]] + flatMatch[2];
  }

  const m = cleanName.match(/^([A-G]#?)(\d+)$/);
  if (!m) return 261.63; // C4 fallback
  
  const midi = (parseInt(m[2]) + 1) * 12 + CHROMATIC.indexOf(m[1]);
  return 440 * Math.pow(2, (midi - 69) / 12);
}