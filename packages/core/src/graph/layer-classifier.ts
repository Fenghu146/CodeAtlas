// ============================================================
// Layer Classifier - Identifies architectural layers of code
// ============================================================
// Uses a rule-based engine to classify each symbol into one of:
//   interface | business | data | utility | unknown
//
// Rules match on: file path patterns, naming conventions,
// import dependencies, code structure, and decorators.

import type { Symbol, Relationship, FileInfo, Layer } from './types.js';
import picomatch from 'picomatch';

interface PathRule {
  kind: 'path';
  patterns: string[];
  weight: number;
}

interface NamingRule {
  kind: 'naming';
  patterns: string[];
  weight: number;
}

interface ImportRule {
  kind: 'import';
  patterns: string[];
  weight: number;
}

interface CodeRule {
  kind: 'code';
  patterns: string[];
  weight: number;
}

type LayerRule = PathRule | NamingRule | ImportRule | CodeRule;

/** Default layer classification rules */
const LAYER_RULES: Record<Layer, LayerRule[]> = {
  interface: [
    // Web/JS patterns
    { kind: 'path', patterns: [
      '**/routes/**', '**/controllers/**', '**/views/**',
      '**/pages/**', '**/components/**', '**/screens/**',
      '**/*.controller.*', '**/*.handler.*', '**/*.route.*',
      '**/*.view.*', '**/*.page.*', '**/*.component.*',
    ], weight: 3 },
    { kind: 'naming', patterns: [
      'Controller', 'Handler', 'Router', 'Middleware',
      'View', 'Page', 'Component', 'Screen', 'Layout',
      'Template', 'Action', 'Endpoint',
      'setupEventListeners', 'cycleLayout', 'render', 'draw',
      'addEventListener', 'removeEventListener',
    ], weight: 3 },
    { kind: 'import', patterns: [
      'express', 'fastify', 'koa', 'hono',
      'next/router', 'react-router', 'vue-router',
      'react', 'vue', 'svelte', 'angular',
    ], weight: 2 },
    // Embedded UI patterns (LVGL, etc.)
    { kind: 'naming', patterns: [
      'ui_', '_ui', 'gui_', '_gui', 'display_', 'screen_',
      'lv_', '_lv', 'widget', 'button', 'menu',
      'draw', 'render', 'paint', 'canvas',
    ], weight: 3 },
    { kind: 'path', patterns: [
      '**/ui/**', '**/gui/**', '**/display/**', '**/screen/**',
      '**/views/**', '**/widgets/**', '**/pages/**',
    ], weight: 3 },
  ],

  business: [
    // Web/JS patterns
    { kind: 'path', patterns: [
      '**/services/**', '**/domain/**', '**/models/**',
      '**/entities/**', '**/usecases/**', '**/core/**',
      '**/*.service.*', '**/*.usecase.*', '**/*.manager.*',
    ], weight: 3 },
    { kind: 'naming', patterns: [
      'Service', 'Manager', 'Processor', 'UseCase',
      'Validator', 'Factory', 'Strategy', 'Builder',
      'Handler', 'Executor', 'Orchestrator',
    ], weight: 2 },
    // Embedded application logic patterns
    { kind: 'naming', patterns: [
      'init', 'setup', 'loop', 'main', 'task', 'run',
      'start', 'stop', 'reset', 'update', 'process',
      'handle', 'dispatch', 'event', 'callback',
    ], weight: 2 },
    { kind: 'path', patterns: [
      '**/src/**', '**/app/**', '**/application/**',
    ], weight: 1 },
  ],

  data: [
    // Web/JS patterns
    { kind: 'path', patterns: [
      '**/repositories/**', '**/dal/**', '**/database/**',
      '**/migrations/**', '**/schemas/**', '**/stores/**',
      '**/*.repository.*', '**/*.dao.*', '**/*.mapper.*',
      '**/*.model.*', '**/*.entity.*',
    ], weight: 3 },
    { kind: 'import', patterns: [
      'prisma', 'typeorm', 'sequelize', 'mongoose',
      'knex', 'drizzle', 'sqlalchemy', 'pg', 'mysql2',
      'sqlite', 'redis',
    ], weight: 2 },
    { kind: 'naming', patterns: [
      'Repository', 'DAO', 'Mapper', 'Schema',
      'Migration', 'Store', 'Adapter', 'Gateway',
    ], weight: 2 },
    { kind: 'code', patterns: [
      'SELECT ', 'INSERT ', 'UPDATE ', 'DELETE ',
      'db.query', 'prisma.', 'typeorm.',
    ], weight: 1 },
    // Embedded data/storage patterns
    { kind: 'naming', patterns: [
      'nvs_', 'eeprom_', 'flash_', 'storage_', 'persist_',
      'save', 'load', 'read', 'write', 'get', 'set',
      'database', 'db_', 'cache_',
    ], weight: 3 },
    { kind: 'import', patterns: [
      'nvs', 'eeprom', 'flash', 'spi', 'i2c', 'uart',
      'wire', 'serial', 'hardware',
    ], weight: 2 },
  ],

  utility: [
    // Web/JS patterns
    { kind: 'path', patterns: [
      '**/utils/**', '**/helpers/**', '**/lib/**',
      '**/common/**', '**/shared/**', '**/tools/**',
      '**/*.util.*', '**/*.helper.*', '**/*.config.*',
    ], weight: 3 },
    { kind: 'naming', patterns: [
      'util', 'helper', 'format', 'parse', 'validate',
      'transform', 'logger', 'config', 'constants',
      'types', 'interfaces',
      'substitute', 'env', 'merge', 'deepMerge',
    ], weight: 2 },
    // Embedded utility patterns
    { kind: 'naming', patterns: [
      'debug_', 'log_', 'print_', 'printf',
      'math_', 'calc_', 'convert_', 'transform_',
      'timer_', 'delay_', 'sleep_',
      'string_', 'str_', 'mem_', 'memcpy',
    ], weight: 3 },
    { kind: 'path', patterns: [
      '**/utils/**', '**/helpers/**', '**/common/**',
      '**/debug/**', '**/log/**', '**/math/**',
    ], weight: 2 },
  ],

  unknown: [],
};

