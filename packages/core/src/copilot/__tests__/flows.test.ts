// ============================================================
// Flow Unit Tests — Test each extracted flow function directly
// ============================================================

import { describe, it, expect, beforeAll } from 'vitest';
import { flowSafeDelete } from '../flows/safeDelete.js';
import { flowImpact } from '../flows/impact.js';
import { flowUnderstand } from '../flows/understand.js';
import { flowRelationship } from '../flows/relationship.js';
import { flowCallChain } from '../flows/callChain.js';
import { flowCodeReview } from '../flows/codeReview.js';
import { flowFindCode } from '../flows/findCode.js';
import { flowArchitecture } from '../flows/architecture.js';
import { flowOverview } from '../flows/overview.js';
import { flowRefactor } from '../flows/refactor.js';
import { flowEntryPoint } from '../flows/entryPoint.js';
import { flowFreeForm } from '../flows/freeForm.js';
import { flowCompare } from '../flows/compare.js';
import { flowTestCoverage } from '../flows/testCoverage.js';
import { flowEmbeddedLinux } from '../flows/embeddedLinux.js';
import type { Intent, AskOptions } from '../graph-copilot.js';

// ========================
// Mock Store Setup
// ========================

const symbols = new Map<string, any>();
const relationships: Array<{ sourceId: string; targetId: string; kind: string }> = [];

function addSymbol(s: any) { symbols.set(s.id, s); }

function createMockStore() {
  return {
    getSymbol: (id: string) => symbols.get(id) ?? null,
    searchSymbols: (_q: string, _opts?: any) => {
      let res = Array.from(symbols.values()).filter(s => s.name.toLowerCase().includes(_q.toLowerCase()));
      if (!res.length && !_q) res = Array.from(symbols.values());
      return res;
    },
    getCallers: (id: string) => relationships.filter(r => r.targetId === id).map(r => symbols.get(r.sourceId)).filter(Boolean),
    getCallees: (id: string) => relationships.filter(r => r.sourceId === id).map(r => symbols.get(r.targetId)).filter(Boolean),
    getRelationshipsFrom: (id: string) => relationships.filter(r => r.sourceId === id),
    getRelationshipsTo: (id: string) => relationships.filter(r => r.targetId === id),
    getCallerCounts: (ids: string[]) => {
      const m = new Map<string, number>();
      for (const id of ids) m.set(id, relationships.filter(r => r.targetId === id).length);
      return m;
    },
    getCalleeCounts: (ids: string[]) => {
      const m = new Map<string, number>();
      for (const id of ids) m.set(id, relationships.filter(r => r.sourceId === id).length);
      return m;
    },
    getStats: () => ({ files: 2, symbols: symbols.size, relationships: relationships.length, languages: ['typescript'] }),
    getSymbolsByFile: (_p: string) => Array.from(symbols.values()).filter(s => s.filePath === _p),
    getFileHash: (_p: string) => null,
    upsertSymbol: (s: any) => symbols.set(s.id, s),
    insertRelationship: (r: any) => relationships.push(r),
    close: () => {},
    clear: () => {},
    saveGraph: () => {},
    queryAll: () => [],
  } as any;
}

// ========================
// Fixtures
// ========================

