// ============================================================
// Graph Builder Unit Tests
// ============================================================

import { describe, it, expect } from 'vitest';
import { GraphBuilder } from './builder.js';
import type { Symbol, Relationship, FileInfo, CodeGraph } from './types.js';
import type { ParseResult, ParsedSymbol } from '../parser/index.js';

describe('GraphBuilder', () => {
  let builder: GraphBuilder;

  beforeEach(() => {
    builder = new GraphBuilder();
  });

  describe('build', () => {
    it('should build graph from parse results', () => {
      const parseResult: ParseResult = {
        filePath: 'test.ts',
        language: 'typescript',
        symbols: [
          {
            name: 'hello',
            kind: 'function',
            startLine: 1,
            endLine: 5,
            startCol: 0,
            endCol: 10,
            sourceCode: 'function hello() {}',
            exported: false,
          },
        ],
        relationships: [],
      };

      const files = new Map<string, FileInfo>();

      const graph = builder.build([parseResult], files);

      expect(graph.symbols.size).toBe(1);
      const symbol = graph.symbols.get('test.ts:hello:1');
      expect(symbol?.name).toBe('hello');
    });

    it('should classify layers correctly', () => {
      const parseResults: ParseResult[] = [
        {
          filePath: 'src/routes/api.ts',
          language: 'typescript',
          symbols: [
            { name: 'getUser', kind: 'function', startLine: 1, endLine: 10, startCol: 0, endCol: 5, sourceCode: '', exported: true },
          ],
          relationships: [],
        },
        {
          filePath: 'src/services/user.ts',
          language: 'typescript',
          symbols: [
            { name: 'createUser', kind: 'function', startLine: 1, endLine: 20, startCol: 0, endCol: 5, sourceCode: '', exported: false },
          ],
          relationships: [],
        },
        {
          filePath: 'src/repositories/user-repository.ts',
          language: 'typescript',
          symbols: [
            { name: 'save', kind: 'function', startLine: 1, endLine: 15, startCol: 0, endCol: 5, sourceCode: '', exported: false },
          ],
          relationships: [],
        },
      ];

      const files = new Map<string, FileInfo>();
      const graph = builder.build(parseResults, files);

      // Check that layers were classified
      const apiSymbol = graph.symbols.get('src/routes/api.ts:getUser:1');
      const serviceSymbol = graph.symbols.get('src/services/user.ts:createUser:1');
      const dbSymbol = graph.symbols.get('src/repositories/user-repository.ts:save:1');

      expect(apiSymbol?.layer).toBe('interface');
      expect(serviceSymbol?.layer).toBe('business');
      expect(dbSymbol?.layer).toBe('data');
    });

    it('should handle empty input', () => {
      const graph = builder.build([], new Map());

      expect(graph.symbols.size).toBe(0);
      expect(graph.relationships).toHaveLength(0);
    });
  });

  describe('Graph Convenience Methods', () => {
    it('should filter symbols by kind', () => {
      const parseResult: ParseResult = {
        filePath: 'test.ts',
        language: 'typescript',
        symbols: [
          { name: 'a', kind: 'function', startLine: 1, endLine: 5, startCol: 0, endCol: 5, sourceCode: '', exported: false },
          { name: 'B', kind: 'class', startLine: 10, endLine: 20, startCol: 0, endCol: 5, sourceCode: '', exported: false },
        ],
        relationships: [],
      };

      const graph = builder.build([parseResult], new Map());

      const functions = graph.getSymbolsByKind('function');
      const classes = graph.getSymbolsByKind('class');

      expect(functions).toHaveLength(1);
      expect(classes).toHaveLength(1);
    });

    it('should filter symbols by layer', () => {
      const parseResults: ParseResult[] = [
        {
          filePath: 'src/routes/a.ts',
          language: 'typescript',
          symbols: [{ name: 'a', kind: 'function', startLine: 1, endLine: 5, startCol: 0, endCol: 5, sourceCode: '', exported: false }],
          relationships: [],
        },
        {
          filePath: 'src/repositories/b.ts',
          language: 'typescript',
          symbols: [{ name: 'b', kind: 'function', startLine: 1, endLine: 5, startCol: 0, endCol: 5, sourceCode: '', exported: false }],
          relationships: [],
        },
      ];

      const graph = builder.build(parseResults, new Map());

      const interfaceSymbols = graph.getSymbolsByLayer('interface');
      const dataSymbols = graph.getSymbolsByLayer('data');

      expect(interfaceSymbols).toHaveLength(1);
      expect(dataSymbols).toHaveLength(1);
    });

    it('should get relationships from symbol', () => {
      const parseResult: ParseResult = {
        filePath: 'test.ts',
        language: 'typescript',
        symbols: [
          { name: 'a', kind: 'function', startLine: 1, endLine: 5, startCol: 0, endCol: 5, sourceCode: '', exported: false },
          { name: 'b', kind: 'function', startLine: 10, endLine: 15, startCol: 0, endCol: 5, sourceCode: '', exported: false },
        ],
        relationships: [
          { sourceName: 'a', targetName: 'b', kind: 'calls', line: 12 },
        ],
      };

      const graph = builder.build([parseResult], new Map());

      const outgoing = graph.getRelationshipsFrom('test.ts:a:1');
      expect(outgoing).toHaveLength(1);
      expect(outgoing[0].targetId).toBe('test.ts:b:10');
    });

    it('should get relationships to symbol', () => {
      const parseResult: ParseResult = {
        filePath: 'test.ts',
        language: 'typescript',
        symbols: [
          { name: 'a', kind: 'function', startLine: 1, endLine: 5, startCol: 0, endCol: 5, sourceCode: '', exported: false },
          { name: 'b', kind: 'function', startLine: 10, endLine: 15, startCol: 0, endCol: 5, sourceCode: '', exported: false },
        ],
        relationships: [
          { sourceName: 'a', targetName: 'b', kind: 'calls', line: 12 },
        ],
      };

      const graph = builder.build([parseResult], new Map());

      const incoming = graph.getRelationshipsTo('test.ts:b:10');
      expect(incoming).toHaveLength(1);
      expect(incoming[0].sourceId).toBe('test.ts:a:1');
    });
  });
});
