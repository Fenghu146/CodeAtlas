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

// Ancestor scopes that introduce names for binding nodes (assignments/decls).
const CLASS_SCOPE_TYPES = new Set([
  'class_definition', 'class_declaration', 'abstract_class_declaration',
  'class_specifier', 'struct_specifier', 'impl_item', 'class',
]);
const FUNCTION_SCOPE_TYPES = new Set([
  'function_definition', 'function_declaration', 'method_definition', 'method',
  'singleton_method', 'arrow_function', 'lambda', 'generator_function_declaration',
  'function_item', 'constructor_declaration',
]);
// Value nodes that make `const f = ...` a function symbol, not a variable.
const FUNCTION_VALUE_TYPES = new Set([
  'arrow_function', 'function', 'function_expression',
  'generator_function', 'lambda',
]);
const LOOP_VARIABLE_PARENTS = new Set([
  'for_statement', 'for_in_statement', 'while_statement',
]);

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
  /** Cyclomatic complexity (1 + number of decision points) */
  complexity?: number;
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
  // Header extensions are ambiguous between C and C++; the C++ grammar is a
  // superset of C and the ecosystem convention (clang/GitHub Linguist) treats
  // headers as C++ when ambiguous. Using the C grammar on C++ headers parses
  // `class X {}` as a function definition and destroys namespaces entirely.
  '.h': 'cpp',
  '.hpp': 'cpp',
  '.cc': 'cpp',
  '.cxx': 'cpp',
  '.hh': 'cpp',
  '.hxx': 'cpp',
  '.c++': 'cpp',
  '.h++': 'cpp',
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

    // `self.attr = v` in every method still declares one property — keep the
    // first (earliest) occurrence per class attribute name.
    const seenProperties = new Set<string>();
    return symbols.filter((s) => {
      if (s.kind !== 'property') return true;
      const key = `${s.parentName ?? ''}::${s.name}`;
      if (seenProperties.has(key)) return false;
      seenProperties.add(key);
      return true;
    });
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
        const symbol = this.nodeToSymbol(node, sourceCode, lang);
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
        const symbol = this.nodeToSymbol(node, sourceCode, lang);
        if (symbol) {
          symbols.push(symbol);
        }
      }
    } else if (symbolKinds.has(node.type)) {
      const symbol = this.nodeToSymbol(node, sourceCode, lang);
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
      'assignment',           // Python/Ruby: X = ... (declaration-by-assignment)
      'assignment_expression', // JS/TS/Java: only `this.x = ...` property init
      // C/C++ specifics (names and kinds are resolved through the declarator
      // chain — see nodeToSymbolC)
      'function_definition',
      'class_specifier',      // C++ class
      'struct_specifier',     // C struct/class
      'union_specifier',      // C/C++ union
      'enum_specifier',       // C/C++ enum
      'namespace_definition', // C++ namespace
      'alias_declaration',    // C++ using X = Y
      'field_declaration',    // class/struct members and method declarations
      'preproc_def',          // #define
      'preproc_function_def', // #define FUNC()
      // TypeScript/JavaScript class fields
      'public_field_definition',
      // Java specifics
      'method_declaration',
      'constructor_declaration',
      'record_declaration',
      'annotation_type_declaration',
      // Rust specifics (impl_item is not extracted — it only names the parent)
      'struct_item',
      'enum_item',
      'trait_item',
      'function_item',
      'function_signature_item',
      'mod_item',
      'type_item',
      'const_item',
      // Embedded C specifics
      'type_definition',      // typedef
      'declaration',          // file-scope declarations (locals are skipped)
    ]);
    return common;
  }

  /** Convert a syntax node to a ParsedSymbol */
  private nodeToSymbol(node: SyntaxNode, sourceCode: string, lang?: string): ParsedSymbol | null {
    // C/C++ use declarator-based extraction (names come from the declarator
    // chain, not from the type) — see nodeToSymbolC.
    if (lang === 'c' || lang === 'cpp') {
      return this.nodeToSymbolC(node, sourceCode, lang);
    }

    let kind = this.mapNodeKind(node.type);
    if (!kind) return null;

    // Extract name - varies by language and node type
    let nameNode: SyntaxNode | null = node.childForFieldName('name') ?? null;

    // Assignments name their target, not the value: `self.name = raw`
    // is the attribute `name` (unwrap `obj.attr` to `attr`).
    if (!nameNode && (node.type === 'assignment' || node.type === 'assignment_expression')) {
      const target = node.childForFieldName('left') ?? node.childForFieldName('target');
      if (target) {
        nameNode = target.childForFieldName('attribute')   // python `self.name`
          ?? target.childForFieldName('property')          // js/ts `this.name`
          ?? target.childForFieldName('field')             // java `this.name`
          ?? target.childForFieldName('name')
          ?? target;
      }
    }

    // JS/TS const/let/var: the binding lives in the `variable_declarator`
    // child (`const top = 1` — the declaration node has no name field).
    if (!nameNode && (node.type === 'lexical_declaration' || node.type === 'variable_declaration')) {
      const decl = node.children.find(c => c.type === 'variable_declarator');
      if (decl) {
        const binding = decl.childForFieldName('name') ?? decl.namedChild(0);
        // Destructuring patterns have no single name; skip rather than guess.
        if (binding && (binding.type === 'identifier' || binding.type === 'type_identifier')) {
          nameNode = binding;
        } else {
          return null;
        }
      }
    }

    // Java/Rust/C declarators: the name lives in the declarator, never in the
    // type (`private String prefix;` — `String` is the type, `prefix` the name).
    if (!nameNode) {
      const declarator = node.childForFieldName('declarator');
      if (declarator) {
        nameNode = declarator.childForFieldName('name')
          ?? (declarator.namedChildCount === 1 ? declarator.namedChild(0) : null)
          ?? declarator;
      }
    }

    // Fallback: a plain identifier child (never the type — see below).
    if (!nameNode) {
      nameNode = node.children.find(c => c.type === 'identifier') ?? null;
    }
    // Last resort: the type name, kept only when nothing else identifies the symbol.
    if (!nameNode) {
      nameNode = node.children.find(c => c.type === 'type_identifier') ?? null;
    }

    if (!nameNode) return null;

    // Scope-aware binding rules for assignment-like nodes: only module scope
    // and class scope introduce names; bindings inside functions are locals
    // and never symbols. Attribute targets (`self.x`/`this.x`/`@x`) declare
    // the object's property; other attribute/subscript targets are plain
    // reassignments of existing objects and never declare names.
    if (
      node.type === 'assignment' ||
      node.type === 'assignment_expression' ||
      node.type === 'lexical_declaration' ||
      node.type === 'variable_declaration'
    ) {
      const target = node.type === 'assignment' || node.type === 'assignment_expression'
        ? (node.childForFieldName('left') ?? node.childForFieldName('target') ?? node)
        : nameNode;
      const objectNode = target.childForFieldName('object');
      const isPropertyTarget =
        target.type === 'instance_variable' || // ruby `@x = 1`
        (objectNode !== null &&
          (objectNode.type === 'this' ||
            sourceCode.slice(objectNode.startIndex, objectNode.endIndex) === 'self'));
      const isPlainName = target.type === 'identifier' || target.type === 'type_identifier';

      if (isPropertyTarget) {
        // Property declarations attach to the enclosing class.
        let scope: SyntaxNode | null = node.parent;
        while (scope && !CLASS_SCOPE_TYPES.has(scope.type)) scope = scope.parent;
        if (!scope) return null;
        kind = 'property';
      } else if (!isPlainName) {
        return null; // `obj.field = ...` / `a[0] = ...` — not declarations
      } else if (node.type === 'assignment_expression') {
        return null; // js/ts/java `x = ...` reassigns; the declaration is the symbol
      } else if (node.parent && LOOP_VARIABLE_PARENTS.has(node.parent.type)) {
        return null; // `for (let i = ...)` loop variable
      } else {
        let scope: SyntaxNode | null = node.parent;
        while (scope && scope.type !== 'program') {
          if (FUNCTION_SCOPE_TYPES.has(scope.type)) return null; // local binding
          if (CLASS_SCOPE_TYPES.has(scope.type)) { kind = 'property'; break; }
          scope = scope.parent;
        }
        if (kind !== 'property') {
          // `const helper = () => {}` reads as a function, not a variable.
          const value = node.childForFieldName('value') ?? node.childForFieldName('right');
          if (value && FUNCTION_VALUE_TYPES.has(value.type)) kind = 'function';
        }
      }
    }

    const name = sourceCode.slice(nameNode.startIndex, nameNode.endIndex);
    const sourceSlice = sourceCode.slice(node.startIndex, node.endIndex);
    const docComment = this.extractDocComment(node, sourceCode);
    const exported = this.isExported(node, sourceCode, lang);

    // Cyclomatic complexity: count decision points in the function body
    const complexity = (kind === 'function' || kind === 'method')
      ? this.calculateComplexity(sourceSlice, lang)
      : undefined;

    // Detect the enclosing type (class/struct/impl/trait) and use it as parent.
    // Rust names the parent of an `impl` block through its `type` field.
    let parentName: string | undefined;
    {
      let parent = node.parent;
      while (parent) {
        const isTypeBody =
          parent.type === 'class_definition' ||
          parent.type === 'class_declaration' ||
          parent.type === 'abstract_class_declaration' ||
          parent.type === 'class' ||
          parent.type === 'class_specifier' ||
          parent.type === 'struct_specifier' ||
          parent.type === 'record_declaration' ||
          parent.type === 'interface_declaration' ||
          parent.type === 'trait_item' ||
          parent.type === 'struct_item' ||
          parent.type === 'impl_item';
        if (isTypeBody) {
          const parentNameNode = parent.childForFieldName('type')
            ?? parent.childForFieldName('name')
            ?? parent.children.find(c => c.type === 'identifier' || c.type === 'type_identifier');
          if (parentNameNode) {
            parentName = sourceCode.slice(parentNameNode.startIndex, parentNameNode.endIndex);
            // A function declared in a type body is a method.
            if (kind === 'function') kind = 'method';
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
      complexity,
    };
  }

  /**
   * C/C++ symbol extraction.
   *
   * C-family declarations name their entity through the declarator chain
   * (`Type* name(...)`, `Type name = ...`), so a naive "first identifier in
   * children" rule returns the TYPE instead of the name (`string name;` →
   * "string"). This path resolves the declarator chain, classifies members as
   * properties and methods (with their class as parent), and skips
   * function-local declarations, which are implementation detail.
   */
  private nodeToSymbolC(node: SyntaxNode, sourceCode: string, lang: string): ParsedSymbol | null {
    // Reassignments (`x = 5`, `this->x = 5`) never declare names in C-family;
    // fields come from declarations inside the class body.
    if (node.type === 'assignment_expression') return null;
    const decl = this.resolveCDeclarator(node);

    let kind: string | null;
    switch (node.type) {
      case 'namespace_definition':
        kind = 'namespace';
        break;
      case 'class_specifier':
      case 'struct_specifier':
      case 'union_specifier':
        kind = 'class';
        break;
      case 'enum_specifier':
        kind = 'enum';
        break;
      case 'alias_declaration':
      case 'type_definition':
        kind = 'type';
        break;
      case 'preproc_def':
        kind = 'constant';
        break;
      case 'preproc_function_def':
        kind = 'function';
        break;
      case 'field_declaration':
        kind = decl?.isFunction ? 'method' : 'property';
        break;
      case 'function_definition': {
        // In-class definitions are methods; out-of-class definitions with a
        // qualified name (`void Manager::load() {}`) are methods too.
        kind = this.findCClassParent(node) || decl?.qualifierNode ? 'method' : 'function';
        break;
      }
      case 'declaration': {
        // Function-local declarations are implementation detail; keeping them
        // floods the symbol table with type-named noise.
        if (this.isLocalToFunction(node)) return null;
        if (decl?.isFunction) {
          kind = this.findCClassParent(node) || decl.qualifierNode ? 'method' : 'function';
        } else {
          kind = 'variable';
        }
        break;
      }
      default:
        return null;
    }

    // Named nodes (class/enum/namespace/alias/#define) carry a `name` field;
    // declarator nodes resolve it through the declarator chain.
    let nameNode: SyntaxNode | null = node.childForFieldName('name');
    if (!nameNode) nameNode = decl?.nameNode ?? null;
    if (!nameNode) return null;

    const name = nameNode.text;
    const sourceSlice = sourceCode.slice(node.startIndex, node.endIndex);
    const docComment = this.extractDocComment(node, sourceCode);
    const exported = this.isExported(node, sourceCode, lang);

    // Cyclomatic complexity: count decision points in the function body
    const complexity = (kind === 'function' || kind === 'method')
      ? this.calculateComplexity(sourceSlice, lang)
      : undefined;

    // Parent: enclosing class/struct, or the qualifier of out-of-class
    // definitions (`void Manager::load() {}` → Manager).
    const classParent = this.findCClassParent(node);
    let parentName: string | undefined;
    if (classParent) {
      parentName = classParent.childForFieldName('name')?.text;
    } else if (decl?.qualifierNode) {
      parentName = decl.qualifierNode.text;
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
      complexity,
    };
  }

  /** Declarator wrapper node types in the C-family grammars. */
  private static readonly C_DECLARATOR_WRAPPERS = new Set([
    'function_declarator',
    'pointer_declarator',
    'reference_declarator',
    'array_declarator',
    'init_declarator',
    'parenthesized_declarator',
    'attributed_declarator',
  ]);

  /**
   * Resolve the declared entity of a C-family node through its declarator
   * chain. Returns the node carrying the name, whether the entity is a
   * function (the chain passes through a function_declarator), and the
   * qualifier of qualified names (`Manager::instance` → "Manager").
   */
  private resolveCDeclarator(node: SyntaxNode): {
    nameNode: SyntaxNode | null;
    isFunction: boolean;
    qualifierNode: SyntaxNode | null;
  } | null {
    let current =
      node.childForFieldName('declarator') ??
      node.children.find((c) => CodeParser.C_DECLARATOR_WRAPPERS.has(c.type)) ??
      null;
    if (!current) return null;

    let isFunction = false;
    for (let hops = 0; current && hops < 12; hops++) {
      if (current.type === 'function_declarator') isFunction = true;

      switch (current.type) {
        case 'identifier':
        case 'field_identifier':
        case 'type_identifier':
        case 'operator_name':
        case 'destructor_name':
          return { nameNode: current, isFunction, qualifierNode: null };
        case 'qualified_identifier':
          return {
            nameNode: current.childForFieldName('name'),
            isFunction,
            qualifierNode: current.childForFieldName('scope') ?? current.namedChildren[0] ?? null,
          };
        default: {
          if (!CodeParser.C_DECLARATOR_WRAPPERS.has(current.type)) return null;
          current = current.childForFieldName('declarator') ?? current.namedChildren[0] ?? null;
        }
      }
    }
    return null;
  }

  /** Nearest enclosing class/struct/union specifier, if any. */
  private findCClassParent(node: SyntaxNode): SyntaxNode | null {
    let parent = node.parent;
    while (parent && parent.type !== 'translation_unit') {
      if (
        parent.type === 'class_specifier' ||
        parent.type === 'struct_specifier' ||
        parent.type === 'union_specifier'
      ) {
        return parent;
      }
      parent = parent.parent;
    }
    return null;
  }

  /** True when the node sits inside a function body (compound_statement). */
  private isLocalToFunction(node: SyntaxNode): boolean {
    let parent = node.parent;
    while (parent) {
      if (parent.type === 'compound_statement') return true;
      if (parent.type === 'translation_unit') return false;
      parent = parent.parent;
    }
    return false;
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
      'class_specifier': 'class',
      'struct_specifier': 'class',         // struct (treat as class)
      'union_specifier': 'class',          // union (aggregate like struct)
      'enum_specifier': 'enum',
      'namespace_definition': 'namespace',
      'alias_declaration': 'type',         // using X = Y
      'preproc_def': 'constant',           // #define
      'preproc_function_def': 'function',  // #define FUNC()
      // Embedded C specifics
      'type_definition': 'type',           // typedef (name lives in the declarator)
      'declaration': 'variable',           // refined to function/method via declarator
      'field_declaration': 'property',     // refined to method for method declarations
      'public_field_definition': 'property',  // TS/JS class field
      // Java
      'method_declaration': 'method',
      'constructor_declaration': 'method',
      'record_declaration': 'class',
      'annotation_type_declaration': 'interface',
      // Rust
      'struct_item': 'class',              // struct (aggregate like class)
      'trait_item': 'interface',
      'function_item': 'function',         // promoted to method inside impl
      'function_signature_item': 'function',
      'mod_item': 'module',
      'type_item': 'type',
      'const_item': 'constant',
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
  private isExported(node: SyntaxNode, sourceCode?: string, lang?: string): boolean {
    const parent = node.parent;
    if (!parent) return false;

    // JS/TS: explicit export keyword
    if (parent.type === 'export_statement' || parent.type === 'export_default_declaration') {
      return true;
    }

    // C/C++: externally visible by default, unless 'static' or file-scoped
    if (lang === 'c' || lang === 'cpp') {
      // function_definition, struct_specifier, class_specifier at file scope are exported
      if (['function_definition', 'struct_specifier', 'class_specifier',
           'template_function', 'template_class', 'type_definition'].includes(node.type)) {
        // Check for 'static' storage class specifier in the node or its declarator
        if (sourceCode && this.hasStaticSpecifier(node, sourceCode)) {
          return false; // static functions are file-local
        }
        return true;
      }
      // declaration nodes: check for extern vs static
      if (node.type === 'declaration' || node.type === 'linked_declaration') {
        if (sourceCode && this.hasStaticSpecifier(node, sourceCode)) return false;
        return true;
      }
      // preprocessor defines are global
      if (node.type === 'preproc_def' || node.type === 'preproc_function_def') return true;
    }

    return false;
  }

  /**
   * Check if a C/C++ AST node carries a 'static' storage class specifier.
   */
  private hasStaticSpecifier(node: SyntaxNode, sourceCode: string): boolean {
    for (const child of node.children) {
      if (child.type === 'storage_class_specifier') {
        const text = sourceCode.slice(child.startIndex, child.endIndex);
        if (text === 'static') return true;
      }
      // For function_definition with declarator, also check children of declarator children
      if (child.type === 'function_declarator' || child.type === 'pointer_declarator' || child.type === 'init_declarator') {
        for (const sub of child.children) {
          if (sub.type === 'storage_class_specifier') {
            const text = sourceCode.slice(sub.startIndex, sub.endIndex);
            if (text === 'static') return true;
          }
        }
      }
    }
    return false;
  }

  /**
   * Calculate cyclomatic complexity of a function/method body.
   * Complexity = 1 (baseline) + each decision point.
   * Decision points: if, else if, while, for, case, catch, &&, ||, ? :
   */
  private calculateComplexity(sourceCode: string, lang?: string): number {
    let complexity = 1; // baseline
    const body = sourceCode;

    // Count keywords that represent decision points
    const decisions = [
      /\bif\s*\(/g, /\belse\s+if\b/g, /\bwhile\s*\(/g,
      /\bfor\s*\(/g, /\bcase\s+/g, /\bcatch\s*\(/g,
      /\bswitch\s*\(/g,
    ];

    for (const re of decisions) {
      const matches = body.match(re);
      if (matches) complexity += matches.length;
    }

    // Count ternary operators (? :) but not inside strings or comments
    const ternaryMatches = body.match(/\?\s*[^:;]+\s*:/g);
    if (ternaryMatches) {
      // Filter out obvious false positives (template literals, macros, etc.)
      const valid = ternaryMatches.filter(m =>
        !m.includes('"') && !m.includes("'") && !m.startsWith('//')
      );
      complexity += valid.length;
    }

    // Logical operators && and || that appear in condition contexts
    const logicalMatches = body.match(/&&|\|\|/g);
    if (logicalMatches) complexity += logicalMatches.length;

    // Additional C/C++ specific: else without if, but that's usually else-if which we count
    if (lang === 'c' || lang === 'cpp') {
      // C/C++ specific: count #if, #ifdef, #elif as branching
      const preprocMatches = body.match(/\#\s*(?:if|ifdef|ifndef|elif)\b/g);
      if (preprocMatches) complexity += preprocMatches.length;
    }

    return complexity;
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
    const localNames = this.collectLocalNames(node);

    // 1. Extract call relationships
    this.walkForRelationships(node, sourceCode, symbolNames, symbols, relationships, localNames);

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
    localNames: Set<string>,
  ): void {
    // Detect function calls: call_expression (JS/TS) or call (Python)
    if (node.type === 'call_expression' || node.type === 'call' || node.type === 'method_invocation' || node.type === 'object_creation_expression') {
      // Java call nodes carry the callee in `name`/`type` — hand the node itself
      // to normalizeCallTarget, which knows how to pick the right child.
      const funcNode = node.childForFieldName('function')
        ?? (node.type === 'method_invocation' || node.type === 'object_creation_expression' ? node : null);
      if (funcNode) {
        const funcName = this.normalizeCallTarget(funcNode, sourceCode);
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
        this.findFunctionReferencesInArgs(argListNode, sourceCode, symbolNames, symbols, node, relationships, localNames);
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
      this.walkForRelationships(child, sourceCode, symbolNames, symbols, relationships, localNames);
    }
  }

  /** Resolve the callee name for a call expression's `function` node. */
  private normalizeCallTarget(funcNode: SyntaxNode, sourceCode: string): string {
    // Java `obj.method()` / `new Foo()` — the callee is `name` or `type`.
    if (funcNode.type === 'method_invocation') {
      const name = funcNode.childForFieldName('name');
      if (name) return sourceCode.slice(name.startIndex, name.endIndex);
    }
    if (funcNode.type === 'object_creation_expression') {
      const type = funcNode.childForFieldName('type');
      if (type) return sourceCode.slice(type.startIndex, type.endIndex);
    }

    // `this.repo.save()` / `console.log()` — use the property name so the call
    // resolves to the `save` symbol instead of the literal expression text.
    if (funcNode.type === 'member_expression') {
      const prop = funcNode.childForFieldName('property');
      if (prop) return sourceCode.slice(prop.startIndex, prop.endIndex);
    }
    // C/C++ `obj->fn()` / `obj.method()` — the callee is the `field` child.
    if (funcNode.type === 'field_expression') {
      const field = funcNode.childForFieldName('field');
      if (field) return sourceCode.slice(field.startIndex, field.endIndex);
    }
    // Python `raw.strip()` — the callee is the `attribute` child.
    if (funcNode.type === 'attribute') {
      const attr = funcNode.childForFieldName('attribute');
      if (attr) return sourceCode.slice(attr.startIndex, attr.endIndex);
    }
    // C++ `ns::fn()` — the callee is the `name` child.
    if (funcNode.type === 'qualified_identifier') {
      const name = funcNode.childForFieldName('name');
      if (name) return sourceCode.slice(name.startIndex, name.endIndex);
    }
    return sourceCode.slice(funcNode.startIndex, funcNode.endIndex);
  }

  /**
   * Collect names bound to local values (variables, parameters) in this file.
   * Keeps call detection from mistaking a local value passed as an argument
   * (`printf("%d", total)`) for a function reference.
   */
  private collectLocalNames(rootNode: SyntaxNode): Set<string> {
    const names = new Set<string>();
    const add = (n: SyntaxNode | null): void => {
      if (n && n.namedChildCount === 0) names.add(n.text);
    };
    const visit = (n: SyntaxNode): void => {
      if (/declarator$/.test(n.type) || n.type === 'let_declaration') {
        for (const field of ['name', 'declarator', 'pattern']) {
          add(n.childForFieldName(field));
        }
      }
      if (n.type === 'required_parameter' || n.type === 'optional_parameter' || n.type === 'default_parameter' || n.type === 'typed_parameter') {
        add(n.childForFieldName('pattern') ?? n.childForFieldName('name'));
      }
      // Python: `def f(a, b)` — bare parameter identifiers under `parameters`.
      if (n.type === 'parameters') {
        for (const child of n.children) {
          if (child.type === 'identifier') add(child);
        }
      }
      for (const child of n.children) visit(child);
    };
    visit(rootNode);
    return names;
  }

  /** Find the symbol containing a node — the innermost declaration wins. */
  private findContainingSymbol(node: SyntaxNode, symbols: ParsedSymbol[]): string | null {
    const line = node.startPosition.row + 1;
    let best: ParsedSymbol | null = null;
    for (const symbol of symbols) {
      if (line < symbol.startLine || line > symbol.endLine) continue;
      // A call inside a method belongs to the method, not to its class.
      if (!best) {
        best = symbol;
        continue;
      }
      const bestSpan = best.endLine - best.startLine;
      const span = symbol.endLine - symbol.startLine;
      if (span < bestSpan || (span === bestSpan && symbol.startLine > best.startLine)) best = symbol;
    }
    return best ? best.name : null;
  }

  /** Recursively find function references in argument lists */
  private findFunctionReferencesInArgs(
    node: SyntaxNode,
    sourceCode: string,
    symbolNames: Set<string>,
    symbols: ParsedSymbol[],
    callNode: SyntaxNode,
    relationships: ParsedRelationship[],
    localNames: Set<string>,
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

        // A local value shadows any same-named symbol: `foo(name)` where `name`
        // is a parameter is not a reference to the `name` symbol.
        if (localNames.has(name)) return;

        // Create relationship if:
        // 1. Target is a known function/method, OR
        // 2. Target is a known symbol in this file, OR
        // 3. Target looks like a function (heuristic for cross-file references)
        if (isKnownFunction || symbolNames.has(name) || looksLikeFunction) {
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
      this.findFunctionReferencesInArgs(child, sourceCode, symbolNames, symbols, callNode, relationships, localNames);
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