beforeAll(() => {
  symbols.clear();
  relationships.length = 0;
  addSymbol({ id: 'src:UserService:1', name: 'UserService', kind: 'class', filePath: 'src/services/user.ts', startLine: 1, endLine: 50, language: 'typescript', layer: 'business', exported: true, complexity: 12, sourceCode: 'export class UserService { getUser(id: number) {} }' });
  addSymbol({ id: 'src:getUser:10', name: 'getUser', kind: 'method', filePath: 'src/services/user.ts', startLine: 10, endLine: 15, language: 'typescript', layer: 'business', exported: false, sourceCode: 'getUser(id: number) { return this.repo.find(id); }' });
  addSymbol({ id: 'src:UserRepository:20', name: 'UserRepository', kind: 'class', filePath: 'src/repositories/user.ts', startLine: 1, endLine: 30, language: 'typescript', layer: 'data', exported: true, sourceCode: 'export class UserRepository { find(id: number) {} }' });
  addSymbol({ id: 'src:main:30', name: 'main', kind: 'function', filePath: 'src/main.ts', startLine: 1, endLine: 5, language: 'typescript', layer: 'business', exported: true, sourceCode: 'function main() { console.log("start"); }' });
  addSymbol({ id: 'src:helper:40', name: 'helperUtil', kind: 'function', filePath: 'src/utils/helper.ts', startLine: 1, endLine: 8, language: 'typescript', layer: 'utility', exported: false, sourceCode: 'function helperUtil() { return 42; }' });
  relationships.push({ sourceId: 'src:UserService:1', targetId: 'src:getUser:10', kind: 'calls' });
  relationships.push({ sourceId: 'src:getUser:10', targetId: 'src:UserRepository:20', kind: 'calls' });
  relationships.push({ sourceId: 'src:main:30', targetId: 'src:UserService:1', kind: 'calls' });
});

// ========================
// Shared Helpers
// ========================

function makeIntent(type: string, target?: string, secondary?: string, question?: string): Intent {
  return { type: type as any, confidence: 0.8, target, secondaryTarget: secondary, keywords: target ? [target] : [], rawQuestion: question ?? '' };
}

function makeOpts(): AskOptions { return { mode: 'quick' as const }; }

// ========================
// Tests
// ========================

describe('flowSafeDelete', () => {
  it('should return FlowResult for a deletable symbol', () => {
    const store = createMockStore();
    const result = flowSafeDelete(store, '', makeIntent('safe_delete', 'helperUtil'), makeOpts(), []);
    expect(result).toHaveProperty('answer');
    expect(result).toHaveProperty('symbols');
    expect(result).toHaveProperty('conclusions');
  });

  it('should return not found for missing symbol', () => {
    const result = flowSafeDelete(createMockStore(), '', makeIntent('safe_delete', 'NonExistent'), makeOpts(), []);
    expect(result.answer).toContain('not found');
  });

  it('should detect callers for symbols with dependents', () => {
    const result = flowSafeDelete(createMockStore(), '', makeIntent('safe_delete', 'UserService'), makeOpts(), []);
    expect(result.answer).toContain('Cannot safely delete');
    expect(result.symbols.length).toBeGreaterThan(0);
  });
});

describe('flowImpact', () => {
  it('should analyse impact depth', () => {
    const result = flowImpact(createMockStore(), '', makeIntent('impact', 'UserService'), makeOpts(), []);
    expect(result.answer).toContain('Impact');
    expect(result.symbols.length).toBeGreaterThan(0);
  });

  it('should return not found for missing symbol', () => {
    const result = flowImpact(createMockStore(), '', makeIntent('impact', 'NoSymbol'), makeOpts(), []);
    expect(result.answer).toContain('not found');
  });
});

describe('flowUnderstand', () => {
  it('should return symbol details', () => {
    const result = flowUnderstand(createMockStore(), '', makeIntent('understand', 'UserService'), makeOpts(), []);
    expect(result.answer).toContain('Understanding');
    expect(result.answer).toContain('UserService');
    expect(result.answer).toContain('business');
    expect(result.symbols.length).toBeGreaterThan(0);
  });
});

describe('flowCallChain', () => {
  it('should show upstream and downstream', () => {
    const result = flowCallChain(createMockStore(), '', makeIntent('call_chain', 'getUser'), makeOpts(), []);
    expect(result.answer).toContain('Upstream');
    expect(result.answer).toContain('Downstream');
    expect(result.answer).toContain('getUser');
  });
});

describe('flowCodeReview', () => {
  it('should run code review on project', () => {
    const store = createMockStore();
    addSymbol({ id: 'src:GodClass:99', name: 'GodClass', kind: 'class', filePath: 'src/god.ts', startLine: 1, endLine: 100, language: 'typescript', layer: 'business', exported: true, sourceCode: Array(50).fill('method() {}').join('\n') });
    const result = flowCodeReview(store, '', makeIntent('code_review', 'GodClass'), makeOpts(), []);
    expect(result.answer).toBeDefined();
  });
});

