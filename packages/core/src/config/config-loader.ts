// ============================================================
// Config Loader - Load configuration from .codeatlas.yaml
// ============================================================

import fs from 'fs';
import path from 'path';

export interface ScanConfig {
  include?: string[];
  exclude?: string[];
  languages?: string[];
}

export interface LayerRuleConfig {
  kind: 'path' | 'naming' | 'import' | 'code';
  patterns: string[];
  weight?: number;
}

export interface LayerConfig {
  interface?: { paths?: string[]; rules?: LayerRuleConfig[] };
  business?: { paths?: string[]; rules?: LayerRuleConfig[] };
  data?: { paths?: string[]; rules?: LayerRuleConfig[] };
  utility?: { paths?: string[]; rules?: LayerRuleConfig[] };
}

export interface AIConfig {
  provider?: 'claude' | 'openai' | 'local';
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  autoExplain?: boolean;
  batchSize?: number;
}

export interface MCPConfig {
  autoScan?: boolean;
  watchChanges?: boolean;
}

export interface ArchitectureRule {
  /** Rule name */
  name: string;
  /** Rule description */
  description: string;
  /** Forbidden pattern: source layer/pattern cannot depend on target */
  forbid?: {
    from: string;  // Layer or file pattern
    to: string;    // Layer or file pattern
  };
  /** Required pattern: source must depend on target */
  require?: {
    from: string;
    to: string;
  };
  /** Max callers for any symbol */
  maxCallers?: number;
  /** Max callees for any symbol */
  maxCallees?: number;
  /** Max complexity */
  maxComplexity?: number;
}

export interface CodeAtlasConfig {
  name?: string;
  version?: string;
  scan?: ScanConfig;
  layers?: LayerConfig;
  ai?: AIConfig;
  mcp?: MCPConfig;
  rules?: ArchitectureRule[];
}

const DEFAULT_CONFIG: CodeAtlasConfig = {
  name: 'my-project',
  scan: {
    include: ['src/**', 'lib/**'],
    exclude: [
      // Package managers
      'node_modules/**', 'vendor/**', 'target/**',
      // Build output
      'dist/**', 'build/**', 'out/**',
      // Testing
      '**/*.test.*', '**/*.spec.*', 'coverage/**',
      // Python
      '__pycache__/**', '.venv/**', 'venv/**',
      // Embedded/IoT
      '.pio/**', '.pioenvs/**', '.piolibdeps/**',
      // Third-party libraries (common in embedded projects)
      'lib/**', 'Lib/**', 'external/**', 'third_party/**',
      // IDE
      '.vscode/**', '.idea/**',
    ],
    languages: ['javascript', 'typescript', 'python'],
  },
  ai: {
    provider: undefined,
    model: undefined,
    autoExplain: false,
    batchSize: 10,
  },
  mcp: {
    autoScan: true,
    watchChanges: false,
  },
};

/**
 * Load configuration from .codeatlas.yaml
 * Falls back to defaults if file doesn't exist
 */
export function loadConfig(projectPath: string): CodeAtlasConfig {
  const configPath = path.join(projectPath, '.codeatlas.yaml');
  const jsonConfigPath = path.join(projectPath, '.codeatlas.json');

  let config: CodeAtlasConfig = { ...DEFAULT_CONFIG };

  // Try YAML config
  if (fs.existsSync(configPath)) {
    try {
      const content = fs.readFileSync(configPath, 'utf-8');
      config = parseYAML(content);
      console.log(`Loaded config from ${configPath}`);
    } catch (error) {
      console.warn(`Failed to parse ${configPath}:`, error);
    }
  }
  // Try JSON config
  else if (fs.existsSync(jsonConfigPath)) {
    try {
      const content = fs.readFileSync(jsonConfigPath, 'utf-8');
      config = JSON.parse(content);
      console.log(`Loaded config from ${jsonConfigPath}`);
    } catch (error) {
      console.warn(`Failed to parse ${jsonConfigPath}:`, error);
    }
  }

  // Merge with defaults
  return mergeConfig(DEFAULT_CONFIG, config);
}

/**
 * Improved YAML parser — handles multi-line arrays, deeper nesting,
 * environment variable substitution, and comments.
 */
