// ============================================================
// Dependency Analyzer - Analyzes dependency health
// ============================================================
// Detects circular dependencies, unused deps, unlisted deps,
// and computes a health score.

import fs from 'fs';
import path from 'path';
import { SQLiteStore } from '../store/sqlite-store.js';

export interface DepHealthResult {
  /** Circular dependency chains */
  circular: CircularDep[];
  /** Dependencies declared but never imported */
  unused: string[];
  /** Dependencies imported but not declared */
  unlisted: string[];
  /** All declared dependencies */
  declared: string[];
  /** Health score 0-100 */
  score: number;
  /** Summary text */
  summary: string;
}

export interface CircularDep {
  /** Chain of module/file names forming the cycle */
  chain: string[];
  /** Symbols involved in the cycle */
  symbols: Array<{ name: string; file: string }>;
}

/**
 * Analyzes dependency health of a project.
 * Uses the code graph to detect circular dependencies,
 * and package manifest to find unused/unlisted dependencies.
 */
export class DepAnalyzer {
  private store: SQLiteStore;
  private projectPath: string;

  constructor(store: SQLiteStore, projectPath: string) {
    this.store = store;
    this.projectPath = projectPath;
  }

  /**
   * Run full dependency health analysis.
   */
  analyze(): DepHealthResult {
    const circular = this.detectCircularDeps();
    const { unused, unlisted, declared } = this.checkPackageDeps();

    // Compute health score
    let score = 100;
    score -= circular.length * 15; // Each cycle costs 15 points
    score -= unused.length * 3;    // Each unused dep costs 3 points
    score -= unlisted.length * 5;  // Each unlisted dep costs 5 points
    score = Math.max(0, Math.min(100, score));

    const summary = this.buildSummary(circular, unused, unlisted, declared, score);

    return { circular, unused, unlisted, declared, score, summary };
  }

  /**
   * Detect circular dependencies using DFS on the import graph.
   */
  private detectCircularDeps(): CircularDep[] {
    // Build file-level import graph from relationships
    const allSymbols = this.store.searchSymbols('', { limit: 10000 });
    const fileGraph = new Map<string, Set<string>>();

    for (const symbol of allSymbols) {
      const rels = this.store.getRelationshipsFrom(symbol.id);
      for (const rel of rels) {
        if (rel.kind === 'imports') {
          const target = this.store.getSymbol(rel.targetId);
          if (target && target.filePath !== symbol.filePath) {
            if (!fileGraph.has(symbol.filePath)) {
              fileGraph.set(symbol.filePath, new Set());
            }
            fileGraph.get(symbol.filePath)!.add(target.filePath);
          }
        }
      }
    }

    // DFS cycle detection
    const visited = new Set<string>();
    const inStack = new Set<string>();
    const cycles: CircularDep[] = [];

    const dfs = (node: string, pathSoFar: string[]) => {
      if (inStack.has(node)) {
        // Found a cycle
        const cycleStart = pathSoFar.indexOf(node);
        const cycle = pathSoFar.slice(cycleStart).concat(node);
        cycles.push({
          chain: cycle,
          symbols: cycle.map(f => ({ name: path.basename(f, path.extname(f)), file: f })),
        });
        return;
      }
      if (visited.has(node)) return;

      visited.add(node);
      inStack.add(node);
      pathSoFar.push(node);

      const deps = fileGraph.get(node);
      if (deps) {
        for (const dep of deps) {
          dfs(dep, [...pathSoFar]);
        }
      }

      pathSoFar.pop();
      inStack.delete(node);
    };

    for (const file of fileGraph.keys()) {
      visited.clear();
      inStack.clear();
      dfs(file, []);
    }

    // Deduplicate cycles (same cycle in different starting points)
    return this.deduplicateCycles(cycles);
  }

  private deduplicateCycles(cycles: CircularDep[]): CircularDep[] {
    const seen = new Set<string>();
    const result: CircularDep[] = [];

    for (const cycle of cycles) {
      // Normalize: start from the lexicographically smallest element
      const normalized = cycle.chain.slice(0, -1); // Remove the repeated end
      const minIdx = normalized.reduce((minIdx, val, idx, arr) =>
        val < arr[minIdx] ? idx : minIdx, 0);
      const key = [...normalized.slice(minIdx), ...normalized.slice(0, minIdx)].join(' -> ');

      if (!seen.has(key)) {
        seen.add(key);
        result.push(cycle);
      }
    }

    return result;
  }

