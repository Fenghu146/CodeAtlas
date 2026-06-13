// ============================================================
// Smell Detector - Detects code smells using graph analysis
// ============================================================
// Uses the code graph structure to identify architectural
// and design-level code smells that static analysis misses.

import { SQLiteStore } from '../store/sqlite-store.js';
import type { Symbol } from '../graph/types.js';

export interface CodeSmell {
  /** Type of smell */
  type: SmellType;
  /** Severity: error (must fix), warning (should fix), info (consider fixing) */
  severity: 'error' | 'warning' | 'info';
  /** Symbol(s) involved */
  symbols: Array<{ name: string; file: string; line: number }>;
  /** Description of the problem */
  description: string;
  /** Suggested refactoring */
  suggestion: string;
  /** Metrics that triggered this detection */
  metrics: Record<string, number>;
}

export type SmellType =
  | 'god-class'
  | 'feature-envy'
  | 'shotgun-surgery'
  | 'data-clumps'
  | 'long-parameter-list'
  | 'dead-code'
  | 'long-function'
  | 'cyclic-dependency'
  | 'high-coupling'
  | 'divergent-change';

/**
 * Detects code smells using graph structure analysis.
 * Goes beyond simple metrics to find design-level problems.
 */
export class SmellDetector {
  private store: SQLiteStore;

  constructor(store: SQLiteStore) {
    this.store = store;
  }

  /**
   * Run all smell detectors and return findings.
   */
  detect(): CodeSmell[] {
    const smells: CodeSmell[] = [];

    smells.push(...this.detectGodClass());
    smells.push(...this.detectFeatureEnvy());
    smells.push(...this.detectShotgunSurgery());
    smells.push(...this.detectDataClumps());
    smells.push(...this.detectLongParameterList());
    smells.push(...this.detectDeadCode());
    smells.push(...this.detectLongFunctions());
    smells.push(...this.detectHighCoupling());

    // Sort by severity
    const severityOrder = { error: 0, warning: 1, info: 2 };
    smells.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

    return smells;
  }

  /**
   * Detect a specific smell type.
   */
  detectType(type: SmellType): CodeSmell[] {
    switch (type) {
      case 'god-class': return this.detectGodClass();
      case 'feature-envy': return this.detectFeatureEnvy();
      case 'shotgun-surgery': return this.detectShotgunSurgery();
      case 'data-clumps': return this.detectDataClumps();
      case 'long-parameter-list': return this.detectLongParameterList();
      case 'dead-code': return this.detectDeadCode();
      case 'long-function': return this.detectLongFunctions();
      case 'high-coupling': return this.detectHighCoupling();
      default: return [];
    }
  }

  // ========================
  // Detectors
  // ========================

  /**
   * God Class: A class that does too much.
   * Detection: methods > 15 OR (methods > 10 AND callers > 8)
   */
  private detectGodClass(): CodeSmell[] {
    const smells: CodeSmell[] = [];
    const classes = this.store.searchSymbols('', { kind: 'class', limit: 10000 });

    for (const cls of classes) {
      // Count methods in this class
      const methods = this.store.getSymbolsByFile(cls.filePath)
        .filter(s => s.kind === 'method' && s.startLine >= cls.startLine && s.endLine <= cls.endLine);

      const callerCount = this.store.getCallers(cls.id).length;

      if (methods.length > 15 || (methods.length > 10 && callerCount > 8)) {
        smells.push({
          type: 'god-class',
          severity: methods.length > 20 ? 'error' : 'warning',
          symbols: [{ name: cls.name, file: cls.filePath, line: cls.startLine }],
          description: `Class "${cls.name}" has ${methods.length} methods and ${callerCount} callers — it's doing too much`,
          suggestion: 'Split into smaller classes with single responsibilities',
          metrics: { methods: methods.length, callers: callerCount },
        });
      }
    }

    return smells;
  }

  /**
   * Feature Envy: A function that uses another class's data more than its own.
   * Detection: function calls > 3 methods of a single other class
   */
  private detectFeatureEnvy(): CodeSmell[] {
    const smells: CodeSmell[] = [];
    const functions = this.store.searchSymbols('', { kind: 'function', limit: 10000 });
    const methods = this.store.searchSymbols('', { kind: 'method', limit: 10000 });
    const allFunctions = [...functions, ...methods];

    for (const func of allFunctions) {
      const callees = this.store.getCallees(func.id);
      if (callees.length < 3) continue;

      // Group callees by their containing class (via filePath)
      const byFile = new Map<string, Symbol[]>();
      for (const callee of callees) {
        if (callee.kind === 'method') {
          if (!byFile.has(callee.filePath)) byFile.set(callee.filePath, []);
          byFile.get(callee.filePath)!.push(callee);
        }
      }

      // Check if any single file has > 3 calls
      for (const [file, fileMethods] of byFile) {
        if (fileMethods.length >= 3 && file !== func.filePath) {
          smells.push({
            type: 'feature-envy',
            severity: 'warning',
            symbols: [
              { name: func.name, file: func.filePath, line: func.startLine },
              { name: fileMethods[0].name, file, line: fileMethods[0].startLine },
            ],
            description: `Function "${func.name}" calls ${fileMethods.length} methods from ${file} — it may belong there`,
            suggestion: `Consider moving "${func.name}" to ${file} or extracting a new class`,
            metrics: { externalCalls: fileMethods.length, totalCallees: callees.length },
          });
          break; // One smell per function
        }
      }
    }

    return smells;
  }

