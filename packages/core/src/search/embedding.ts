// ============================================================
// Embedding Generator - Creates vector embeddings for search
// ============================================================
// Supports multiple backends:
// 1. Local hash-based (no dependencies, fast)
// 2. OpenAI embedding API
// 3. Ollama embedding API

/**
 * Embedding generator interface
 */
export interface EmbeddingGenerator {
  /** Generate embedding for a single text */
  embed(text: string): Promise<number[]>;
  /** Generate embeddings for multiple texts */
  embedBatch(texts: string[]): Promise<number[][]>;
  /** Get embedding dimension */
  getDimension(): number;
}

/**
 * Simple hash-based embedding (no external dependencies).
 * Uses feature hashing to create a fixed-size vector from text.
 * Good for basic similarity search without LLM dependency.
 */
export class HashEmbeddingGenerator implements EmbeddingGenerator {
  private dimension: number;

  constructor(dimension: number = 256) {
    this.dimension = dimension;
  }

  async embed(text: string): Promise<number[]> {
    return this.hashEmbed(text);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return texts.map(t => this.hashEmbed(t));
  }

  getDimension(): number {
    return this.dimension;
  }

  /**
   * Create embedding using feature hashing (SimHash-like).
   * Maps text features to a fixed-size vector.
   */
  private hashEmbed(text: string): number[] {
    const vector = new Array(this.dimension).fill(0);
    const normalized = text.toLowerCase().replace(/[^\w\s]/g, ' ');

    // Extract n-grams (unigrams and bigrams)
    const words = normalized.split(/\s+/).filter(w => w.length > 1);
    const ngrams: string[] = [...words];

    // Add bigrams
    for (let i = 0; i < words.length - 1; i++) {
      ngrams.push(`${words[i]}_${words[i + 1]}`);
    }

    // Hash each ngram to vector position
    for (const ngram of ngrams) {
      const hash = this.fnv1a(ngram);
      const pos = hash % this.dimension;
      vector[pos] += 1;

      // Use second hash for distribution
      const hash2 = this.fnv1a(ngram + '_2');
      const pos2 = hash2 % this.dimension;
      vector[pos2] += 0.5;
    }

    // Normalize
    const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
    if (norm > 0) {
      for (let i = 0; i < vector.length; i++) {
        vector[i] /= norm;
      }
    }

    return vector;
  }

  /** FNV-1a hash function */
  private fnv1a(str: string): number {
    let hash = 2166136261;
    for (let i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      hash = (hash * 16777619) >>> 0;
    }
    return hash;
  }
}

/**
 * OpenAI embedding API client.
 */
export class OpenAIEmbeddingGenerator implements EmbeddingGenerator {
  private apiKey: string;
  private model: string;
  private baseUrl: string;
  private dimension: number;

  constructor(config: { apiKey: string; model?: string; baseUrl?: string }) {
    this.apiKey = config.apiKey;
    this.model = config.model || 'text-embedding-3-small';
    this.baseUrl = config.baseUrl || 'https://api.openai.com';
    this.dimension = this.model.includes('small') ? 1536 : 3072;
  }

  async embed(text: string): Promise<number[]> {
    const response = await fetch(`${this.baseUrl}/v1/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        input: text,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI embedding error: ${response.status}`);
    }

    const data = await response.json() as any;
    return data.data[0].embedding;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const response = await fetch(`${this.baseUrl}/v1/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        input: texts,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI embedding error: ${response.status}`);
    }

    const data = await response.json() as any;
    return data.data.map((d: any) => d.embedding);
  }

  getDimension(): number {
    return this.dimension;
  }
}

/**
 * Ollama embedding API client.
 */
export class OllamaEmbeddingGenerator implements EmbeddingGenerator {
  private model: string;
  private baseUrl: string;
  private dimension: number;

  constructor(config: { model?: string; baseUrl?: string }) {
    this.model = config.model || 'nomic-embed-text';
    this.baseUrl = config.baseUrl || 'http://localhost:11434';
    this.dimension = 768; // Default for nomic-embed-text
  }

  async embed(text: string): Promise<number[]> {
    const response = await fetch(`${this.baseUrl}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        prompt: text,
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama embedding error: ${response.status}`);
    }

    const data = await response.json() as any;
    return data.embedding;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    // Ollama doesn't have batch embedding, so we call sequentially
    const results: number[][] = [];
    for (const text of texts) {
      results.push(await this.embed(text));
    }
    return results;
  }

  getDimension(): number {
    return this.dimension;
  }
}

/**
 * Create embedding generator based on config.
 */
export function createEmbeddingGenerator(config?: {
  provider?: 'local' | 'openai' | 'ollama';
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  dimension?: number;
}): EmbeddingGenerator {
  const provider = config?.provider || 'local';

  switch (provider) {
    case 'openai':
      if (!config?.apiKey) {
        throw new Error('OpenAI API key required for embedding');
      }
      return new OpenAIEmbeddingGenerator({
        apiKey: config.apiKey,
        model: config.model,
        baseUrl: config.baseUrl,
      });

    case 'ollama':
      return new OllamaEmbeddingGenerator({
        model: config?.model,
        baseUrl: config?.baseUrl,
      });

    case 'local':
    default:
      return new HashEmbeddingGenerator(config?.dimension || 256);
  }
}
