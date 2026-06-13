import { SQLiteStore } from '../../store/sqlite-store.js';
import type { AskOptions } from '../graph-copilot.js';
import type { Intent } from '../intents.js';
import type { FlowResult } from './_shared.js';
import { resolveTarget } from './_shared.js';
import { flowUnderstand } from './understand.js';
import { flowFindCode } from './findCode.js';

export function flowFreeForm(store: SQLiteStore, projectPath: string, intent: Intent, options: AskOptions, steps: string[]): FlowResult {
  const target = resolveTarget(store, intent);
  if (target) return flowUnderstand(store, projectPath, intent, options, steps);
  return flowFindCode(store, projectPath, intent, options, steps);
}
