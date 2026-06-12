// ============================================================
// Refactor Engine - Generates refactoring suggestions
// ============================================================
// Takes code smells detected by SmellDetector and generates
// actionable refactoring plans with risk assessment.

import { SQLiteStore } from '../store/sqlite-store.js';
import { ImpactAnalyzer } from './impact-analyzer.js';
import { SmellDetector, type CodeSmell, type SmellType } from './smell-detector.js';

export interface RefactorSuggestion {
  /** The original smell */
  smell: CodeSmell;
  /** Refactoring steps */
  steps: RefactorStep[];
  /** Risk level */
  risk: 'low' | 'medium' | 'high';
  /** Estimated effort */
  effort: 'quick' | 'moderate' | 'significant';
  /** Impact assessment */
  impact: {
    filesAffected: number;
    symbolsAffected: number;
  };
}

export interface RefactorStep {
  order: number;
  action: string;
  file: string;
  description: string;
}

export interface RefactorReport {
  /** All smells found */
  smells: CodeSmell[];
  /** All suggestions */
  suggestions: RefactorSuggestion[];
  /** Summary statistics */
  stats: {
    totalSmells: number;
    byType: Record<string, number>;
    bySeverity: Record<string, number>;
    totalSuggestions: number;
    quickFixes: number;
  };
  /** Summary text */
  summary: string;
}

/**
 * Generates refactoring suggestions from detected code smells.
 */
export class RefactorEngine {
  private store: SQLiteStore;
  private smellDetector: SmellDetector;
  private impactAnalyzer: ImpactAnalyzer;

  constructor(store: SQLiteStore) {
    this.store = store;
    this.smellDetector = new SmellDetector(store);
    this.impactAnalyzer = new ImpactAnalyzer(store);
  }

  /**
   * Detect smells and generate refactoring suggestions.
   */
  analyze(): RefactorReport {
    const smells = this.smellDetector.detect();
    const suggestions = smells.map(s => this.generateSuggestion(s));

    const stats = this.buildStats(smells, suggestions);
    const summary = this.buildSummary(smells, suggestions, stats);

    return { smells, suggestions, stats, summary };
  }

  /**
   * Detect a specific smell type and generate suggestions.
   */
  analyzeType(type: SmellType): RefactorReport {
    const smells = this.smellDetector.detectType(type);
    const suggestions = smells.map(s => this.generateSuggestion(s));

    const stats = this.buildStats(smells, suggestions);
    const summary = this.buildSummary(smells, suggestions, stats);

    return { smells, suggestions, stats, summary };
  }

  /**
   * Generate a suggestion for a specific smell.
   */
  generateSuggestion(smell: CodeSmell): RefactorSuggestion {
    const steps = this.generateSteps(smell);
    const risk = this.assessRisk(smell);
    const effort = this.estimateEffort(smell);
    const impact = this.assessImpact(smell);

    return { smell, steps, risk, effort, impact };
  }

  // ========================
  // Step Generation
  // ========================

  private generateSteps(smell: CodeSmell): RefactorStep[] {
    const steps: RefactorStep[] = [];
    let order = 1;

    switch (smell.type) {
      case 'god-class':
        steps.push({
          order: order++,
          action: 'Identify responsibilities',
          file: smell.symbols[0]?.file || '',
          description: 'List all responsibilities of this class and group related methods',
        });
        steps.push({
          order: order++,
          action: 'Extract new classes',
          file: smell.symbols[0]?.file || '',
          description: 'Create new classes for each identified responsibility',
        });
        steps.push({
          order: order++,
          action: 'Update callers',
          file: smell.symbols[0]?.file || '',
          description: 'Update all callers to use the new, smaller classes',
        });
        break;

      case 'feature-envy':
        steps.push({
          order: order++,
          action: 'Move method',
          file: smell.symbols[0]?.file || '',
          description: `Move "${smell.symbols[0]?.name}" to the class it's envious of`,
        });
        steps.push({
          order: order++,
          action: 'Update references',
          file: smell.symbols[0]?.file || '',
          description: 'Update all callers to use the new location',
        });
        break;

      case 'shotgun-surgery':
        steps.push({
          order: order++,
          action: 'Introduce facade',
          file: smell.symbols[0]?.file || '',
          description: 'Create a facade that centralizes the scattered logic',
        });
        steps.push({
          order: order++,
          action: 'Route through facade',
          file: smell.symbols[0]?.file || '',
          description: 'Update all callers to go through the new facade',
        });
        break;

      case 'dead-code':
        steps.push({
          order: order++,
          action: 'Verify usage',
          file: smell.symbols[0]?.file || '',
          description: 'Check if this symbol is used externally or in tests',
        });
        steps.push({
          order: order++,
          action: 'Remove if unused',
          file: smell.symbols[0]?.file || '',
          description: 'Delete the symbol and update any remaining references',
        });
        break;

      case 'high-coupling':
        steps.push({
          order: order++,
          action: 'Identify core dependencies',
          file: smell.symbols[0]?.file || '',
          description: 'Separate essential vs. optional dependencies',
        });
        steps.push({
          order: order++,
          action: 'Extract interfaces',
          file: smell.symbols[0]?.file || '',
          description: 'Create interfaces for the most-used dependencies',
        });
        steps.push({
          order: order++,
          action: 'Apply dependency inversion',
          file: smell.symbols[0]?.file || '',
          description: 'Depend on abstractions instead of concrete implementations',
        });
        break;

      default:
        steps.push({
          order: order++,
          action: 'Review and refactor',
          file: smell.symbols[0]?.file || '',
          description: smell.suggestion,
        });
    }

    return steps;
  }

