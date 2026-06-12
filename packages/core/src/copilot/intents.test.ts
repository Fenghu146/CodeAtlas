// ============================================================
// Intent Recognition Unit Tests
// ============================================================

import { describe, it, expect } from 'vitest';
import { recognizeIntent, extractTargetSymbols } from './intents.js';

describe('recognizeIntent', () => {
  // ---- safe_delete ----
  describe('safe_delete', () => {
    it('should recognize English delete questions', () => {
      const intent = recognizeIntent('Can I safely delete UserService?');
      expect(intent.type).toBe('safe_delete');
      expect(intent.target).toBe('UserService');
      expect(intent.confidence).toBeGreaterThan(0.3);
    });

    it('should recognize "is it safe to remove"', () => {
      const intent = recognizeIntent('Is it safe to remove this function?');
      expect(intent.type).toBe('safe_delete');
    });

    it('should recognize Chinese delete questions', () => {
      const intent = recognizeIntent('能安全删除 UserService 吗');
      expect(intent.type).toBe('safe_delete');
    });
  });

  // ---- impact ----
  describe('impact', () => {
    it('should recognize English impact questions', () => {
      const intent = recognizeIntent('What happens if I change UserRepository?');
      expect(intent.type).toBe('impact');
      expect(intent.target).toBe('UserRepository');
    });

    it('should recognize Chinese impact questions', () => {
      const intent = recognizeIntent('修改 UserService 会有什么影响');
      expect(intent.type).toBe('impact');
    });

    it('should recognize "impact of" pattern', () => {
      const intent = recognizeIntent('What is the impact of changing SQLiteStore?');
      expect(intent.type).toBe('impact');
    });
  });

  // ---- understand ----
  describe('understand', () => {
    it('should recognize "what does X do"', () => {
      const intent = recognizeIntent('What does UserService do?');
      expect(intent.type).toBe('understand');
      expect(intent.target).toBe('UserService');
    });

    it('should recognize "explain" pattern', () => {
      const intent = recognizeIntent('Explain the auth flow');
      expect(intent.type).toBe('understand');
    });

    it('should recognize Chinese understand questions', () => {
      const intent = recognizeIntent('解释一下 UserService 是做什么的');
      expect(intent.type).toBe('understand');
    });
  });

  // ---- relationship ----
  describe('relationship', () => {
    it('should recognize "how are X and Y related"', () => {
      const intent = recognizeIntent('How are UserService and UserRepository related?');
      expect(intent.type).toBe('relationship');
    });

    it('should recognize Chinese relationship questions', () => {
      const intent = recognizeIntent('UserService 和 UserRepository 什么关系');
      expect(intent.type).toBe('relationship');
    });
  });

  // ---- code_review ----
  describe('code_review', () => {
    it('should recognize "anything wrong with X"', () => {
      const intent = recognizeIntent('Is there anything wrong with UserService?');
      expect(intent.type).toBe('code_review');
    });

    it('should recognize "review" pattern', () => {
      const intent = recognizeIntent('Review this code');
      expect(intent.type).toBe('code_review');
    });
  });

  // ---- find_code ----
  describe('find_code', () => {
    it('should recognize "where is the code"', () => {
      const intent = recognizeIntent('Where is the code that handles login?');
      expect(intent.type).toBe('find_code');
    });

    it('should recognize Chinese find_code questions', () => {
      const intent = recognizeIntent('哪里处理了用户登录');
      expect(intent.type).toBe('find_code');
    });
  });

  // ---- architecture ----
  describe('architecture', () => {
    it('should recognize architecture questions', () => {
      const intent = recognizeIntent('What is the architecture of this project?');
      expect(intent.type).toBe('architecture');
    });

    it('should recognize Chinese architecture questions', () => {
      const intent = recognizeIntent('这个项目的架构是什么');
      expect(intent.type).toBe('architecture');
    });
  });

  // ---- call_chain ----
  describe('call_chain', () => {
    it('should recognize "who calls X"', () => {
      const intent = recognizeIntent('Who calls UserService?');
      expect(intent.type).toBe('call_chain');
    });

    it('should recognize "what does X call"', () => {
      const intent = recognizeIntent('What does UserService call?');
      expect(intent.type).toBe('call_chain');
    });
  });

  // ---- refactor ----
  describe('refactor', () => {
    it('should recognize "how should I refactor"', () => {
      const intent = recognizeIntent('How should I refactor UserService?');
      expect(intent.type).toBe('refactor');
    });

    it('should recognize Chinese refactor questions', () => {
      const intent = recognizeIntent('怎么重构 UserService');
      expect(intent.type).toBe('refactor');
    });
  });

  // ---- overview ----
  describe('overview', () => {
    it('should recognize overview questions', () => {
      const intent = recognizeIntent('Give me an overview of the project');
      expect(intent.type).toBe('overview');
    });

    it('should recognize Chinese overview questions', () => {
      const intent = recognizeIntent('项目概览');
      expect(intent.type).toBe('overview');
    });
  });

  // ---- entry_point ----
  describe('entry_point', () => {
    it('should recognize entry point questions', () => {
      const intent = recognizeIntent('Where does the app start?');
      expect(intent.type).toBe('entry_point');
    });
  });

  // ---- compare ----
  describe('compare', () => {
    it('should recognize compare questions', () => {
      const intent = recognizeIntent('Compare UserService and AuthService');
      expect(intent.type).toBe('compare');
    });
  });

  // ---- test_coverage ----
  describe('test_coverage', () => {
    it('should recognize test coverage questions', () => {
      const intent = recognizeIntent('Is UserService well tested?');
      expect(intent.type).toBe('test_coverage');
    });

    it('should recognize "test coverage of" pattern', () => {
      const intent = recognizeIntent('What is the test coverage of SQLiteStore?');
      expect(intent.type).toBe('test_coverage');
    });
  });

  // ---- free_form fallback ----
  describe('free_form', () => {
    it('should fallback for unrecognized patterns', () => {
      const intent = recognizeIntent('hello world');
      expect(intent.type).toBe('free_form');
    });

    it('should handle empty string', () => {
      const intent = recognizeIntent('');
      expect(intent.type).toBe('free_form');
    });
  });
});

describe('extractTargetSymbols', () => {
  it('should extract PascalCase identifiers', () => {
    const result = extractTargetSymbols('What does UserService do?');
    expect(result.primary).toBe('UserService');
  });

  it('should extract camelCase identifiers', () => {
    const result = extractTargetSymbols('Where is getUser defined?');
    expect(result.primary).toBe('getUser');
  });

  it('should extract snake_case identifiers', () => {
    const result = extractTargetSymbols('Where is user_service defined?');
    expect(result.primary).toBe('user_service');
  });

  it('should extract multiple symbols', () => {
    const result = extractTargetSymbols('How are UserService and UserRepository related?');
    expect(result.primary).toBeDefined();
    expect(result.secondary).toBeDefined();
  });

  it('should extract quoted identifiers', () => {
    const result = extractTargetSymbols('Explain "loginHandler"');
    expect(result.primary).toBe('loginHandler');
  });

  it('should extract path-like patterns', () => {
    const result = extractTargetSymbols('Show me src/services/user');
    expect(result.primary).toBe('src/services/user');
  });

  it('should extract keywords when no symbols found', () => {
    const result = extractTargetSymbols('How does this work?');
    expect(result.keywords.length).toBeGreaterThan(0);
  });
});
