import { binCode } from "@/domain/rack-builder";
import { cn } from "@/lib/utils";

/** Drawing width the face aims for; the cell width comes from the bay count and is clamped so codes stay readable. */
const FACE_W = 460;
const MAX_W = 720;
const MIN_CELL_W = 52;
const MAX_CELL_W = 110;
const CELL_H = 34;
const LABEL_W = 30;
const HEADER_H = 16;
const POST = 4;
const BASE_H = 5;

/**
 * Front elevation of one rack: bays left to right, level 1 on the floor. Pick faces are tinted with the
 * info tone; bulk (and unassigned) cells sit on the muted surface. Each cell shows its bin code.
 */
export function RackPreview({
  aisle,
  rack,
  bays,
  levels,
  pickFaces,
  className,
}: {
  aisle: string;
  rack: string;
  bays: number;
  levels: number;
  /** Level 1 is the pick face and the levels above it are bulk. Only means something with 2+ levels. */
  pickFaces: boolean;
  className?: string;
}) {
  const bayCount = Math.max(1, Math.floor(bays));
  const levelCount = Math.max(1, Math.floor(levels));
  const roles = pickFaces && levelCount > 1;
  const cellW = Math.min(MAX_CELL_W, Math.max(MIN_CELL_W, Math.floor((FACE_W - LABEL_W - POST) / bayCount)));
  const width = Math.min(MAX_W, LABEL_W + bayCount * cellW + POST * 2);
  const height = HEADER_H + levelCount * CELL_H + BASE_H;
  const fontSize = cellW >= 72 ? 10 : 9;
  const rackCode = binCode(aisle, rack, 1, 1).split("-").slice(0, 2).join("-");
  const bayLabels = Array.from({ length: bayCount }, (_, index) => index + 1);
  const levelRows = Array.from({ length: levelCount }, (_, index) => levelCount - index);

  return (
    <div className={cn("space-y-2", className)}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="mx-auto block h-auto w-full"
        style={{ maxWidth: width * 1.1 }}
        role="img"
        aria-label={`Rack ${rackCode} front view, ${bayCount} ${bayCount === 1 ? "bay" : "bays"} by ${levelCount} ${levelCount === 1 ? "level" : "levels"}${roles ? ", level 1 pick faces, upper levels bulk" : ""}`}
      >
        {bayLabels.map((bay, index) => (
          <text
            key={`bay-${bay}`}
            x={LABEL_W + POST + index * cellW + cellW / 2}
            y={HEADER_H - 5}
            textAnchor="middle"
            fontSize="9"
            fontFamily="ui-monospace, monospace"
            fill="var(--muted-foreground)"
          >
            Bay {String(bay).padStart(2, "0")}
          </text>
        ))}
        {levelRows.map((level, row) => {
          const y = HEADER_H + row * CELL_H;
          const pick = roles && level === 1;
          const bulk = roles && level > 1;
          return (
            <g key={`level-${level}`}>
              <text
                x={LABEL_W - 4}
                y={y + CELL_H / 2 + 3}
                textAnchor="end"
                fontSize="9"
                fontFamily="ui-monospace, monospace"
                fill="var(--muted-foreground)"
              >
                L{level}
              </text>
              {bayLabels.map((bay, index) => {
                const x = LABEL_W + POST + index * cellW;
                const code = binCode(aisle, rack, bay, level);
                return (
                  <g key={code}>
                    <rect
                      x={x + 1}
                      y={y + 1}
                      width={cellW - 2}
                      height={CELL_H - 2}
                      rx="2"
                      fill={pick ? "var(--tone-info-bg)" : "var(--muted)"}
                      stroke={pick ? "var(--tone-info)" : "var(--border)"}
                      strokeWidth={pick ? 1 : 0.75}
                    />
                    <text
                      x={x + cellW / 2}
                      y={y + CELL_H / 2 + (bulk || pick ? -1 : 3)}
                      textAnchor="middle"
                      fontSize={fontSize}
                      fontFamily="ui-monospace, monospace"
                      fill={pick ? "var(--tone-info)" : "var(--foreground)"}
                      fontWeight={pick ? 600 : 400}
                    >
                      {code}
                    </text>
                    {pick || bulk ? (
                      <text
                        x={x + cellW / 2}
                        y={y + CELL_H / 2 + 9}
                        textAnchor="middle"
                        fontSize="7.5"
                        fill={pick ? "var(--tone-info)" : "var(--muted-foreground)"}
                      >
                        {pick ? "pick face" : "bulk"}
                      </text>
                    ) : null}
                  </g>
                );
              })}
            </g>
          );
        })}
        {/* Uprights and the floor. */}
        <rect x={LABEL_W} y={HEADER_H} width={POST} height={levelCount * CELL_H} fill="var(--border)" />
        <rect x={LABEL_W + POST + bayCount * cellW} y={HEADER_H} width={POST} height={levelCount * CELL_H} fill="var(--border)" />
        <rect x={LABEL_W - 6} y={HEADER_H + levelCount * CELL_H} width={bayCount * cellW + POST * 2 + 12} height={BASE_H} rx="1" fill="var(--border)" />
      </svg>
      {roles ? (
        <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label="Legend">
          <li className="flex items-center gap-1.5">
            <span aria-hidden className="size-3 rounded-sm border border-tone-info bg-tone-info-bg" />
            Pick face (level 1)
          </li>
          <li className="flex items-center gap-1.5">
            <span aria-hidden className="size-3 rounded-sm border bg-muted" />
            Bulk (levels above)
          </li>
        </ul>
      ) : null}
    </div>
  );
}