  /**
   * Check package.json / go.mod / Cargo.toml for unused/unlisted deps.
   */
  private checkPackageDeps(): { unused: string[]; unlisted: string[]; declared: string[] } {
    const declared = this.getDeclaredDeps();
    if (declared.length === 0) {
      return { unused: [], unlisted: [], declared: [] };
    }

    // Collect all import specifiers from the code graph
    const importedPackages = new Set<string>();
    const allSymbols = this.store.searchSymbols('', { limit: 10000 });

    for (const symbol of allSymbols) {
      const rels = this.store.getRelationshipsFrom(symbol.id);
      for (const rel of rels) {
        if (rel.kind === 'imports') {
          const target = this.store.getSymbol(rel.targetId);
          if (target) {
            // Extract package name from file path
            const pkg = this.extractPackageName(target.filePath);
            if (pkg) importedPackages.add(pkg);
          }
        }
      }
    }

    // Also check source code for bare import specifiers
    for (const symbol of allSymbols) {
      if (symbol.sourceCode) {
        const imports = this.extractImportsFromSource(symbol.sourceCode);
        for (const imp of imports) {
          importedPackages.add(imp);
        }

        // Check for dynamic imports (e.g., import('chokidar'))
        const dynamicImports = this.extractDynamicImports(symbol.sourceCode);
        for (const imp of dynamicImports) {
          importedPackages.add(imp);
        }
      }
    }

    // Find unused (declared but not imported)
    const unused = declared.filter(dep => {
      const normalizedDep = dep.replace(/^@[^/]+\//, '');
      return !importedPackages.has(dep) &&
             !importedPackages.has(normalizedDep) &&
             !this.isDevDependency(dep);
    });

    // Find unlisted (imported but not declared)
    const unlisted = Array.from(importedPackages).filter(pkg => {
      return !declared.some(dep => dep === pkg || pkg.startsWith(dep + '/'));
    });

    return { unused, unlisted, declared };
  }

  private getDeclaredDeps(): string[] {
    const deps: string[] = [];

    // package.json
    const pkgJsonPath = path.join(this.projectPath, 'package.json');
    if (fs.existsSync(pkgJsonPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));
        deps.push(...Object.keys(pkg.dependencies || {}));
      } catch { /* ignore */ }
    }

    // go.mod
    const goModPath = path.join(this.projectPath, 'go.mod');
    if (fs.existsSync(goModPath)) {
      try {
        const content = fs.readFileSync(goModPath, 'utf-8');
        const requireBlock = content.match(/require\s*\(([\s\S]*?)\)/);
        if (requireBlock) {
          const lines = requireBlock[1].split('\n').filter(l => l.trim());
          for (const line of lines) {
            const match = line.trim().match(/^(\S+)/);
            if (match) deps.push(match[1]);
          }
        }
        // Single require
        const singleRequire = content.match(/^require\s+(\S+)/m);
        if (singleRequire && !requireBlock) {
          deps.push(singleRequire[1]);
        }
      } catch { /* ignore */ }
    }

