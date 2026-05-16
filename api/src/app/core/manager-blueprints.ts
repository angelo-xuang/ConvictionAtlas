import { OpportunityType } from '@prisma/client';

export type ManagerBlueprint = {
  slug: string;
  label: string;
  signalWeights: Record<string, number>;
  bullishThreshold: number;
  bearishThreshold: number;
  opportunityTypeBias?: Partial<Record<OpportunityType, number>>;
  cashFloor: number;
  maxPositions: number;
};

export const MANAGER_BLUEPRINTS: ManagerBlueprint[] = [
  {
    slug: 'narrative-manager',
    label: 'Narrative Manager',
    signalWeights: {
      narrative_strength: 0.22,
      news_heat: 0.16,
      market_momentum: 0.10,
      trend_regime: 0.18,
      opportunity_quality: 0.20,
      volume_spike: 0.06,
      event_proximity: 0.03,
      price_dislocation: 0.05,
      risk_flag: -0.28,
    },
    bullishThreshold: 0.22,
    bearishThreshold: -0.12,
    opportunityTypeBias: {
      TOKEN: 0.10,
      PREDICTION_MARKET: -0.18,
    },
    cashFloor: 0.35,
    maxPositions: 4,
  },
  {
    slug: 'event-driven-manager',
    label: 'Event-driven Manager',
    signalWeights: {
      catalyst_setup: 0.22,
      event_proximity: 0.16,
      probability_edge: 0.10,
      trend_regime: 0.12,
      news_heat: 0.08,
      narrative_strength: 0.06,
      opportunity_quality: 0.12,
      market_momentum: 0.04,
      volume_spike: 0.06,
      risk_flag: -0.26,
    },
    bullishThreshold: 0.16,
    bearishThreshold: -0.12,
    opportunityTypeBias: {
      TOKEN: 0.04,
      PREDICTION_MARKET: 0.04,
    },
    cashFloor: 0.30,
    maxPositions: 4,
  },
  {
    slug: 'quant-manager',
    label: 'Quant Manager',
    signalWeights: {
      market_momentum: 0.22,
      trend_regime: 0.24,
      volume_spike: 0.12,
      price_dislocation: 0.10,
      opportunity_quality: 0.18,
      probability_edge: 0.03,
      event_proximity: 0.01,
      risk_flag: -0.30,
    },
    bullishThreshold: 0.20,
    bearishThreshold: -0.12,
    opportunityTypeBias: {
      TOKEN: 0.12,
      PREDICTION_MARKET: -0.22,
    },
    cashFloor: 0.35,
    maxPositions: 4,
  },
  {
    slug: 'hybrid-manager',
    label: 'Hybrid Manager',
    signalWeights: {
      market_momentum: 0.12,
      trend_regime: 0.16,
      narrative_strength: 0.10,
      news_heat: 0.10,
      opportunity_quality: 0.18,
      event_proximity: 0.06,
      volume_spike: 0.08,
      price_dislocation: 0.08,
      probability_edge: 0.04,
      risk_flag: -0.26,
    },
    bullishThreshold: 0.18,
    bearishThreshold: -0.12,
    opportunityTypeBias: {
      TOKEN: 0.06,
      PREDICTION_MARKET: -0.12,
    },
    cashFloor: 0.35,
    maxPositions: 4,
  },
  {
    slug: 'onchain-fundamentals-manager',
    label: 'On-chain Fundamentals',
    signalWeights: {
      opportunity_quality: 0.26,
      volume_spike: 0.18,
      trend_regime: 0.18,
      price_dislocation: 0.14,
      probability_edge: 0.03,
      event_proximity: 0.04,
      narrative_strength: 0.02,
      risk_flag: -0.32,
    },
    bullishThreshold: 0.22,
    bearishThreshold: -0.10,
    opportunityTypeBias: {
      TOKEN: 0.12,
      PREDICTION_MARKET: -0.25,
    },
    cashFloor: 0.40,
    maxPositions: 3,
  },
];

export function getManagerBlueprint(slug: string): ManagerBlueprint {
  return (
    MANAGER_BLUEPRINTS.find((blueprint) => blueprint.slug === slug) ??
    MANAGER_BLUEPRINTS[MANAGER_BLUEPRINTS.length - 1]
  );
}
