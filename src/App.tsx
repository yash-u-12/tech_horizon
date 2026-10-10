import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, CheckCircle2, Info, OctagonAlert, X } from 'lucide-react';
import { Sidebar } from '@/components/Sidebar';
import { TopBar } from '@/components/TopBar';
import { useNexus } from '@/store/useNexus';
import { CommandCenter } from '@/pages/CommandCenter';
import { Fleet } from '@/pages/Fleet';
import { Tasks } from '@/pages/Tasks';
import { CommunicationNoc } from '@/pages/CommunicationNoc';
import { DigitalTwin } from '@/pages/DigitalTwin';
import { Experiments } from '@/pages/Experiments';
import { SystemPage } from '@/pages/System';
import { useEffect } from 'react';
import { runtime } from '@/simulation/runtime';

const PAGES = {
  COMMAND: CommandCenter,
  FLEET: Fleet,
  TASKS: Tasks,
  COMMS: CommunicationNoc,
  TWIN: DigitalTwin,
  EXPERIMENTS: Experiments,
  SYSTEM: SystemPage,
};

export default function App() {
  const page = useNexus((s) => s.page);
  const toast = useNexus((s) => s.toast);
  const notify = useNexus((s) => s.notify);
  const clickMode = useNexus((s) => s.clickMode);
  const setClickMode = useNexus((s) => s.setClickMode);
  const Page = PAGES[page];

  // ESC leaves any click-to-place mode
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (useNexus.getState().bindingFor) useNexus.getState().closeBinding();
        if (useNexus.getState().clickMode !== 'SELECT') setClickMode('SELECT');
        if (useNexus.getState().selectedRobot) useNexus.getState().selectRobot(null);
      }
      if (e.key === ' ' && e.target === document.body) {
        e.preventDefault();
        runtime.engine.setRunning(!runtime.engine.running);
        runtime.emit();
        useNexus.getState().notify(runtime.engine.running ? 'SIMULATION RESUMED' : 'SIMULATION PAUSED');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setClickMode]);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-void text-txt">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <div className="relative flex min-h-0 flex-1 flex-col">
          <Page key={page} />
        </div>
      </div>

      {/* ── toast ──────────────────────────────────────────────────────────── */}
      <AnimatePresence>
        {toast && toast.message && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.15 }}
            className="pointer-events-none fixed left-1/2 top-[60px] z-[60] -translate-x-1/2"
          >
            <div
              className={
                toast.severity === 'CRITICAL'
                  ? 'flex items-center gap-2 rounded border border-danger/50 bg-panel px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-danger shadow-2xl'
                  : toast.severity === 'WARNING'
                    ? 'flex items-center gap-2 rounded border border-warn/50 bg-panel px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-warn shadow-2xl'
                    : toast.severity === 'SUCCESS'
                      ? 'flex items-center gap-2 rounded border border-ok/50 bg-panel px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-ok shadow-2xl'
                      : 'flex items-center gap-2 rounded border border-nav/50 bg-panel px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-nav shadow-2xl'
              }
            >
              {toast.severity === 'CRITICAL' ? (
                <OctagonAlert size={12} />
              ) : toast.severity === 'WARNING' ? (
                <AlertTriangle size={12} />
              ) : toast.severity === 'SUCCESS' ? (
                <CheckCircle2 size={12} />
              ) : (
                <Info size={12} />
              )}
              {toast.message}
              <button className="pointer-events-auto text-txt3 hover:text-txt" onClick={() => useNexus.getState().clearToast()}>
                <X size={11} />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {clickMode !== 'SELECT' && (
        <div className="pointer-events-none fixed bottom-0 left-0 right-0 z-40 flex justify-center pb-6">
          <div className="rounded border border-nav/40 bg-void/95 px-3 py-1 text-2xs font-semibold uppercase tracking-[0.12em] text-nav shadow-2xl">
            {clickMode === 'PLACE_OBSTACLE'
              ? 'CLICK THE FLOOR TO PLACE AN OBSTACLE · ROBOTS MUST PERCEIVE AND REPLAN AROUND IT'
              : 'CLICK A PICK LOCATION, THEN A DESTINATION · ESC TO CANCEL'}
          </div>
        </div>
      )}
    </div>
  );
}
