# Conviction Atlas

> AI Fund Managers as Autonomous Economic Agents on TRON  
> 基于 TRON 的自主 AI 基金经理与可购买份额的 Agent 经济体

[![Live Demo](https://img.shields.io/badge/Live_Demo-47.76.120.0-blue?style=for-the-badge)](http://47.76.120.0/)
[![API Docs](https://img.shields.io/badge/API_Docs-Swagger-green?style=for-the-badge)](http://47.76.120.0/docs)
[![TRON Network](https://img.shields.io/badge/TRON-Nile_Testnet-red?style=for-the-badge)](https://nile.tronscan.org)

Quick links / 快速跳转:
- [中文](#中文版)
- [English](#english)
- [Live Demo](http://47.76.120.0/)
- [API Docs](http://47.76.120.0/docs)

---

## Architecture / 架构总览

```text
┌──────────────────────────────────────────────────────────────────────┐
│                        Conviction Atlas Architecture                 │
├──────────────────────────────────────────────────────────────────────┤
│  CoinGecko / Polymarket / News APIs                                 │
│                 ↓                                                    │
│        Opportunity Normalization Layer                              │
│                 ↓                                                    │
│         Signal Engine (10+ dimensions)                              │
│                 ↓                                                    │
│          6 AI Manager Decision Layer                                │
│                 ↓                                                    │
│      Portfolio Rebalance + NAV Snapshot                             │
│                 ↓                                                    │
│         LLM Memo Generation (DeepSeek)                              │
│                 ↓                                                    │
│        NestJS API + Next.js Frontend + TRON Payment                 │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 中文版

### 项目简介

**Conviction Atlas** 是一个由 **5 个自主运行的 AI 基金经理** 组成的 Web3 投资服务市场。  
每个经理都有独立的投资哲学、信号权重、仓位逻辑和业绩曲线，用户可以通过 **TRON Nile Testnet 的 USDT** 购买经理份额，查看调仓、信号、投研 Memo 和历史表现。

核心理念：

> 同一个 Web3 机会，不同的 AI 基金经理，应该给出不同的判断、不同的仓位和不同的解释。

这不是一个单一答案的推荐器，而是一个可比较、可付费、可追踪、可验证的 Agent 投资市场。

### 解决的问题

- **AI Agent 经济化**：AI 不只是生成内容，而是具备收费、业绩与服务交付能力的经济主体。
- **投资决策透明化**：每个判断都可以追溯到量化信号、conviction score、调仓结果与 Memo。
- **多视角分歧呈现**：同一标的由 6 位经理独立判断，用户可以比较而不是被单点答案绑死。
- **链上支付闭环**：用户可通过 TRON USDT 购买份额，完成 Agent 服务的价值交换。

### 核心能力

- 统一采集 CoinGecko、Polymarket 与新闻数据
- 生成 10+ 维度信号，包括 momentum、volume、narrative、catalyst、probability edge 等
- 5 个经理独立做出方向、仓位与理由判断
- 自动完成组合再平衡、NAV 快照与 LLM 投研备忘录
- 支持经理份额购买、评价、排行榜与可视化对比

### 技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| 后端 | NestJS + TypeScript | 模块化 API 服务 |
| 数据库 | SQLite + Prisma ORM | 轻量级文件数据库 |
| 前端 | Next.js 15 | 静态导出 + 服务器直连 API |
| 可视化 | React Three Fiber + Three.js | 首页视觉效果 |
| AI | DeepSeek Chat API | 投研 Memo 生成 |
| 支付 | TRON Nile Testnet | USDT TRC-20 份额购买 |
| 工程 | Nx Monorepo | API + Web 统一构建 |
| 部署 | Nginx + systemd | 生产部署与服务管理 |

### 六个 AI 基金经理

| 经理 (slug) | 风格 | 核心信号 / 策略 | 风险 | 最大持仓 |
|------|------|-------------|------|----------|
| Narrative Manager (`narrative-manager`) | 叙事驱动 | `narrative_strength`, `opportunity_quality` | Aggressive | 4 |
| Event-driven Manager (`event-driven-manager`) | 事件驱动 | `catalyst_setup`, `event_proximity` | Moderate | 6 |
| On-chain Fundamentals (`onchain-fundamentals-manager`) | 链上基本面 | `opportunity_quality`, `volume_spike` | Conservative | 5 |
| Crypto CTA (`crypto-cta`) | 量价 CTA | OHLCV + ADX 趋势跟踪 (`strategyType: 'cta'`) | Moderate | 6 |
| Prediction Market Manager (`prediction-market-manager`) | 预测市场 | `probability_edge`, `event_proximity` | Moderate | 8 |

决策公式：

```text
convictionScore = clamp(Σ(signalValue × weight) + opportunityTypeBias, -1, 1)

BULLISH  -> convictionScore > bullishThreshold
BEARISH  -> convictionScore < bearishThreshold
NEUTRAL  -> otherwise
```

### TRON 支付与 Agent 服务交付

购买流程：

```text
选择经理 -> 输入份额数量 -> 获取 TRON 钱包地址
-> 发送 USDT (Nile Testnet) -> 粘贴 txHash
-> 链上验证 -> 份额到账
```

关键点：

- 网络：TRON Nile Testnet
- 代币：USDT TRC-20
- 验证：TronGrid Nile API 实时校验
- API：
  - `GET /api/managers/:slug/shares/payment-info`
  - `POST /api/managers/:slug/shares/purchase`

购买后可获得：

- 完整投研备忘录
- 实时持仓与调仓记录
- 信号明细与风险指标
- 经理曲线、评分与排行对比

### 自动化 Pipeline

```bash
npm run pipeline
```

| 步骤 | 端点 | 说明 |
|------|------|------|
| 1 | `POST /api/internal/ingest/coingecko` | 采集代币行情 |
| 2 | `POST /api/internal/ingest/polymarket` | 采集预测市场 |
| 3 | `POST /api/internal/normalize/opportunities` | 标准化机会数据 |
| 4 | `POST /api/internal/ingest/news` | 采集新闻与情绪 |
| 5 | `POST /api/internal/signals/recompute` | 重算信号 |
| 6 | `POST /api/internal/managers/run` | 5 个经理独立决策 |
| 7 | `POST /api/internal/portfolio/rebalance` | 组合再平衡 |
| 8 | `POST /api/internal/performance/snapshot` | 记录 NAV |
| 9 | `POST /api/internal/memos/generate` | 生成 AI Memo |

### 在线访问

- 产品主页：<http://47.76.120.0/>
- API 文档：<http://47.76.120.0/docs>
- API 基础路径：`http://47.76.120.0/api`

### 本地开发

```bash
git clone https://github.com/YourUsername/ConvictionAtlas.git
cd ConvictionAtlas

npm install
npm run setup

cp .env.example .env
# 编辑 .env，填入需要的 API Key

npm run dev
npm run pipeline
```

### API 概览

公开接口：

```text
GET  /api/managers
GET  /api/managers/:slug
GET  /api/managers/:slug/performance
GET  /api/managers/:slug/portfolio
GET  /api/managers/:slug/rebalances
GET  /api/managers/:slug/memos
GET  /api/managers/:slug/reviews
POST /api/managers/:slug/reviews
GET  /api/managers/:slug/shares/payment-info
POST /api/managers/:slug/shares/purchase

GET  /api/opportunities
GET  /api/opportunities/:slug
GET  /api/opportunities/:slug/signals
GET  /api/opportunities/:slug/news
GET  /api/opportunities/:slug/managers

GET  /api/leaderboard/managers
GET  /api/leaderboard/opportunities
```

### 当前 Demo 快照

数据库 NAV 序列由 `POST /api/internal/backfill/history` 一次性回填，
之后每天 03:07 UTC 由 `scripts/run-pipeline-cron.sh` 增量追加一行。
最新业绩请直接查 `/api/leaderboard/managers` 或前端排行榜页。

### 项目结构

```text
ConvictionAtlas/
├── api/                    NestJS 后端
├── web/                    Next.js 前端
├── prisma/                 Prisma schema + SQLite 数据库
├── scripts/                pipeline、部署与启动脚本
├── deploy/                 nginx / systemd 配置
└── README.md
```

### 部署说明

```text
Browser
  ↓
Nginx (443/80)
  ├── /        -> Next.js 静态产物
  ├── /api/    -> NestJS (3001)
  └── /docs    -> Swagger UI
```

- 前端由 Nginx 直接提供
- API 由 systemd 管理并通过 Nginx 反向代理
- SQLite 为文件数据库，部署与迁移成本低

### 未来规划

- 接入更多数据源（DeFiLlama、Dune、社交情绪）
- 支持 TRON 主网支付
- 引入链上 Agent 身份与信誉体系
- 支持微支付解锁单篇 Memo
- 增加用户自定义 Agent 参数
- 接入实盘执行层与多链扩展

---

## English

### Overview

**Conviction Atlas** is a Web3 investment marketplace powered by **five autonomous AI fund managers**.  
Each manager operates with an independent investment philosophy, signal mix, position logic, and performance curve. Users can buy manager shares with **TRON Nile Testnet USDT**, inspect rebalances, signals, memos, and compare long-term results.

Core thesis:

> The same Web3 opportunity should produce different judgments, sizing, and explanations from different AI fund managers.

This is not a single-answer recommendation engine. It is a market of comparable, monetizable, traceable, and auditable AI investment agents.

### Problems It Solves

- **Economic AI agents**: AI is treated as a service provider with pricing, performance, and delivery.
- **Transparent decision-making**: Each output is backed by signals, conviction scores, rebalances, and research memos.
- **Structured disagreement**: Five managers can disagree on the same asset, giving users comparative judgment instead of a single narrative.
- **On-chain payment loop**: Users pay with TRON USDT and receive access to an AI-managed service product.

### Core Capabilities

- Unified ingestion from CoinGecko, Polymarket, and news providers
- 10+ dimensional signal engine covering momentum, volume, narrative, catalysts, and probability edge
- Independent decisions from five managers with different styles and thresholds
- Portfolio rebalance, NAV snapshots, and LLM-generated memos
- Share purchase, ratings, leaderboards, and side-by-side manager comparison

### Tech Stack

| Layer | Technology | Notes |
|------|------|------|
| Backend | NestJS + TypeScript | Modular API service |
| Database | SQLite + Prisma ORM | Lightweight file-based storage |
| Frontend | Next.js 15 | Static export with server-hosted deployment |
| Visualization | React Three Fiber + Three.js | Landing page visuals |
| AI | DeepSeek Chat API | Memo generation |
| Payment | TRON Nile Testnet | USDT TRC-20 share purchase |
| Tooling | Nx Monorepo | Unified API + Web build flow |
| Deployment | Nginx + systemd | Production serving and process management |

### The Five AI Managers

| Manager (slug) | Style | Primary Bias / Strategy | Risk | Max Positions |
|------|------|------|------|------|
| Narrative Manager (`narrative-manager`) | Narrative-driven | `narrative_strength`, `opportunity_quality` | Aggressive | 4 |
| Event-driven Manager (`event-driven-manager`) | Catalyst-driven | `catalyst_setup`, `event_proximity` | Moderate | 6 |
| On-chain Fundamentals (`onchain-fundamentals-manager`) | On-chain quality | `opportunity_quality`, `volume_spike` | Conservative | 5 |
| Crypto CTA (`crypto-cta`) | Price-volume CTA | OHLCV + ADX trend following (`strategyType: 'cta'`) | Moderate | 6 |
| Prediction Market Manager (`prediction-market-manager`) | Prediction markets | `probability_edge`, `event_proximity` | Moderate | 8 |

Decision rule:

```text
convictionScore = clamp(Σ(signalValue × weight) + opportunityTypeBias, -1, 1)

BULLISH  -> convictionScore > bullishThreshold
BEARISH  -> convictionScore < bearishThreshold
NEUTRAL  -> otherwise
```

### TRON Payment and Agent Delivery

Purchase flow:

```text
Choose manager -> Enter share amount -> Get TRON wallet address
-> Send USDT on Nile -> Paste txHash
-> Verify on-chain -> Shares credited
```

Key points:

- Network: TRON Nile Testnet
- Asset: USDT TRC-20
- Verification: real-time TronGrid Nile validation
- Endpoints:
  - `GET /api/managers/:slug/shares/payment-info`
  - `POST /api/managers/:slug/shares/purchase`

Share holders gain access to:

- Full research memos
- Live portfolio and rebalance visibility
- Signal details and risk context
- Performance curves, rankings, and comparisons

### Automated Pipeline

```bash
npm run pipeline
```

| Step | Endpoint | Purpose |
|------|------|------|
| 1 | `POST /api/internal/ingest/coingecko` | Token market ingestion |
| 2 | `POST /api/internal/ingest/polymarket` | Prediction market ingestion |
| 3 | `POST /api/internal/normalize/opportunities` | Opportunity normalization |
| 4 | `POST /api/internal/ingest/news` | News and sentiment ingestion |
| 5 | `POST /api/internal/signals/recompute` | Signal recomputation |
| 6 | `POST /api/internal/managers/run` | Independent manager decisions |
| 7 | `POST /api/internal/portfolio/rebalance` | Portfolio rebalance |
| 8 | `POST /api/internal/performance/snapshot` | NAV snapshot |
| 9 | `POST /api/internal/memos/generate` | AI memo generation |

### Live Access

- App: <http://47.76.120.0/>
- Docs: <http://47.76.120.0/docs>
- API Base: `http://47.76.120.0/api`

### Local Development

```bash
git clone https://github.com/YourUsername/ConvictionAtlas.git
cd ConvictionAtlas

npm install
npm run setup

cp .env.example .env
# edit .env and add any required API keys

npm run dev
npm run pipeline
```

### API Overview

Public endpoints:

```text
GET  /api/managers
GET  /api/managers/:slug
GET  /api/managers/:slug/performance
GET  /api/managers/:slug/portfolio
GET  /api/managers/:slug/rebalances
GET  /api/managers/:slug/memos
GET  /api/managers/:slug/reviews
POST /api/managers/:slug/reviews
GET  /api/managers/:slug/shares/payment-info
POST /api/managers/:slug/shares/purchase

GET  /api/opportunities
GET  /api/opportunities/:slug
GET  /api/opportunities/:slug/signals
GET  /api/opportunities/:slug/news
GET  /api/opportunities/:slug/managers

GET  /api/leaderboard/managers
GET  /api/leaderboard/opportunities
```

### Current Demo Snapshot

NAV series is generated by a one-time call to
`POST /api/internal/backfill/history` and then extended once a day at
03:07 UTC by `scripts/run-pipeline-cron.sh`. Pull the live leaderboard
from `/api/leaderboard/managers` or the frontend leaderboard page for
up-to-date numbers.

### Project Structure

```text
ConvictionAtlas/
├── api/                    NestJS backend
├── web/                    Next.js frontend
├── prisma/                 Prisma schema + SQLite database
├── scripts/                pipeline, startup, and deploy scripts
├── deploy/                 nginx / systemd configs
└── README.md
```

### Deployment Model

```text
Browser
  ↓
Nginx (443/80)
  ├── /        -> Next.js static export
  ├── /api/    -> NestJS (3001)
  └── /docs    -> Swagger UI
```

- The frontend is served directly by Nginx
- The backend is managed by systemd and proxied by Nginx
- SQLite keeps deployment simple and self-contained

### Roadmap

- More data sources such as DeFiLlama, Dune, and social sentiment
- TRON mainnet payment support
- On-chain identity and reputation for agents
- Micropayment-based memo unlocks
- User-configurable manager parameters
- Execution layer for live trading
- Multi-chain expansion

---

## License

MIT

---

<div align="center">
  <strong>Conviction Atlas</strong> — Where AI agents become autonomous economic participants.
  <br/>
  Built for TRON × Bank of AI Hackathon 2026
</div>
