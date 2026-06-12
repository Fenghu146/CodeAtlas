// ============================================================
// tree-sitter based code parser
// ============================================================
// Wraps web-tree-sitter to parse source files into ASTs
// and extract symbols + intra-file relationships.

import Parser from 'web-tree-sitter';
import path from 'path';
import { fileURLToPath } from 'url';

// Re-export type for use in other modules
type SyntaxNode = Parser.SyntaxNode;

export interface ParsedSymbol {
  name: string;
  kind: string;
  startLine: number;
  endLine: number;
  startCol: number;
  endCol: number;
  sourceCode: string;
  docComment?: string;
  exported: boolean;
  parentName?: string;
}

export interface ParsedRelationship {
  sourceName: string;
  targetName: string;
  kind: string;
  line: number;
}

export interface ParsedImport {
  /** The source path string from the import statement (e.g. './graph/builder') */
  source: string;
  /** Imported symbol names (e.g. ['GraphBuilder', 'LayerClassifier']) */
  names: string[];
  /** Whether this is a wildcard import (import * as X) */
  isWildcard: boolean;
  /** Line number where the import occurs */
  line: number;
}

export interface ParseResult {
  symbols: ParsedSymbol[];
  relationships: ParsedRelationship[];
  imports: ParsedImport[];
  language: string;
  filePath: string;
}

/** File extension → tree-sitter language name mapping */
const EXTENSION_MAP: Record<string, string> = {
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.ts': 'typescript',
  '.tsx': 'tsx',
  '.py': 'python',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java',
  '.rb': 'ruby',
  '.php': 'php',
  '.cs': 'c_sharp',
  '.cpp': 'cpp',
  '.c': 'c',
  '.h': 'c',
  '.hpp': 'cpp',
};

export function detectLanguage(filePath: string): string | null {
  const ext = path.extname(filePath).toLowerCase();
  return EXTENSION_MAP[ext] ?? null;
}

/**
 * Core parser wrapping web-tree-sitter.
 * 
 * Usage:
 *   const parser = new CodeParser();
 *   await parser.init();
 *   await parser.loadLanguage('typescript');
 *   const result = parser.parse(sourceCode, 'src/index.ts');
 */
export class CodeParser {
  private parsers: Map<string, Parser> = new Map();
  private initialized = false;

  /** Initialize the tree-sitter runtime. Call once before any parsing. */
  async init(): Promise<void> {
    if (this.initialized) return;
    await Parser.init();
    this.initialized = true;
  }

  /**
   * Load a language's WASM grammar.
   * The .wasm file must exist in the language-packs directory.
   */
  async loadLanguage(lang: string): Promise<void> {
    if (this.parsers.has(lang)) return;

    const parser = new Parser();
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    const wasmPath = path.join(currentDir, 'language-packs', `tree-sitter-${lang}.wasm`);
    const language = await Parser.Language.load(wasmPath);
    parser.setLanguage(language);
    this.parsers.set(lang, parser);
  }

  /** Check if a language is loaded and ready */
  hasLanguage(lang: string): boolean {
    return this.parsers.has(lang);
  }

  /** Get list of loaded languages */
  getLoadedLanguages(): string[] {
    return Array.from(this.parsers.keys());
  }

  /**
   * Parse a source file and extract symbols + relationships.
   * 
   * @param sourceCode - The raw source code string
   * @param filePath - File path (used for language detection)
   * @returns Parsed symbols and intra-file relationships
   */
  parse(sourceCode: string, filePath: string): ParseResult {
    const lang = detectLanguage(filePath);
    if (!lang) {
      return { symbols: [], relationships: [], imports: [], language: 'unknown', filePath };
    }

    const parser = this.parsers.get(lang);
    if (!parser) {
      throw new Error(`Language '${lang}' not loaded. Call loadLanguage('${lang}') first.`);
    }

    try {
      const tree = parser.parse(sourceCode);
      if (!tree) {
        console.warn(`Failed to parse ${filePath}: tree is null`);
        return { symbols: [], relationships: [], imports: [], language: lang, filePath };
      }

      const symbols = this.extractSymbols(tree.rootNode, sourceCode, lang);
      const relationships = this.extractRelationships(tree.rootNode, sourceCode, symbols);
      const imports = this.extractImports(tree.rootNode, sourceCode);

      tree.delete();

      return { symbols, relationships, imports, language: lang, filePath };
    } catch (err) {
      // Graceful degradation: return empty result instead of crashing
      console.warn(`Error parsing ${filePath}:`, err);
      return { symbols: [], relationships: [], imports: [], language: lang, filePath };
    }
  }

