// ============================================================
// Team Export/Import - Share graph data and annotations
// ============================================================

import fs from 'fs';
import path from 'path';
import { SQLiteStore } from '../store/sqlite-store.js';

export interface TeamData {
  version: string;
  exportedAt: string;
  project: string;
  annotations: AnnotationData[];
  metadata: Record<string, any>;
}

export interface AnnotationData {
  id: string;
  symbolId: string;
  userId: string;
  content: string;
  type: string;
  resolved: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ExportOptions {
  /** Include annotations (default: true) */
  includeAnnotations?: boolean;
  /** Include metadata (default: true) */
  includeMetadata?: boolean;
  /** Custom metadata to include */
  metadata?: Record<string, any>;
}

/**
 * Export team data (annotations, metadata) for sharing
 */
export function exportTeamData(
  store: SQLiteStore,
  projectPath: string,
  options: ExportOptions = {},
): TeamData {
  const { includeAnnotations = true, includeMetadata = true, metadata = {} } = options;

  const data: TeamData = {
    version: '1.0.0',
    exportedAt: new Date().toISOString(),
    project: path.basename(projectPath),
    annotations: [],
    metadata: {
      ...metadata,
      symbolCount: store.getStats().symbols,
      relationshipCount: store.getStats().relationships,
    },
  };

  // Export annotations
  if (includeAnnotations) {
    // Get all symbols and their annotations
    const symbols = store.searchSymbols('', { limit: 100000 });
    for (const symbol of symbols) {
      const annotations = store.getAnnotations(symbol.id);
      for (const ann of annotations) {
        data.annotations.push({
          id: ann.id,
          symbolId: ann.symbol_id,
          userId: ann.user_id,
          content: ann.content,
          type: ann.type,
          resolved: !!ann.resolved,
          createdAt: ann.created_at,
          updatedAt: ann.updated_at,
        });
      }
    }
  }

  return data;
}

/**
 * Save team data to file
 */
export function saveTeamData(data: TeamData, outputPath: string): void {
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(outputPath, JSON.stringify(data, null, 2), 'utf-8');
  console.log(`✅ Team data exported to ${outputPath}`);
  console.log(`   - ${data.annotations.length} annotations`);
}

/**
 * Load team data from file
 */
export function loadTeamData(inputPath: string): TeamData {
  if (!fs.existsSync(inputPath)) {
    throw new Error(`File not found: ${inputPath}`);
  }

  const content = fs.readFileSync(inputPath, 'utf-8');
  const data = JSON.parse(content) as TeamData;

  // Validate version
  if (!data.version) {
    throw new Error('Invalid team data file: missing version');
  }

  return data;
}

/**
 * Import team data into store
 */
export function importTeamData(
  store: SQLiteStore,
  data: TeamData,
  options: { merge?: boolean } = {},
): { imported: number; skipped: number } {
  const { merge = true } = options;
  let imported = 0;
  let skipped = 0;

  // Import annotations
  for (const ann of data.annotations) {
    // Check if annotation already exists
    const existing = store.getAnnotations(ann.symbolId);
    const exists = existing.some((e: any) => e.id === ann.id);

    if (exists && !merge) {
      skipped++;
      continue;
    }

    // Skip if symbol doesn't exist
    const symbol = store.getSymbol(ann.symbolId);
    if (!symbol) {
      console.warn(`⚠️  Symbol "${ann.symbolId}" not found, skipping annotation`);
      skipped++;
      continue;
    }

    // Import annotation (with original ID if merging)
    if (exists && merge) {
      store.updateAnnotation(ann.id, ann.content);
    } else {
      store.addAnnotation(ann.symbolId, ann.userId, ann.content, ann.type);
    }

    imported++;
  }

  return { imported, skipped };
}

/**
 * Create a human-readable summary of team data
 */
export function summarizeTeamData(data: TeamData): string {
  const lines: string[] = [
    `Team Data Summary`,
    `═══════════════════════════════════════`,
    `Version: ${data.version}`,
    `Project: ${data.project}`,
    `Exported: ${data.exportedAt}`,
    ``,
    `Statistics:`,
    `  - Annotations: ${data.annotations.length}`,
  ];

  // Group by user
  const byUser = new Map<string, number>();
  for (const ann of data.annotations) {
    byUser.set(ann.userId, (byUser.get(ann.userId) || 0) + 1);
  }

  if (byUser.size > 0) {
    lines.push(`  - Contributors: ${byUser.size}`);
    lines.push(``);
    lines.push(`By User:`);
    for (const [user, count] of byUser) {
      lines.push(`  - ${user}: ${count} annotations`);
    }
  }

  // Group by type
  const byType = new Map<string, number>();
  for (const ann of data.annotations) {
    byType.set(ann.type, (byType.get(ann.type) || 0) + 1);
  }

  if (byType.size > 0) {
    lines.push(``);
    lines.push(`By Type:`);
    for (const [type, count] of byType) {
      lines.push(`  - ${type}: ${count}`);
    }
  }

  // Unresolved count
  const unresolved = data.annotations.filter(a => !a.resolved).length;
  if (unresolved > 0) {
    lines.push(``);
    lines.push(`⚠️  ${unresolved} unresolved annotations`);
  }

  return lines.join('\n');
}
