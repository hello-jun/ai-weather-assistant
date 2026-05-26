interface TipsCardProps {
  tips: string[];
}

const TIP_ICONS = ["💡", "🌂", "🧴", "💧", "🧢", "👕", "🧣", "🏠", "🚗", "⚡"];

export function TipsCard({ tips }: TipsCardProps) {
  return (
    <div className="mx-4 mt-2 mb-1 rounded-lg border border-amber-200 bg-amber-50 p-3">
      <div className="flex items-center gap-1.5 mb-2">
        <span className="text-sm">💡</span>
        <span className="text-xs font-semibold text-amber-700">出行建议</span>
      </div>
      <ul className="space-y-1">
        {tips.map((tip, i) => (
          <li key={i} className="flex items-start gap-2 text-xs text-amber-900">
            <span className="shrink-0 mt-px">{TIP_ICONS[i % TIP_ICONS.length]}</span>
            <span>{tip}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
