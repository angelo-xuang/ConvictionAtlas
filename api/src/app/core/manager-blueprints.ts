import { OpportunityType } from '@prisma/client';

export type CTAParams = {
  adxThreshold: number;
  maxRiskPerPosition: number;
  onlyTokenTypes: boolean;
};

export type ManagerBlueprint = {
  slug: string;
  label: string;
  strategyType: 'linear' | 'cta';
  signalWeights?: Record<string, number>;
  bullishThreshold?: number;
  bearishThreshold?: number;
  opportunityTypeBias?: Partial<Record<OpportunityType, number>>;
  cashFloor: number;
  maxPositions: number;
  ctaParams?: CTAParams;
};

export const MANAGER_BLUEPRINTS: ManagerBlueprint[] = [
  {
    slug: 'narrative-manager',
    strategyType: 'linear',
    label: 'Narrative Manager',
    signalWeights: {
      narrative_strength: 0.18,
      news_heat: 0.10,
      market_momentum: 0.08,
      trend_regime: 0.28,
      opportunity_quality: 0.14,
      volume_spike: 0.06,
      event_proximity: 0.02,
      price_dislocation: 0.04,
      risk_flag: -0.24,
    },
    bullishThreshold: 0.10,
    bearishThreshold: -0.08,
    opportunityTypeBias: {
      TOKEN: 0.16,
      PREDICTION_MARKET: -0.18,
    },
    cashFloor: 0.25,
    maxPositions: 4,
  },
  {
    slug: 'event-driven-manager',
    strategyType: 'linear',
    label: 'Event-driven Manager',
    signalWeights: {
      catalyst_setup: 0.18,
      event_proximity: 0.12,
      probability_edge: 0.06,
      trend_regime: 0.22,
      news_heat: 0.08,
      narrative_strength: 0.06,
      opportunity_quality: 0.10,
      market_momentum: 0.06,
      volume_spike: 0.06,
      risk_flag: -0.22,
    },
    bullishThreshold: 0.08,
    bearishThreshold: -0.08,
    opportunityTypeBias: {
      TOKEN: 0.12,
      PREDICTION_MARKET: 0.04,
    },
    cashFloor: 0.20,
    maxPositions: 4,
  },
  {
    slug: 'onchain-fundamentals-manager',
    strategyType: 'linear',
    label: 'On-chain Fundamentals',
    signalWeights: {
      opportunity_quality: 0.16,
      volume_spike: 0.10,
      trend_regime: 0.28,
      price_dislocation: 0.08,
      probability_edge: 0.04,
      event_proximity: 0.04,
      narrative_strength: 0.04,
      risk_flag: -0.22,
    },
    bullishThreshold: 0.08,
    bearishThreshold: -0.08,
    opportunityTypeBias: {
      TOKEN: 0.16,
      PREDICTION_MARKET: -0.22,
    },
    cashFloor: 0.25,
    maxPositions: 4,
  },
  {
    slug: 'crypto-cta',
    label: 'Crypto CTA',
    strategyType: 'cta',
    cashFloor: 0.25,
    maxPositions: 6,
    ctaParams: {
      adxThreshold: 20,
      maxRiskPerPosition: 0.02,
      onlyTokenTypes: true,
    },
  },
  {
    slug: 'prediction-market-manager',
    strategyType: 'linear',
    label: 'Prediction Market Manager',
    signalWeights: {
      probability_edge: 0.24,
      event_proximity: 0.20,
      catalyst_setup: 0.14,
      trend_regime: 0.14,
      opportunity_quality: 0.10,
      volume_spike: 0.08,
      news_heat: 0.06,
      price_dislocation: 0.06,
      risk_flag: -0.20,
    },
    bullishThreshold: 0.08,
    bearishThreshold: -0.06,
    opportunityTypeBias: {
      TOKEN: -0.16,
      PREDICTION_MARKET: 0.20,
    },
    cashFloor: 0.20,
    maxPositions: 5,
  },
];

export function getManagerBlueprint(slug: string): ManagerBlueprint {
  return (
    MANAGER_BLUEPRINTS.find((blueprint) => blueprint.slug === slug) ??
    MANAGER_BLUEPRINTS[MANAGER_BLUEPRINTS.length - 1]
  );
}
