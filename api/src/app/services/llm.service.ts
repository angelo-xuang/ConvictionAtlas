import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

type GenerateTextParams = {
  messages: ChatMessage[];
  temperature?: number;
};

/**
 * LlmService — DeepSeek (OpenAI-compatible, non-streaming axios call).
 */
@Injectable()
export class LlmService {
  constructor(private readonly configService: ConfigService) {}

  isConfigured() {
    return Boolean(this.resolveToken() && this.resolveBaseUrl());
  }

  getProviderName() {
    return 'deepseek';
  }

  getModel() {
    return (
      this.configService.get<string>('DEEPSEEK_MODEL') ??
      this.configService.get<string>('LLM_MODEL') ??
      'deepseek-v4-pro'
    );
  }

  async generateText({ messages, temperature = 0.2 }: GenerateTextParams): Promise<string | null> {
    if (!this.isConfigured()) {
      return null;
    }

    const token = this.resolveToken();
    const model = this.getModel();

    try {
      const response = await axios.post(
        `${this.resolveBaseUrl()}/chat/completions`,
        {
          model,
          messages,
          temperature,
          max_tokens: 8000,
          stream: false,
          thinking: { type: 'enabled' },
          reasoning_effort: 'high',
        },
        {
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Authorization: `Bearer ${token}`,
          },
          timeout: 120_000,
        },
      );

      return response.data?.choices?.[0]?.message?.content?.trim() ?? null;
    } catch (error: any) {
      console.error('LLM generation failed:', error?.response?.data ?? error?.message);
      return null;
    }
  }

  async generateMarkdown(params: GenerateTextParams): Promise<string | null> {
    const content = await this.generateText(params);
    return (
      content
        ?.replace(/^```(?:markdown|md)?\s*/i, '')
        .replace(/\s*```$/, '')
        .trim() ?? null
    );
  }

  private resolveToken() {
    return (
      this.configService.get<string>('DEEPSEEK_API_KEY') ??
      this.configService.get<string>('LLM_API_KEY') ??
      ''
    );
  }

  private resolveBaseUrl() {
    return (
      this.configService.get<string>('DEEPSEEK_BASE_URL') ??
      this.configService.get<string>('LLM_BASE_URL') ??
      'https://api.deepseek.com'
    );
  }
}
