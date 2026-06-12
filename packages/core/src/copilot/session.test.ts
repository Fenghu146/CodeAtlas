// ============================================================
// Session Manager Unit Tests
// ============================================================

import { describe, it, expect, beforeEach } from 'vitest';
import { SessionManager } from './session.js';

describe('SessionManager', () => {
  let manager: SessionManager;

  beforeEach(() => {
    manager = new SessionManager({ maxTurns: 10 });
  });

  describe('Session Creation', () => {
    it('should create session on first access', () => {
      const session = manager.getSession('test');
      expect(session.turns).toHaveLength(0);
      expect(session.hotSymbols.size).toBe(0);
      expect(session.topic).toBeUndefined();
    });

    it('should return same session for same ID', () => {
      const s1 = manager.getSession('test');
      const s2 = manager.getSession('test');
      expect(s1).toBe(s2);
    });

    it('should create separate sessions for different IDs', () => {
      const s1 = manager.getSession('session-a');
      const s2 = manager.getSession('session-b');
      expect(s1).not.toBe(s2);
    });
  });

  describe('Turn Recording', () => {
    it('should record turns correctly', () => {
      manager.recordTurn('test', {
        question: 'What does UserService do?',
        intent: 'understand',
        target: 'UserService',
        symbols: [{ name: 'UserService', kind: 'class', file: 'user.ts', id: '1' }],
        conclusions: ['UserService handles user operations'],
      });

      const session = manager.getSession('test');
      expect(session.turns).toHaveLength(1);
      expect(session.topic).toBe('UserService');
    });

    it('should track hot symbols', () => {
      for (let i = 0; i < 3; i++) {
        manager.recordTurn('test', {
          question: `Question ${i}`,
          intent: 'understand',
          target: 'UserService',
          symbols: [{ name: 'UserService', kind: 'class', file: 'user.ts', id: '1' }],
          conclusions: [],
        });
      }

      const session = manager.getSession('test');
      expect(session.hotSymbols.get('1')?.references).toBe(3);
    });

    it('should trim old turns when exceeding maxTurns', () => {
      for (let i = 0; i < 15; i++) {
        manager.recordTurn('test', {
          question: `Question ${i}`,
          intent: 'understand',
          symbols: [],
          conclusions: [],
        });
      }

      const session = manager.getSession('test');
      expect(session.turns.length).toBeLessThanOrEqual(10);
    });
  });

  describe('Reference Resolution', () => {
    it('should resolve pronouns using last target', () => {
      manager.recordTurn('test', {
        question: 'What is UserService?',
        intent: 'understand',
        target: 'UserService',
        symbols: [],
        conclusions: [],
      });

      const resolved = manager.resolveReferences('test', 'Is it safe to delete?');
      expect(resolved).toContain('UserService');
    });

    it('should not modify questions without pronouns', () => {
      manager.recordTurn('test', {
        question: 'What is UserService?',
        intent: 'understand',
        symbols: [],
        conclusions: [],
      });

      const resolved = manager.resolveReferences('test', 'Compare X and Y');
      expect(resolved).toBe('Compare X and Y');
    });

    it('should return original question when no history', () => {
      const resolved = manager.resolveReferences('test', 'Hello world');
      expect(resolved).toBe('Hello world');
    });
  });

  describe('Context Summary', () => {
    it('should generate context summary with turns', () => {
      manager.recordTurn('test', {
        question: 'What is UserService?',
        intent: 'understand',
        target: 'UserService',
        symbols: [{ name: 'UserService', kind: 'class', file: 'user.ts', id: '1' }],
        conclusions: ['Handles user operations'],
      });

      const summary = manager.getContextSummary('test');
      expect(summary).toContain('UserService');
      expect(summary).toContain('1');
    });

    it('should return empty string for empty session', () => {
      const summary = manager.getContextSummary('test');
      expect(summary).toBe('');
    });
  });

  describe('Session Reset', () => {
    it('should clear session on reset', () => {
      manager.recordTurn('test', {
        question: 'What is UserService?',
        intent: 'understand',
        target: 'UserService',
        symbols: [],
        conclusions: [],
      });

      manager.reset('test');
      const session = manager.getSession('test');
      expect(session.turns).toHaveLength(0);
      expect(session.topic).toBeUndefined();
    });
  });

  describe('Session Stats', () => {
    it('should report correct stats', () => {
      manager.recordTurn('test', {
        question: 'Q1',
        intent: 'understand',
        symbols: [],
        conclusions: [],
      });
      manager.recordTurn('test', {
        question: 'Q2',
        intent: 'impact',
        symbols: [],
        conclusions: [],
      });

      const stats = manager.getStats();
      expect(stats.totalTurns).toBe(2);
    });
  });
});
