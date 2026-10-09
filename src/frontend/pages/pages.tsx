/**
 * Compatibility exports for the retired frontend page layout.
 *
 * The application now renders the page components from `src/pages` directly.
 * These wrappers preserve the old module's public names for any legacy imports.
 */
export { CommandCenter as CommandPage } from '../../pages/CommandCenter';
export { Fleet } from '../../pages/Fleet';
export { Tasks } from '../../pages/Tasks';
export { Communication } from '../../pages/Communication';
export { DigitalTwin } from '../../pages/DigitalTwin';
export { Experiments } from '../../pages/Experiments';
export { SystemPage } from '../../pages/System';

export { Fleet as FleetPage } from '../../pages/Fleet';
export { Tasks as TasksPage } from '../../pages/Tasks';
export { Communication as CommsPage } from '../../pages/Communication';
export { DigitalTwin as TwinPage } from '../../pages/DigitalTwin';
export { Experiments as ExperimentsPage } from '../../pages/Experiments';
