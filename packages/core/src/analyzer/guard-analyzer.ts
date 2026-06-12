// ============================================================
// Guard Analyzer - CI/CD gate checks
// ============================================================
// Enforces architecture rules: max impact depth, circular deps,
// layer violations. Returns pass/fail with detailed report.

import { SQLiteStore } from '../store/sqlite-store.js';
import { ImpactAnalyzer } from './impact-analyzer.js';
import { DepAnalyzer } from './dep-analyzer.js';
import type { Symbol, Layer } from '../graph/types.js';
import type { ArchitectureRule } from '../config/config-loader.js';

export interface GuardConfig {
  /** Maximum allowed impact depth for any change */
  maxImpactDepth?: number;
  /** Fail if circular dependencies are detected */
  forbidCircular?: boolean;
  /** Forbidden layer transitions (e.g., "data→interface") */
  forbiddenTransitions?: Array<{ from: Layer; to: Layer }>;
  /** Max complexity for any single symbol */
  maxComplexity?: number;
  /** Max callers for any single symbol (coupling threshold) */
  maxCallers?: number;
  /** Custom architecture rules from config */
  customRules?: ArchitectureRule[];
}

export interface GuardViolation {
  /** Rule that was violated */
  rule: string;
  /** Severity: error (blocks), warning (advisory) */
  severity: 'error' | 'warning';
  /** Human-readable message */
  message: string;
  /** Symbol involved (if applicable) */
  symbolId?: string;
  /** File involved (if applicable) */
  file?: string;
}

export interface GuardResult {
  /** Whether all checks passed */
  passed: boolean;
  /** All violations found */
  violations: GuardViolation[];
  /** Summary text */
  summary: string;
}

const DEFAULT_CONFIG: GuardConfig = {
  maxImpactDepth: 3,
  forbidCircular: true,
  forbiddenTransitions: [
    { from: 'data', to: 'interface' },
    { from: 'utility', to: 'business' },
    { from: 'utility', to: 'interface' },
  ],
  maxComplexity: 50,
  maxCallers: 20,
};

/**
 * Enforces architecture rules as a CI gate.
 * Returns pass/fail with detailed violation report.
 */
export class GuardAnalyzer {
  private store: SQLiteStore;
  private config: GuardConfig;

