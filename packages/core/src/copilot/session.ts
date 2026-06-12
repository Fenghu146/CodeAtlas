// ============================================================
// Session Memory — Cross-turn context for Graph Copilot
// ============================================================
// Remembers previous analyses so follow-up questions can build
// on prior context without re-analyzing from scratch.

import type { Symbol } from '../graph/types.js';
import type { IntentType } from './intents.js';

// ========================
// Types
// ========================

export interface TurnRecord {
  /** Turn number (1-based) */
  turn: number;
  /** The original question */
  question: string;
  /** Recognized intent */
  intent: IntentType;
  /** Target symbol (if any) */
  target?: string;
  /** Symbols discovered/analyzed */
  symbols: Array<{ name: string; kind: string; file: string; id: string }>;
  /** Key conclusions from this turn */
  conclusions: string[];
  /** Timestamp */
  timestamp: number;
}

export interface SessionContext {
  /** All previous turns */
  turns: TurnRecord[];
  /** Frequently referenced symbols across turns */
  hotSymbols: Map<string, { name: string; file: string; references: number }>;
  /** Running topic — the main subject of conversation */
  topic?: string;
}

// ========================
// Session Manager
// ========================

export class SessionManager {
  private sessions: Map<string, SessionContext> = new Map();
  private maxTurns: number;

  constructor(options?: { maxTurns?: number }) {
    this.maxTurns = options?.maxTurns ?? 20;
  }

  /**
   * Get or create a session.
   * @param sessionId - Unique session identifier (default: "default")
   */
  getSession(sessionId: string = 'default'): SessionContext {
    let session = this.sessions.get(sessionId);
    if (!session) {
      session = { turns: [], hotSymbols: new Map() };
      this.sessions.set(sessionId, session);
    }
    return session;
  }

  /**
   * Record a completed turn.
   */
  recordTurn(
    sessionId: string,
    turn: Omit<TurnRecord, 'turn' | 'timestamp'>,
  ): void {
    const session = this.getSession(sessionId);

    const record: TurnRecord = {
      ...turn,
      turn: session.turns.length + 1,
      timestamp: Date.now(),
    };

    session.turns.push(record);

    // Trim old turns
    if (session.turns.length > this.maxTurns) {
      session.turns = session.turns.slice(-this.maxTurns);
    }

    // Update hot symbols
    for (const sym of turn.symbols) {
      const existing = session.hotSymbols.get(sym.id);
      if (existing) {
        existing.references++;
      } else {
        session.hotSymbols.set(sym.id, { name: sym.name, file: sym.file, references: 1 });
      }
    }

    // Update topic: most recent target
    if (turn.target) {
      session.topic = turn.target;
    }
  }

  /**
   * Get context from previous turns for building follow-up answers.
   * Returns a compact summary suitable for inclusion in prompts.
   */
  getContextSummary(sessionId: string = 'default', maxTurns: number = 3): string {
    const session = this.getSession(sessionId);
    if (session.turns.length === 0) return '';

    const recent = session.turns.slice(-maxTurns);
    const parts: string[] = [];

    parts.push(`[Session context: ${session.turns.length} turns, topic: ${session.topic ?? 'none'}]`);

    for (const turn of recent) {
      const symList = turn.symbols.slice(0, 3).map(s => s.name).join(', ');
      parts.push(`  T${turn.turn}: "${turn.question.slice(0, 60)}" → [${turn.intent}] ${symList}`);
      if (turn.conclusions.length > 0) {
        parts.push(`    → ${turn.conclusions[0]}`);
      }
    }

    // Hot symbols
    const hot = [...session.hotSymbols.entries()]
      .sort((a, b) => b[1].references - a[1].references)
      .slice(0, 5);
    if (hot.length > 0) {
      parts.push(`  Hot symbols: ${hot.map(([, s]) => `${s.name}(${s.references}x)`).join(', ')}`);
    }

    return parts.join('\n');
  }

  /**
   * Resolve implicit references in a question using session context.
   * E.g., "is it safe?" → resolves "it" to the last analyzed target.
   */
  resolveReferences(sessionId: string, question: string): string {
    const session = this.getSession(sessionId);
    if (session.turns.length === 0) return question;

    const lastTurn = session.turns[session.turns.length - 1];
    let resolved = question;

    // Replace pronouns with last target
    if (lastTurn.target) {
      resolved = resolved.replace(/\b(it|this|that|them|these|它|这个|那个)\b/gi, lastTurn.target);
    }

    // If question has no target but session has a topic, prepend it
    const hasExplicitTarget = /\b[A-Z][a-zA-Z]{2,}/.test(resolved) ||
      /["'`]/.test(resolved);
    if (!hasExplicitTarget && session.topic) {
      resolved = `${session.topic}: ${resolved}`;
    }

    return resolved;
  }

  /**
   * Get previously discovered symbols relevant to a target.
   */
  getRelevantHistory(sessionId: string, target: string): TurnRecord[] {
    const session = this.getSession(sessionId);
    return session.turns.filter(t =>
      t.target?.toLowerCase() === target.toLowerCase() ||
      t.symbols.some(s => s.name.toLowerCase() === target.toLowerCase()),
    );
  }

  /**
   * Reset a session.
   */
  reset(sessionId: string = 'default'): void {
    this.sessions.delete(sessionId);
  }

  /**
   * Get stats about active sessions.
   */
  getStats(): { activeSessions: number; totalTurns: number } {
    let totalTurns = 0;
    for (const session of this.sessions.values()) {
      totalTurns += session.turns.length;
    }
    return { activeSessions: this.sessions.size, totalTurns };
  }
}
