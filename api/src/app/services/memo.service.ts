import { Injectable } from '@nestjs/common';
import { truncate } from '../core/helpers';
import { PrismaService } from '../prisma/prisma.service';
import { LlmService } from './llm.service';

@Injectable()
export class MemoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly llmService: LlmService,
  ) {}

  async generateMemos(managerSlug?: string) {
    const managers = await this.prisma.manager.findMany({
      where: managerSlug ? { slug: managerSlug } : undefined,
    });
    const created: Array<{ manager: string; memoId: string }> = [];
    const skipped: Array<{ manager: string; reason: string }> = [];

    for (const manager of managers) {
      const portfolio = await this.prisma.portfolioSnapshot.findFirst({
        where: { managerId: manager.id },
        orderBy: { computedAt: 'desc' },
        include: {
          positions: {
            orderBy: { weight: 'desc' },
            take: 4,
            include: {
              opportunity: {
                include: {
                  signals: true,
                  newsItems: {
                    orderBy: { publishedAt: 'desc' },
                    take: 3,
                  },
                },
              },
            },
          },
        },
      });

      if (!portfolio || !portfolio.positions.length) {
        continue;
      }

      const leadPosition = portfolio.positions[0];
      const content = await this.generateMemoContent(manager, portfolio);
      if (!content) {
        skipped.push({
          manager: manager.slug,
          reason: this.llmService.isConfigured()
            ? 'DeepSeek generation failed.'
            : 'DeepSeek is not configured.',
        });
        continue;
      }

      await this.prisma.memo.deleteMany({
        where: { managerId: manager.id },
      });

      const memo = await this.prisma.memo.create({
        data: {
          managerId: manager.id,
          opportunityId: leadPosition.opportunityId,
          title: `${manager.style}经理：${leadPosition.opportunity.title}`,
          summary: truncate(
            content
              .replace(/[#>*`_-]/g, ' ')
              .replace(/\s+/g, ' ')
              .trim(),
            220,
          ),
          content,
          generatedBy: this.llmService.getProviderName(),
        },
      });

      created.push({ manager: manager.slug, memoId: memo.id });
    }

    return { created: created.length, memos: created, skipped };
  }

  private async generateMemoContent(manager: any, portfolio: any) {
    const topLines = portfolio.positions.map((position: any) => {
      const topSignals = position.opportunity.signals
        .filter((signal: any) => signal.name !== 'risk_flag')
        .sort((left: any, right: any) => Math.abs(right.value) - Math.abs(left.value))
        .slice(0, 3)
        .map((signal: any) => `${signal.name}:${signal.value}`)
        .join(', ');
      const headlines = position.opportunity.newsItems
        .map((item: any) => item.title)
        .join(' | ');

      return `- ${position.opportunity.title} (${Math.round(
        position.weight * 100,
      )}%): signals [${topSignals}] | headlines [${headlines || 'none'}]`;
    });

    const prompt = [
      '你正在为 Conviction Atlas 撰写投资备忘录。',
      `经理风格: ${manager.style}。`,
      `风险偏好: ${manager.riskProfile}。`,
      '仅输出 markdown，不要用代码块包裹。',
      '严格按以下结构输出：',
      '## 核心观点',
      '一段简洁的核心观点阐述。',
      '### 组合调仓逻辑',
      '用项目符号列表逐一分析当前前几大持仓及其逻辑。',
      '### 风险提示',
      '用项目符号列出当前主要风险。',
      '所有内容必须基于提供的组合数据，不要编造信息。',
      '',
      ...topLines,
    ].join('\n');

    const content = await this.llmService.generateMarkdown({
      temperature: 0.2,
      messages: [
        {
          role: 'system',
          content:
            '你是一位专业投资研究分析师，用清晰、深入的中文撰写 markdown 格式的投资备忘录。语言风格：专业但不晦涩，像给基金经理的内部分析报告。',
        },
        { role: 'user', content: prompt },
      ],
    });

    if (content) {
      return content;
    }

    return null;
  }
}
