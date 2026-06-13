// ============================================================
// Flow: Overview (delegates to Architecture)
// ============================================================

import { SQLiteStore } from '../../store/sqlite-store.js';
import type { AskOptions } from '../graph-copilot.js';
import type { Intent } from '../intents.js';
import type { FlowResult } from './_shared.js';
import { flowArchitecture } from './architecture.js';

export function flowOverview(
  store: SQLiteStore, projectPath: string,
  intent: Intent, options: AskOptions, steps: string[],
): FlowResult {
  return flowArchitecture(store, projectPath, intent, options, steps);
}
