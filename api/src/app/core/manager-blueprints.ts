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
      narrative_strength: 0.14,
      news_heat: 0.08,
      market_momentum: 0.08,
      trend_regime: 0.32,
      opportunity_quality: 0.12,
      volume_spike: 0.06,
      event_proximity: 0.02,
      price_dislocation: 0.04,
      risk_flag: -0.14,
    },
    bullishThreshold: 0.03,
    bearishThreshold: -0.06,
    opportunityTypeBias: {
      TOKEN: 0.18,
      PREDICTION_MARKET: -0.18,
    },
    cashFloor: 0.10,
    maxPositions: 6,
  },
  {
    slug: 'event-driven-manager',
    label: 'Event-driven Manager',
    signalWeights: {
      catalyst_setup: 0.16,
      event_proximity: 0.12,
      probability_edge: 0.06,
      trend_regime: 0.26,
      news_heat: 0.06,
      narrative_strength: 0.06,
      opportunity_quality: 0.10,
      market_momentum: 0.08,
      volume_spike: 0.06,
      risk_flag: -0.12,
    },
    bullishThreshold: 0.03,
    bearishThreshold: -0.06,
    opportunityTypeBias: {
      TOKEN: 0.12,
      PREDICTION_MARKET: 0.04,
    },
    cashFloor: 0.10,
    maxPositions: 6,
  },
  {
    slug: 'quant-manager',
    label: 'Quant Manager',
    signalWeights: {
      market_momentum: 0.14,
      trend_regime: 0.36,
      volume_spike: 0.08,
      price_dislocation: 0.06,
      opportunity_quality: 0.14,
      probability_edge: 0.04,
      event_proximity: 0.02,
      risk_flag: -0.16,
    },
    bullishThreshold: 0.03,
    bearishThreshold: -0.06,
    opportunityTypeBias: {
      TOKEN: 0.14,
      PREDICTION_MARKET: -0.20,
    },
    cashFloor: 0.12,
    maxPositions: 5,
  },
  {
    slug: 'hybrid-manager',
    label: 'Hybrid Manager',
    signalWeights: {
      market_momentum: 0.10,
      trend_regime: 0.30,
      narrative_strength: 0.08,
      news_heat: 0.06,
      opportunity_quality: 0.12,
      event_proximity: 0.04,
      volume_spike: 0.08,
      price_dislocation: 0.06,
      probability_edge: 0.04,
      risk_flag: -0.14,
    },
    bullishThreshold: 0.03,
    bearishThreshold: -0.06,
    opportunityTypeBias: {
      TOKEN: 0.14,
      PREDICTION_MARKET: -0.12,
    },
    cashFloor: 0.12,
    maxPositions: 6,
  },
  {
    slug: 'onchain-fundamentals-manager',
    label: 'On-chain Fundamentals',
    signalWeights: {
      opportunity_quality: 0.16,
      volume_spike: 0.12,
      trend_regime: 0.30,
      price_dislocation: 0.08,
      probability_edge: 0.04,
      event_proximity: 0.04,
      narrative_strength: 0.04,
      risk_flag: -0.14,
    },
    bullishThreshold: 0.03,
    bearishThreshold: -0.06,
    opportunityTypeBias: {
      TOKEN: 0.16,
      PREDICTION_MARKET: -0.22,
    },
    cashFloor: 0.15,
    maxPositions: 5,
  },
];

export function getManagerBlueprint(slug: string): ManagerBlueprint {
  return (
    MANAGER_BLUEPRINTS.find((blueprint) => blueprint.slug === slug) ??
    MANAGER_BLUEPRINTS[MANAGER_BLUEPRINTS.length - 1]
  );
}
