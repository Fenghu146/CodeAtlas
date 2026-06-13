// ============================================================
// Flow: Embedded Linux Analysis
// ============================================================

import { SQLiteStore } from '../../store/sqlite-store.js';
import { EmbeddedAnalyzer } from '../../analyzer/embedded-analyzer.js';
import type { AskOptions } from '../graph-copilot.js';
import type { Intent } from '../intents.js';
import type { FlowResult } from './_shared.js';

export function flowEmbeddedLinux(
  store: SQLiteStore, projectPath: string,
  intent: Intent, options: AskOptions, steps: string[],
): FlowResult {
  steps.push('embedded-linux');
  try {
    const analyzer = new EmbeddedAnalyzer(store, projectPath, { profile: 'linux' } as any);
    const result = analyzer.analyze();
    if (!result.linux) return { answer: 'No embedded Linux artifacts detected.', symbols: [], conclusions: ['No embedded Linux'] };
    const linux = result.linux;
    const symbols = linux.drivers.map((d: any) => ({ name: d.name, kind: 'driver' as const, file: d.file, id: d.file + ':' + d.name + ':' + d.line }));
    const parts: string[] = [];
    parts.push('Embedded Linux Analysis');
    parts.push(linux.summary);
    return { answer: parts.join('\n'), symbols, conclusions: [linux.drivers.length + ' drivers, ' + linux.deviceTree.nodes.length + ' DTS nodes'] };
  } catch (err: any) {
    return { answer: 'Failed: ' + err.message, symbols: [], conclusions: ['Analysis failed'] };
  }
}
