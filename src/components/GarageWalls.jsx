import { Hammer, Ruler, Wrench } from "lucide-react";
import ToteCard from "./ToteCard";

// Renders one garage wall from the data model in utils/constants.js.
// Fixture kinds: "rack" (wooden tote rack), "workbench" (pegboard + bench,
// totes below), "wallShelf" (side-wall shelf levels).

const WOOD = "bg-gradient-to-b from-amber-600 via-amber-700 to-amber-800";
const WOOD_SIDE = "bg-gradient-to-r from-amber-700 via-amber-600 to-amber-700";

function SlotGrid({ row, totesByPosition, onSlotClick, highlightPosition }) {
  return (
    <div
      className="grid gap-0.5 sm:gap-1 px-0.5 py-1 sm:py-1.5"
      style={{ gridTemplateColumns: `repeat(${row.length}, minmax(0, 1fr))` }}
    >
      {row.map((pos, idx) =>
        pos ? (
          <ToteCard
            key={pos}
            position={pos}
            tote={totesByPosition[pos]}
            onClick={() => onSlotClick(pos)}
            highlighted={highlightPosition === pos}
          />
        ) : (
          <div key={`gap-${idx}`} />
        )
      )}
    </div>
  );
}

function Plank() {
  return (
    <div className={`h-1.5 sm:h-2.5 ${WOOD} relative`}>
      <div className="absolute inset-x-0 top-0 h-px bg-amber-400/30" />
      <div className="absolute inset-x-0 bottom-0 h-px bg-amber-950/50" />
    </div>
  );
}

function RackSection({ fixture, ...slotProps }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col" style={{ flexGrow: fixture.rows[0].length }}>
      <div className={`h-1.5 sm:h-2.5 rounded-t ${WOOD} shadow`} />
      <div className="flex flex-1">
        <div className={`w-1.5 sm:w-2.5 shrink-0 ${WOOD_SIDE} shadow-inner`} />
        <div className="flex min-w-0 flex-1 flex-col justify-end">
          {fixture.rows.map((row, i) => (
            <div key={i}>
              <SlotGrid row={row} {...slotProps} />
              <Plank />
            </div>
          ))}
        </div>
        <div className={`w-1.5 sm:w-2.5 shrink-0 ${WOOD_SIDE} shadow-inner`} />
      </div>
    </div>
  );
}

function WorkbenchSection({ fixture, ...slotProps }) {
  return (
    <div
      className="flex min-w-0 flex-1 flex-col"
      style={{ flexGrow: fixture.rows[0].length }}
    >
      {/* Pegboard with tools */}
      <div
        className="relative flex-1 rounded-t border border-amber-200 bg-amber-50 min-h-[72px] dark:border-amber-900/60 dark:bg-amber-950/30"
        style={{
          backgroundImage:
            "radial-gradient(circle, rgba(180,130,70,0.25) 1px, transparent 1.2px)",
          backgroundSize: "10px 10px",
        }}
        aria-hidden="true"
      >
        <div className="absolute inset-0 flex items-center justify-center gap-2 sm:gap-4 text-amber-700/60">
          <Wrench className="h-4 w-4 sm:h-6 sm:w-6 rotate-45" />
          <Hammer className="h-4 w-4 sm:h-6 sm:w-6 -rotate-12" />
          <Ruler className="h-4 w-4 sm:h-6 sm:w-6 rotate-12" />
        </div>
      </div>
      {/* Bench top */}
      <div className="h-2 sm:h-3 rounded-sm bg-gradient-to-b from-stone-600 via-stone-700 to-stone-800 shadow-md" />
      {/* Totes under / in front of the bench */}
      {fixture.rows.map((row, i) => (
        <div key={i}>
          <SlotGrid row={row} {...slotProps} />
          {i < fixture.rows.length - 1 && <Plank />}
        </div>
      ))}
    </div>
  );
}

function WallShelfSection({ fixture, ...slotProps }) {
  const { totesByPosition, onSlotClick, highlightPosition } = slotProps;
  return (
    <div className="mx-auto w-full max-w-sm">
      {fixture.slots.map((pos) => (
        <div key={pos} className="mb-1">
          <ToteCard
            variant="wide"
            position={pos}
            tote={totesByPosition[pos]}
            onClick={() => onSlotClick(pos)}
            highlighted={highlightPosition === pos}
          />
          {/* Shelf plank with brackets */}
          <div className="ml-12">
            <div className={`h-1.5 sm:h-2 rounded-sm ${WOOD} shadow`} />
            <div className="flex justify-between px-6" aria-hidden="true">
              <div className="h-2 w-1 rounded-b-sm bg-amber-800/70" />
              <div className="h-2 w-1 rounded-b-sm bg-amber-800/70" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

const FIXTURE_RENDERERS = {
  rack: RackSection,
  workbench: WorkbenchSection,
  wallShelf: WallShelfSection,
};

export default function WallPanel({
  wall,
  totesByPosition,
  onSlotClick,
  highlightPosition,
}) {
  const slotProps = { totesByPosition, onSlotClick, highlightPosition };
  const multi = wall.fixtures.length > 1;

  return (
    <section aria-label={wall.label} className="px-1 sm:px-2">
      <div className="rounded-xl border border-gray-200 bg-gradient-to-b from-white to-gray-50 p-1.5 sm:p-3 shadow-inner dark:border-gray-700 dark:from-gray-900 dark:to-gray-950">
        <div className={multi ? "flex items-stretch gap-1 sm:gap-2" : ""}>
          {wall.fixtures.map((fixture) => {
            const Renderer = FIXTURE_RENDERERS[fixture.kind];
            return Renderer ? (
              <Renderer key={fixture.id} fixture={fixture} {...slotProps} />
            ) : null;
          })}
        </div>
        {/* Concrete floor */}
        <div className="mt-0.5 h-2 rounded-b bg-gradient-to-b from-gray-300 to-gray-400 dark:from-gray-600 dark:to-gray-700" />
      </div>
    </section>
  );
}

/**
 * Plan-view orientation aid (decorative — the wall tabs are the accessible
 * control). Draws the garage from above: three walls + door opening.
 */
export function MiniMap({ activeWallId }) {
  const bar = (id, cls) =>
    `${cls} rounded-sm transition-colors ${
      activeWallId === id ? "bg-blue-500" : "bg-gray-300 dark:bg-gray-600"
    }`;
  return (
    <div aria-hidden="true" className="relative h-10 w-14 shrink-0">
      <div className={bar("front", "absolute inset-x-0 top-0 h-2")} />
      <div className={bar("left", "absolute left-0 top-2.5 bottom-0 w-2")} />
      <div className={bar("right", "absolute right-0 top-2.5 bottom-0 w-2")} />
      <div className="absolute inset-x-3 bottom-0 border-b-2 border-dashed border-gray-300 dark:border-gray-600" />
    </div>
  );
}