describe('flowFindCode', () => {
  it('should find symbols by keyword', () => {
    const result = flowFindCode(createMockStore(), '', makeIntent('find_code', undefined, undefined, 'find UserService'), makeOpts(), []);
    expect(result.answer).toContain('Code Search');
    expect(result.symbols.length).toBeGreaterThan(0);
  });
});

describe('flowArchitecture', () => {
  it('should return architecture overview', () => {
    const result = flowArchitecture(createMockStore(), '', makeIntent('architecture'), makeOpts(), []);
    expect(result.answer).toContain('Architecture');
    expect(result.answer).toContain('Symbols');
    expect(result.conclusions.length).toBeGreaterThan(0);
  });
});

describe('flowOverview', () => {
  it('should delegate to architecture', () => {
    const result = flowOverview(createMockStore(), '', makeIntent('overview'), makeOpts(), []);
    expect(result.answer).toContain('Architecture');
  });
});

describe('flowRefactor', () => {
  it('should detect code smells for a target', () => {
    const result = flowRefactor(createMockStore(), '', makeIntent('refactor', 'UserService'), makeOpts(), []);
    expect(result.answer).toBeDefined();
  });
});

describe('flowEntryPoint', () => {
  it('should find entry points like main', () => {
    const result = flowEntryPoint(createMockStore(), '', makeIntent('entry_point'), makeOpts(), []);
    expect(result.answer).toContain('Entry Points');
    expect(result.symbols.length).toBeGreaterThan(0);
  });
});

describe('flowCompare', () => {
  it('should compare two symbols', () => {
    const result = flowCompare(createMockStore(), '', makeIntent('compare', 'UserService', 'UserRepository'), makeOpts(), []);
    expect(result.answer).toContain('Compare');
    expect(result.answer).toContain('UserService');
    expect(result.answer).toContain('UserRepository');
  });
});

describe('flowTestCoverage', () => {
  it('should return project coverage', () => {
    const result = flowTestCoverage(createMockStore(), '', makeIntent('test_coverage'), makeOpts(), []);
    expect(result.answer).toContain('Coverage');
  });

  it('should handle symbol-specific coverage', () => {
    const result = flowTestCoverage(createMockStore(), '', makeIntent('test_coverage', 'UserService'), makeOpts(), []);
    expect(result.answer).toContain('UserService');
  });
});

describe('flowFreeForm', () => {
  it('should delegate to understand when target found', () => {
    const result = flowFreeForm(createMockStore(), '', makeIntent('free_form', 'UserService'), makeOpts(), []);
    expect(result.answer).toContain('Understanding');
  });

  it('should delegate to findCode when no target', () => {
    const result = flowFreeForm(createMockStore(), '', makeIntent('free_form', undefined, undefined, 'search something'), { mode: 'quick' }, []);
    expect(result.answer).toContain('Code Search');
  });
});

describe('flowRelationship', () => {
  it('should find path between related symbols', () => {
    const result = flowRelationship(createMockStore(), '', makeIntent('relationship', 'UserService', 'UserRepository'), makeOpts(), []);
    expect(result.answer).toBeDefined();
  });

  it('should handle missing secondary target', () => {
    const result = flowRelationship(createMockStore(), '', makeIntent('relationship', 'UserService'), makeOpts(), []);
    expect(result.answer).toContain('Need two symbols');
  });
});

describe('flowEmbeddedLinux', () => {
  it('should return analysis result or no-detection message', () => {
    const result = flowEmbeddedLinux(createMockStore(), '', makeIntent('embedded_linux'), makeOpts(), []);
    // Should either say no Linux artifacts detected, or give analysis
    expect(result.answer).toBeDefined();
    expect(result.conclusions.length).toBeGreaterThanOrEqual(0);
  });
});
