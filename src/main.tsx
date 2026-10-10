import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { runtime } from './simulation/runtime';
import { ensureFleetTelemetry } from './integrations/fleetPublisher';

// The simulation starts before React mounts so the warehouse is already alive
// on the first frame the operator sees. If Firebase is configured, the fleet
// digest then stays in sync at a 5-second cadence.
runtime.start();
ensureFleetTelemetry();

const boot = document.getElementById('boot');
if (boot) boot.remove();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
