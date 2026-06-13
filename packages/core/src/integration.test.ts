// ============================================================
// Integration Tests - Full Pipeline
// ============================================================

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { CodeParser } from './parser/index.js';
import { GraphBuilder } from './graph/builder.js';
import { SQLiteStore } from './store/sqlite-store.js';
import { ProjectScanner } from './scanner/scanner.js';
import fs from 'fs';
import path from 'path';

const TEST_DB_PATH = path.join(process.cwd(), '.codeatlas', 'test-integration.sqlite');
const TEST_PROJECT_PATH = path.join(process.cwd(), '.codeatlas', 'test-project');

describe('Integration Tests', () => {
  let parser: CodeParser;
  let graphBuilder: GraphBuilder;
  let store: SQLiteStore;

  beforeAll(async () => {
    // Create test project structure
    if (!fs.existsSync(TEST_PROJECT_PATH)) {
      fs.mkdirSync(TEST_PROJECT_PATH, { recursive: true });
    }

    // Create test files
    fs.writeFileSync(
      path.join(TEST_PROJECT_PATH, 'index.ts'),
      `
        import { UserService } from './services/user.js';

        export function main() {
          const service = new UserService();
          service.getUser(1);
        }
      `
    );

    fs.mkdirSync(path.join(TEST_PROJECT_PATH, 'services'), { recursive: true });
    fs.writeFileSync(
      path.join(TEST_PROJECT_PATH, 'services', 'user.ts'),
      `
        export class UserService {
          getUser(id: number) {
            return { id, name: 'Test User' };
          }

          createUser(data: any) {
            return data;
          }
        }
      `
    );

    fs.mkdirSync(path.join(TEST_PROJECT_PATH, 'db'), { recursive: true });
    fs.writeFileSync(
      path.join(TEST_PROJECT_PATH, 'db', 'repository.ts'),
      `
        export function saveUser(user: any) {
          return user;
        }
      `
    );

    // Initialize components
    parser = new CodeParser();
    await parser.init();
    await parser.loadLanguage('typescript');

    graphBuilder = new GraphBuilder();

    // Ensure test directory exists
    const dir = path.dirname(TEST_DB_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    store = new SQLiteStore({ dbPath: TEST_DB_PATH });
  });

  afterAll(() => {
    store.close();

    // Clean up test files
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
    if (fs.existsSync(TEST_PROJECT_PATH)) {
      fs.rmSync(TEST_PROJECT_PATH, { recursive: true, force: true });
    }
  });

  beforeEach(() => {
    store.clear();
  });

  describe('Parser + Graph Builder', () => {
    it('should parse files and build graph', () => {
      const indexCode = fs.readFileSync(path.join(TEST_PROJECT_PATH, 'index.ts'), 'utf-8');
      const userCode = fs.readFileSync(path.join(TEST_PROJECT_PATH, 'services', 'user.ts'), 'utf-8');

      const result1 = parser.parse(indexCode, 'index.ts');
      const result2 = parser.parse(userCode, 'services/user.ts');

      expect(result1.symbols.length).toBeGreaterThan(0);
      expect(result2.symbols.length).toBeGreaterThan(0);

      // Build graph (pass ParseResult[])
      const files = new Map([
        ['index.ts', { path: 'index.ts', language: 'typescript', size: 100, lineCount: 10, hash: 'abc' }],
        ['services/user.ts', { path: 'services/user.ts', language: 'typescript', size: 200, lineCount: 15, hash: 'def' }],
      ]);

      const graph = graphBuilder.build([result1, result2], files);
      expect(graph.symbols.size).toBeGreaterThan(0);
    });
  });

  describe('Full Pipeline', () => {
    it('should scan project and query results', async () => {
      const scanner = new ProjectScanner(store);

      const result = await scanner.scan({
        projectPath: TEST_PROJECT_PATH,
        full: true,
      });

      expect(result.filesScanned).toBeGreaterThan(0);
      expect(result.symbolsFound).toBeGreaterThan(0);

      // Query the stored data
      const stats = store.getStats();
      expect(stats.symbols).toBeGreaterThan(0);
      expect(stats.files).toBeGreaterThan(0);
    });

    it('should search for symbols after scan', async () => {
      const scanner = new ProjectScanner(store);

      await scanner.scan({
        projectPath: TEST_PROJECT_PATH,
        full: true,
      });

      // Search for UserService
      const results = store.searchSymbols('UserService');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].name).toBe('UserService');
    });

    it('should get symbol details', async () => {
      const scanner = new ProjectScanner(store);

      await scanner.scan({
        projectPath: TEST_PROJECT_PATH,
        full: true,
      });

      // Find a symbol using LIKE search
      const results = store.searchSymbols('UserService', { limit: 10 });
      expect(results.length).toBeGreaterThan(0);

      // Get details
      const symbol = store.getSymbol(results[0].id);
      expect(symbol).toBeDefined();
      expect(symbol?.name).toBe(results[0].name);
    });
  });

  describe('Incremental Scan', () => {
    it('should detect unchanged files', async () => {
      const scanner = new ProjectScanner(store);

      // First scan
      const result1 = await scanner.scan({
        projectPath: TEST_PROJECT_PATH,
        full: true,
      });

      // Second scan (incremental)
      const result2 = await scanner.scan({
        projectPath: TEST_PROJECT_PATH,
        full: false,
      });

      // Should skip unchanged files
      expect(result2.filesSkipped).toBe(result1.filesScanned);
    });

    it('should detect changed files', async () => {
      const scanner = new ProjectScanner(store);

      // First scan
      await scanner.scan({
        projectPath: TEST_PROJECT_PATH,
        full: true,
      });

      // Modify a file
      fs.writeFileSync(
        path.join(TEST_PROJECT_PATH, 'index.ts'),
        `
          export function main() {
            console.log('Modified');
          }
        `
      );

      // Incremental scan
      const result = await scanner.scan({
        projectPath: TEST_PROJECT_PATH,
        full: false,
      });

      // Should detect the change
      expect(result.filesScanned).toBe(1);
    });
  });

  describe('Layer Classification', () => {
    it('should classify layers correctly', async () => {
      const scanner = new ProjectScanner(store);

      await scanner.scan({
        projectPath: TEST_PROJECT_PATH,
        full: true,
      });

      // Check layer distribution
      const interfaceSymbols = store.getSymbolsByLayer('interface');
      const businessSymbols = store.getSymbolsByLayer('business');
      const dataSymbols = store.getSymbolsByLayer('data');

      // At least some symbols should be classified
      const total = interfaceSymbols.length + businessSymbols.length + dataSymbols.length;
      expect(total).toBeGreaterThan(0);
    });
  });
});
