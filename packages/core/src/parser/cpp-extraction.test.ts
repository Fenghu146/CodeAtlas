// ============================================================
// C/C++ Extraction Quality Tests
//
// Regression coverage for real-repo defects found on HIS_cpp:
// - `.h` headers were parsed with the C grammar, turning `class X {}`
//   into function definitions and erasing namespaces
// - declarator-based names came out as the TYPE (`string name;` → "string")
// - class members were variables, methods were functions, complexity was
//   missing on misclassified nodes
// - function-local declarations flooded the symbol table
// ============================================================

import { describe, it, expect, beforeAll } from 'vitest';
import { CodeParser, detectLanguage } from './index.js';

describe('C/C++ extraction quality', () => {
  let parser: CodeParser;

  beforeAll(async () => {
    parser = new CodeParser();
    await parser.init();
    await parser.loadLanguage('cpp');
    await parser.loadLanguage('c');
  });

  const parse = (source: string, file = 'sample.cpp') => parser.parse(source, file).symbols;

  describe('language detection', () => {
    it('treats ambiguous header extensions as C++', () => {
      // C++ headers are the dominant case; the C grammar mangles them badly.
      expect(detectLanguage('model/entity.h')).toBe('cpp');
      expect(detectLanguage('include/legacy.hh')).toBe('cpp');
      expect(detectLanguage('include/legacy.h++')).toBe('cpp');
    });

    it('keeps .c files as C', () => {
      expect(detectLanguage('src/main.c')).toBe('c');
    });
  });

  describe('declarator-based names', () => {
    it('names class fields after the field, not the type', () => {
      const symbols = parse(`
class Patient {
private:
  string name;
  int age;
};
`);
      const fields = symbols.filter(s => s.kind === 'property');
      expect(fields.map(f => f.name).sort()).toEqual(['age', 'name']);
    });

    it('names functions after the identifier, not the return type', () => {
      const symbols = parse(`
Doctor DoctorManager::find(const string& id) {
  return Doctor();
}
`);
      const fn = symbols.find(s => s.kind === 'method');
      expect(fn?.name).toBe('find');
      expect(fn?.parentName).toBe('DoctorManager');
    });

    it('names file-scope variables after the variable', () => {
      const symbols = parse(`
Doctor g_instance;
string g_config_path = "a.txt";
`);
      const vars = symbols.filter(s => s.kind === 'variable');
      expect(vars.map(v => v.name).sort()).toEqual(['g_config_path', 'g_instance']);
    });
  });

  describe('kinds', () => {
    it('extracts namespaces, classes, enums and aliases with proper kinds', () => {
      const symbols = parse(`
namespace HospitalSystem {

class Manager { };

struct Config { };

union Value { int i; float f; };

enum class Color { Red, Green };

using IdType = string;

}
`);
      const byName = new Map(symbols.map(s => [s.name, s.kind]));
      expect(byName.get('HospitalSystem')).toBe('namespace');
      expect(byName.get('Manager')).toBe('class');
      expect(byName.get('Config')).toBe('class');
      expect(byName.get('Value')).toBe('class');
      expect(byName.get('Color')).toBe('enum');
      expect(byName.get('IdType')).toBe('type');
    });

    it('classifies members as properties and methods', () => {
      const symbols = parse(`
class Manager {
public:
  void remove(const string& id);
  bool ok() const { return true; }
private:
  string name;
  static Manager* instance;
};
`);
      const byName = new Map(symbols.map(s => [s.name, s.kind]));
      expect(byName.get('remove')).toBe('method');
      expect(byName.get('ok')).toBe('method');
      expect(byName.get('name')).toBe('property');
      expect(byName.get('instance')).toBe('property');
    });

    it('keeps prototypes and definitions as functions', () => {
      const symbols = parse(`
void showMenu();
int add(int a, int b) { return a + b; }
`);
      const fns = symbols.filter(s => s.kind === 'function');
      expect(fns.map(f => f.name).sort()).toEqual(['add', 'showMenu']);
    });

    it('treats qualified definitions as methods with the qualifier as parent', () => {
      const symbols = parse(`
void DoctorManager::load() { }
`);
      const fn = symbols.find(s => s.name === 'load');
      expect(fn?.kind).toBe('method');
      expect(fn?.parentName).toBe('DoctorManager');
    });
  });

  describe('noise suppression', () => {
    it('does not extract function-local declarations', () => {
      const symbols = parse(`
void run() {
  ifstream file("doctors.txt");
  string line;
  Doctor local;
  for (int i = 0; i < 3; i++) {
    int j = i;
  }
}
`);
      // Only the function itself; locals are implementation detail.
      expect(symbols.map(s => s.name)).toEqual(['run']);
    });

    it('keeps namespace-scope declarations of nested namespaces', () => {
      const symbols = parse(`
namespace Outer {
namespace Inner {
  int counter;
  void helper() { int local; }
}
}
`);
      const names = symbols.map(s => s.name).sort();
      expect(names).toEqual(['Inner', 'Outer', 'counter', 'helper']);
    });
  });

  describe('complexity', () => {
    it('computes complexity for functions and methods', () => {
      const symbols = parse(`
class Gate {
public:
  int classify(int x) {
    if (x > 0) { return 1; }
    if (x < 0) { return -1; }
    return 0;
  }
};
int standalone(int n) {
  for (int i = 0; i < n; i++) {
    if (i % 2 == 0) { continue; }
  }
  return n;
}
`);
      const method = symbols.find(s => s.name === 'classify');
      const fn = symbols.find(s => s.name === 'standalone');
      expect(method?.kind).toBe('method');
      expect(method?.complexity).toBeGreaterThanOrEqual(3);
      expect(fn?.complexity).toBeGreaterThanOrEqual(3);
    });
  });

  describe('templates and macros', () => {
    it('extracts template functions with correct names', () => {
      const symbols = parse(`
template <typename T>
T* findById(vector<T>& list, const string& id) {
  for (auto& item : list) {
    if (item.id == id) { return &item; }
  }
  return nullptr;
}
`);
      const fn = symbols.find(s => s.kind === 'function');
      expect(fn?.name).toBe('findById');
      expect(fn?.complexity).toBeGreaterThanOrEqual(3);
    });

    it('extracts #define constants and macros', () => {
      const symbols = parse(`
#define MAX_ROOMS 100
#define SQUARE(x) ((x) * (x))
`);
      const byName = new Map(symbols.map(s => [s.name, s.kind]));
      expect(byName.get('MAX_ROOMS')).toBe('constant');
      expect(byName.get('SQUARE')).toBe('function');
    });
  });

  describe('C headers under the C++ grammar', () => {
    it('parses C-style headers cleanly', () => {
      const symbols = parse(`
#include <stdio.h>

#define MAX_LEN 64

typedef struct Point {
  int x;
  int y;
} Point;

typedef enum Mode {
  MODE_A,
  MODE_B
} Mode;

static int s_counter = 0;

int point_sum(const Point* p);
void reset(void);
`, 'legacy.h');

      const byName = new Map(symbols.map(s => [s.name, s.kind]));
      expect(byName.get('MAX_LEN')).toBe('constant');
      expect(byName.get('Point')).toBeDefined();
      expect(byName.get('Mode')).toBeDefined();
      expect(byName.get('s_counter')).toBe('variable');
      expect(byName.get('point_sum')).toBe('function');
      expect(byName.get('reset')).toBe('function');
      expect(byName.get('x')).toBe('property');
      expect(byName.get('y')).toBe('property');
    });
  });
});