  // ========================
  // Risk & Effort Assessment
  // ========================

  private assessRisk(smell: CodeSmell): RefactorSuggestion['risk'] {
    if (smell.severity === 'error') return 'high';
    if (smell.type === 'god-class' || smell.type === 'shotgun-surgery') return 'medium';
    if (smell.type === 'dead-code' || smell.type === 'long-parameter-list') return 'low';
    return 'medium';
  }

  private estimateEffort(smell: CodeSmell): RefactorSuggestion['effort'] {
    if (smell.type === 'dead-code') return 'quick';
    if (smell.type === 'long-parameter-list' || smell.type === 'data-clumps') return 'quick';
    if (smell.type === 'god-class') return 'significant';
    if (smell.type === 'shotgun-surgery') return 'significant';
    return 'moderate';
  }

  private assessImpact(smell: CodeSmell): RefactorSuggestion['impact'] {
    const primarySymbol = smell.symbols[0];
    if (!primarySymbol) return { filesAffected: 0, symbolsAffected: 0 };

    // Find symbol ID
    const allSymbols = this.store.searchSymbols(primarySymbol.name, { limit: 5 });
    const symbol = allSymbols.find(s => s.name === primarySymbol.name && s.filePath === primarySymbol.file);

    if (!symbol) return { filesAffected: 1, symbolsAffected: 1 };

    const impact = this.impactAnalyzer.analyze(symbol.id, 2);
    if (!impact) return { filesAffected: 1, symbolsAffected: 1 };

    return {
      filesAffected: impact.affectedFiles.length,
      symbolsAffected: impact.direct.length + impact.indirect.length,
    };
  }

  // ========================
  // Stats & Summary
  // ========================

  private buildStats(smells: CodeSmell[], suggestions: RefactorSuggestion[]): RefactorReport['stats'] {
    const byType: Record<string, number> = {};
    const bySeverity: Record<string, number> = {};

    for (const smell of smells) {
      byType[smell.type] = (byType[smell.type] || 0) + 1;
      bySeverity[smell.severity] = (bySeverity[smell.severity] || 0) + 1;
    }

    const quickFixes = suggestions.filter(s => s.effort === 'quick').length;

    return {
      totalSmells: smells.length,
      byType,
      bySeverity,
      totalSuggestions: suggestions.length,
      quickFixes,
    };
  }

  private buildSummary(
    smells: CodeSmell[],
    suggestions: RefactorSuggestion[],
    stats: RefactorReport['stats'],
  ): string {
    const parts: string[] = [];

    parts.push(`🔧 Refactoring Report`);
    parts.push('═'.repeat(40));
    parts.push(`Total smells found: ${stats.totalSmells}`);
    parts.push(`Quick fixes available: ${stats.quickFixes}`);
    parts.push('');

    // Breakdown by severity
    if (stats.bySeverity.error) parts.push(`❌ Errors: ${stats.bySeverity.error}`);
    if (stats.bySeverity.warning) parts.push(`⚠️  Warnings: ${stats.bySeverity.warning}`);
    if (stats.bySeverity.info) parts.push(`ℹ️  Info: ${stats.bySeverity.info}`);
    parts.push('');

    // Breakdown by type
    parts.push('By type:');
    for (const [type, count] of Object.entries(stats.byType)) {
      parts.push(`  - ${type}: ${count}`);
    }
    parts.push('');

    // Top suggestions
    const topSuggestions = suggestions.slice(0, 5);
    if (topSuggestions.length > 0) {
      parts.push('Top refactoring suggestions:');
      for (const s of topSuggestions) {
        const icon = s.effort === 'quick' ? '🟢' : s.effort === 'moderate' ? '🟡' : '🔴';
        parts.push(`  ${icon} [${s.smell.type}] ${s.smell.description}`);
        parts.push(`     Risk: ${s.risk} | Effort: ${s.effort} | Impact: ${s.impact.filesAffected} files`);
      }
    }

    return parts.join('\n');
  }
}