/**
 * Classifies symbols into architectural layers using a weighted rule engine.
 * 
 * For each symbol, all rules are evaluated. The layer with the highest
 * total weight wins. Ties are broken by priority:
 * interface > data > business > utility > unknown
 */
export class LayerClassifier {
  private rules = LAYER_RULES;

  /**
   * Classify all symbols in the graph.
   * Modifies symbols in-place by setting their `layer` property.
   */
  classify(
    symbols: Map<string, Symbol>,
    relationships: Relationship[],
    files: Map<string, FileInfo>,
  ): void {
    for (const symbol of symbols.values()) {
      symbol.layer = this.classifySymbol(symbol, files);
    }
  }

  /** Classify a single symbol */
  private classifySymbol(symbol: Symbol, files: Map<string, FileInfo>): Layer {
    const scores: Record<Layer, number> = {
      interface: 0,
      business: 0,
      data: 0,
      utility: 0,
      unknown: 0,
    };

    const fileInfo = files.get(symbol.filePath);

    for (const [layer, rules] of Object.entries(this.rules)) {
      for (const rule of rules) {
        if (this.matchRule(rule, symbol, fileInfo)) {
          scores[layer as Layer] += rule.weight;
        }
      }
    }

    // Find the layer with the highest score
    let bestLayer: Layer = 'unknown';
    let bestScore = 0;

    // Priority order for tie-breaking
    const priority: Layer[] = ['interface', 'data', 'business', 'utility'];
    
    for (const layer of priority) {
      if (scores[layer] > bestScore) {
        bestScore = scores[layer];
        bestLayer = layer;
      }
    }

    // If no rules matched, default to 'business' (most code is business logic)
    if (bestScore === 0) {
      bestLayer = 'business';
    }

    return bestLayer;
  }

  /** Check if a rule matches a symbol */
  private matchRule(rule: LayerRule, symbol: Symbol, fileInfo?: FileInfo): boolean {
    switch (rule.kind) {
      case 'path':
        return rule.patterns.some(p => picomatch.isMatch(symbol.filePath, p));

      case 'naming': {
        // Skip framework type prefixes on variables and type aliases
        // (e.g. lv_obj_t, lv_color_t, ui_telemetry_t) — they're type
        // declarations, not actual interface constructs
        if ((symbol.kind === 'variable' || symbol.kind === 'type') && this.isFrameworkTypeName(rule, symbol.name)) {
          return false;
        }
        return rule.patterns.some(p => symbol.name.includes(p));
      }

      case 'import':
        // Check if the symbol's file imports from these packages
        if (!fileInfo?.imports || fileInfo.imports.length === 0) return false;
        return rule.patterns.some(pattern =>
          fileInfo.imports!.some(imp => imp === pattern || imp.startsWith(pattern + '/'))
        );

      case 'code':
        // Check if the source code contains these patterns
        if (!symbol.sourceCode) return false;
        return rule.patterns.some(p => symbol.sourceCode!.includes(p));

      default:
        return false;
    }
  }

  /** Known framework type prefixes — variables matching these are not real interfaces */
  private readonly FRAMEWORK_TYPE_PREFIXES = ['lv_', '_lv', 'ui_', 'gui_', 'screen_'];

  /** Check if a naming-rule match is really a framework type declaration */
  private isFrameworkTypeName(rule: LayerRule, name: string): boolean {
    // Only filter framework types for the interface layer
    for (const prefix of this.FRAMEWORK_TYPE_PREFIXES) {
      if (name.includes(prefix)) {
        // C type naming convention: foo_t → framework type
        if (name.endsWith('_t')) return true;
        // Direct framework prefix: lv_obj, ui_page → treat as framework
        return true;
      }
    }
    return false;
  }

  /** Allow custom rules to be added/overridden */
  addRules(layer: Layer, rules: LayerRule[]): void {
    if (!this.rules[layer]) {
      this.rules[layer] = [];
    }
    this.rules[layer].push(...rules);
  }
}
