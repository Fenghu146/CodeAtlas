// ============================================================
// Macro Scanner — Detect function declarations hidden behind macros
// ============================================================
// Tree-sitter cannot parse function declarations that are wrapped
// in macros like LLAMA_API, EXPORT, DLL_EXPORT, etc.
// This scanner fills the gap by regex-scanning source files.

import fs from 'fs';
import path from 'path';
import type { ParseResult, ParsedSymbol } from '../parser/index.js';

/** Macro prefixes that indicate exported function declarations */
const EXPORT_MACROS = [
  'LLAMA_API', 'DLL_EXPORT', 'EXPORT', 'API_EXPORT',
  'DECLSPEC', 'DLL_PUBLIC', 'EXTERN_C',
  'RTC_EXPORT', 'PLUGIN_EXPORT', 'MODULE_EXPORT',
];

/** Regex to match: MACRO return_type func_name(params) — captures func_name via backtracking */
const EXPORT_FN_REGEX = new RegExp(
  '^(?:' + EXPORT_MACROS.join('|') + ')\\s+' +   // Macro prefix
  '(.*)\\s+' +                                      // Return type (greedy, backtracks to last word before ()
  '(\\w+)\\s*\\(' +                                 // Function name + (
  '([^)]*)\\s*\\)' +                                // Parameters
  '\\s*;',                                           // End with ;
  'gm'
);

/** Regex to match: MACRO on one line, then return_type func_name(params) on next */
const EXPORT_FN_MULTILINE_REGEX = new RegExp(
  '^(?:' + EXPORT_MACROS.join('|') + ')\\s*' +   // Macro prefix (line N)
  '(?:\\r?\\n)' +                                   // newline
  '(.*)\\s+' +                                      // Return type on next line
  '(\\w+)\\s*\\(' +                                 // Function name + (
  '([^)]*)\\s*\\)' +                                // Parameters
  '\\s*;',                                           // End with ;
  'gm'
);

/**
 * Scan a C/C++ source file for macro-protected function declarations
 * that tree-sitter might have missed.
 */
export function scanMacroDeclarations(filePath: string, content: string): ParsedSymbol[] {
  const symbols: ParsedSymbol[] = [];
  const base = path.basename(filePath);
  const ext = path.extname(filePath).toLowerCase();
  if (!['.c', '.h', '.cpp', '.hpp', '.cc', '.cxx', '.hh', '.hxx'].includes(ext)) {
    return symbols;
  }

  const lines = content.split(/\r?\n/);

  // Try single-line match first: LLAMA_API return_type name(params);
  let match: RegExpExecArray | null;
  while ((match = EXPORT_FN_REGEX.exec(content)) !== null) {
    const returnType = match[1].trim();
    const funcName = match[2].trim();
    const params = match[3].trim();

    // Calculate line number from position
    const lineNum = content.slice(0, match.index).split(/\r?\n/).length;

    // Generate source signature
    const sourceCode = lines[lineNum - 1]?.trim() ?? `LLAMA_API ${returnType} ${funcName}(${params});`;

    symbols.push({
      name: funcName,
      kind: 'function',
      startLine: lineNum,
      endLine: lineNum,
      startCol: match.index - content.lastIndexOf('\n', match.index) - 1,
      endCol: match.index + match[0].length - content.lastIndexOf('\n', match.index + match[0].length) - 1,
      sourceCode,
      exported: true,
    });
  }

  // Try multiline match: LLAMA_API \n return_type name(params);
  // P1#5 & #4: Catch C/C++ function definitions with complex return types
  // that tree-sitter may miss: const char * name(params), struct X * name(params)
  const COMPLEX_RETURN_REGEX = /^((?:const|struct|unsigned|signed)\s+)?(\w[\w\s]*(?:\s*\*+\s*)+)\s+(\w+)\s*\(([^)]*)\)\s*\{/gm;
  while ((match = COMPLEX_RETURN_REGEX.exec(content)) !== null) {
    const funcName = match[3].trim();
    if (symbols.some(s => s.name === funcName)) continue;
    const lineNum = content.slice(0, match.index).split(/\r?\n/).length;
    symbols.push({
      name: funcName,
      kind: 'function',
      startLine: lineNum,
      endLine: lineNum,
      startCol: 0,
      endCol: match[0].length,
      sourceCode: lines[lineNum - 1]?.trim() ?? match[0].trim(),
      exported: true,
    });
  }

  while ((match = EXPORT_FN_MULTILINE_REGEX.exec(content)) !== null) {
    const funcName = match[2].trim();
    // Skip if already found by single-line regex (dedup by name)
    if (symbols.some(s => s.name === funcName)) continue;

    const lineNum = content.slice(0, match.index).split(/\r?\n/).length;
    symbols.push({
      name: funcName,
      kind: 'function',
      startLine: lineNum,
      endLine: lineNum + 1,
      startCol: 0,
      endCol: match[0].length,
      sourceCode: match[0].trim(),
      exported: true,
    });
  }

  return symbols;
}

/**
 * Scan a project's C/C++ files for macro-decorated declarations
 * and return synthetic parse results.
 */
export function scanProjectMacros(
  projectPath: string,
  files: string[],
  existingSymbols: Set<string>,
): ParseResult[] {
  const results: ParseResult[] = [];

  for (const filePath of files) {
    const ext = path.extname(filePath).toLowerCase();
    if (!['.c', '.h', '.cpp', '.hpp', '.cc', '.cxx', '.hh', '.hxx'].includes(ext)) continue;

    let content: string;
    try {
      const stat = fs.statSync(filePath);
      if (stat.size > 1024 * 1024) continue; // Skip files > 1MB
      content = fs.readFileSync(filePath, 'utf-8');
    } catch {
      continue;
    }

    const relativePath = path.relative(projectPath, filePath).replace(/\\/g, '/');
    const symbols = scanMacroDeclarations(filePath, content);

    // Filter out symbols that already exist from tree-sitter parsing
    const newSymbols = symbols.filter(s => !existingSymbols.has(s.name));

    if (newSymbols.length > 0) {
      results.push({
        symbols: newSymbols,
        relationships: [],
        imports: [],
        language: ext === '.c' || ext === '.h' ? 'c' : 'cpp',
        filePath: relativePath,
      });
    }
  }

  return results;
}
