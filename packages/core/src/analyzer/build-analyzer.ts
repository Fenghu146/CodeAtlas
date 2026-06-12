// ============================================================
// Build Analyzer - Parses build system configurations
// ============================================================
// Supports: platformio.ini, CMakeLists.txt, Makefile
// Extracts: dependencies, build flags, target platforms

import fs from 'fs';
import path from 'path';

export interface BuildConfig {
  /** Build system type */
  type: 'platformio' | 'cmake' | 'makefile' | 'unknown';
  /** Project name */
  name?: string;
  /** Target platform */
  platform?: string;
  /** Target board */
  board?: string;
  /** Framework */
  framework?: string;
  /** Dependencies (libraries) */
  dependencies: string[];
  /** Build flags */
  flags: string[];
  /** Include paths */
  includes: string[];
  /** Source directories */
  sources: string[];
  /** Raw config content */
  raw?: string;
}

export interface LibraryInfo {
  /** Library name */
  name: string;
  /** Library version */
  version?: string;
  /** Is it a system library */
  isSystem: boolean;
  /** Is it a vendor library */
  isVendor: boolean;
}

/**
 * Parses build system configurations for embedded projects.
 */
export class BuildAnalyzer {
  private projectPath: string;

  constructor(projectPath: string) {
    this.projectPath = projectPath;
  }

  /**
   * Detect and parse the build system configuration.
   * Searches current directory and parent directories.
   */
  analyze(): BuildConfig {
    // Search current directory and up to 5 parent directories
    let searchPath = this.projectPath;
    for (let i = 0; i < 6; i++) {
      // Try platformio.ini
      const pioConfig = this.parsePlatformIO(searchPath);
      if (pioConfig) return pioConfig;

      // Try CMakeLists.txt
      const cmakeConfig = this.parseCMake(searchPath);
      if (cmakeConfig) return cmakeConfig;

      // Try Makefile
      const makefileConfig = this.parseMakefile(searchPath);
      if (makefileConfig) return makefileConfig;

      // Try Cargo.toml (for Rust embedded)
      const cargoConfig = this.parseCargo(searchPath);
      if (cargoConfig) return cargoConfig;

      // Move to parent directory
      const parent = path.dirname(searchPath);
      if (parent === searchPath) break; // Reached root
      searchPath = parent;
    }

    return { type: 'unknown', dependencies: [], flags: [], includes: [], sources: [] };
  }

  /**
   * Get library information (vendor vs user libraries).
   */
  getLibraries(): LibraryInfo[] {
    const config = this.analyze();
    return config.dependencies.map(dep => ({
      name: dep,
      isSystem: this.isSystemLibrary(dep),
      isVendor: this.isVendorLibrary(dep, config),
    }));
  }

  /**
   * Get files to exclude (vendor/system libraries).
   */
  getExcludePatterns(): string[] {
    const libraries = this.getLibraries();
    const patterns: string[] = [];

    for (const lib of libraries) {
      if (lib.isVendor || lib.isSystem) {
        patterns.push(`**/${lib.name}/**`);
      }
    }

    // Common vendor directories
    patterns.push(
      'lib/**', 'Lib/**',
      '.pio/libdeps/**',
      'vendor/**',
      'external/**',
      'third_party/**',
      'Drivers/**',  // STM32 HAL drivers
      'Components/**',  // ESP-IDF components
    );

    return patterns;
  }

  // ========================
  // PlatformIO Parser
  // ========================