  /**
   * Shotgun Surgery: A change requires modifying many unrelated files.
   * Detection: A symbol's callers are spread across > 4 different files
   */
  private detectShotgunSurgery(): CodeSmell[] {
    const smells: CodeSmell[] = [];
    const allSymbols = this.store.searchSymbols('', { limit: 10000 });

    for (const symbol of allSymbols) {
      const callers = this.store.getCallers(symbol.id);
      if (callers.length < 3) continue;

      const uniqueFiles = new Set(callers.map(c => c.filePath));
      if (uniqueFiles.size >= 4) {
        smells.push({
          type: 'shotgun-surgery',
          severity: 'warning',
          symbols: [{ name: symbol.name, file: symbol.filePath, line: symbol.startLine }],
          description: `Changing "${symbol.name}" requires updating ${callers.length} callers across ${uniqueFiles.size} files`,
          suggestion: 'Consider using the Strategy pattern or extracting a facade to centralize changes',
          metrics: { callers: callers.length, files: uniqueFiles.size },
        });
      }
    }

    return smells;
  }

  /**
   * Data Clumps: Groups of parameters that always appear together.
   * Detection: 3+ functions share 3+ same parameter types
   */
  private detectDataClumps(): CodeSmell[] {
    // Simplified: detect functions with > 5 parameters as a proxy
    const smells: CodeSmell[] = [];
    const functions = this.store.searchSymbols('', { kind: 'function', limit: 10000 });
    const methods = this.store.searchSymbols('', { kind: 'method', limit: 10000 });

    for (const func of [...functions, ...methods]) {
      if (!func.sourceCode) continue;

      // Count parameters (rough heuristic: count commas in first line of params)
      const paramMatch = func.sourceCode.match(/\(([^)]+)\)/);
      if (paramMatch) {
        const params = paramMatch[1].split(',').filter(p => p.trim().length > 0);
        if (params.length >= 6) {
          smells.push({
            type: 'data-clumps',
            severity: 'info',
            symbols: [{ name: func.name, file: func.filePath, line: func.startLine }],
            description: `Function "${func.name}" has ${params.length} parameters — consider grouping them into an object`,
            suggestion: 'Create a parameter object or options type',
            metrics: { parameterCount: params.length },
          });
        }
      }
    }

