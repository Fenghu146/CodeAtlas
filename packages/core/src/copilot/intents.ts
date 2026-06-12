// ============================================================
// Intent Recognition Engine — Rule-based, zero LLM cost
// ============================================================
// Maps natural language questions to pre-defined analysis flows.
// Supports both English and Chinese patterns.

// ========================
// Intent Types
// ========================

export type IntentType =
  | 'safe_delete'        // "Can I safely delete X?"
  | 'understand'         // "What does X do?" / "Explain X"
  | 'impact'             // "What happens if I change X?"
  | 'relationship'       // "How are X and Y related?"
  | 'code_review'        // "Is there anything wrong with X?"
  | 'find_code'          // "Where is the code that handles X?"
  | 'architecture'       // "What's the architecture of X?"
  | 'call_chain'         // "Who calls X?" / "What does X call?"
  | 'refactor'           // "How should I refactor X?"
  | 'test_coverage'      // "Is X well tested?"
  | 'overview'           // "Give me an overview of the project"
  | 'compare'            // "Compare X and Y"
  | 'entry_point'        // "Where does X start?" / "How does the app boot?"
  | 'embedded_linux'     // "Analyze embedded Linux drivers / device tree / Kconfig"
  | 'free_form';         // Fallback — generic graph query

export interface Intent {
  type: IntentType;
  confidence: number;       // 0-1
  target?: string;          // Extracted target symbol name
  secondaryTarget?: string; // For relationship/compare: second symbol
  keywords: string[];       // Extracted keywords for search
  rawQuestion: string;
}

// ========================
// Pattern Definitions
// ========================

interface IntentPattern {
  type: IntentType;
  // English + Chinese patterns (regex fragments)
  patterns: RegExp[];
  // Priority: higher = wins ties (0-10)
  priority: number;
  // Whether this intent typically needs a target symbol
  needsTarget: boolean;
}

