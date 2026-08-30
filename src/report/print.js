// Print support: a "Print report" button plus a beforeprint hook that resets
// any zoomed/panned waveform canvases to the full recording, so the printed
// page always shows the whole trace regardless of on-screen viewport state.
import { resetViewport } from './waveform.js';

/** Build a print button that triggers window.print(). */
export function buildPrintButton() {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'ecg-btn ecg-no-print';
  btn.textContent = 'Print report';
  btn.addEventListener('click', () => window.print());
  return btn;
}

/** Wire beforeprint so waveform canvases print the full trace, not the current zoom. */
export function setupPrintLayout(container) {
  const onBeforePrint = () => {
    container.querySelectorAll('canvas').forEach((canvas) => {
      if (canvas.__ecgLastArgs) resetViewport(canvas);
    });
  };
  window.addEventListener('beforeprint', onBeforePrint);
  return () => window.removeEventListener('beforeprint', onBeforePrint);
}