    return smells;
  }

  /**
   * Long Parameter List: Functions with too many parameters.
   * Detection: parameter count > 5
   */
  private detectLongParameterList(): CodeSmell[] {
    return this.detectDataClumps().filter(s => s.type === 'data-clumps');
  }

  /**
   * Dead Code: Symbols that are never called or referenced.
   * Detection path 1: non-exported symbol with 0 callers -> strongly suspicious (warning)
   * Detection path 2: exported symbol with 0 callers and not an API pattern -> may be unused (info)
   */
  private detectDeadCode(): CodeSmell[] {
    const smells: CodeSmell[] = [];
    const allSymbols = this.store.searchSymbols('', { limit: 10000 });

    for (const symbol of allSymbols) {
      // Skip interfaces, types, and namespaces — they don't get "called"
      if (symbol.kind === 'interface' || symbol.kind === 'type' || symbol.kind === 'namespace') continue;

      const callers = this.store.getCallers(symbol.id);

      // Only check callers (not callees) — a function that calls others but is never called IS dead code
      if (callers.length > 0) continue;

      if (!symbol.exported) {
        // Non-exported with 0 callers = strong dead code evidence
        smells.push({
          type: 'dead-code',
          severity: 'warning',
          symbols: [{ name: symbol.name, file: symbol.filePath, line: symbol.startLine }],
          description: `"${symbol.name}" is not exported and has no callers — likely dead code`,
          suggestion: 'Remove this symbol if no longer needed',
          metrics: { callers: 0 },
        });
      } else if (symbol.exported && !this.isApiPattern(symbol.name, symbol.filePath)) {
        // Exported with 0 callers — may be an external API entry point
        smells.push({
          type: 'dead-code',
          severity: 'info',
          symbols: [{ name: symbol.name, file: symbol.filePath, line: symbol.startLine }],
          description: `"${symbol.name}" is exported but has no internal callers — verify if used externally`,
          suggestion: 'If this is a public API, add a comment marker (e.g., @public); otherwise remove it',
          metrics: { callers: 0 },
        });
      }
    }

    return smells;
  }

  /**
   * Lightweight heuristic to detect common API/symbol patterns that are meant
   * to be consumed externally (not by internal code).
   */
  private isApiPattern(name: string, filePath: string): boolean {
    // Common API entry-point naming patterns
    const apiNamePatterns = [
      /^create[A-Z]/, /^make[A-Z]/, /^build[A-Z]/, /^new[A-Z]/,
      /^get[A-Z]/, /^set[A-Z]/, /^is[A-Z]/, /^has[A-Z]/, /^to[A-Z]/, /^from[A-Z]/,
      /^on[A-Z]/, /^handle[A-Z]/, /^render[A-Z]/, /^connect[A-Z]/,
      /Factory$/, /Provider$/, /Handler$/, /Controller$/, /Service$/,
      /^main$/, /^init_/, /^setup_/, /^configure/, /^bootstrap/,
      /^app$/, /^server$/, /^router$/, /^middleware/, /^plugin/,
      /^define/, /^register/, /^mount/, /^listen/, /^start/, /^run$/,
      /^exports\./, /^module\.exports/,
    ];

    if (apiNamePatterns.some(p => p.test(name))) return true;

    // Path-based hints: files in typical API/module entry directories
    const apiPathPatterns = [
      /\/index\./, /\/main\./, /\/app\./, /\/server\./,
      /\/api\//, /\/routes\//, /\/controllers\//,
      /\/public\//, /\/exports\//,
    ];

    if (apiPathPatterns.some(p => p.test(filePath))) return true;

    return false;
  }

  /**
   * Long Function / Giant Class: Functions or classes that exceed line thresholds.
   * Detection: function > 100 lines, class > 300 lines, method > 80 lines.
   */
  private detectLongFunctions(): CodeSmell[] {
    const smells: CodeSmell[] = [];
    const allSymbols = this.store.searchSymbols('', { limit: 10000 });
    const LINE_THRESHOLDS: Record<string, { soft: number; hard: number }> = {
      function: { soft: 100, hard: 200 },
      method: { soft: 80, hard: 150 },
      class: { soft: 300, hard: 500 },
      module: { soft: 200, hard: 400 },
    };

    for (const symbol of allSymbols) {
      if (!symbol.sourceCode) continue;
      const lines = symbol.sourceCode.split('\n').length;
      const threshold = LINE_THRESHOLDS[symbol.kind];
      if (!threshold) continue;

      if (lines > threshold.hard) {
        smells.push({
          type: 'long-function',
          severity: 'error',
          symbols: [{ name: symbol.name, file: symbol.filePath, line: symbol.startLine }],
          description: `"${symbol.name}" (${symbol.kind}) is ${lines} lines — far exceeds ${threshold.hard}-line limit, consider extracting smaller functions`,
          suggestion: 'Extract cohesive blocks into separate functions/modules',
          metrics: { lines, limit: threshold.hard },
        });
      } else if (lines > threshold.soft) {
        smells.push({
          type: 'long-function',
          severity: 'warning',
          symbols: [{ name: symbol.name, file: symbol.filePath, line: symbol.startLine }],
          description: `"${symbol.name}" (${symbol.kind}) is ${lines} lines (threshold: ${threshold.soft}) — consider refactoring`,
          suggestion: 'Break down into smaller focused functions',
          metrics: { lines, limit: threshold.soft },
        });
      }
    }

    return smells;
  }

  /**
   * High Coupling: Symbols with too many dependencies.
   * Detection: callees > 10
   */
  private detectHighCoupling(): CodeSmell[] {
    const smells: CodeSmell[] = [];
    const allSymbols = this.store.searchSymbols('', { limit: 10000 });

    for (const symbol of allSymbols) {
      const callees = this.store.getCallees(symbol.id);
      if (callees.length > 10) {
        smells.push({
          type: 'high-coupling',
          severity: 'warning',
          symbols: [{ name: symbol.name, file: symbol.filePath, line: symbol.startLine }],
          description: `"${symbol.name}" depends on ${callees.length} other symbols — too many dependencies`,
          suggestion: 'Reduce dependencies by applying Dependency Inversion or extracting interfaces',
          metrics: { dependencies: callees.length },
        });
      }
    }

    return smells;
  }
}
