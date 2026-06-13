// ============================================================
// Graph Copilot Unit Tests
// ============================================================

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { GraphCopilot } from './graph-copilot.js';
import { recognizeIntent, extractTargetSymbols } from './intents.js';
import { SessionManager } from './session.js';
import { scoreSymbolMatch } from './flows/_shared.js';
import { SQLiteStore } from '../store/sqlite-store.js';
import type { Symbol } from '../graph/types.js';
import fs from 'fs';
import path from 'path';

const TEST_DB_PATH = path.join(process.cwd(), '.codeatlas', 'test-copilot.sqlite');

describe('GraphCopilot', () => {
  let store: SQLiteStore;
  let copilot: GraphCopilot;

  beforeAll(async () => {
    const dir = path.dirname(TEST_DB_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    store = await SQLiteStore.create({ dbPath: TEST_DB_PATH });

    // Seed test data
    const testSymbols: Symbol[] = [
      {
        id: 'src/services/user.ts:UserService:1',
        name: 'UserService',
        kind: 'class',
        filePath: 'src/services/user.ts',
        startLine: 1,
        endLine: 50,
        language: 'typescript',
        layer: 'business',
        exported: true,
        complexity: 12,
        sourceCode: 'export class UserService { getUser(id: number) {} }',
      },
      {
        id: 'src/services/user.ts:getUser:10',
        name: 'getUser',
        kind: 'method',
        filePath: 'src/services/user.ts',
        startLine: 10,
        endLine: 15,
        language: 'typescript',
        layer: 'business',
        exported: false,
        sourceCode: 'getUser(id: number) { return this.repo.find(id); }',
      },
      {
        id: 'src/repositories/user.ts:UserRepository:20',
        name: 'UserRepository',
        kind: 'class',
        filePath: 'src/repositories/user.ts',
        startLine: 1,
        endLine: 30,
        language: 'typescript',
        layer: 'data',
        exported: true,
        sourceCode: 'export class UserRepository { find(id: number) {} }',
      },
    ];

    testSymbols.forEach(s => store.upsertSymbol(s));

    // Add relationships
    store.insertRelationship({
      id: 'rel-1',
      sourceId: 'src/services/user.ts:UserService:1',
      targetId: 'src/services/user.ts:getUser:10',
      kind: 'calls',
    });
    store.insertRelationship({
      id: 'rel-2',
      sourceId: 'src/services/user.ts:getUser:10',
      targetId: 'src/repositories/user.ts:UserRepository:20',
      kind: 'calls',
    });

    copilot = new GraphCopilot(store, process.cwd());
  });

  afterAll(() => {
    store.close();
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
  });

  describe('Intent Recognition', () => {
    it('should recognize safe_delete intent', () => {
      const intent = recognizeIntent('Can I safely delete UserService?');
      expect(intent.type).toBe('safe_delete');
      expect(intent.target).toBe('UserService');
    });

    it('should recognize impact intent', () => {
      const intent = recognizeIntent('What happens if I change UserRepository?');
      expect(intent.type).toBe('impact');
    });

    it('should recognize understand intent', () => {
      const intent = recognizeIntent('What does UserService do?');
      expect(intent.type).toBe('understand');
    });

    it('should recognize compare intent', () => {
      const intent = recognizeIntent('Compare UserService and UserRepository');
      expect(intent.type).toBe('compare');
    });

    it('should recognize test_coverage intent', () => {
      const intent = recognizeIntent('Is UserService well tested?');
      expect(intent.type).toBe('test_coverage');
    });

    it('should extract target symbols correctly', () => {
      const result = extractTargetSymbols('What does UserService do?');
      expect(result.primary).toBe('UserService');
    });
  });

  describe('Ask Method', () => {
    it('should handle understand intent', async () => {
      const result = await copilot.ask('What does UserService do?');
      expect(result.intent).toBe('understand');
      expect(result.answer).toContain('UserService');
      expect(result.symbols.length).toBeGreaterThan(0);
    });

    it('should handle safe_delete intent', async () => {
      const result = await copilot.ask('Can I safely delete UserRepository?');
      expect(result.intent).toBe('safe_delete');
      expect(result.answer).toContain('UserRepository');
    });

    it('should handle compare intent', async () => {
      const result = await copilot.ask('Compare UserService and UserRepository');
      expect(result.intent).toBe('compare');
      expect(result.answer).toContain('UserService');
      expect(result.answer).toContain('UserRepository');
      expect(result.answer).toContain('📋');
    });

    it('should handle test_coverage intent', async () => {
      const result = await copilot.ask('Is UserService well tested?');
      expect(result.intent).toBe('test_coverage');
      expect(result.answer).toContain('UserService');
    });

    it('should handle unknown symbol gracefully', async () => {
      const result = await copilot.ask('What does NonExistentSymbol do?');
      expect(result.answer).toBeDefined();
    });
  });

  describe('Session Memory', () => {
    it('should resolve pronouns using session context', async () => {
      const sessionId = 'test-session-' + Date.now();

      // First turn
      await copilot.ask('What does UserService do?', { sessionId });

      // Second turn - should resolve "it" to UserService
      const result = await copilot.ask('Is it safe to delete?', { sessionId });
      expect(result.answer).toContain('UserService');
    });
  });

  describe('Score Symbol Match', () => {
    it('should score exact match highest', () => {
      const sym = {
        id: '1', name: 'UserService', kind: 'class', filePath: 'test.ts',
        startLine: 1, endLine: 10, language: 'typescript', layer: 'business',
        exported: true,
      } as Symbol;

      // Use the shared helper directly
      const score = scoreSymbolMatch(sym, 'UserService', []);
      expect(score).toBeGreaterThanOrEqual(1.0);
    });

    it('should score partial match lower', () => {
      const sym = {
        id: '1', name: 'UserServiceTest', kind: 'class', filePath: 'test.ts',
        startLine: 1, endLine: 10, language: 'typescript', layer: 'business',
        exported: true,
      } as Symbol;

      const score = scoreSymbolMatch(sym, 'UserService', []);
      expect(score).toBeGreaterThan(0.5);
      expect(score).toBeLessThan(1.0);
    });
  });
});
