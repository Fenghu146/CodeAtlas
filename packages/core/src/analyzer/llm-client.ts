// ============================================================
// LLM Client - Unified interface for AI providers
// ============================================================
// Supports Claude (Anthropic), OpenAI, and local models (Ollama)

import type { LLMConfig } from './module-explainer.js';

/**
 * LLM Client Interface
 * Supports both single-prompt and system+user separation.
 */
export interface LLMClient {
  complete(prompt: string): Promise<string>;
  /** System/user separation enables prompt caching in Claude and OpenAI */
  completeWithSystem?(systemPrompt: string, userPrompt: string): Promise<string>;
}

/**
 * Claude (Anthropic) Client
 */
class ClaudeClient implements LLMClient {
  private apiKey: string;
  private model: string;
  private baseUrl: string;

  constructor(config: LLMConfig) {
    this.apiKey = config.apiKey || process.env.ANTHROPIC_API_KEY || '';
    this.model = config.model || 'claude-sonnet-4-20250514';
    this.baseUrl = config.baseUrl || 'https://api.anthropic.com';

    if (!this.apiKey) {
      throw new Error('Claude API key required. Set ANTHROPIC_API_KEY or provide apiKey in config.');
    }
  }

  async complete(prompt: string): Promise<string> {
    return this.doComplete(undefined, prompt);
  }

  async completeWithSystem(systemPrompt: string, userPrompt: string): Promise<string> {
    return this.doComplete(systemPrompt, userPrompt);
  }

  private async doComplete(systemPrompt: string | undefined, userPrompt: string): Promise<string> {
    const messages: Array<{ role: string; content: string }> = [];
    if (systemPrompt) {
      // Claude uses a separate "system" field, not a message
    }
    messages.push({ role: 'user', content: userPrompt });

    const body: any = {
      model: this.model,
      max_tokens: 4096,
      messages,
    };
    if (systemPrompt) {
      body.system = systemPrompt;
    }

    const response = await fetch(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Claude API error: ${response.status} - ${error}`);
    }

    const data = await response.json() as any;
    return data.content[0].text;
  }
}

/**
 * OpenAI Client
 */
class OpenAIClient implements LLMClient {
  private apiKey: string;
  private model: string;
  private baseUrl: string;

  constructor(config: LLMConfig) {
    this.apiKey = config.apiKey || process.env.OPENAI_API_KEY || '';
    this.model = config.model || 'gpt-4';
    this.baseUrl = config.baseUrl || 'https://api.openai.com';

    if (!this.apiKey) {
      throw new Error('OpenAI API key required. Set OPENAI_API_KEY or provide apiKey in config.');
    }
  }

  async complete(prompt: string): Promise<string> {
    return this.doComplete(undefined, prompt);
  }

  async completeWithSystem(systemPrompt: string, userPrompt: string): Promise<string> {
    return this.doComplete(systemPrompt, userPrompt);
  }

  private async doComplete(systemPrompt: string | undefined, userPrompt: string): Promise<string> {
    const messages: Array<{ role: string; content: string }> = [];
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }
    messages.push({ role: 'user', content: userPrompt });

    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        max_tokens: 4096,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error: ${response.status} - ${error}`);
    }

    const data = await response.json() as any;
    return data.choices[0].message.content;
  }
}

/**
 * Local Model Client (Ollama)
 */
class OllamaClient implements LLMClient {
  private model: string;
  private baseUrl: string;

  constructor(config: LLMConfig) {
    this.model = config.model || 'llama2';
    this.baseUrl = config.baseUrl || 'http://localhost:11434';
  }

  async complete(prompt: string): Promise<string> {
    return this.doComplete(undefined, prompt);
  }

  async completeWithSystem(systemPrompt: string, userPrompt: string): Promise<string> {
    return this.doComplete(systemPrompt, userPrompt);
  }

  private async doComplete(systemPrompt: string | undefined, userPrompt: string): Promise<string> {
    const body: any = {
      model: this.model,
      prompt: userPrompt,
      stream: false,
    };
    if (systemPrompt) {
      body.system = systemPrompt;
    }

    const response = await fetch(`${this.baseUrl}/api/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Ollama API error: ${response.status} - ${error}`);
    }

    const data = await response.json() as any;
    return data.response;
  }
}

/**
 * Create LLM client based on config
 */
export function createLLMClient(config: LLMConfig): LLMClient | null {
  if (!config || !config.provider) {
    return null;
  }

  switch (config.provider) {
    case 'claude':
      return new ClaudeClient(config);
    case 'openai':
      return new OpenAIClient(config);
    case 'local':
      return new OllamaClient(config);
    default:
      console.warn(`Unknown LLM provider: ${config.provider}`);
      return null;
  }
}

/**
 * Cached LLM Client with rate limiting
 */
export class CachedLLMClient implements LLMClient {
  private client: LLMClient;
  private cache = new Map<string, { result: string; timestamp: number }>();
  private cacheTTL = 1000 * 60 * 60; // 1 hour
  private lastRequestTime = 0;
  private minRequestInterval = 1000; // 1 second between requests

  constructor(client: LLMClient) {
    this.client = client;
  }

  async complete(prompt: string): Promise<string> {
    return this.doComplete(undefined, prompt);
  }

  async completeWithSystem(systemPrompt: string, userPrompt: string): Promise<string> {
    return this.doComplete(systemPrompt, userPrompt);
  }

  private async doComplete(systemPrompt: string | undefined, userPrompt: string): Promise<string> {
    // Build cache key from system+user prompts
    const cacheKey = systemPrompt ? `${systemPrompt}|||${userPrompt}` : userPrompt;

    // Check cache
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
      return cached.result;
    }

    // Rate limiting
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    if (timeSinceLastRequest < this.minRequestInterval) {
      await new Promise(resolve => setTimeout(resolve, this.minRequestInterval - timeSinceLastRequest));
    }

    // Call LLM (prefer system/user separation if available)
    this.lastRequestTime = Date.now();
    let result: string;
    if (systemPrompt && this.client.completeWithSystem) {
      result = await this.client.completeWithSystem(systemPrompt, userPrompt);
    } else {
      result = await this.client.complete(systemPrompt ? `${systemPrompt}\n\n${userPrompt}` : userPrompt);
    }

    // Cache result
    this.cache.set(cacheKey, { result, timestamp: Date.now() });

    return result;
  }

  clearCache(): void {
    this.cache.clear();
  }
}
