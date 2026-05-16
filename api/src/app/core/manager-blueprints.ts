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
    // Narrative Manager: story-driven, hunts breakout themes in TOKEN markets.
    // Should strongly prefer tokens over prediction markets — narratives
    // are about sentiment and attention around real crypto assets.
    slug: 'narrative-manager',
    label: 'Narrative Manager',
    signalWeights: {
      narrative_strength: 0.26,
      news_heat: 0.18,
      market_momentum: 0.14,
      trend_regime: 0.16,
      opportunity_quality: 0.18,
      volume_spike: 0.08,
      event_proximity: 0.04,         // Reduced: narratives aren't event-driven
      price_dislocation: 0.06,
      risk_flag: -0.16,
    },
    bullishThreshold: 0.14,           // Raised: be more selective
    bearishThreshold: -0.12,
    opportunityTypeBias: {
      TOKEN: 0.10,                    // Strong token preference — narratives live here
      PREDICTION_MARKET: -0.18,       // Heavily penalise prediction markets
    },
    cashFloor: 0.18,
    maxPositions: 5,
  },
  {
    // Event-driven Manager: tracks catalyst calendars across BOTH markets.
    // Slight lean toward prediction markets but also trades token catalysts.
    slug: 'event-driven-manager',
    label: 'Event-driven Manager',
    signalWeights: {
      catalyst_setup: 0.26,
      event_proximity: 0.18,
      probability_edge: 0.12,
      trend_regime: 0.1,
      news_heat: 0.08,
      narrative_strength: 0.08,
      opportunity_quality: 0.08,
      market_momentum: 0.05,
      volume_spike: 0.07,
      risk_flag: -0.18,
    },
    bullishThreshold: 0.10,           // Raised from 0.035 — too many low-quality passes
    bearishThreshold: -0.12,
    opportunityTypeBias: {
      TOKEN: 0.04,
      PREDICTION_MARKET: 0.04,        // Reduced from 0.06 — was letting too many through
    },
    cashFloor: 0.15,
    maxPositions: 6,
  },
  {
    // Quant Manager: pure price-action and momentum signals on tokens.
    // Should NOT hold prediction markets — they have no price-momentum profile.
    slug: 'quant-manager',
    label: 'Quant Manager',
    signalWeights: {
      market_momentum: 0.26,
      trend_regime: 0.22,
      volume_spike: 0.16,
      price_dislocation: 0.14,
      opportunity_quality: 0.16,
      probability_edge: 0.04,         // Reduced: quant doesn't care about probabilities
      event_proximity: 0.02,          // Minimal: quant is price-driven not event-driven
      risk_flag: -0.18,
    },
    bullishThreshold: 0.14,           // Raised: be more selective
    bearishThreshold: -0.12,
    opportunityTypeBias: {
      TOKEN: 0.12,                    // Strong token preference — quant = price action
      PREDICTION_MARKET: -0.22,       // Very strong bias away — no momentum signal
    },
    cashFloor: 0.2,
    maxPositions: 6,
  },
  {
    // Hybrid Manager: balanced across all dimensions, but leans toward tokens.
    // May take a small prediction market position if the signal is very strong.
    slug: 'hybrid-manager',
    label: 'Hybrid Manager',
    signalWeights: {
      market_momentum: 0.14,
      trend_regime: 0.12,
      narrative_strength: 0.14,
      news_heat: 0.12,
      opportunity_quality: 0.16,
      event_proximity: 0.08,          // Reduced from 0.1
      volume_spike: 0.12,
      price_dislocation: 0.10,
      probability_edge: 0.06,         // Reduced from 0.08
      risk_flag: -0.14,
    },
    bullishThreshold: 0.12,           // Raised from 0.10
    bearishThreshold: -0.12,
    opportunityTypeBias: {
      TOKEN: 0.06,                    // Moderate token preference
      PREDICTION_MARKET: -0.12,       // Moderate prediction market penalty
    },
    cashFloor: 0.15,
    maxPositions: 6,
  },
  {
    // On-chain Fundamentals: ignores price action and news entirely.
    // Signal comes from DeFiLlama TVL flows, whale wallet accumulation,
    // smart money netflow (Nansen/Mobula), and protocol fee revenue.
    // High cash floor — only acts on strong on-chain conviction.
    // Should NEVER hold prediction markets — they have no on-chain signal.
    slug: 'onchain-fundamentals-manager',
    label: 'On-chain Fundamentals',
    signalWeights: {
      opportunity_quality: 0.28,    // Protocol TVL + revenue quality
      volume_spike: 0.22,           // On-chain volume is truth
      trend_regime: 0.16,           // Chain-level TVL trend direction
      price_dislocation: 0.18,      // Price lagging on-chain fundamentals = edge
      probability_edge: 0.04,       // Minimal: prediction market confirmation
      event_proximity: 0.06,        // Protocol upgrades/launches
      narrative_strength: 0.04,     // Very low weight — we distrust narrative
      risk_flag: -0.24,             // Hard exit on TVL drain or smart money exit
    },
    bullishThreshold: 0.16,         // Raised: only very strong on-chain signal
    bearishThreshold: -0.10,
    opportunityTypeBias: {
      TOKEN: 0.12,                  // Strong token bias — on-chain = real assets
      PREDICTION_MARKET: -0.25,     // Very strong penalty — prediction markets have no TVL
    },
    cashFloor: 0.30,                // Conservative — on-chain conviction takes time
    maxPositions: 5,                // Concentrated: only highest-conviction protocols
  },
];

export function getManagerBlueprint(slug: string): ManagerBlueprint {
  return (
    MANAGER_BLUEPRINTS.find((blueprint) => blueprint.slug === slug) ??
    MANAGER_BLUEPRINTS[MANAGER_BLUEPRINTS.length - 1]
  );
}
