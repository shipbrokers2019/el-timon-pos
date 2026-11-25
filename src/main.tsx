import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './index.css';

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('No se encontró el elemento #root para iniciar Brisa POS.');
}

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