  /**
   * Extract symbols from AST nodes recursively.
   * Override/extend this for language-specific rules.
   */
  private extractSymbols(node: SyntaxNode, sourceCode: string, lang: string): ParsedSymbol[] {
    const symbols: ParsedSymbol[] = [];
    this.walkForSymbols(node, sourceCode, symbols, lang);
    return symbols;
  }

  /** Walk the AST and collect symbol nodes */
  private walkForSymbols(node: SyntaxNode, sourceCode: string, symbols: ParsedSymbol[], lang?: string): void {
    const symbolKinds = this.getSymbolNodeTypes(lang ?? 'unknown');

    // Special handling for Python: function_definition inside class = method
    if (node.type === 'function_definition' && lang === 'python') {
      // Check if parent is class_definition
      let parent = node.parent;
      let isMethod = false;
      while (parent) {
        if (parent.type === 'class_definition' || parent.type === 'class_declaration') {
          isMethod = true;
          break;
        }
        // Stop at function boundary (nested functions are not methods)
        if (parent.type === 'function_definition' || parent.type === 'function_declaration') {
          break;
        }
        parent = parent.parent;
      }

      if (isMethod) {
        // Parse as method
        const symbol = this.nodeToSymbol(node, sourceCode);
        if (symbol) {
          symbol.kind = 'method';
          // Set parentName from the class we found
          let p = node.parent;
          while (p) {
            if (p.type === 'class_definition' || p.type === 'class_declaration') {
              const nameNode = p.childForFieldName('name')
                ?? p.children.find(c => c.type === 'identifier' || c.type === 'type_identifier');
              if (nameNode) {
                symbol.parentName = sourceCode.slice(nameNode.startIndex, nameNode.endIndex);
              }
              break;
            }
            p = p.parent;
          }
          symbols.push(symbol);
        }
      } else if (symbolKinds.has(node.type)) {
        // Parse as function
        const symbol = this.nodeToSymbol(node, sourceCode);
        if (symbol) {
          symbols.push(symbol);
        }
      }
    } else if (symbolKinds.has(node.type)) {
      const symbol = this.nodeToSymbol(node, sourceCode);
      if (symbol) {
        symbols.push(symbol);
      }
    }

    for (const child of node.children) {
      this.walkForSymbols(child, sourceCode, symbols, lang);
    }
  }

  /** Map tree-sitter node types to our symbol kinds per language */
  private getSymbolNodeTypes(lang: string): Set<string> {
    // Common patterns across languages; extend per language as needed
    const common = new Set([
      'function_declaration',
      'class_declaration',
      'method_definition',
      'interface_declaration',
      'type_alias_declaration',
      'enum_declaration',
      // Python
      'function_definition',
      'class_definition',
      // TypeScript specifics
      'abstract_class_declaration',
      // Variables/Constants (top-level assignments)
      'lexical_declaration',  // const/let
      'variable_declaration', // var
      'assignment',           // Python: X = ...
      // C/C++ specifics - use function_definition instead of function_declarator
      'function_definition',
      'class_specifier',      // C++ class
      'struct_specifier',     // C struct/class
      'template_function',
      'template_class',
      'preproc_def',          // #define
      'preproc_function_def', // #define FUNC()
      // Embedded C specifics
      'type_definition',      // typedef
      'declaration',          // Variable declarations
      'linked_declaration',   // static/extern/volatile declarations
    ]);
    return common;
  }

