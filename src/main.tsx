import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { runtime } from './simulation/runtime';

// The simulation starts before React mounts so the warehouse is already alive
// on the first frame the operator sees.
runtime.start();

const boot = document.getElementById('boot');
if (boot) boot.remove();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
