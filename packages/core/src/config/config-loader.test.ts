// ============================================================
// Config Loader Unit Tests
// ============================================================

import { describe, it, expect, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { loadConfig } from './config-loader.js';

describe('ConfigLoader', () => {
  const baseTmp = path.join(os.tmpdir(), 'codeatlas-config-test-' + Date.now());

  afterAll(() => {
    try { fs.rmSync(baseTmp, { recursive: true }); } catch { /* ignore */ }
  });

  function writeYaml(dir: string, yaml: string): void {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, '.codeatlas.yaml'), yaml, 'utf-8');
  }

  it('should load and parse simple config', () => {
    const dir = path.join(baseTmp, 'simple');
    writeYaml(dir, `name: test-project\nversion: "1.0"\n`);
    const config = loadConfig(dir);
    expect(config.name).toBe('test-project');
    expect(config.version).toBe('1.0');
  });

  it('should return defaults for missing config', () => {
    const dir = path.join(baseTmp, 'missing');
    fs.mkdirSync(dir, { recursive: true });
    const config = loadConfig(dir);
    expect(config).toBeDefined();
    expect(typeof config.name).toBe('string'); // has default
  });

  it('should parse scan.exclude list', () => {
    const dir = path.join(baseTmp, 'exclude');
    writeYaml(dir, `scan:\n  exclude:\n    - node_modules\n    - dist\n`);
    const config = loadConfig(dir);
    expect(config.scan?.exclude).toBeDefined();
  });

  it('should parse scan.include list', () => {
    const dir = path.join(baseTmp, 'include');
    writeYaml(dir, `scan:\n  include:\n    - "src/**"\n    - "lib/**"\n`);
    const config = loadConfig(dir);
    expect(config.scan?.include).toBeDefined();
  });

  it('should merge config with defaults', () => {
    const dir = path.join(baseTmp, 'merge');
    writeYaml(dir, `name: my-project\n`);
    const config = loadConfig(dir);
    expect(config.name).toBe('my-project');
  });
});