  constructor(store: SQLiteStore, config?: GuardConfig) {
    this.store = store;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Run all guard checks.
   */
  check(): GuardResult {
    const violations: GuardViolation[] = [];

    // 1. Check for circular dependencies
    if (this.config.forbidCircular) {
      violations.push(...this.checkCircularDeps());
    }

    // 2. Check layer violations
    if (this.config.forbiddenTransitions && this.config.forbiddenTransitions.length > 0) {
      violations.push(...this.checkLayerViolations());
    }

    // 3. Check complexity thresholds
    if (this.config.maxComplexity) {
      violations.push(...this.checkComplexity());
    }

    // 4. Check coupling thresholds
    if (this.config.maxCallers) {
      violations.push(...this.checkCoupling());
    }

    // 5. Check custom architecture rules
    if (this.config.customRules && this.config.customRules.length > 0) {
      violations.push(...this.checkCustomRules());
    }

    const passed = violations.filter(v => v.severity === 'error').length === 0;
    const summary = this.buildSummary(passed, violations);

    return { passed, violations, summary };
  }

  /**
   * Check impact depth for a specific set of changed files.
   */
  checkImpact(changedFiles: string[]): GuardViolation[] {
    const violations: GuardViolation[] = [];
    const maxDepth = this.config.maxImpactDepth || 3;

    for (const file of changedFiles) {
      const symbols = this.store.getSymbolsByFile(file);
      for (const symbol of symbols) {
        const analyzer = new ImpactAnalyzer(this.store);
        const impact = analyzer.analyze(symbol.id, maxDepth + 1);

        if (impact && impact.indirect.length > 0) {
          const maxActualDepth = Math.max(...impact.indirect.map(i => i.depth));
          if (maxActualDepth > maxDepth) {
            violations.push({
              rule: 'max-impact-depth',
              severity: 'error',
              message: `${symbol.name} has impact depth ${maxActualDepth} (max allowed: ${maxDepth})`,
              symbolId: symbol.id,
              file: symbol.filePath,
            });
          }
        }
      }
    }

    return violations;
  }

  // ========================
  // Individual Checks
  // ========================

  private checkCircularDeps(): GuardViolation[] {
    const depAnalyzer = new DepAnalyzer(this.store, process.cwd());
    const result = depAnalyzer.analyze();

    return result.circular.map(c => ({
      rule: 'no-circular-deps',
      severity: 'error' as const,
      message: `Circular dependency: ${c.chain.join(' → ')}`,
    }));
  }

  private checkLayerViolations(): GuardViolation[] {
    const violations: GuardViolation[] = [];
    const forbidden = this.config.forbiddenTransitions || [];

    const allSymbols = this.store.searchSymbols('', { limit: 10000 });

    for (const symbol of allSymbols) {
      const rels = this.store.getRelationshipsFrom(symbol.id);
      for (const rel of rels) {
        const target = this.store.getSymbol(rel.targetId);
        if (!target) continue;

        // Check if this transition is forbidden
        for (const rule of forbidden) {
          if (symbol.layer === rule.from && target.layer === rule.to) {
            violations.push({
              rule: 'layer-violation',
              severity: 'error',
              message: `${symbol.layer} layer (${symbol.name}) depends on ${target.layer} layer (${target.name})`,
              symbolId: symbol.id,
              file: symbol.filePath,
            });
          }
        }
      }
    }

    return violations;
  }

  private checkComplexity(): GuardViolation[] {
    const violations: GuardViolation[] = [];
    const max = this.config.maxComplexity || 50;

    const allSymbols = this.store.searchSymbols('', { limit: 10000 });

    for (const symbol of allSymbols) {
      if (symbol.complexity && symbol.complexity > max) {
        violations.push({
          rule: 'max-complexity',
          severity: 'warning',
          message: `${symbol.name} has complexity ${symbol.complexity} (max: ${max})`,
          symbolId: symbol.id,
          file: symbol.filePath,
        });
      }
    }

    return violations;
  }

  private checkCoupling(): GuardViolation[] {
    const violations: GuardViolation[] = [];
    const max = this.config.maxCallers || 20;

    const allSymbols = this.store.searchSymbols('', { limit: 10000 });

    for (const symbol of allSymbols) {
      const callers = this.store.getCallers(symbol.id);
      if (callers.length > max) {
        violations.push({
          rule: 'max-coupling',
          severity: 'warning',
          message: `${symbol.name} has ${callers.length} callers (max: ${max}) — high coupling`,
          symbolId: symbol.id,
          file: symbol.filePath,
        });
      }
    }

    return violations;
  }

  /**
   * Check custom architecture rules from config.
   */
  private checkCustomRules(): GuardViolation[] {
    const violations: GuardViolation[] = [];
    const rules = this.config.customRules || [];
    const allSymbols = this.store.searchSymbols('', { limit: 10000 });

    for (const rule of rules) {
      if (rule.forbid) {
        // Check forbidden dependencies
        const { from, to } = rule.forbid;
        for (const symbol of allSymbols) {
          // Check if symbol matches "from" pattern
          if (!this.matchesPattern(symbol, from)) continue;

          // Check if any of its callees match "to" pattern
          const callees = this.store.getCallees(symbol.id);
          for (const callee of callees) {
            if (this.matchesPattern(callee, to)) {
              violations.push({
                rule: `custom:${rule.name}`,
                severity: 'error',
                message: `${rule.description}: ${symbol.name} cannot depend on ${callee.name}`,
                symbolId: symbol.id,
                file: symbol.filePath,
              });
            }
          }
        }
      }

      if (rule.maxCallers) {
        for (const symbol of allSymbols) {
          if (!this.matchesPattern(symbol, rule.forbid?.from || '*')) continue;
          const callers = this.store.getCallers(symbol.id);
          if (callers.length > rule.maxCallers) {
            violations.push({
              rule: `custom:${rule.name}`,
              severity: 'warning',
              message: `${rule.description}: ${symbol.name} has ${callers.length} callers (max: ${rule.maxCallers})`,
              symbolId: symbol.id,
              file: symbol.filePath,
            });
          }
        }
      }

      if (rule.maxCallees) {
        for (const symbol of allSymbols) {
          if (!this.matchesPattern(symbol, rule.forbid?.from || '*')) continue;
          const callees = this.store.getCallees(symbol.id);
          if (callees.length > rule.maxCallees) {
            violations.push({
              rule: `custom:${rule.name}`,
              severity: 'warning',
              message: `${rule.description}: ${symbol.name} calls ${callees.length} symbols (max: ${rule.maxCallees})`,
              symbolId: symbol.id,
              file: symbol.filePath,
            });
          }
        }
      }

      if (rule.maxComplexity) {
        for (const symbol of allSymbols) {
          if (!this.matchesPattern(symbol, rule.forbid?.from || '*')) continue;
          if (symbol.complexity && symbol.complexity > rule.maxComplexity) {
            violations.push({
              rule: `custom:${rule.name}`,
              severity: 'warning',
              message: `${rule.description}: ${symbol.name} has complexity ${symbol.complexity} (max: ${rule.maxComplexity})`,
              symbolId: symbol.id,
              file: symbol.filePath,
            });
          }
        }
      }
    }

    return violations;
  }

  /**
   * Check if a symbol matches a pattern (layer or file glob).
   */
  private matchesPattern(symbol: Symbol, pattern: string): boolean {
    // Layer match
    if (symbol.layer === pattern) return true;

    // File path glob match (simple)
    if (pattern.includes('*') || pattern.includes('/')) {
      const regex = new RegExp('^' + pattern.replace(/\*/g, '.*').replace(/\//g, '\\/') + '$');
      return regex.test(symbol.filePath);
    }

    // Name match
    if (symbol.name.includes(pattern)) return true;

    return false;
  }

  private buildSummary(passed: boolean, violations: GuardViolation[]): string {
    const parts: string[] = [];

    if (passed) {
      parts.push('✅ All architecture checks passed!');
    } else {
      parts.push('❌ Architecture checks FAILED');
    }

    parts.push('═'.repeat(40));

    const errors = violations.filter(v => v.severity === 'error');
    const warnings = violations.filter(v => v.severity === 'warning');

    if (errors.length > 0) {
      parts.push(`\n🚫 Errors (${errors.length}):`);
      for (const v of errors) {
        parts.push(`  [${v.rule}] ${v.message}`);
      }
    }

    if (warnings.length > 0) {
      parts.push(`\n⚠️  Warnings (${warnings.length}):`);
      for (const v of warnings) {
        parts.push(`  [${v.rule}] ${v.message}`);
      }
    }

    if (violations.length === 0) {
      parts.push('\nNo violations found.');
    }

    return parts.join('\n');
  }
}
