import { formatUsage } from "./format";

/** "312 MB of 500 MB" with a bar. */
export function UsageBar({ usedBytes, capBytes }: { usedBytes: number; capBytes: number }) {
  const percent = capBytes > 0 ? Math.min(100, (usedBytes / capBytes) * 100) : 0;
  const text = formatUsage(usedBytes, capBytes);
  return (
    <div className="usage">
      <div className="usage-text" data-testid="usage">
        {text}
      </div>
      <div
        className="usage-bar"
        role="progressbar"
        aria-label="Storage used"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(percent)}
        aria-valuetext={text}
      >
        <div className="usage-fill" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}
