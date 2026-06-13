// ============================================================
// Macro Scanner Unit Tests
// ============================================================

import { describe, it, expect } from 'vitest';
import { scanMacroDeclarations } from './macro-scanner.js';

describe('scanMacroDeclarations', () => {
  it('should detect LLAMA_API function declarations', () => {
    const src = 'LLAMA_API int32_t llama_decode(llama_context * ctx, llama_batch batch);\n';
    const symbols = scanMacroDeclarations('test.cpp', src);
    expect(symbols.length).toBe(1);
    expect(symbols[0].name).toBe('llama_decode');
    expect(symbols[0].kind).toBe('function');
    expect(symbols[0].exported).toBe(true);
  });

  it('should detect multiple macro functions', () => {
    const src = [
      'LLAMA_API int32_t llama_decode(llama_context * ctx, llama_batch batch);',
      'LLAMA_API void llama_free(llama_context * ctx);',
      'LLAMA_API struct llama_model * llama_load_model(const char * path);',
    ].join('\n');
    const symbols = scanMacroDeclarations('test.cpp', src);
    expect(symbols.length).toBe(3);
    expect(symbols.map(s => s.name)).toEqual(['llama_decode', 'llama_free', 'llama_load_model']);
  });

  it('should ignore non-macro functions', () => {
    const src = 'int normal_func(int x) { return x; }\nstatic void helper(void) {}\n';
    const symbols = scanMacroDeclarations('test.cpp', src);
    expect(symbols.length).toBe(0);
  });

  it('should return empty for non-C/C++ files', () => {
    const src = 'export function foo() {}\n';
    const symbols = scanMacroDeclarations('test.ts', src);
    expect(symbols.length).toBe(0);
  });

  it('should handle LLAMA_API with pointer return types', () => {
    const src = 'LLAMA_API struct llama_context * llama_new_context(struct llama_model * model);\n';
    const symbols = scanMacroDeclarations('test.c', src);
    expect(symbols.length).toBe(1);
    expect(symbols[0].name).toBe('llama_new_context');
  });

  it('should handle DLL_EXPORT macro', () => {
    const src = 'DLL_EXPORT int32_t init_module(void);\n';
    const symbols = scanMacroDeclarations('test.c', src);
    expect(symbols.length).toBe(1);
    expect(symbols[0].name).toBe('init_module');
  });

  it('should handle multiline macro declarations', () => {
    const src = 'LLAMA_API\nint32_t llama_decode(\n  llama_context * ctx,\n  llama_batch batch);\n';
    const symbols = scanMacroDeclarations('test.cpp', src);
    expect(symbols.length).toBeGreaterThanOrEqual(1);
  });

  it('should not duplicate from multiline regex when same line matches both', () => {
    // The multiline regex requires an actual newline after the macro
    const src = 'LLAMA_API int32_t llama_decode(llama_context * ctx, llama_batch batch);\nLLAMA_API\nint32_t llama_decode_multiline(llama_context * ctx);\n';
    const symbols = scanMacroDeclarations('test.cpp', src);
    const single = symbols.filter(s => s.name === 'llama_decode');
    const multi = symbols.filter(s => s.name === 'llama_decode_multiline');
    expect(single.length).toBe(1);  // single-line match only
    expect(multi.length).toBe(1);   // multiline match only
  });
});