function parseYAML(content: string): CodeAtlasConfig {
  const lines = content.split('\n');
  const result: any = {};

  // Track nesting stack: [{ indent, obj, key }]
  const stack: Array<{ indent: number; obj: any; key: string | null }> = [{ indent: -1, obj: result, key: null }];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Skip comments and empty lines
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;

    // Calculate indent level (number of leading spaces)
    const indent = line.length - line.trimStart().length;

    // Pop stack to find parent
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }
    const parent = stack[stack.length - 1];

    // Array item: "  - value" or "  - key: value"
    if (trimmed.startsWith('- ')) {
      const itemContent = trimmed.slice(2).trim();

      // Ensure parent key has an array
      if (parent.key && !Array.isArray(parent.obj[parent.key])) {
        parent.obj[parent.key] = [];
      }
      const arr = parent.key ? parent.obj[parent.key] : null;

      if (itemContent.includes(':')) {
        // Array of objects: "- key: value"
        const obj: any = {};
        const colonIdx = itemContent.indexOf(':');
        const k = itemContent.slice(0, colonIdx).trim();
        const v = parseYAMLValue(itemContent.slice(colonIdx + 1).trim());
        obj[k] = v;
        if (arr) arr.push(obj);
        // Push this object onto stack for potential nested items
        stack.push({ indent: indent + 2, obj: obj, key: null });
      } else {
        // Simple array item
        if (arr) arr.push(parseYAMLValue(itemContent));
      }
      continue;
    }

    // Key: value pair
    const kvMatch = trimmed.match(/^([\w.-]+)\s*:\s*(.*)/);
    if (kvMatch) {
      const key = kvMatch[1];
      const valueStr = kvMatch[2].trim();

      if (valueStr === '' || valueStr === '|' || valueStr === '>') {
        // Block scalar or empty — look ahead for children
        parent.obj[key] = {};
        parent.key = key;
        stack.push({ indent, obj: parent.obj[key], key });
      } else if (valueStr.startsWith('[')) {
        // Inline array: [a, b, c]
        parent.obj[key] = parseYAMLInlineArray(valueStr);
        parent.key = key;
      } else {
        // Simple value
        parent.obj[key] = parseYAMLValue(valueStr);
        parent.key = key;

        // If next line is indented more, this is a parent
        const nextLine = lines[i + 1];
        if (nextLine) {
          const nextTrimmed = nextLine.trim();
          const nextIndent = nextLine.length - nextLine.trimStart().length;
          if (nextTrimmed !== '' && !nextTrimmed.startsWith('#') && nextIndent > indent && !nextTrimmed.startsWith('- ')) {
            // Next line is a child — convert current value to object
            parent.obj[key] = {};
            stack.push({ indent, obj: parent.obj[key], key });
          }
        }
      }
    }
  }

  // Environment variable substitution
  substituteEnvVars(result);

  return result;
}

/** Parse a YAML value string into the appropriate JS type */
function parseYAMLValue(s: string): any {
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s === 'null' || s === '~') return null;
  if (/^-?\d+$/.test(s)) return parseInt(s, 10);
  if (/^-?\d+\.\d+$/.test(s)) return parseFloat(s);
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

/** Parse inline array: [a, b, c] or ["a", "b"] */
function parseYAMLInlineArray(s: string): any[] {
  const inner = s.slice(1, -1).trim();
  if (inner === '') return [];
  return inner.split(',').map(item => parseYAMLValue(item.trim()));
}

/** Substitute ${VAR} and $VAR environment variable references */
function substituteEnvVars(obj: any): void {
  for (const key of Object.keys(obj)) {
    const val = obj[key];
    if (typeof val === 'string') {
      obj[key] = val.replace(/\$\{(\w+)\}|\$(\w+)/g, (_, braced, bare) => {
        const varName = braced || bare;
        return process.env[varName] || '';
      });
    } else if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
      substituteEnvVars(val);
    } else if (Array.isArray(val)) {
      for (const item of val) {
        if (typeof item === 'object' && item !== null) substituteEnvVars(item);
      }
    }
  }
}

/**
 * Deep merge config with defaults
 */
function mergeConfig(defaults: CodeAtlasConfig, user: CodeAtlasConfig): CodeAtlasConfig {
  const result = { ...defaults };

  for (const key of Object.keys(user) as Array<keyof CodeAtlasConfig>) {
    const userValue = user[key];
    const defaultValue = defaults[key];

    if (userValue === undefined) continue;

    if (typeof userValue === 'object' && userValue !== null && !Array.isArray(userValue)) {
      (result as any)[key] = { ...(defaultValue as any), ...userValue };
    } else {
      (result as any)[key] = userValue;
    }
  }

  return result;
}

/**
 * Get AI config with environment variable fallbacks
 */
export function getAIConfig(config: CodeAtlasConfig): AIConfig {
  const ai = config.ai || {};

  return {
    provider: ai.provider || detectProvider(),
    model: ai.model || getDefaultModel(ai.provider),
    apiKey: ai.apiKey || getAPIKey(ai.provider),
    baseUrl: ai.baseUrl,
    autoExplain: ai.autoExplain ?? false,
    batchSize: ai.batchSize ?? 10,
  };
}

/**
 * Detect LLM provider from environment variables
 */
function detectProvider(): 'claude' | 'openai' | 'local' | undefined {
  if (process.env.ANTHROPIC_API_KEY) return 'claude';
  if (process.env.OPENAI_API_KEY) return 'openai';
  return undefined;
}

/**
 * Get default model for provider
 */
function getDefaultModel(provider?: string): string {
  switch (provider) {
    case 'claude':
      return 'claude-sonnet-4-20250514';
    case 'openai':
      return 'gpt-4';
    case 'local':
      return 'llama2';
    default:
      return 'gpt-4';
  }
}

/**
 * Get API key from environment
 */
function getAPIKey(provider?: string): string | undefined {
  switch (provider) {
    case 'claude':
      return process.env.ANTHROPIC_API_KEY;
    case 'openai':
      return process.env.OPENAI_API_KEY;
    default:
      return undefined;
  }
}
