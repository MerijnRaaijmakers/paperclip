import { cn } from "../lib/utils";
import { statusBadge, statusBadgeDefault, statusShine } from "../lib/status-colors";

export function StatusBadge({ status }: { status: string }) {
  const shine = statusShine.has(status);
  return (
    <span
      className={cn(
        "relative inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap shrink-0",
        shine && "overflow-hidden",
        statusBadge[status] ?? statusBadgeDefault
      )}
    >
      {shine && (
        <span className="absolute inset-0 bg-[linear-gradient(120deg,transparent_30%,oklch(1_0_0_/_0.25)_50%,transparent_70%)] bg-[length:200%_100%] animate-[shine-sweep_4s_ease-in-out_infinite]" />
      )}
      <span className={shine ? "relative z-10" : undefined}>
        {status.replace("_", " ")}
      </span>
    </span>
  );
}
