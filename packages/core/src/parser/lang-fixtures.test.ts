// ============================================================
// Language extraction fixtures
// ============================================================
// One fixture per language with an expected symbol table. These lock in the
// extraction contract (kind, name, parent) and double as regression tests for
// the failure modes found in real-repo audits:
//   - names must come from the declarator, never from the type
//   - methods belong to their class/struct/impl, not to the file
//   - call targets are member names, and local values are never call targets
// ============================================================

import { describe, it, expect, beforeAll } from 'vitest';
import { CodeParser } from './index.js';

interface ExpectedSymbol {
  kind: string;
  name: string;
  parent?: string;
}

interface Fixture {
  language: string;
  file: string;
  code: string;
  symbols: ExpectedSymbol[];
  /** source -> target call pairs that must be present */
  calls: Array<[string, string]>;
  /** pairs that must NOT appear (regressions: type names, locals) */
  noCalls: Array<[string, string]>;
}

const FIXTURES: Fixture[] = [
  {
    language: 'typescript',
    file: 'service.ts',
    code: `
export class UserService {
  private prefix: string;

  constructor(prefix: string) {
    this.prefix = prefix;
  }

  create(name: string): string {
    return this.prefix + name.trim();
  }
}

export function helper(x: number): number {
  return x * 2;
}
`,
    symbols: [
      { kind: 'class', name: 'UserService' },
      { kind: 'property', name: 'prefix', parent: 'UserService' },
      { kind: 'method', name: 'constructor', parent: 'UserService' },
      { kind: 'method', name: 'create', parent: 'UserService' },
      { kind: 'function', name: 'helper' },
    ],
    calls: [['create', 'trim']],
    noCalls: [['create', 'string'], ['create', 'name']],
  },
  {
    language: 'python',
    file: 'models/user.py',
    code: `
class User:
    def __init__(self, name: str):
        self.name = name

    def rename(self, new_name: str) -> None:
        self.name = new_name

def format_name(raw: str) -> str:
    return raw.strip()

class UserService:
    def create(self, name):
        return User(format_name(name))
`,
    symbols: [
      { kind: 'class', name: 'User' },
      { kind: 'method', name: '__init__', parent: 'User' },
      // `self.name = ...` is an assignment — extracted as a variable, not a field.
      { kind: 'variable', name: 'name', parent: 'User' },
      { kind: 'method', name: 'rename', parent: 'User' },
      { kind: 'function', name: 'format_name' },
      { kind: 'class', name: 'UserService' },
      { kind: 'method', name: 'create', parent: 'UserService' },
    ],
    calls: [['format_name', 'strip'], ['create', 'format_name']],
    // `name`/`new_name` are local values, `str`/`None` are types.
    noCalls: [['create', 'name'], ['rename', 'str'], ['__init__', 'str']],
  },
  {
    language: 'java',
    file: 'UserService.java',
    code: `
public class UserService {
    private final String prefix;

    public UserService(String prefix) {
        this.prefix = prefix;
    }

    public String create(String name) {
        return prefix + name.trim();
    }

    private int count(List<String> items) {
        return items.size();
    }
}
`,
    symbols: [
      { kind: 'class', name: 'UserService' },
      // The name is `prefix` — the type `String` must never become a symbol name.
      { kind: 'property', name: 'prefix', parent: 'UserService' },
      { kind: 'method', name: 'UserService', parent: 'UserService' },
      { kind: 'method', name: 'create', parent: 'UserService' },
      { kind: 'method', name: 'count', parent: 'UserService' },
    ],
    calls: [['create', 'trim'], ['count', 'size']],
    noCalls: [['UserService', 'String'], ['create', 'int']],
  },
  {
    language: 'rust',
    file: 'service.rs',
    code: `
pub struct UserService {
    prefix: String,
}

impl UserService {
    pub fn new(prefix: String) -> Self {
        Self { prefix }
    }

    pub fn create(&self, name: &str) -> String {
        let trimmed = name.trim();
        format!("{}{}", self.prefix, trimmed)
    }
}

fn helper(x: i32) -> i32 {
    x * 2
}
`,
    symbols: [
      // `struct` maps to class: the aggregate kind in the shared vocabulary.
      { kind: 'class', name: 'UserService' },
      { kind: 'property', name: 'prefix', parent: 'UserService' },
      // Functions in an `impl` block are methods of that type.
      { kind: 'method', name: 'new', parent: 'UserService' },
      { kind: 'method', name: 'create', parent: 'UserService' },
      { kind: 'function', name: 'helper' },
    ],
    calls: [['create', 'trim']],
    noCalls: [['create', 'String'], ['helper', 'i32']],
  },
  {
    language: 'cpp',
    file: 'service.hpp',
    code: `
namespace svc {

class UserService {
public:
    std::string create(std::string name);
private:
    std::string prefix_;
};

}
`,
    symbols: [
      { kind: 'namespace', name: 'svc' },
      { kind: 'class', name: 'UserService' },
      { kind: 'property', name: 'prefix_', parent: 'UserService' },
      { kind: 'method', name: 'create', parent: 'UserService' },
    ],
    calls: [],
    noCalls: [['UserService', 'class'], ['create', 'std']],
  },
];

let parser: CodeParser;

beforeAll(async () => {
  parser = new CodeParser();
  await parser.init();
  for (const fixture of FIXTURES) {
    await parser.loadLanguage(fixture.language);
  }
}, 60_000);

describe.each(FIXTURES.map((f) => [f.language, f] as const))('extracts %s', (_language, fixture) => {
  it('produces the expected symbols with kinds and parents', () => {
    const result = parser.parse(fixture.code, fixture.file);
    const actual = result.symbols.map((s) => `${s.kind} ${s.name}${s.parentName ? `@${s.parentName}` : ''}`);
    for (const expected of fixture.symbols) {
      const wanted = `${expected.kind} ${expected.name}${expected.parent ? `@${expected.parent}` : ''}`;
      expect(actual, `${fixture.file}: expected ${wanted} in [${actual.join(', ')}]`).toContain(wanted);
    }
  });

  it('never names a symbol after its type', () => {
    const result = parser.parse(fixture.code, fixture.file);
    const typeNames = new Set(
      result.symbols.filter((s) => s.kind === 'class' || s.kind === 'type' || s.kind === 'interface').map((s) => s.name),
    );
    for (const symbol of result.symbols) {
      // A value named exactly like a declared type is the C++/Java name bug.
      if (symbol.kind === 'property' || symbol.kind === 'variable') {
        expect(typeNames.has(symbol.name), `${fixture.file}: ${symbol.name} is a type, not a value`).toBe(false);
      }
    }
  });

  it('links the expected calls and drops type/local noise', () => {
    const result = parser.parse(fixture.code, fixture.file);
    const edges = result.relationships
      .filter((r) => r.kind === 'calls')
      .map((r) => `${r.sourceName} -> ${r.targetName}`);
    for (const [source, target] of fixture.calls) {
      expect(edges, `${fixture.file}: expected call ${source} -> ${target} in [${edges.join(', ')}]`).toContain(`${source} -> ${target}`);
    }
    for (const [source, target] of fixture.noCalls) {
      expect(edges, `${fixture.file}: spurious call ${source} -> ${target}`).not.toContain(`${source} -> ${target}`);
    }
  });
});
