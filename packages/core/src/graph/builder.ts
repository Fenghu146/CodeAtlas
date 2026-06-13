// ============================================================
// Graph Builder - Constructs the full CodeGraph from parse results
// ============================================================

import type { Symbol, Relationship, CodeGraph, FileInfo, Layer, SymbolKind, RelationshipKind } from './types.js';
import type { ParseResult } from '../parser/index.js';
import { LayerClassifier } from './layer-classifier.js';
import type { LayerConfig } from '../config/config-loader.js';

/**
 * Builds a complete code graph from multiple file parse results.
 * 
 * Pipeline:
 * 1. Collect all symbols from all files
 * 2. Build intra-file relationships (already extracted by parser)
 * 3. Resolve cross-file imports
 * 4. Classify architectural layers
 * 5. Compute metrics
 */
export class GraphBuilder {
  private layerClassifier = new LayerClassifier();

  build(parseResults: ParseResult[], files: Map<string, FileInfo>, layerConfig?: LayerConfig): CodeGraph {
    const symbols = new Map<string, Symbol>();
    const relationships: Relationship[] = [];
    const fileMap = new Map(files);

    // Phase 0: Collect external package imports per file (for layer classification)
    for (const result of parseResults) {
      const fileInfo = fileMap.get(result.filePath);
      if (fileInfo && result.imports && result.imports.length > 0) {
        const externalImports = result.imports
          .filter(imp => !imp.source.startsWith('.') && !imp.source.startsWith('/'))
          .map(imp => {
            // Extract package name (handle scoped packages like @scope/pkg)
            if (imp.source.startsWith('@')) {
              const parts = imp.source.split('/');
              return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : imp.source;
            }
            return imp.source.split('/')[0];
          });
        // Deduplicate
        fileInfo.imports = [...new Set(externalImports)];
      }
    }

    // Phase 1: Register all symbols with unique IDs
    for (const result of parseResults) {
      for (const parsed of result.symbols) {
        const id = `${result.filePath}:${parsed.name}:${parsed.startLine}`;
        const symbol: Symbol = {
          id,
          name: parsed.name,
          kind: parsed.kind as SymbolKind,
          filePath: result.filePath,
          startLine: parsed.startLine,
          endLine: parsed.endLine,
          startCol: parsed.startCol,
          endCol: parsed.endCol,
          sourceCode: parsed.sourceCode,
          language: result.language,
          layer: 'unknown',  // Will be classified later
          docComment: parsed.docComment,
          exported: parsed.exported,
          complexity: parsed.complexity,
        };
        symbols.set(id, symbol);
      }
    }

    // Phase 2: Build relationships
    // Build global name-to-id mapping for cross-file calls
    const globalNameToIds = new Map<string, string[]>();
    for (const [id, symbol] of symbols) {
      const ids = globalNameToIds.get(symbol.name) || [];
      ids.push(id);
      globalNameToIds.set(symbol.name, ids);
    }

    for (const result of parseResults) {
      const fileSymbols = [...symbols.values()].filter(s => s.filePath === result.filePath);
      const symbolNameToId = new Map(fileSymbols.map(s => [s.name, s.id]));

      for (const rel of result.relationships) {
        // First try local (same file), then global (cross-file)
        let sourceId = symbolNameToId.get(rel.sourceName);
        let targetId = symbolNameToId.get(rel.targetName);

        // If target not found locally, try global (pick first match)
        if (!targetId) {
          const globalIds = globalNameToIds.get(rel.targetName);
          if (globalIds && globalIds.length > 0) {
            targetId = globalIds[0];
          }
        }

        // If source not found locally, try global
        if (!sourceId) {
          const globalIds = globalNameToIds.get(rel.sourceName);
          if (globalIds && globalIds.length > 0) {
            sourceId = globalIds[0];
          }
        }

        // For imports/decorates, allow target to be a name (not just ID)
        // This handles module imports and decorator references
        if (sourceId && !targetId && (rel.kind === 'imports' || rel.kind === 'decorates')) {
          targetId = rel.targetName; // Use name as reference
        }

        if (sourceId && targetId) {
          relationships.push({
            id: `${sourceId}->${rel.kind}->${targetId}`,
            sourceId,
            targetId,
            kind: rel.kind as RelationshipKind,
            line: rel.line,
          });
        }
      }
    }

    // Phase 3: Resolve cross-file imports
    this.resolveImports(parseResults, symbols, relationships);

    // Phase 4: Apply custom layer rules from config
    if (layerConfig) {
      this.applyLayerConfig(layerConfig);
    }

    // Phase 5: Classify layers
    this.layerClassifier.classify(symbols, relationships, fileMap);

    // Phase 5: Build the graph object with convenience methods
    const graph: CodeGraph = {
      symbols,
      relationships,
      files: fileMap,

      getSymbolById(id: string) {
        return symbols.get(id);
      },

      getSymbolsByFile(filePath: string) {
        return [...symbols.values()].filter(s => s.filePath === filePath);
      },

      getSymbolsByKind(kind: SymbolKind) {
        return [...symbols.values()].filter(s => s.kind === kind);
      },

      getSymbolsByLayer(layer: Layer) {
        return [...symbols.values()].filter(s => s.layer === layer);
      },

      getRelationshipsFrom(symbolId: string) {
        return relationships.filter(r => r.sourceId === symbolId);
      },

      getRelationshipsTo(symbolId: string) {
        return relationships.filter(r => r.targetId === symbolId);
      },
    };

    return graph;
  }

