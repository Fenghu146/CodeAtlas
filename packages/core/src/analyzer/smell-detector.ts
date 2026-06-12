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
    const classes = this.store.searchSymbols('', { kind: 'class', limit: 500 });

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
    const functions = this.store.searchSymbols('', { kind: 'function', limit: 200 });
    const methods = this.store.searchSymbols('', { kind: 'method', limit: 500 });
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
    const allSymbols = this.store.searchSymbols('', { limit: 500 });

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
    const functions = this.store.searchSymbols('', { kind: 'function', limit: 200 });
    const methods = this.store.searchSymbols('', { kind: 'method', limit: 500 });

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
   * Detection: exported symbol with 0 callers and 0 callees
   */
  private detectDeadCode(): CodeSmell[] {
    const smells: CodeSmell[] = [];
    const exported = this.store.searchSymbols('', { limit: 1000 }).filter(s => s.exported);

    for (const symbol of exported) {
      const callers = this.store.getCallers(symbol.id);
      const callees = this.store.getCallees(symbol.id);

      // If exported but never called and doesn't call anything, it's suspicious
      if (callers.length === 0 && callees.length === 0 && symbol.kind !== 'interface' && symbol.kind !== 'type') {
        smells.push({
          type: 'dead-code',
          severity: 'info',
          symbols: [{ name: symbol.name, file: symbol.filePath, line: symbol.startLine }],
          description: `"${symbol.name}" is exported but has no callers — it may be unused`,
          suggestion: 'Verify if this symbol is used externally; remove if dead code',
          metrics: { callers: 0, callees: 0 },
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
    const allSymbols = this.store.searchSymbols('', { limit: 500 });

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