    // Cargo.toml
    const cargoPath = path.join(this.projectPath, 'Cargo.toml');
    if (fs.existsSync(cargoPath)) {
      try {
        const content = fs.readFileSync(cargoPath, 'utf-8');
        const depsSection = content.match(/\[dependencies\]([\s\S]*?)(?:\[|$)/);
        if (depsSection) {
          const lines = depsSection[1].split('\n').filter(l => l.trim() && !l.trim().startsWith('#'));
          for (const line of lines) {
            const match = line.trim().match(/^(\w[\w-]*)/);
            if (match) deps.push(match[1]);
          }
        }
      } catch { /* ignore */ }
    }

    // requirements.txt
    const reqPath = path.join(this.projectPath, 'requirements.txt');
    if (fs.existsSync(reqPath)) {
      try {
        const lines = fs.readFileSync(reqPath, 'utf-8').split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('-')) {
            const match = trimmed.match(/^([\w][\w.-]*)/);
            if (match) deps.push(match[1]);
          }
        }
      } catch { /* ignore */ }
    }

    return deps;
  }

  private isDevDependency(dep: string): boolean {
    const pkgJsonPath = path.join(this.projectPath, 'package.json');
    if (fs.existsSync(pkgJsonPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));
        return dep in (pkg.devDependencies || {});
      } catch { /* ignore */ }
    }
    return false;
  }

  private extractPackageName(filePath: string): string | null {
    // Extract package name from file path
    // e.g., "node_modules/lodash/index.js" -> "lodash"
    // e.g., "../../some-pkg/util.ts" -> hard to determine without node_modules
    const parts = filePath.split('/');

    // Check if it's in node_modules
    const nmIdx = parts.indexOf('node_modules');
    if (nmIdx !== -1) {
      const pkgPart = parts[nmIdx + 1];
      if (pkgPart?.startsWith('@')) {
        return `${pkgPart}/${parts[nmIdx + 2]}`;
      }
      return pkgPart || null;
    }

    // For non-node_modules paths, extract relative package
    // This is a heuristic — we check the import path pattern
    if (parts[0] === '..' || parts[0] === '.') {
      return null; // Local import, not a package
    }

    return null;
  }

  private extractImportsFromSource(sourceCode: string): string[] {
    const packages: string[] = [];
    const importRegex = /(?:import\s+.*?\s+from\s+['"]([^'"]+)['"]|import\s+['"]([^'"]+)['"]|require\s*\(\s*['"]([^'"]+)['"]\s*\))/g;
    let match;

    while ((match = importRegex.exec(sourceCode)) !== null) {
      const spec = match[1] || match[2] || match[3];
      if (!spec) continue;

      // Skip relative imports
      if (spec.startsWith('.') || spec.startsWith('/')) continue;

      // Skip common false positives (file extensions, paths with dots)
      if (spec.includes('.') && !spec.startsWith('@')) continue;

      // Skip common non-package strings
      if (['file', 'module', 'source', 'path', 'lines', 'code'].includes(spec.toLowerCase())) continue;

      // Extract package name (handle scoped packages)
      if (spec.startsWith('@')) {
        const parts = spec.split('/');
        if (parts.length >= 2) {
          packages.push(`${parts[0]}/${parts[1]}`);
        }
      } else {
        packages.push(spec.split('/')[0]);
      }
    }

    return packages;
  }

  private extractDynamicImports(sourceCode: string): string[] {
    const packages: string[] = [];
    // Match dynamic imports: import('package-name')
    const dynamicImportRegex = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    let match;

    while ((match = dynamicImportRegex.exec(sourceCode)) !== null) {
      const spec = match[1];
      if (spec.startsWith('.') || spec.startsWith('/')) continue;

      if (spec.startsWith('@')) {
        const parts = spec.split('/');
        if (parts.length >= 2) {
          packages.push(`${parts[0]}/${parts[1]}`);
        }
      } else {
        packages.push(spec.split('/')[0]);
      }
    }

    return packages;
  }

  private buildSummary(
    circular: CircularDep[],
    unused: string[],
    unlisted: string[],
    declared: string[],
    score: number,
  ): string {
    const parts: string[] = [];
    parts.push(`📦 Dependency Health: ${score}/100`);
    parts.push('═'.repeat(40));

    if (circular.length > 0) {
      parts.push(`\n🔄 Circular Dependencies (${circular.length}):`);
      for (const c of circular) {
        parts.push(`  ${c.chain.join(' → ')}`);
      }
    }

    if (unused.length > 0) {
      parts.push(`\n🗑️  Unused Dependencies (${unused.length}):`);
      for (const u of unused) {
        parts.push(`  - ${u}`);
      }
    }

    if (unlisted.length > 0) {
      parts.push(`\n⚠️  Unlisted Dependencies (${unlisted.length}):`);
      for (const u of unlisted) {
        parts.push(`  - ${u}`);
      }
    }

    if (circular.length === 0 && unused.length === 0 && unlisted.length === 0) {
      parts.push('\n✅ All dependencies look healthy!');
    }

    parts.push(`\n📊 Declared: ${declared.length} | Unused: ${unused.length} | Unlisted: ${unlisted.length} | Circular: ${circular.length}`);

    return parts.join('\n');
  }
}