  /**
   * Apply custom layer rules from config.
   */
  private applyLayerConfig(config: LayerConfig): void {
    const layers = ['interface', 'business', 'data', 'utility'] as const;
    for (const layer of layers) {
      const layerConf = config[layer];
      if (!layerConf) continue;

      const rules: Array<{ kind: 'path' | 'naming' | 'import' | 'code'; patterns: string[]; weight: number }> = [];

      // Convert paths config to path rules
      if (layerConf.paths && layerConf.paths.length > 0) {
        rules.push({ kind: 'path', patterns: layerConf.paths, weight: 3 });
      }

      // Add explicit rules
      if (layerConf.rules) {
        for (const rule of layerConf.rules) {
          rules.push({
            kind: rule.kind,
            patterns: rule.patterns,
            weight: rule.weight ?? 2,
          });
        }
      }

      if (rules.length > 0) {
        this.layerClassifier.addRules(layer, rules);
      }
    }
  }

  /**
   * Resolve imports across files.
   * Matches import statements to exported symbols in other files.
   */
  private resolveImports(
    parseResults: ParseResult[],
    symbols: Map<string, Symbol>,
    relationships: Relationship[],
  ): void {
    // Build an export index: filePath → exported symbol names → symbolId
    const exportsByFile = new Map<string, Map<string, string>>();
    for (const [id, symbol] of symbols) {
      if (symbol.exported) {
        if (!exportsByFile.has(symbol.filePath)) {
          exportsByFile.set(symbol.filePath, new Map());
        }
        exportsByFile.get(symbol.filePath)!.set(symbol.name, id);
      }
    }

    // Build a set of known file paths for resolution
    const knownFiles = new Set<string>();
    for (const result of parseResults) {
      knownFiles.add(result.filePath);
    }

    // Process imports from each file
    for (const result of parseResults) {
      if (!result.imports || result.imports.length === 0) continue;

      const fileSymbols = [...symbols.values()].filter(s => s.filePath === result.filePath);
      const symbolNameToId = new Map(fileSymbols.map(s => [s.name, s.id]));

      for (const imp of result.imports) {
        // Handle C/C++ wildcard includes (from #include directives)
        // For wildcards, we'll create a relationship to the file itself
        // C/C++ #include directives use relative paths (../common/header.h) but are wildcard imports
        const isCInclude = imp.isWildcard && (result.language === 'c' || result.language === 'cpp');
        if (imp.isWildcard && imp.source && (isCInclude || !imp.source.startsWith('.')) && !imp.source.startsWith('/')) {
          // Try to find the file by name in knownFiles
          const headerFile = this.findHeaderFile(imp.source, knownFiles);
          if (headerFile) {
            // Wildcard imports (C/C++ #include): create ONE import per file pair (not N×M)
            // This avoids O(n²) memory explosion for headers with hundreds of symbols
            if (fileSymbols.length > 0) {
              const headerSymbols = [...symbols.values()].filter(s => s.filePath === headerFile && s.exported);
              if (headerSymbols.length > 0) {
                // Use first file symbol → first header symbol to represent the dependency
                const relId = `${fileSymbols[0].id}:imports:${headerSymbols[0].id}`;
                relationships.push({
                  id: relId,
                  sourceId: fileSymbols[0].id,
                  targetId: headerSymbols[0].id,
                  kind: 'imports',
                  line: imp.line,
                });
              }
            }
          }
          continue;
        }

        // Only resolve relative imports (skip package imports like 'express')
        if (!imp.source.startsWith('.') && !imp.source.startsWith('/')) continue;

        // Resolve the import path to a file
        const resolvedFile = this.resolveImportPath(result.filePath, imp.source, knownFiles);
        if (!resolvedFile) continue;

        const fileExports = exportsByFile.get(resolvedFile);
        if (!fileExports) continue;

        // Match imported names to exported symbols
        for (const name of imp.names) {
          const targetId = fileExports.get(name);
          if (targetId) {
            // Find which symbol in the importing file uses this import
            // For simplicity, create a relationship from the file level
            // (we don't know exactly which symbol uses the import)
            const sourceSymbol = fileSymbols.find(s => s.exported && s.name === name);
            if (sourceSymbol) {
              // Create an imports relationship
              const relId = `${result.filePath}:imports:${name}->${targetId}`;
              relationships.push({
                id: relId,
                sourceId: sourceSymbol.id,
                targetId,
                kind: 'imports',
                line: imp.line,
              });
            }
          }
        }
      }
    }
  }

