import { SQLiteStore } from '../../store/sqlite-store.js';
import { CoverageAnalyzer } from '../../analyzer/coverage-analyzer.js';
import type { AskOptions } from '../graph-copilot.js';
import type { Intent } from '../intents.js';
import type { FlowResult } from './_shared.js';
import { resolveTarget, toSymbolRefs } from './_shared.js';

export function flowTestCoverage(store: SQLiteStore, projectPath: string, intent: Intent, options: AskOptions, steps: string[]): FlowResult {
  steps.push('coverage');
  const target = resolveTarget(store, intent);
  const ca = new CoverageAnalyzer(store);
  if (target) {
    const report = ca.analyze();
    const detail = report.coverageDetails.find((c: any) => c.symbol.id === target.id);
    const symbols = toSymbolRefs([target]), conclusions: string[] = [], p: string[] = [];
    p.push('Test Coverage: "' + target.name + '"'); p.push(''.padEnd(40, '='));
    if (detail?.hasTest) { p.push('Has test coverage'); if (detail.testFiles.length) p.push('  Files: ' + detail.testFiles.join(', ')); conclusions.push('Covered by ' + detail.testFiles.length + ' file(s)'); }
    else { p.push('No test coverage detected'); conclusions.push('No test coverage'); }
    return { answer: p.join('\n'), symbols, conclusions };
  }
  const report = ca.analyze();
  const symbols: Array<any> = [], conclusions: string[] = [], p: string[] = [];
  p.push('Project Test Coverage'); p.push(''.padEnd(40, '='));
  p.push('Exported symbols: ' + report.totalSymbols); p.push('Covered: ' + report.coveredSymbols);
  const filled = Math.round(report.coveragePercent / 5), empty = 20 - filled;
  p.push('[' + '|'.repeat(filled) + '.'.repeat(empty) + '] ' + report.coveragePercent + '%');
  const uncovered = report.coverageDetails.filter((c: any) => !c.hasTest).slice(0, 10);
  if (uncovered.length) {
    p.push('\nUncovered:');
    for (const u of uncovered) { p.push('  ' + u.symbol.name + ' @ ' + u.symbol.filePath); symbols.push({ name: u.symbol.name, kind: u.symbol.kind, file: u.symbol.filePath, id: u.symbol.id }); }
  }
  conclusions.push(report.coveragePercent + '% coverage');
  return { answer: p.join('\n'), symbols, conclusions };
}
