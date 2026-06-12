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

    // For C/C++ projects, scan source files for #include directives
    // (symbol-level sourceCode only stores the declaration line, not file-level includes)
    try {
      const cppIncludes = this.scanCppIncludes();
      for (const inc of cppIncludes) {
        importedPackages.add(inc);
      }
    } catch { /* ignore */ }

    // Find unused (declared but not imported)
    const unused = declared.filter(dep => {
      const normalizedDep = dep.replace(/^@[^/]+\//, '');
      // For PlatformIO-style deps (owner/name), also check just the short name
      const shortName = dep.includes('/') ? dep.split('/')[1] : null;
      const shortNameCleaned = shortName ? shortName.split('@')[0].trim() : null;
      return !this.isDepInImports(importedPackages, dep) &&
             !this.isDepInImports(importedPackages, normalizedDep) &&
             !(shortNameCleaned && this.isDepInImports(importedPackages, shortNameCleaned)) &&
             !this.isDevDependency(dep);
    });

    // Find unlisted (imported but not declared)
    const unlisted = Array.from(importedPackages).filter(pkg => {
      // Skip project-internal includes
      if (this.isLocalProjectHeader(pkg)) return false;
      // Skip framework/auto-installed transitive deps
      if (this.isFrameworkHeader(pkg)) return false;
      // Skip common non-package artifacts
      if (['service', 'driver', 'api', 'hardware', 'font', 'canvas',
           'gfxfont', 'math', 'float', 'avr', 'pgmspace', 'sys',
           'platform', 'REG', 'VNC', 'VNC_config', 'databus', 'display',
           'esp32c3', 'esp32s3',
          ].includes(pkg)) return false;
      return !declared.some(dep => this.isDepMatch(dep, pkg));
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

    // platformio.ini (embedded C/C++ projects)
    const platformioPath = path.join(this.projectPath, 'platformio.ini');
    if (fs.existsSync(platformioPath)) {
      try {
        const content = fs.readFileSync(platformioPath, 'utf-8');
        deps.push(...this.parsePlatformioDeps(content));
      } catch { /* ignore */ }
    }

    return deps;
  }

  /** Parse PlatformIO lib_deps from platformio.ini */
  private parsePlatformioDeps(content: string): string[] {
    const deps: string[] = [];
    // Match lib_deps blocks inside [env:*] sections
    // Format: lib_deps = owner/name@version (one per line)
    const envSections = content.match(/\[env:.*?\](?:[^[]|\[(?!env:))*/gs);
    if (envSections) {
      for (const section of envSections) {
        const libMatch = section.match(/^lib_deps\s*=\s*([\s\S]*?)(?:\n\[|\n$)/m);
        if (libMatch) {
          const libLines = libMatch[1].split('\n').filter(l => l.trim());
          for (const line of libLines) {
            const trimmed = line.trim();
            // Handle: owner/name@version or name@version or just name
            const libName = trimmed.split('@')[0].split('//')[0].trim();
            if (libName) deps.push(libName);
          }
        }
      }
    }
    return [...new Set(deps)];
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

    // Check if it's in PlatformIO library directory (.pio/libdeps/<env>/)
    const pioIdx = parts.indexOf('libdeps');
    if (pioIdx !== -1 && parts[pioIdx - 1] === '.pio') {
      return parts[pioIdx + 2] || null;  // .pio/libdeps/esp32s3/<libname>/...
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

    // C/C++ includes: #include <library/header.h> or #include "library/header.h"
    const cppIncludeRegex = /#include\s*[<"]([^>"]+)[>"]/g;
    while ((match = cppIncludeRegex.exec(sourceCode)) !== null) {
      const include = match[1];
      if (!include) continue;

      // Extract the top-level library name from <lib_name/header.h>
      const parts = include.split('/');
      if (parts.length >= 2) {
        packages.push(parts[0]);
      } else {
        // Single header like <lvgl.h> — try to strip extension
        const headerName = parts[0].replace(/\.h(h|pp|xx)?$/, '');
        // Map known single-header libraries to their package names
        const knownHeaders: Record<string, string> = {
          'lvgl': 'lvgl',
          'ArduinoJson': 'ArduinoJson',
          'WiFi': 'esp32',
          'BluetoothSerial': 'esp32',
          'FS': 'esp32',
          'SD': 'esp32',
          'SPI': 'esp32',
          'Wire': 'esp32',
          'HTTPClient': 'esp32',
        };
        if (knownHeaders[headerName]) {
          packages.push(knownHeaders[headerName]);
        } else if (headerName.length > 2) {
          packages.push(headerName);
        }
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

  /** System/framework header prefixes that are NOT external packages */
  private readonly SYSTEM_HEADER_PREFIXES = [
    'esp_', 'freertos', 'driver', 'hal', 'soc', 'sdkconfig',
    'std', 'string', 'cmath', 'cstd', 'cint', 'cstr',
    'sys/', 'linux/', 'asm/',
  ];

  /** Well-known Arduino-ESP32 framework headers (auto-available, not external deps) */
  private readonly ARDUINO_FRAMEWORK_HEADERS = new Set([
    'Arduino', 'WiFi', 'BluetoothSerial', 'FS', 'SD',
    'SPI', 'Wire', 'HTTPClient', 'Update', 'time',
    'Preferences', 'SD_MMC', 'esp_now', 'BLEAdvertisedDevice',
    'BLEClient', 'BLEDevice', 'BLEServer', 'BLEUtils', 'BLE2902',
    'BLEScan', 'BLECharacteristic', 'BLEDescriptor', 'BLEService',
    'BLESecurity', 'BLEAddress', 'BLEBeacon', 'BLEEddystoneURL',
    'Print', 'Stream', 'WString', 'String',
  ]);

  /** Filter out known framework / auto-installed transitive deps from unlisted */
  private isFrameworkHeader(name: string): boolean {
    return this.ARDUINO_FRAMEWORK_HEADERS.has(name) ||
           name.startsWith('Arduino_') ||
           name.startsWith('Adafruit_') ||
           name.startsWith('Sensor') ||
           name.startsWith('XPowers') ||
           name.startsWith('Powers') ||
           name === 'esp32' || name === 'esp32s3' || name === 'api' ||
           name === 'font' || name === 'canvas' || name === 'gfxfont' ||
           name === 'avr' || name === 'pgmspace' || name === 'sys' ||
           name === 'float' || name === 'hardware' || name === 'platform' ||
           name === 'REG' || name === 'databus' || name === 'display' ||
           name === 'VNC' || name === 'VNC_config' || name === 'driver' ||
           name === 'lv_demo_benchmark' || name === 'math' ||
           name === 'JPEGDEC' || name === 'ESP32_JPEG_Library';
  }

  /** Check if a dependency name appears in the imported packages set */
  private isDepInImports(importedPackages: Set<string>, dep: string): boolean {
    // Direct match, or partial match: e.g. "lvgl" matches "lvgl/lvgl"
    return importedPackages.has(dep) ||
           [...importedPackages].some(pkg => pkg.includes(dep));
  }

  /** Check if a declared dependency matches a detected package name */
  private isDepMatch(declared: string, pkg: string): boolean {
    if (declared === pkg) return true;
    if (pkg.startsWith(declared + '/')) return true;
    // PlatformIO: "owner/name" — check if pkg matches the short name
    const shortName = declared.includes('/') ? declared.split('/')[1]?.split('@')[0]?.trim() : null;
    if (shortName && (pkg === shortName || pkg.includes(shortName))) return true;
    return false;
  }

  /** Check if a package name looks like a local project header */
  private isLocalProjectHeader(name: string): boolean {
    // Project-internal service files: audio, ble_hid, tf_card, etc.
    const localServices = ['audio', 'ble_hid', 'ble_srv', 'ble_hid',
      'ota_update', 'wifi_ntp', 'tf_card', 'voice_chat',
      'activity', 'weather', 'player', 'stopwatch', 'backlight',
      'watch_faces', 'ui_pages', 'settings_page',
      'step_counter', 'sleep_tracker', 'motion_intensity',
      'notif_history', 'quick_panel', 'sensor_task',
      'fall_detect', 'debug_log', 'ui_styles',
      'lv_port_indev', 'lv_port_disp',
    ];
    return localServices.includes(name);
  }

  /** Scan C/C++ source files for #include directives (file-level) */
  private scanCppIncludes(): string[] {
    const packages: string[] = [];
    const srcExts = ['.cpp', '.h', '.hpp', '.hh', '.c', '.cc', '.cxx', '.hxx'];

    // Build a set of local headers for filtering (headers that belong to this project)
    const localHeaders = new Set<string>();
    const collectLocalHeaders = (dir: string): void => {
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isFile()) {
            const name = entry.name.toLowerCase();
            if (name.endsWith('.h') || name.endsWith('.hpp')) {
              localHeaders.add(entry.name);
            }
          }
        }
      } catch { /* skip */ }
    };
    for (const subDir of ['src', 'lib', 'include']) {
      const dir = path.join(this.projectPath, subDir);
      if (fs.existsSync(dir)) collectLocalHeaders(dir);
    }

    const isSystemHeader = (name: string): boolean =>
      this.SYSTEM_HEADER_PREFIXES.some(p => name.startsWith(p));

    const SKIP_DIRS = new Set(['.', 'node_modules', '.pio', '.git', '__pycache__',
      'build', 'dist', '.build', 'target']);

    const collectIncludes = (dir: string): void => {
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            if (!entry.name.startsWith('.') && !SKIP_DIRS.has(entry.name)) {
              collectIncludes(fullPath);
            }
          } else if (entry.isFile()) {
            const ext = path.extname(entry.name).toLowerCase();
            if (srcExts.includes(ext)) {
              const content = fs.readFileSync(fullPath, 'utf-8');
              const includeRe = /#include\s*[<"]([^>"]+)[>"]/g;
              let m: RegExpExecArray | null;
              while ((m = includeRe.exec(content)) !== null) {
                const include = m[1];
                // Skip local project headers (included by name or path)
                const includeBase = include.split('/').pop() || include;
                if (localHeaders.has(include) || localHeaders.has(includeBase)) continue;

                const parts = include.split('/');
                const topLevel = parts[0].replace(/\.h(h|pp|xx)?$/, '');
                // Skip system/framework headers
                if (isSystemHeader(topLevel)) continue;
                // Skip single-dir noise
                if (topLevel === '.' || topLevel === '..' || topLevel === '') continue;

                if (parts.length >= 2) {
                  // Only push if it doesn't look like a local relative path
                  const topDir = parts[0];
                  if (topDir !== '.' && topDir !== '..' && !localHeaders.has(parts[parts.length - 1])) {
                    packages.push(topDir);
                  }
                } else {
                  const knownHeaders: Record<string, string> = {
                    'lvgl': 'lvgl', 'CST816S': 'CST816S',
                    'ArduinoJson': 'ArduinoJson',
                    'WiFi': 'esp32', 'BluetoothSerial': 'esp32',
                    'FS': 'esp32', 'SD': 'esp32',
                    'SPI': 'esp32', 'Wire': 'esp32',
                  };
                  if (knownHeaders[topLevel]) {
                    packages.push(knownHeaders[topLevel]);
                  } else if (topLevel.length > 2) {
                    packages.push(topLevel);
                  }
                }
              }
            }
          }
        }
      } catch { /* skip unreadable dirs */ }
    };

    for (const subDir of ['src', 'lib', 'include', 'source']) {
      const dir = path.join(this.projectPath, subDir);
      if (fs.existsSync(dir)) collectIncludes(dir);
    }

    return [...new Set(packages)];
  }

  /**
   * Build a human-readable summary of dependency health.
   */
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