  private parsePlatformIO(searchPath: string): BuildConfig | null {
    const iniPath = path.join(searchPath, 'platformio.ini');
    if (!fs.existsSync(iniPath)) return null;

    try {
      const content = fs.readFileSync(iniPath, 'utf-8');
      const config: BuildConfig = {
        type: 'platformio',
        dependencies: [],
        flags: [],
        includes: [],
        sources: [],
        raw: content,
      };

      // Parse [env] sections
      const envRegex = /\[env:(\w+)\]/g;
      let match;
      while ((match = envRegex.exec(content)) !== null) {
        config.name = match[1];
      }

      // Parse platform
      const platformMatch = content.match(/platform\s*=\s*(\S+)/);
      if (platformMatch) config.platform = platformMatch[1];

      // Parse board
      const boardMatch = content.match(/board\s*=\s*(\S+)/);
      if (boardMatch) config.board = boardMatch[1];

      // Parse framework
      const frameworkMatch = content.match(/framework\s*=\s*(\S+)/);
      if (frameworkMatch) config.framework = frameworkMatch[1];

      // Parse lib_deps
      const libDepsMatch = content.match(/lib_deps\s*=\s*([\s\S]*?)(?=\n\[|\n$)/);
      if (libDepsMatch) {
        const deps = libDepsMatch[1].split('\n')
          .map(l => l.trim())
          .filter(l => l && !l.startsWith(';'));
        config.dependencies.push(...deps);
      }

      // Parse build_flags
      const flagsMatch = content.match(/build_flags\s*=\s*([\s\S]*?)(?=\n\[|\n$)/);
      if (flagsMatch) {
        const flags = flagsMatch[1].split('\n')
          .map(l => l.trim())
          .filter(l => l && !l.startsWith(';'));
        config.flags.push(...flags);
      }

      // Parse build_src_filter (source directories)
      const srcMatch = content.match(/build_src_filter\s*=\s*([\s\S]*?)(?=\n\[|\n$)/);
      if (srcMatch) {
        const srcs = srcMatch[1].split('\n')
          .map(l => l.trim())
          .filter(l => l && !l.startsWith(';'));
        config.sources.push(...srcs);
      }

      return config;
    } catch {
      return null;
    }
  }

  // ========================
  // CMake Parser
  // ========================

  private parseCMake(searchPath: string): BuildConfig | null {
    const cmakePath = path.join(searchPath, 'CMakeLists.txt');
    if (!fs.existsSync(cmakePath)) return null;

    try {
      const content = fs.readFileSync(cmakePath, 'utf-8');
      const config: BuildConfig = {
        type: 'cmake',
        dependencies: [],
        flags: [],
        includes: [],
        sources: [],
        raw: content,
      };

      // Parse project name
      const projectMatch = content.match(/project\s*\(\s*(\w+)/);
      if (projectMatch) config.name = projectMatch[1];

      // Parse target_link_libraries
      const linkMatch = content.match(/target_link_libraries\s*\([^)]+\s+(\S[\s\S]*?)\)/);
      if (linkMatch) {
        const deps = linkMatch[1].split(/\s+/).filter(d => d && !d.startsWith('-'));
        config.dependencies.push(...deps);
      }

      // Parse include_directories
      const includeMatch = content.match(/include_directories\s*\(([\s\S]*?)\)/);
      if (includeMatch) {
        const includes = includeMatch[1].split('\n')
          .map(l => l.trim())
          .filter(l => l && !l.startsWith('#'));
        config.includes.push(...includes);
      }

      // Parse add_executable sources
      const srcMatch = content.match(/add_executable\s*\(\s*\w+\s+([\s\S]*?)\)/);
      if (srcMatch) {
        const srcs = srcMatch[1].split(/\s+/).filter(s => s.endsWith('.c') || s.endsWith('.cpp'));
        config.sources.push(...srcs);
      }

      // Parse compile definitions
      const defMatch = content.match(/target_compile_definitions\s*\([^)]+\s+(\S[\s\S]*?)\)/);
      if (defMatch) {
        const defs = defMatch[1].split(/\s+/).filter(d => d.startsWith('-D'));
        config.flags.push(...defs);
      }

      return config;
    } catch {
      return null;
    }
  }

  // ========================
  // Makefile Parser
  // ========================

  private parseMakefile(searchPath: string): BuildConfig | null {
    const makefilePath = path.join(searchPath, 'Makefile');
    if (!fs.existsSync(makefilePath)) return null;

    try {
      const content = fs.readFileSync(makefilePath, 'utf-8');
      const config: BuildConfig = {
        type: 'makefile',
        dependencies: [],
        flags: [],
        includes: [],
        sources: [],
        raw: content,
      };

      // Parse TARGET
      const targetMatch = content.match(/TARGET\s*[:?]?=\s*(\S+)/);
      if (targetMatch) config.name = targetMatch[1];

      // Parse SRCS
      const srcsMatch = content.match(/SRCS\s*[:?]?=\s*([\s\S]*?)(?=\n[A-Z]|\n$)/);
      if (srcsMatch) {
        const srcs = srcsMatch[1].split(/\s+/).filter(s => s.endsWith('.c') || s.endsWith('.cpp'));
        config.sources.push(...srcs);
      }

      // Parse CFLAGS
      const cflagsMatch = content.match(/CFLAGS\s*[:?]?=\s*([\s\S]*?)(?=\n[A-Z]|\n$)/);
      if (cflagsMatch) {
        const flags = cflagsMatch[1].split(/\s+/).filter(f => f.startsWith('-'));
        config.flags.push(...flags);
      }

      // Parse INCLUDES
      const includesMatch = content.match(/INCLUDES\s*[:?]?=\s*([\s\S]*?)(?=\n[A-Z]|\n$)/);
      if (includesMatch) {
        const includes = includesMatch[1].split(/\s+/).filter(i => i.startsWith('-I'));
        config.includes.push(...includes);
      }

      return config;
    } catch {
      return null;
    }
  }

  // ========================
  // Cargo.toml Parser (Rust embedded)
  // ========================

  private parseCargo(searchPath: string): BuildConfig | null {
    const cargoPath = path.join(searchPath, 'Cargo.toml');
    if (!fs.existsSync(cargoPath)) return null;

    try {
      const content = fs.readFileSync(cargoPath, 'utf-8');
      const config: BuildConfig = {
        type: 'unknown', // Cargo is not one of the standard types
        dependencies: [],
        flags: [],
        includes: [],
        sources: [],
        raw: content,
      };

      // Parse package name
      const nameMatch = content.match(/name\s*=\s*"(\S+)"/);
      if (nameMatch) config.name = nameMatch[1];

      // Parse dependencies
      const depsSection = content.match(/\[dependencies\]([\s\S]*?)(?:\[|$)/);
      if (depsSection) {
        const lines = depsSection[1].split('\n').filter(l => l.trim() && !l.trim().startsWith('#'));
        for (const line of lines) {
          const match = line.trim().match(/^(\w[\w-]*)/);
          if (match) config.dependencies.push(match[1]);
        }
      }

      return config;
    } catch {
      return null;
    }
  }

  // ========================
  // Helper Methods
  // ========================

  private isSystemLibrary(name: string): boolean {
    const systemLibs = [
      'libc', 'libm', 'libgcc', 'newlib',
      'FreeRTOS', 'CMSIS', 'HAL', 'LL',
      'Arduino', 'Wire', 'SPI', 'Serial',
    ];
    return systemLibs.some(lib => name.includes(lib));
  }

  private isVendorLibrary(name: string, config: BuildConfig): boolean {
    const vendorPatterns = [
      'STM32', 'ESP-IDF', 'esp-idf',
      'NXP', 'TI', 'Microchip', 'Renesas',
      'ST', 'Espressif',
    ];
    return vendorPatterns.some(p => name.includes(p) || config.platform?.includes(p));
  }
}