const INTENT_PATTERNS: IntentPattern[] = [
  // ---- safe_delete ----
  {
    type: 'safe_delete',
    priority: 8,
    needsTarget: true,
    patterns: [
      /(?:can|could|is it safe to)\s+(?:i\s+)?(?:safely\s+)?(?:delete|remove|drop)\b/i,
      /(?:delete|remove)\s+.{2,40}\s+safely/i,
      /(?:unused|dead\s*code|no\s*(?:one|body)\s*(?:uses|calls|references))/i,
      /能.{0,4}(?:删除|移除|去掉)/,
      /(?:删除|移除|去掉).{0,4}安全/,
      /没有.{0,4}(?:引用|调用|使用)/,
      /死代码/,
    ],
  },

  // ---- impact ----
  {
    type: 'impact',
    priority: 7,
    needsTarget: true,
    patterns: [
      /(?:what\s+(?:happens|changes|breaks|is\s+affected)|impact|risk|consequences?)\s+(?:if|of)\s+(?:i\s+)?(?:change|modify|update|refactor|delete|rename)/i,
      /(?:what\s+is\s+the\s+)?impact\s+(?:of|from)\s+/i,
      /(?:what\s+)?(?:happens|changes|breaks)\s+(?:if|when)\s+(?:i\s+)?(?:change|modify|update|refactor|delete|rename)/i,
      /(?:affected|breaking|downstream|upstream)\s+(?:files|modules|code|symbols)/i,
      /(?:修改|改动|变更|重构).{0,8}(?:影响|后果|风险|波及)/,
      /(?:修改|改动|变更).{0,4}.{2,20}.{0,4}(?:会|能|可以).{0,4}(?:影响|什么|怎样|如何)/,
      /影响.{0,6}(?:范围|分析|评估)/,
      /(?:动了|改了).{0,8}会.{0,4}(?:怎样|如何|影响)/,
    ],
  },

  // ---- understand / explain ----
  {
    type: 'understand',
    priority: 5,
    needsTarget: true,
    patterns: [
      /(?:what\s+does|explain|describe|tell\s+me\s+about|help\s+me\s+understand|how\s+does)\b/i,
      /(?:这个|这个).{0,4}(?:做|干|是).{0,2}(?:什么|啥)/,
      /(?:解释|说明|介绍|描述).{0,6}(?:一下)?/,
      /(?:做什么|干什么|是干嘛的|有什么用|什么意思)/,
      /how\s+(?:does|do)\s+.{2,30}\s+work/i,
    ],
  },

  // ---- relationship ----
  {
    type: 'relationship',
    priority: 7,
    needsTarget: true,
    patterns: [
      /(?:how\s+(?:are|is)|what'?s?\s+the\s+(?:relationship|relation|connection|link))\s+(?:between|from|to)\b/i,
      /(?:related|connected|depends?\s+on|dependenc)/i,
      /.{2,20}\s+(?:和|与|跟|同)\s+.{2,20}\s+(?:什么关系|有啥关系|的关系|怎么联系)/,
      /(?:依赖|关联|关系).{0,4}(?:之间)/,
    ],
  },

  // ---- code_review ----
  {
    type: 'code_review',
    priority: 6,
    needsTarget: true,
    patterns: [
      /(?:anything\s+wrong|problems?|issues?|bugs?|code\s*smells?|anti[- ]?patterns?)\s+(?:with|in)\b/i,
      /(?:review|check|audit|inspect)\s+(?:(?:the|this)\s+)?(?:code|module|file|class|function)/i,
      /(?:有问题|有bug|有错误|写得不好|不规范|有隐患)/,
      /(?:检查|审查|评审|review)\s*(?:一下)?\s*(?:这段|这个|这文件)/,
    ],
  },

  // ---- find_code ----
  {
    type: 'find_code',
    priority: 5,
    needsTarget: false,
    patterns: [
      /(?:where\s+is|find|locate|search\s+for|show\s+me)\s+(?:the\s+)?(?:code|function|class|module|file)\s+(?:that|for|handling|related)/i,
      /(?:handle|process|manage|implement)\s+.{2,30}\s+(?:logic|flow|feature)/i,
      /(?:在哪|哪里|哪个文件|哪个模块).{0,4}(?:处理|实现|负责)/,
      /(?:找|搜索|查找).{0,4}(?:代码|函数|类|文件)/,
      /(?:处理|实现|负责).{0,6}(?:什么|哪些)/,
    ],
  },

  // ---- architecture ----
  {
    type: 'architecture',
    priority: 6,
    needsTarget: false,
    patterns: [
      /(?:architecture|structure|design|pattern|layer|module\s+structure)/i,
      /(?:how\s+is\s+(?:this|the)\s+(?:project|app|codebase|code)\s+(?:organized|structured|designed|architected))/i,
      /(?:架构|结构|分层|模块|设计模式)/,
      /(?:怎么组织|如何组织|项目结构)/,
    ],
  },

  // ---- call_chain ----
  {
    type: 'call_chain',
    priority: 6,
    needsTarget: true,
    patterns: [
      /(?:who\s+calls|what\s+calls|callers?\s+of|called\s+by|invokes?)\b/i,
      /(?:what\s+does\s+.{2,30}\s+call|callees?\s+of|calls?\s+to)\b/i,
      /(?:call\s+(?:chain|graph|tree|hierarchy)|execution\s+(?:flow|path))/i,
      /(?:谁调用|调用.{0,2}谁|调用链|调用关系)/,
      /(?:被.{0,2}调用|上游|下游)/,
    ],
  },

  // ---- refactor ----
  {
    type: 'refactor',
    priority: 6,
    needsTarget: true,
    patterns: [
      /(?:how\s+(?:should|to|can)\s+(?:i\s+)?|best\s+way\s+to)\s*(?:refactor|improve|clean\s+up|restructure)\b/i,
      /(?:refactor|improvement|cleanup)\s+(?:suggestions?|ideas?|recommendations?)/i,
      /(?:tech\s*debt|technical\s+debt)/i,
      /(?:怎么重构|如何重构|重构建议|改进建议)/,
      /(?:技术债|代码债)/,
    ],
  },

  // ---- test_coverage ----
  {
    type: 'test_coverage',
    priority: 5,
    needsTarget: true,
    patterns: [
      /(?:test|tested|coverage|spec)\s*(?:ed|s|ing)?\s*(?:\?|well|enough|adequate)/i,
      /test\s+coverage\s+(?:of|for)/i,
      /(?:is|are)\s+.{2,30}\s+(?:well\s+)?tested/i,
      /(?:测试覆盖|有没有测试|测试够不够|测试情况)/,
    ],
  },

  // ---- overview ----
  {
    type: 'overview',
    priority: 4,
    needsTarget: false,
    patterns: [
      /(?:overview|summary|dashboard|stats?|statistics|about\s+the\s+project)/i,
      /(?:give\s+me|show\s+me)\s+(?:an?\s+)?(?:overview|summary|big\s+picture)/i,
      /(?:项目概览|项目概况|总体|整体|概况|统计)/,
      /(?:简单介绍|大概|大致)/,
    ],
  },

  // ---- compare ----
  {
    type: 'compare',
    priority: 7,
    needsTarget: true,
    patterns: [
      /(?:compare|diff|difference|vs\.?|versus)\s+(?:between)?\b/i,
      /(?:对比|比较|区别|不同|差异)/,
    ],
  },

  // ---- entry_point ----
  {
    type: 'entry_point',
    priority: 5,
    needsTarget: false,
    patterns: [
      /(?:entry\s*point|start|boot|bootstrap|main|initializ)/i,
      /(?:where\s+does\s+(?:it|the\s+app|the\s+program)\s+start)/i,
      /(?:入口|启动|开始|初始化)/,
    ],
  },

  // ---- embedded_linux ----
  {
    type: 'embedded_linux',
    priority: 7,
    needsTarget: false,
    patterns: [
      /(?:embedded\s+linux|linux\s+(?:kernel|driver|module|kconfig|kbuild|device\s*tree|dts|yocto|buildroot|sysfs|procfs|debugfs|ioctl))/i,
      /(?:kernel\s+module|platform\s+driver|i2c_driver|spi_driver|usb_driver)/i,
      /(?:module_init|MODULE_LICENSE|of_device_id)/i,
      /(?:device\s*tree|dts|compatible|devicetree)/i,
      /(?:嵌入式.?linux|内核驱动|设备树|内核模块|用户态接口)/,
      /(?:Kconfig|Kbuild|Yocto|Buildroot|systemd)/i,
      /(?:sysfs|procfs|debugfs)\s+interface/i,
    ],
  },
];

// ========================
// Symbol Name Extractor
// ========================

/** Common code-like tokens that are NOT symbol names */
const CODE_STOP_WORDS = new Set([
  'the', 'this', 'that', 'code', 'function', 'class', 'module', 'file',
  'method', 'variable', 'interface', 'type', 'enum', 'import', 'export',
  'does', 'doing', 'done', 'using', 'used', 'handle', 'handling', 'handled',
  'implement', 'implementing', 'implemented', 'process', 'processing',
  'manage', 'managing', 'managed', 'logic', 'flow', 'feature', 'system',
  'project', 'app', 'application', 'program', 'codebase', 'repo',
  'safely', 'safe', 'delete', 'remove', 'change', 'modify', 'update',
  'refactor', 'check', 'review', 'test', 'tested', 'coverage',
  'can', 'could', 'should', 'would', 'will', 'may', 'might', 'shall', 'must',
  'what', 'when', 'where', 'which', 'who', 'how', 'why', 'are', 'was', 'were',
  'has', 'had', 'have', 'been', 'being', 'about', 'between', 'from', 'into',
  'also', 'any', 'more', 'than', 'then', 'just', 'only', 'very', 'really',
  'well', 'much', 'many', 'some', 'each', 'every', 'both', 'other', 'another',
  'get', 'set', 'put', 'let', 'not', 'new', 'old', 'big', 'all',
  'here', 'there', 'these', 'those', 'anything', 'something', 'nothing', 'everything',
  'happens', 'happen', 'calls', 'called', 'calling', 'find', 'found', 'make', 'made',
  'show', 'shown', 'give', 'gave', 'tell', 'told', 'take', 'took',
  'need', 'needed', 'want', 'look', 'looks', 'seem', 'seems', 'seemed',
  'wrong', 'with', 'without', 'right', 'good', 'bad', 'best', 'worst',
  'compare', 'versus', 'diff', 'like', 'such', 'same', 'different',
  'is', 'if', 'and', 'or', 'define', 'defined', 'explain',
]);

/**
 * Extract probable symbol names from a question.
 * Looks for PascalCase, camelCase, and known identifier patterns.
 */
export function extractTargetSymbols(question: string): { primary?: string; secondary?: string; keywords: string[] } {
  const words = question.split(/[\s,;()\[\]{}'"]+/).filter(Boolean);
  const candidates: string[] = [];
  const keywords: string[] = [];

  for (const raw of words) {
    // Strip trailing punctuation: "UserService?" → "UserService"
    const word = raw.replace(/[^a-zA-Z0-9_.-]+$/, '').replace(/^[^a-zA-Z0-9]+/, '');
    if (!word) continue;
    // PascalCase or camelCase identifier (min 3 chars for PascalCase, 2 for camelCase)
    if (/^[A-Z][a-zA-Z0-9_]{2,}$/.test(word) || /^[a-z][a-zA-Z0-9]{1,}$/.test(word)) {
      const lower = word.toLowerCase();
      if (!CODE_STOP_WORDS.has(lower)) {
        candidates.push(word);
      }
    }
    // snake_case identifiers: user_service, get_user_data (min 5 chars)
    if (/^[a-z][a-z0-9]*(_[a-z0-9]+)+$/.test(word) && word.length >= 5) {
      if (!CODE_STOP_WORDS.has(word)) candidates.push(word);
    }
    // Quoted identifiers: "UserService" or `login`
    const quoted = word.match(/^["'`](.+)["'`]$/);
    if (quoted && quoted[1]) {
      candidates.push(quoted[1]);
    }
  }

  // Also look for path-like patterns: src/services/user
  const pathMatch = question.match(/(?:src|lib|packages|app)\/[\w/.-]+/);
  if (pathMatch) {
    candidates.unshift(pathMatch[0]);
  }

  // Deduplicate
  const unique = [...new Set(candidates)];

  // Remaining useful words as keywords
  for (const word of words) {
    const clean = word.replace(/[^\w]/g, '');
    if (clean.length > 2 && !candidates.includes(clean)) {
      keywords.push(clean);
    }
  }

  return {
    primary: unique[0],
    secondary: unique[1],
    keywords: keywords.slice(0, 10),
  };
}

// ========================
// Main Recognition Function
// ========================

/**
 * Recognize the user's intent from a natural language question.
 * Pure rule-based — no LLM, no token cost, instant response.
 */
export function recognizeIntent(question: string): Intent {
  const { primary, secondary, keywords } = extractTargetSymbols(question);

  let bestMatch: IntentPattern | null = null;
  let bestScore = 0;

  for (const pattern of INTENT_PATTERNS) {
    let matchCount = 0;
    for (const regex of pattern.patterns) {
      if (regex.test(question)) {
        matchCount++;
      }
    }

    if (matchCount > 0) {
      // Score = matches * priority (weighted)
      const score = matchCount * pattern.priority;
      if (score > bestScore) {
        bestScore = score;
        bestMatch = pattern;
      }
    }
  }

  if (bestMatch) {
    return {
      type: bestMatch.type,
      confidence: Math.min(bestScore / 16, 1),  // normalize
      target: primary,
      secondaryTarget: secondary,
      keywords,
      rawQuestion: question,
    };
  }

  // Fallback: free_form
  return {
    type: 'free_form',
    confidence: 0.3,
    target: primary,
    secondaryTarget: secondary,
    keywords,
    rawQuestion: question,
  };
}
