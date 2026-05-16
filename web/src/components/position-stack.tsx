import { AssetAvatar } from './asset-avatar';

type PositionStackProps = {
  positions: Array<{
    id: string;
    title: string;
    weight: number;
    imageUrl?: string | null;
    symbol?: string | null;
    sourceKind?: string | null;
  }>;
};

export function PositionStack({ positions }: PositionStackProps) {
  if (!positions.length) {
    return <div className="muted">暂无活跃持仓。</div>;
  }

  return (
    <div className="position-stack">
      <div className="position-stack-track">
        {positions.map((position, index) => (
          <div
            key={position.id}
            className={`position-stack-segment segment-${(index % 4) + 1}`}
            style={{ width: `${Math.max(position.weight * 100, 4)}%` }}
            title={`${position.title} ${position.weight.toFixed(2)}`}
          />
        ))}
      </div>
      <div className="position-stack-legend">
        {positions.map((position, index) => (
          <div key={position.id} className="position-stack-item">
            <span className={`position-stack-dot segment-${(index % 4) + 1}`} />
            <AssetAvatar
              title={position.title}
              imageUrl={position.imageUrl}
              symbol={position.symbol}
              sourceKind={position.sourceKind}
              size="sm"
            />
            <div>
              <div className="position-stack-name">{position.title}</div>
              <div className="muted">{(position.weight * 100).toFixed(1)}%</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
