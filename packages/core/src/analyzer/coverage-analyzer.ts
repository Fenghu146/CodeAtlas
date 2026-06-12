// ============================================================
// Coverage Analyzer - Test coverage mapping
// ============================================================

import { SQLiteStore } from '../store/sqlite-store.js';
import type { Symbol } from '../graph/types.js';

export interface CoverageInfo {
  symbol: Symbol;
  hasTest: boolean;
  testFiles: string[];
  testSymbolNames: string[];
  coverageScore: number; // 0-1
}

export interface CoverageReport {
  totalSymbols: number;
  coveredSymbols: number;
  coveragePercent: number;
  uncoveredByLayer: Record<string, Symbol[]>;
  uncoveredByKind: Record<string, Symbol[]>;
  coverageDetails: CoverageInfo[];
}

/**
 * Maps symbols to their test coverage
 */
export class CoverageAnalyzer {
  private store: SQLiteStore;
  private testPatterns = [
    /test[_\-]/i,
    /[_\-]test/i,
    /\.test\./,
    /\.spec\./,
    /__tests__\//,
    /test__/,
  ];

  constructor(store: SQLiteStore) {
    this.store = store;
  }

  /**
   * Analyze test coverage for all exported symbols
   */
  analyze(): CoverageReport {
    const allSymbols = this.store.searchSymbols('', { limit: 10000 });

    // Find test files
    const testFiles = new Set<string>();
    const nonTestSymbols: Symbol[] = [];

    for (const symbol of allSymbols) {
      if (this.isTestFile(symbol.filePath)) {
        testFiles.add(symbol.filePath);
      } else if (symbol.exported) {
        nonTestSymbols.push(symbol);
      }
    }

    // Analyze coverage for each exported symbol
    const coverageDetails: CoverageInfo[] = [];
    const uncoveredByLayer: Record<string, Symbol[]> = {};
    const uncoveredByKind: Record<string, Symbol[]> = {};

    for (const symbol of nonTestSymbols) {
      const coverage = this.analyzeSymbolCoverage(symbol, testFiles, allSymbols);
      coverageDetails.push(coverage);

      if (!coverage.hasTest) {
        // Track uncovered by layer
        if (!uncoveredByLayer[symbol.layer]) {
          uncoveredByLayer[symbol.layer] = [];
        }
        uncoveredByLayer[symbol.layer].push(symbol);

        // Track uncovered by kind
        if (!uncoveredByKind[symbol.kind]) {
          uncoveredByKind[symbol.kind] = [];
        }
        uncoveredByKind[symbol.kind].push(symbol);
      }
    }

    const coveredSymbols = coverageDetails.filter(c => c.hasTest).length;
    const coveragePercent = nonTestSymbols.length > 0
      ? Math.round((coveredSymbols / nonTestSymbols.length) * 100)
      : 0;

    return {
      totalSymbols: nonTestSymbols.length,
      coveredSymbols,
      coveragePercent,
      uncoveredByLayer,
      uncoveredByKind,
      coverageDetails,
    };
  }

  /**
   * Analyze coverage for a single symbol
   */
  private analyzeSymbolCoverage(
    symbol: Symbol,
    testFiles: Set<string>,
    allSymbols: Symbol[],
  ): CoverageInfo {
    const testSymbolNames: string[] = [];
    const testFilesList: string[] = [];

    // Strategy 1: Check for test file with matching name
    const expectedTestPatterns = [
      `${symbol.name}.test.`,
      `${symbol.name}.spec.`,
      `test_${symbol.name}.`,
      `${symbol.name}_test.`,
    ];

    for (const testFile of testFiles) {
      for (const pattern of expectedTestPatterns) {
        if (testFile.includes(pattern)) {
          testFilesList.push(testFile);
          break;
        }
      }
    }

    // Strategy 2: Check for test symbols that reference this symbol
    for (const testSymbol of allSymbols) {
      if (!this.isTestFile(testSymbol.filePath)) continue;

      // Check if test symbol name contains the target symbol name
      if (testSymbol.name.toLowerCase().includes(symbol.name.toLowerCase())) {
        testSymbolNames.push(testSymbol.name);
        if (!testFilesList.includes(testSymbol.filePath)) {
          testFilesList.push(testSymbol.filePath);
        }
      }

      // Check if test symbol source code references the target
      if (testSymbol.sourceCode?.includes(symbol.name)) {
        if (!testSymbolNames.includes(testSymbol.name)) {
          testSymbolNames.push(testSymbol.name);
        }
        if (!testFilesList.includes(testSymbol.filePath)) {
          testFilesList.push(testSymbol.filePath);
        }
      }
    }

    const hasTest = testFilesList.length > 0 || testSymbolNames.length > 0;

    return {
      symbol,
      hasTest,
      testFiles: testFilesList,
      testSymbolNames,
      coverageScore: hasTest ? 1 : 0,
    };
  }

  /**
   * Check if a file is a test file
   */
  private isTestFile(filePath: string): boolean {
    return this.testPatterns.some(pattern => pattern.test(filePath));
  }

  /**
   * Format coverage report
   */
  static formatReport(report: CoverageReport): string {
    const lines: string[] = [];

    lines.push('📊 Test Coverage Report');
    lines.push('═'.repeat(50));
    lines.push(`Total exported symbols: ${report.totalSymbols}`);
    lines.push(`Covered by tests: ${report.coveredSymbols}`);
    lines.push(`Coverage: ${report.coveragePercent}%`);
    lines.push('');

    // Coverage bar
    const filled = Math.round(report.coveragePercent / 5);
    const empty = 20 - filled;
    lines.push(`[${'█'.repeat(filled)}${'░'.repeat(empty)}] ${report.coveragePercent}%`);
    lines.push('');

    // Uncovered by layer
    if (Object.keys(report.uncoveredByLayer).length > 0) {
      lines.push('⚠️  Uncovered by Layer:');
      for (const [layer, symbols] of Object.entries(report.uncoveredByLayer)) {
        lines.push(`  ${layer}: ${symbols.length} symbols`);
        for (const s of symbols.slice(0, 3)) {
          lines.push(`    - ${s.name} @ ${s.filePath}:${s.startLine}`);
        }
        if (symbols.length > 3) {
          lines.push(`    ... and ${symbols.length - 3} more`);
        }
      }
      lines.push('');
    }

    // Uncovered by kind
    if (Object.keys(report.uncoveredByKind).length > 0) {
      lines.push('📋 Uncovered by Kind:');
      for (const [kind, symbols] of Object.entries(report.uncoveredByKind)) {
        lines.push(`  ${kind}: ${symbols.length}`);
      }
    }

    return lines.join('\n');
  }
}
