import { sing, stopAudio, setSourceType, getSourceType, setOnSyllablePlay } from './sequencer.js';
import { startVisualizer } from './visualizer.js';

startVisualizer();

setOnSyllablePlay((index) => {
  document.querySelectorAll('.note-box').forEach((box, i) => {
    box.classList.toggle('note-box--active', i === index);
  });
});

const SONGS = {
  wim: {
    title: "World is Mine — ryo (supercell)",
    syllables: "se ka a i de e i chi ba n o hi me sa ma a",
    notes: "F5 C6 C6 F5 D#5 D#5 F5 F5 F5 G5 G#5 G5 F5 D#5 C6 C6",
    // notes: "F4 C5 C5 F4 D#4 D#4 F4 F4 F4 G4 G#4 G4 F4 D#4 C5 C5",
    tempo: 138
  },
  sakura: {
    title: "Sakura Sakura (Japanese Folk Song)",
    syllables: "sa ku ra a sa ku ra a ya yo i no so ra a wa",
    notes: "A4 A4 B4 B4 A4 A4 B4 B4 A4 B4 C5 B4 A4 B4 A4 F4",
    tempo: 80
  },
  melt: {
    title: "Melt — ryo (supercell)",
    syllables: "me ru to to ke te shi ma i so u",
    notes: "F#5 D5 D5 A4 G5 F#5 E5 D5 E5 F#5 F#5",
    tempo: 125
  },
  rolling: {
    title: "Rolling Girl — wowaka",
    syllables: "sa a wa gu u a ta ma no na ka o ka ki ma wa shi te ka ki ma wa shi te e",
    notes: "A4 A4 F#5 E5 E5 C#5 D5 C#5 C#5 C#5 A4 A4 G4 B4 A4 D4 D4 D4 D4 B4 A4 A4 D5 D5 C#5",
    tempo: 180
  },
  twinkle: {
    title: "Twinkle Twinkle Little Star",
    syllables: "tu in ka ru tu in ka ru ri ta ru su ta",
    notes: "C4 C4 C4 C4 G4 G4 G4 G4 A4 A4 A4 G4 G4",
    tempo: 150
  }
};

document.getElementById('songSelect').addEventListener('change', (e) => {
  const song = SONGS[e.target.value];
  if (!song) return;
  document.getElementById('syllablesInput').value = song.syllables;
  document.getElementById('notesInput').value = song.notes;
  document.getElementById('tempoInput').value = song.tempo;
  document.getElementById('tempoValue').textContent = song.tempo;
  document.getElementById('status').textContent = song.title;
  updateNoteGrid();
});

// Tempo slider
const tempoInput = document.getElementById('tempoInput');
const tempoValue = document.getElementById('tempoValue');
tempoInput.addEventListener('input', () => {
  tempoValue.textContent = tempoInput.value;
});

// Per-syllable note grid
function updateNoteGrid() {
  const syllables = document.getElementById('syllablesInput').value.trim().split(/\s+/).filter(Boolean);
  const notes = document.getElementById('notesInput').value.trim().toUpperCase().split(/\s+/).filter(Boolean);
  const grid = document.getElementById('noteGrid');
  grid.innerHTML = '';
  syllables.forEach((syl, i) => {
    const box = document.createElement('div');
    box.className = 'note-box';
    const noteSpan = document.createElement('span');
    noteSpan.className = 'note-box__note';
    noteSpan.textContent = notes[i] ?? '—';
    const sylSpan = document.createElement('span');
    sylSpan.className = 'note-box__syl';
    sylSpan.textContent = syl;
    box.appendChild(noteSpan);
    box.appendChild(sylSpan);
    grid.appendChild(box);
  });
}

document.getElementById('syllablesInput').addEventListener('input', updateNoteGrid);
document.getElementById('notesInput').addEventListener('input', updateNoteGrid);
updateNoteGrid();

document.getElementById('singBtn').addEventListener('click', () => {
  const rawSyl  = document.getElementById('syllablesInput').value.trim().toLowerCase();
  const rawNote = document.getElementById('notesInput').value.trim();
  const tempo   = parseInt(tempoInput.value) || 120;
  
  if (!rawSyl) {
    document.getElementById('status').textContent = 'error: no syllables entered';
    return;
  }

  const syllables = rawSyl.split(/\s+/).filter(Boolean);
  
  // Parse notes with optional velocity (e.g., "C5" or "C5:80")
  const noteParts = rawNote.toUpperCase().split(/\s+/).filter(Boolean);
  const notes = [];
  const velocities = [];
  noteParts.forEach(n => {
    const match = n.match(/^([A-G]#?\d+)(?::(\d+))?$/);
    if (match) {
      notes.push(match[1]);
      velocities.push(match[2] ? parseInt(match[2]) : 100); // Default velocity 100
    }
  });
  
  if (!syllables.length) {
    document.getElementById('status').textContent = 'error: could not parse syllables';
    return;
  }

  sing(syllables, notes, velocities, tempo);
});

document.getElementById('stopBtn').addEventListener('click', stopAudio);

const sourceToggle = document.getElementById('sourceToggle');
sourceToggle.addEventListener('click', () => {
  const next = getSourceType() === 'synth' ? 'voice' : 'synth';
  setSourceType(next);
  sourceToggle.textContent = next === 'synth' ? '[SYNTH] / VOICE' : 'SYNTH / [VOICE]';
  sourceToggle.dataset.mode = next;
});
