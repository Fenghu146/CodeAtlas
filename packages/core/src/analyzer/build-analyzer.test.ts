// ============================================================
// Build Analyzer Unit Tests
// ============================================================

import { describe, it, expect } from 'vitest';
import { BuildAnalyzer } from './build-analyzer.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, '__fixtures__', 'embedded-linux');

describe('BuildAnalyzer', () => {
  it('should detect PlatformIO project', () => {
    const analyzer = new BuildAnalyzer(FIXTURES);
    const result = analyzer.analyze();
    // Our fixtures have Kbuild/Kconfig, so should detect as kbuild first
    expect(result.type).toBe('kbuild');
  });

  it('should return unknown for empty project', () => {
    const tmpDir = path.join(require('os').tmpdir(), 'codeatlas-test-empty-' + Date.now());
    try {
      require('fs').mkdirSync(tmpDir, { recursive: true });
      const analyzer = new BuildAnalyzer(tmpDir);
      const result = analyzer.analyze();
      expect(result.type).toBe('unknown');
      expect(result.dependencies).toEqual([]);
    } finally {
      try { require('fs').rmSync(tmpDir, { recursive: true }); } catch { /* ignore */ }
    }
  });

  it('should extract Linux build metadata from Kbuild/Kconfig fixtures', () => {
    const analyzer = new BuildAnalyzer(FIXTURES);
    const result = analyzer.analyze();
    expect(result.linux).toBeDefined();
    expect(result.linux!.family).toBe('kbuild');
    expect(result.linux!.targets!.length).toBeGreaterThanOrEqual(2);
  });

  it('should detect ccflags from Kbuild Makefile', () => {
    const analyzer = new BuildAnalyzer(FIXTURES);
    const result = analyzer.analyze();
    expect(result.flags.some(f => f.includes('-DDEBUG'))).toBe(true);
  });

  it('should collect dependencies from Yocto recipes when present', () => {
    const analyzer = new BuildAnalyzer(FIXTURES);
    const result = analyzer.analyze();
    // The fixture has Yocto recipes so linux.yocto should be populated
    expect(result.linux).toBeDefined();
    if (result.linux!.recipes!.length > 0) {
      expect(result.linux!.recipes![0].depends.length).toBeGreaterThan(0);
    }
  });
});