  /** Convert a syntax node to a ParsedSymbol */
  private nodeToSymbol(node: SyntaxNode, sourceCode: string): ParsedSymbol | null {
    const kind = this.mapNodeKind(node.type);
    if (!kind) return null;

    // Extract name - varies by language and node type
    let nameNode: SyntaxNode | null = node.childForFieldName('name') ?? null;

    // For C/C++ function_definition, the name is inside function_declarator
    if (!nameNode && node.type === 'function_definition') {
      const declarator = node.children.find(c => c.type === 'function_declarator');
      if (declarator) {
        nameNode = declarator.children.find(c => c.type === 'identifier') ?? null;
      }
    }

    // Fallback: find identifier or type_identifier in children
    if (!nameNode) {
      nameNode = node.children.find(c => c.type === 'identifier' || c.type === 'type_identifier') ?? null;
    }

    if (!nameNode) return null;

    const name = sourceCode.slice(nameNode.startIndex, nameNode.endIndex);
    const sourceSlice = sourceCode.slice(node.startIndex, node.endIndex);
    const docComment = this.extractDocComment(node, sourceCode);
    const exported = this.isExported(node);

    // Detect parent (class containing method)
    let parentName: string | undefined;
    if (kind === 'method') {
      // Walk up to find the class
      let parent = node.parent;
      while (parent) {
        if (parent.type === 'class_definition' || parent.type === 'class_declaration') {
          const parentNameNode = parent.childForFieldName('name')
            ?? parent.children.find(c => c.type === 'identifier' || c.type === 'type_identifier');
          if (parentNameNode) {
            parentName = sourceCode.slice(parentNameNode.startIndex, parentNameNode.endIndex);
          }
          break;
        }
        parent = parent.parent;
      }
    }

    return {
      name,
      kind,
      startLine: node.startPosition.row + 1,  // 1-based
      endLine: node.endPosition.row + 1,
      startCol: node.startPosition.column,
      endCol: node.endPosition.column,
      sourceCode: sourceSlice,
      docComment,
      exported,
      parentName,
    };
  }

  /** Map AST node type to our SymbolKind */
  private mapNodeKind(nodeType: string): string | null {
    const map: Record<string, string> = {
      'function_declaration': 'function',
      'function_definition': 'function',
      'class_declaration': 'class',
      'class_definition': 'class',
      'abstract_class_declaration': 'class',
      'method_definition': 'method',
      'interface_declaration': 'interface',
      'type_alias_declaration': 'type',
      'enum_declaration': 'enum',
      // Variables/Constants
      'lexical_declaration': 'variable',   // const/let
      'variable_declaration': 'variable',  // var
      'assignment': 'variable',            // Python: X = ...
      // C/C++ specifics
      'function_declarator': 'function',
      'template_function': 'function',
      'template_class': 'class',
      'preproc_def': 'constant',           // #define
      'preproc_function_def': 'function',  // #define FUNC()
      // Embedded C specifics
      'type_definition': 'type',           // typedef
      'struct_specifier': 'class',         // struct (treat as class)
      'declaration': 'variable',           // Variable declarations
    };
    return map[nodeType] ?? null;
  }

  /** Extract JSDoc / docstring comment above the node */
  private extractDocComment(node: SyntaxNode, sourceCode: string): string | undefined {
    const prev = node.previousSibling;
    if (prev && (prev.type === 'comment' || prev.type === 'expression_statement')) {
      const text = sourceCode.slice(prev.startIndex, prev.endIndex);
      if (text.startsWith('/**') || text.startsWith('#')) {
        return text;
      }
    }
    return undefined;
  }

  /** Check if the node is exported */
  private isExported(node: SyntaxNode): boolean {
    const parent = node.parent;
    if (!parent) return false;
    return parent.type === 'export_statement' || parent.type === 'export_default_declaration';
  }

  /**
   * Extract intra-file relationships (calls, inheritance, imports, contains, etc.)
   */
  private extractRelationships(
    node: SyntaxNode,
    sourceCode: string,
    symbols: ParsedSymbol[],
  ): ParsedRelationship[] {
    const relationships: ParsedRelationship[] = [];
    const symbolNames = new Set(symbols.map(s => s.name));

    // 1. Extract call relationships
    this.walkForRelationships(node, sourceCode, symbolNames, symbols, relationships);

    // 2. Extract imports relationships
    this.extractImportRelationships(node, sourceCode, symbols, relationships);

    // 3. Extract contains relationships (class -> method, file -> functions)
    this.extractContainsRelationships(symbols, relationships);

    // 4. Extract decorator relationships (Python @decorator)
    this.extractDecoratorRelationships(node, sourceCode, symbols, relationships);

    return relationships;
  }

