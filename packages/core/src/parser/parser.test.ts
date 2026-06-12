// ============================================================
// Parser Unit Tests
// ============================================================

import { describe, it, expect, beforeAll } from 'vitest';
import { CodeParser, detectLanguage } from './index.js';

describe('CodeParser', () => {
  let parser: CodeParser;

  beforeAll(async () => {
    parser = new CodeParser();
    await parser.init();
    await parser.loadLanguage('typescript');
    await parser.loadLanguage('javascript');
  });

  describe('detectLanguage', () => {
    it('should detect TypeScript files', () => {
      expect(detectLanguage('index.ts')).toBe('typescript');
      expect(detectLanguage('app.tsx')).toBe('tsx');
    });

    it('should detect JavaScript files', () => {
      expect(detectLanguage('index.js')).toBe('javascript');
      expect(detectLanguage('module.mjs')).toBe('javascript');
      expect(detectLanguage('script.cjs')).toBe('javascript');
    });

    it('should return null for unsupported files', () => {
      expect(detectLanguage('readme.md')).toBeNull();
      expect(detectLanguage('style.css')).toBeNull();
    });
  });

  describe('parse', () => {
    it('should extract function declarations', () => {
      const code = `
        function hello() {
          return 'world';
        }
      `;
      const result = parser.parse(code, 'test.ts');

      expect(result.symbols).toHaveLength(1);
      expect(result.symbols[0].name).toBe('hello');
      expect(result.symbols[0].kind).toBe('function');
    });

    it('should extract class declarations', () => {
      const code = `
        class UserService {
          constructor() {}
          getUser() {}
        }
      `;
      const result = parser.parse(code, 'test.ts');

      // Should extract class, constructor, and method
      expect(result.symbols).toHaveLength(3);
      expect(result.symbols[0].name).toBe('UserService');
      expect(result.symbols[0].kind).toBe('class');
    });

    it('should extract exported symbols', () => {
      const code = `
        export function publicApi() {}
        function privateHelper() {}
      `;
      const result = parser.parse(code, 'test.ts');

      const publicFunc = result.symbols.find(s => s.name === 'publicApi');
      const privateFunc = result.symbols.find(s => s.name === 'privateHelper');

      expect(publicFunc?.exported).toBe(true);
      expect(privateFunc?.exported).toBe(false);
    });

    it('should extract interface declarations', () => {
      const code = `
        interface User {
          id: number;
          name: string;
        }
      `;
      const result = parser.parse(code, 'test.ts');

      expect(result.symbols).toHaveLength(1);
      expect(result.symbols[0].name).toBe('User');
      expect(result.symbols[0].kind).toBe('interface');
    });

    it('should detect function calls', () => {
      const code = `
        function helper() {}
        function main() {
          helper();
        }
      `;
      const result = parser.parse(code, 'test.ts');

      expect(result.relationships).toHaveLength(1);
      expect(result.relationships[0].kind).toBe('calls');
    });

    it('should handle empty file', () => {
      const code = '';
      const result = parser.parse(code, 'test.ts');

      expect(result.symbols).toHaveLength(0);
      expect(result.relationships).toHaveLength(0);
    });

    it('should handle file with only comments', () => {
      const code = `
        // This is a comment
        /* Multi-line
           comment */
      `;
      const result = parser.parse(code, 'test.ts');

      expect(result.symbols).toHaveLength(0);
    });
  });
});
