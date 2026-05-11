import { getAnalyser, getAudioCtx } from './audioGraph.js';

const canvas       = document.getElementById('fftCanvas');
const ctx2d        = canvas.getContext('2d');
const W            = canvas.width;
const H            = canvas.height;
const MAX_VIZ_FREQ = 5500; // Hz — upper bound, comfortably above F3

function drawFFT() {
  requestAnimationFrame(drawFFT);

  ctx2d.fillStyle = '#090d12';
  ctx2d.fillRect(0, 0, W, H);

  // Frequency grid lines and labels
  ctx2d.lineWidth   = 1;
  ctx2d.strokeStyle = '#18303a';
  ctx2d.fillStyle   = '#2a5055';
  ctx2d.font        = '9px Courier New';
  for (const f of [500, 1000, 2000, 3000, 4000, 5000]) {
    const x = Math.round((f / MAX_VIZ_FREQ) * W) + 0.5;
    ctx2d.beginPath();
    ctx2d.moveTo(x, 0);
    ctx2d.lineTo(x, H);
    ctx2d.stroke();
    ctx2d.fillText(f >= 1000 ? `${f / 1000}k` : `${f}`, x + 3, H - 4);
  }

  const analyser = getAnalyser();
  if (!analyser) return;

  const bins    = analyser.frequencyBinCount;
  const data    = new Uint8Array(bins);
  analyser.getByteFrequencyData(data);
  const nyquist = getAudioCtx().sampleRate / 2;

  // Filled gradient beneath the spectrum curve
  const grad = ctx2d.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0,   '#2dd4bf70');
  grad.addColorStop(0.6, '#2dd4bf18');
  grad.addColorStop(1,   '#2dd4bf00');

  ctx2d.beginPath();
  ctx2d.moveTo(0, H);
  for (let x = 0; x < W; x++) {
    const freq = (x / W) * MAX_VIZ_FREQ;
    const bin  = Math.min(Math.round((freq / nyquist) * bins), bins - 1);
    ctx2d.lineTo(x, H - (data[bin] / 255) * H);
  }
  ctx2d.lineTo(W, H);
  ctx2d.closePath();
  ctx2d.fillStyle = grad;
  ctx2d.fill();

  // Spectrum outline
  ctx2d.beginPath();
  ctx2d.strokeStyle = '#2dd4bf';
  ctx2d.lineWidth   = 1.5;
  for (let x = 0; x < W; x++) {
    const freq = (x / W) * MAX_VIZ_FREQ;
    const bin  = Math.min(Math.round((freq / nyquist) * bins), bins - 1);
    const y    = H - (data[bin] / 255) * H;
    x === 0 ? ctx2d.moveTo(x, y) : ctx2d.lineTo(x, y);
  }
  ctx2d.stroke();
}

export function startVisualizer() {
  drawFFT();
}