  /**
   * Extract import relationships from import statements
   */
  private extractImportRelationships(
    node: SyntaxNode,
    sourceCode: string,
    symbols: ParsedSymbol[],
    relationships: ParsedRelationship[],
  ): void {
    // Find import statements and create imports relationships
    this.walkForImportRelationships(node, sourceCode, symbols, relationships);
  }

  private walkForImportRelationships(
    node: SyntaxNode,
    sourceCode: string,
    symbols: ParsedSymbol[],
    relationships: ParsedRelationship[],
  ): void {
    // Python: from X import Y
    if (node.type === 'import_from_statement') {
      // Get the module name (first dotted_name child)
      const moduleNode = node.children.find(c => c.type === 'dotted_name');
      if (moduleNode) {
        const moduleName = sourceCode.slice(moduleNode.startIndex, moduleNode.endIndex);
        // Create import relationship for the first symbol in the file
        // (or we can skip if no matching symbol)
        const firstSymbol = symbols[0];
        if (firstSymbol) {
          relationships.push({
            sourceName: firstSymbol.name,
            targetName: moduleName,
            kind: 'imports',
            line: node.startPosition.row + 1,
          });
        }
      }
    }

    // Python: import X
    if (node.type === 'import_statement') {
      const moduleNode = node.children.find(c => c.type === 'dotted_name');
      if (moduleNode) {
        const moduleName = sourceCode.slice(moduleNode.startIndex, moduleNode.endIndex);
        const firstSymbol = symbols[0];
        if (firstSymbol) {
          relationships.push({
            sourceName: firstSymbol.name,
            targetName: moduleName,
            kind: 'imports',
            line: node.startPosition.row + 1,
          });
        }
      }
    }

    // JS/TS: import { X } from 'module'
    if (node.type === 'import_statement' || node.type === 'import') {
      const sourceNode = node.children.find(c => c.type === 'string' || c.type === 'string_fragment');
      if (sourceNode) {
        const source = sourceCode.slice(sourceNode.startIndex, sourceNode.endIndex).replace(/^['"]|['"]$/g, '');
        const firstSymbol = symbols[0];
        if (firstSymbol) {
          relationships.push({
            sourceName: firstSymbol.name,
            targetName: source,
            kind: 'imports',
            line: node.startPosition.row + 1,
          });
        }
      }
    }

    for (const child of node.children) {
      this.walkForImportRelationships(child, sourceCode, symbols, relationships);
    }
  }

  /**
   * Extract contains relationships (class -> methods, file -> functions)
   */
  private extractContainsRelationships(
    symbols: ParsedSymbol[],
    relationships: ParsedRelationship[],
  ): void {
    // Build parent-child relationships based on symbol hierarchy
    for (const symbol of symbols) {
      if (symbol.kind === 'class') {
        // Find methods that belong to this class
        for (const other of symbols) {
          if (other.kind === 'method' && other.parentName === symbol.name) {
            relationships.push({
              sourceName: symbol.name,
              targetName: other.name,
              kind: 'contains',
              line: symbol.startLine,
            });
          }
        }
      }

      // File-level contains (optional - adds too much noise for now)
      // if (symbol.kind === 'function' || symbol.kind === 'class') {
      //   relationships.push({
      //     sourceName: '__file__',
      //     targetName: symbol.name,
      //     kind: 'contains',
      //     line: 1,
      //   });
      // }
    }
  }

  private walkForRelationships(
    node: SyntaxNode,
    sourceCode: string,
    symbolNames: Set<string>,
    symbols: ParsedSymbol[],
    relationships: ParsedRelationship[],
  ): void {
    // Detect function calls: call_expression (JS/TS) or call (Python)
    if (node.type === 'call_expression' || node.type === 'call') {
      const funcNode = node.childForFieldName('function');
      if (funcNode) {
        const funcName = sourceCode.slice(funcNode.startIndex, funcNode.endIndex);
        // Find which symbol contains this call
        const containingSymbol = this.findContainingSymbol(node, symbols);
        if (containingSymbol) {
          // Always record the call relationship, even if target is in another file
          relationships.push({
            sourceName: containingSymbol,
            targetName: funcName,
            kind: 'calls',
            line: node.startPosition.row + 1,
          });
        }
      }

      // Also detect function references in arguments (e.g., Depends(get_db))
      // This handles dependency injection patterns
      const argListNode = node.children.find(c => c.type === 'argument_list' || c.type === 'arguments');
      if (argListNode) {
        this.findFunctionReferencesInArgs(argListNode, sourceCode, symbolNames, symbols, node, relationships);
      }
    }

    // Detect inheritance: extends/implements clauses
    if (node.type === 'extends_clause' || node.type === 'implements_clause') {
      // Extract the parent/interface names
      for (const child of node.children) {
        if (child.type === 'identifier' || child.type === 'type_identifier') {
          const name = sourceCode.slice(child.startIndex, child.endIndex);
          const containingSymbol = this.findContainingSymbol(node, symbols);
          if (containingSymbol) {
            relationships.push({
              sourceName: containingSymbol,
              targetName: name,
              kind: node.type === 'extends_clause' ? 'extends' : 'implements',
              line: node.startPosition.row + 1,
            });
          }
        }
      }
    }

    for (const child of node.children) {
      this.walkForRelationships(child, sourceCode, symbolNames, symbols, relationships);
    }
  }

  /** Find which top-level symbol contains a given node */
  private findContainingSymbol(node: SyntaxNode, symbols: ParsedSymbol[]): string | null {
    const line = node.startPosition.row + 1;
    for (const symbol of symbols) {
      if (line >= symbol.startLine && line <= symbol.endLine) {
        return symbol.name;
      }
    }
    return null;
  }

  /** Recursively find function references in argument lists */
  private findFunctionReferencesInArgs(
    node: SyntaxNode,
    sourceCode: string,
    symbolNames: Set<string>,
    symbols: ParsedSymbol[],
    callNode: SyntaxNode,
    relationships: ParsedRelationship[],
  ): void {
    // Guard against null/undefined nodes
    if (!node || !node.type) return;

    // Direct identifier - create relationship for function references in arguments
    // This handles patterns like Depends(get_db), @router.get, etc.
    if (node.type === 'identifier') {
      const name = node.text;
      if (!name) return; // Guard against empty name

      const containingSymbol = this.findContainingSymbol(callNode, symbols);

      if (containingSymbol && containingSymbol !== name) {
        // Check if target is a known function/method in this file
        const targetSymbol = symbols.find(s => s.name === name);
        const isKnownFunction = targetSymbol && (targetSymbol.kind === 'function' || targetSymbol.kind === 'method');

        // Also check if it looks like a function (lowercase, common patterns)
        const looksLikeFunction = name.length > 0 && name[0] === name[0].toLowerCase() && !name.startsWith('_');

        // Create relationship if:
        // 1. Target is a known function/method, OR
        // 2. Target looks like a function (heuristic for cross-file references)
        if (isKnownFunction || looksLikeFunction || symbolNames.has(name)) {
          relationships.push({
            sourceName: containingSymbol,
            targetName: name,
            kind: 'calls',
            line: callNode.startPosition.row + 1,
          });
        }
      }
    }

    // Recurse into children (but skip nested call expressions to avoid double-counting)
    if (node.type !== 'call_expression' && node.type !== 'call') {
      for (const child of node.children) {
        if (child) { // Guard against null children
          this.findFunctionReferencesInArgs(child, sourceCode, symbolNames, symbols, callNode, relationships);
        }
      }
    }
  }

  /**
   * Extract decorator relationships (Python @decorator)
   */
  private extractDecoratorRelationships(
    node: SyntaxNode,
    sourceCode: string,
    symbols: ParsedSymbol[],
    relationships: ParsedRelationship[],
  ): void {
    this.walkForDecorators(node, sourceCode, symbols, relationships);
  }

  private walkForDecorators(
    node: SyntaxNode,
    sourceCode: string,
    symbols: ParsedSymbol[],
    relationships: ParsedRelationship[],
  ): void {
    // Python decorated_definition: contains decorator + function/class
    if (node.type === 'decorated_definition') {
      // Find the decorator child
      const decoratorNode = node.children.find(c => c.type === 'decorator');
      if (decoratorNode) {
        // Extract decorator name
        const callNode = decoratorNode.children.find(c => c.type === 'call');
        let decoratorName: string;

        if (callNode) {
          // @router.get("/") - extract from call
          const attrNode = callNode.children.find(c => c.type === 'attribute');
          if (attrNode) {
            decoratorName = sourceCode.slice(attrNode.startIndex, attrNode.endIndex);
          } else {
            const funcNode = callNode.children.find(c => c.type === 'identifier');
            decoratorName = funcNode ? funcNode.text : 'unknown';
          }
        } else {
          // @router - simple identifier
          const nameNode = decoratorNode.children.find(c =>
            c.type === 'identifier' || c.type === 'dotted_name'
          );
          decoratorName = nameNode ? sourceCode.slice(nameNode.startIndex, nameNode.endIndex) : 'unknown';
        }

        // Find the function/class being decorated
        const funcNode = node.children.find(c =>
          c.type === 'function_definition' || c.type === 'class_definition'
        );
        if (funcNode) {
          const nameNode = funcNode.children.find(c => c.type === 'identifier');
          if (nameNode) {
            const symbolName = nameNode.text;
            relationships.push({
              sourceName: symbolName,
              targetName: decoratorName,
              kind: 'decorates',
              line: decoratorNode.startPosition.row + 1,
            });
          }
        }
      }
    }

    for (const child of node.children) {
      this.walkForDecorators(child, sourceCode, symbols, relationships);
    }
  }

  /**
   * Extract import statements from the AST.
   * Handles JS/TS import syntax:
   *   import { Foo, Bar } from './module';
   *   import * as X from './module';
   *   import Foo from './module';
   *   const { Foo } = require('./module');
   */
  private extractImports(rootNode: SyntaxNode, sourceCode: string): ParsedImport[] {
    const imports: ParsedImport[] = [];
    this.walkForImports(rootNode, sourceCode, imports);
    return imports;
  }

  private walkForImports(node: SyntaxNode, sourceCode: string, imports: ParsedImport[]): void {
    // Handle: import ... from 'source'
    if (node.type === 'import_statement' || node.type === 'import') {
      const sourceNode = node.children.find(c => c.type === 'string' || c.type === 'string_fragment');
      if (sourceNode) {
        const source = sourceCode.slice(sourceNode.startIndex, sourceNode.endIndex).replace(/^['"]|['"]$/g, '');
        const names: string[] = [];
        let isWildcard = false;

        // Find named imports: import { Foo, Bar }
        const namedImports = node.children.find(c => c.type === 'named_imports' || c.type === 'import_clause');
        if (namedImports) {
          for (const child of namedImports.children) {
            if (child.type === 'import_specifier') {
              const nameNode = child.childForFieldName('name') ?? child.children[0];
              if (nameNode) {
                names.push(sourceCode.slice(nameNode.startIndex, nameNode.endIndex));
              }
            }
          }
        }

        // Find namespace import: import * as X
        const namespaceImport = node.children.find(c => c.type === 'namespace_import');
        if (namespaceImport) {
          isWildcard = true;
        }

        // Find default import: import Foo from '...'
        const importClause = node.children.find(c => c.type === 'import_clause');
        if (importClause) {
          for (const child of importClause.children) {
            if (child.type === 'identifier') {
              names.push(sourceCode.slice(child.startIndex, child.endIndex));
            }
          }
        }

        if (source && (names.length > 0 || isWildcard)) {
          imports.push({
            source,
            names,
            isWildcard,
            line: node.startPosition.row + 1,
          });
        }
      }
    }

    // Handle C/C++: #include "header.h" or #include <header.h>
    if (node.type === 'preproc_include') {
      // The path can be a string or system_lib_path
      const pathNode = node.children.find(c =>
        c.type === 'string_literal' || c.type === 'system_lib_string' || c.type === 'identifier'
      );
      if (pathNode) {
        const source = sourceCode.slice(pathNode.startIndex, pathNode.endIndex).replace(/^["<]|[">]$/g, '');

        // For C/C++ includes, we treat the header as providing all symbols
        // The names will be resolved during cross-file resolution
        imports.push({
          source,
          names: ['*'], // Wildcard - all exported symbols from header
          isWildcard: true,
          line: node.startPosition.row + 1,
        });
      }
    }

    for (const child of node.children) {
      this.walkForImports(child, sourceCode, imports);
    }
  }
}