  /**
   * Find a header file by name in known files.
   * Handles C/C++ includes like "ble_srv.h" or <nvs.h>
   */
  private findHeaderFile(headerName: string, knownFiles: Set<string>): string | null {
    // Try exact match
    if (knownFiles.has(headerName)) return headerName;

    // Try with common header extensions
    const headerExts = ['.h', '.hpp', '.hxx'];
    for (const ext of headerExts) {
      if (knownFiles.has(headerName + ext)) return headerName + ext;
    }

    // Try to find by filename (search all known files — handle Windows paths)
    const baseName = headerName.replace(/\\/g, '/').split('/').pop() || headerName;
    for (const file of knownFiles) {
      const normalized = file.replace(/\\/g, '/');
      const fileName = normalized.split('/').pop() || file;
      if (fileName === baseName || fileName === headerName) {
        return file;
      }
    }

    return null;
  }

  /**
   * Resolve a relative import path to an actual file path.
   * Handles: ./foo, ../bar, ./foo/index, extensions (.ts, .js, etc.)
   */
  private resolveImportPath(
    importingFile: string,
    importSource: string,
    knownFiles: Set<string>,
  ): string | null {
    const dir = importingFile.includes('/') ? importingFile.substring(0, importingFile.lastIndexOf('/')) : '';
    let resolved = importSource;

    // Resolve relative path
    if (importSource.startsWith('.')) {
      const parts = dir.split('/').filter(Boolean);
      const importParts = importSource.split('/').filter(Boolean);

      for (const part of importParts) {
        if (part === '..') {
          parts.pop();
        } else if (part !== '.') {
          parts.push(part);
        }
      }
      resolved = parts.join('/');
    } else {
      // For non-relative imports (like C/C++ includes), try resolving relative to current dir
      const parts = dir.split('/').filter(Boolean);
      parts.push(importSource);
      resolved = parts.join('/');
    }

    // Try exact match
    if (knownFiles.has(resolved)) return resolved;

    // Try with common extensions (including C/C++)
    const extensions = ['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.h', '.hpp', '.c', '.cpp'];
    for (const ext of extensions) {
      if (knownFiles.has(resolved + ext)) return resolved + ext;
    }

    // Try as directory with index file
    for (const ext of extensions) {
      const indexPath = `${resolved}/index${ext}`;
      if (knownFiles.has(indexPath)) return indexPath;
    }

    // Try removing extension (import might already have .js that maps to .ts)
    const lastDot = resolved.lastIndexOf('.');
    if (lastDot > 0) {
      const withoutExt = resolved.substring(0, lastDot);
      for (const ext of extensions) {
        if (knownFiles.has(withoutExt + ext)) return withoutExt + ext;
      }
    }

    return null;
  }
}
