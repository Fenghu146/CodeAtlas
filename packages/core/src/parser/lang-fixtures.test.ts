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
  /** symbol names that must NOT be extracted (locals, reassignments) */
  absent?: Array<{ name: string }>;
  /** parent -> child containment pairs that must be present */
  contains?: Array<[string, string]>;
  /** formatted `kind name@parent` strings that must NOT be extracted */
  noSymbols?: string[];
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

export const LIMIT = 10;
`,
    symbols: [
      { kind: 'class', name: 'UserService' },
      { kind: 'property', name: 'prefix', parent: 'UserService' },
      { kind: 'method', name: 'constructor', parent: 'UserService' },
      { kind: 'method', name: 'create', parent: 'UserService' },
      { kind: 'function', name: 'helper' },
      { kind: 'variable', name: 'LIMIT' },
    ],
    calls: [['create', 'trim']],
    noCalls: [['create', 'string'], ['create', 'name']],
    contains: [['UserService', 'constructor'], ['UserService', 'create'], ['UserService', 'prefix']],
  },
  {
    language: 'python',
    file: 'models/user.py',
    code: `
class User:
    role = 'member'

    def __init__(self, name: str):
        self.name = name

    def rename(self, new_name: str) -> None:
        self.name = new_name
        scratch = new_name

def format_name(raw: str) -> str:
    return raw.strip()

class UserService:
    def create(self, name):
        return User(format_name(name))

class Circle:
    def __init__(self, r: float) -> None:
        self.r = r

    @property
    def radius(self) -> float:
        return self.r

    @radius.setter
    def radius(self, value: float) -> None:
        self.r = value
`,
    symbols: [
      { kind: 'class', name: 'User' },
      { kind: 'property', name: 'role', parent: 'User' },
      { kind: 'method', name: '__init__', parent: 'User' },
      // `self.name = ...` assigns the instance attribute — that IS the property.
      { kind: 'property', name: 'name', parent: 'User' },
      { kind: 'method', name: 'rename', parent: 'User' },
      { kind: 'function', name: 'format_name' },
      { kind: 'class', name: 'UserService' },
      { kind: 'method', name: 'create', parent: 'UserService' },
      { kind: 'class', name: 'Circle' },
      { kind: 'property', name: 'r', parent: 'Circle' },
      // @property accessors are the class's property, not methods.
      { kind: 'property', name: 'radius', parent: 'Circle' },
    ],
    calls: [['format_name', 'strip'], ['create', 'format_name']],
    // `name`/`new_name` are local values, `str`/`None` are types.
    noCalls: [['create', 'name'], ['rename', 'str'], ['__init__', 'str']],
    // `scratch` is a function-local binding — never a symbol.
    absent: [{ name: 'scratch' }],
    noSymbols: ['method radius@Circle'],
    contains: [['User', 'name'], ['Circle', 'r'], ['Circle', 'radius']],
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
    contains: [['UserService', 'prefix'], ['UserService', 'create'], ['UserService', 'count']],
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

pub struct Wrapper<T> {
    value: T,
}

impl<T> Wrapper<T> {
    pub fn get(&self) -> &T {
        &self.value
    }
}

pub trait Draw {
    fn draw(&self);
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
      // Generic args never leak into names: `Wrapper<T>` is `Wrapper`.
      { kind: 'class', name: 'Wrapper' },
      { kind: 'property', name: 'value', parent: 'Wrapper' },
      { kind: 'method', name: 'get', parent: 'Wrapper' },
      // Traits are interfaces in the shared vocabulary.
      { kind: 'interface', name: 'Draw' },
      { kind: 'method', name: 'draw', parent: 'Draw' },
    ],
    calls: [['create', 'trim']],
    noCalls: [['create', 'String'], ['helper', 'i32']],
    contains: [['UserService', 'new'], ['UserService', 'create'], ['Wrapper', 'get'], ['Draw', 'draw']],
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
      { kind: 'namespace', name: 'svc' },
      // Namespace children report their namespace as parent.
      { kind: 'class', name: 'UserService', parent: 'svc' },
      { kind: 'property', name: 'prefix_', parent: 'UserService' },
      { kind: 'method', name: 'create', parent: 'UserService' },
    ],
    calls: [],
    noCalls: [['UserService', 'class'], ['create', 'std']],
    contains: [['svc', 'UserService'], ['UserService', 'prefix_'], ['UserService', 'create']],
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
    for (const a of fixture.absent ?? []) {
      const names = result.symbols.map((s) => s.name);
      expect(names, `${fixture.file}: '${a.name}' must not become a symbol`).not.toContain(a.name);
    }
    for (const nope of fixture.noSymbols ?? []) {
      expect(actual, `${fixture.file}: ${nope} must not be extracted`).not.toContain(nope);
    }
  });

  it('links members to their containing scope', () => {
    const result = parser.parse(fixture.code, fixture.file);
    const edges = result.relationships
      .filter((r) => r.kind === 'contains')
      .map((r) => `${r.sourceName} -> ${r.targetName}`);
    for (const [parent, child] of fixture.contains ?? []) {
      expect(edges, `${fixture.file}: expected contains ${parent} -> ${child} in [${edges.join(', ')}]`).toContain(`${parent} -> ${child}`);
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

describe('import relationships target imported symbols', () => {
  const parse = async (code: string, file: string) => {
    await parser.loadLanguage(file.endsWith('.py') ? 'python' : 'typescript');
    return parser.parse(code, file);
  };
  const importEdges = (result: { relationships: { kind: string; sourceName: string; targetName: string }[] }) =>
    result.relationships.filter((r) => r.kind === 'imports').map((r) => `${r.sourceName}->${r.targetName}`);

  it('links each TS named/default/namespace import to its symbol name', async () => {
    const result = await parse(
      `import { UserService, other } from '../services/user-service.js';
import Default from './def.js';
import * as ns from './ns.js';
import './side-effect.js';

export class UserController {
  list() { return 1; }
}`,
      '/tmp/imp/src/api/users.ts',
    );
    const edges = importEdges(result);
    expect(edges).toContain('UserController->UserService');
    expect(edges).toContain('UserController->other');
    expect(edges).toContain('UserController->Default');
    expect(edges).toContain('UserController->ns');
    // Side-effect import keeps the module path (no symbol to name).
    expect(edges).toContain('UserController->./side-effect.js');
  });

  it('resolves TS aliases to the original symbol name', async () => {
    const result = await parse(
      `import { UserService as Svc } from './svc.js';

export class C {}`,
      '/tmp/imp/src/c.ts',
    );
    expect(importEdges(result)).toContain('C->UserService');
    expect(importEdges(result)).not.toContain('C->Svc');
  });

  it('links Python from-imports to each imported symbol name', async () => {
    const result = await parse(
      'from os.path import join, exists\nfrom .mod import Cls as Klass\n\n\ndef foo():\n    pass\n',
      '/tmp/imp/mod.py',
    );
    const edges = importEdges(result);
    expect(edges).toContain('foo->join');
    expect(edges).toContain('foo->exists');
    expect(edges).toContain('foo->Cls');
  });

  it('keeps Python module imports targeting the module name', async () => {
    const result = await parse('import sys\n\n\ndef foo():\n    pass\n', '/tmp/imp/m2.py');
    expect(importEdges(result)).toContain('foo->sys');
  });
});
