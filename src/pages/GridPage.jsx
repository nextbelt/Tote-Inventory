import { Package, Plus } from "lucide-react";
import { useState } from "react";
import SearchBar from "../components/SearchBar";
import ToteCard from "../components/ToteCard";
import { useTotes } from "../hooks/useTotes";
import {
  COLUMN_LABELS,
  LEFT_WALL_POSITIONS,
  RIGHT_WALL_POSITIONS,
  SHELF_LAYOUT,
} from "../utils/constants";

export default function GridPage({ onSelectTote, onAddTote }) {
  const { totes, loading, loadData } = useTotes();
  const [searchTerm, setSearchTerm] = useState("");
  const [activeTab, setActiveTab] = useState("visual");

  // Filter totes by search term
  const filteredTotes = totes.filter((tote) => {
    if (!searchTerm) return true;
    const s = searchTerm.toLowerCase();
    return (
      tote.name.toLowerCase().includes(s) ||
      tote.position.toLowerCase().includes(s) ||
      (tote.items &&
        tote.items.some((item) => item.name.toLowerCase().includes(s)))
    );
  });

  // Keep the most-recently-updated tote per position
  const totesByPosition = {};
  filteredTotes.forEach((tote) => {
    const existing = totesByPosition[tote.position];
    if (
      !existing ||
      new Date(tote.updated_at) > new Date(existing.updated_at)
    ) {
      totesByPosition[tote.position] = tote;
    }
  });

  // Sorted unique totes for the table view
  const uniqueTotes = Object.values(totesByPosition).sort((a, b) => {
    if (a.position[0] !== b.position[0])
      return a.position[0].localeCompare(b.position[0]);
    return parseInt(a.position.slice(1)) - parseInt(b.position.slice(1));
  });

  const handleToteClick = (position) => {
    const tote = totesByPosition[position];
    if (tote) {
      onSelectTote(tote);
    } else {
      onAddTote(position);
    }
  };

  return (
    <div
      className="min-h-screen"
      style={{
        background: "linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%)",
      }}
    >
      <div className="max-w-7xl mx-auto p-4 sm:p-6">
        {/* Header */}
        <div className="apple-card p-4 sm:p-6 md:p-8 mb-4 sm:mb-6 md:mb-8">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 sm:gap-6 mb-4 sm:mb-6 md:mb-8">
            <h1 className="apple-title text-2xl sm:text-3xl md:text-4xl flex items-center">
              <div className="w-8 h-8 sm:w-10 sm:h-10 mr-3 sm:mr-4 bg-gradient-to-r from-blue-500 to-indigo-500 rounded-xl flex items-center justify-center">
                <Package className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
              </div>
              Tote Inventory
            </h1>
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="text-xs sm:text-sm text-gray-600 bg-blue-50 px-3 sm:px-4 py-2 rounded-full border border-blue-200 flex items-center gap-2">
                <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
                <span className="text-blue-600 font-semibold">
                  {totes.length}
                </span>
                <span className="text-gray-600 hidden sm:inline">
                  of 36 positions
                </span>
                <span className="text-gray-600 sm:hidden">totes</span>
              </div>
              <button
                onClick={loadData}
                disabled={loading}
                className="p-2 text-blue-600 hover:text-blue-700 hover:bg-blue-100 rounded-lg transition-all duration-200 disabled:opacity-50"
                title="Refresh data"
              >
                <svg
                  className={`w-4 h-4 ${loading ? "animate-spin" : ""}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                  />
                </svg>
              </button>
            </div>
          </div>
          <SearchBar value={searchTerm} onChange={setSearchTerm} />
        </div>

        {/* Tab navigation */}
        <div className="apple-card p-2 mb-4 sm:mb-6">
          <div className="flex bg-gray-100 rounded-lg p-1">
            {["visual", "table"].map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-all duration-200 ${
                  activeTab === tab
                    ? "bg-white text-blue-600 shadow-sm"
                    : "text-gray-600 hover:text-gray-900"
                }`}
              >
                {tab === "visual" ? "Visual Grid" : "Table View"}
              </button>
            ))}
          </div>
        </div>

        {/* Content card */}
        <div className="apple-card p-4 sm:p-6 md:p-8">
          {/* ---- VISUAL GRID ---- */}
          {activeTab === "visual" && (
            <>
              <div className="text-center mb-4 sm:mb-6 md:mb-8">
                <h2 className="apple-subtitle mb-2">Storage Grid</h2>
                <div className="w-16 sm:w-20 h-1 bg-gradient-to-r from-amber-600 to-yellow-700 rounded-full mx-auto" />
              </div>

              {/* === Main layout: Left Wall + Rack + Right Wall === */}
              <div className="flex justify-center items-start gap-3 sm:gap-4 md:gap-6">
                {/* ---- LEFT WALL ---- */}
                <div className="flex flex-col items-center">
                  <div className="text-xs sm:text-sm font-bold text-gray-600 mb-2 sm:mb-3 text-center">
                    Left Wall
                    <div className="text-xs font-normal text-gray-400">
                      (Other)
                    </div>
                  </div>
                  <div className="border-2 border-gray-300 rounded-xl bg-gradient-to-b from-gray-50 to-gray-100 p-2 sm:p-3 shadow-inner">
                    <div className="flex flex-col gap-1 sm:gap-2">
                      {LEFT_WALL_POSITIONS.map((pos) => (
                        <ToteCard
                          key={pos}
                          position={pos}
                          tote={totesByPosition[pos]}
                          onClick={() => handleToteClick(pos)}
                        />
                      ))}
                    </div>
                  </div>
                </div>

                {/* ---- CENTER: Rack + Labels ---- */}
                <div className="flex flex-col items-center">
                  {/* Wooden shelving unit */}
                  <div className="relative mx-auto w-fit" id="shelf-unit">
                    {/* Top crossbeam */}
                    <div className="mx-6 sm:mx-8 md:mx-10 h-3 sm:h-4 rounded-t-md shadow-md border-t border-amber-500/40 bg-gradient-to-b from-amber-600 via-amber-700 to-amber-800" />

                    {SHELF_LAYOUT.map((row, rowIdx) => (
                        <div key={rowIdx}>
                          {/* Row: uprights + totes */}
                          <div className="flex items-end">
                            {/* Left upright */}
                            <div className="w-5 sm:w-7 md:w-9 self-stretch shadow-inner border-x border-amber-800/30 bg-gradient-to-r from-amber-700 via-amber-600 to-amber-700" />

                            {/* Tote slots */}
                            <div className="flex justify-center gap-1 sm:gap-2 md:gap-3 py-2 sm:py-3 md:py-4 px-1 sm:px-2">
                              {row.map((pos, colIdx) => (
                                <div
                                  key={colIdx}
                                  className="w-16 sm:w-24 md:w-32 flex justify-center"
                                >
                                  {pos ? (
                                    <ToteCard
                                      position={pos}
                                      tote={totesByPosition[pos]}
                                      onClick={() => handleToteClick(pos)}
                                    />
                                  ) : (
                                    <div className="w-14 sm:w-20 md:w-28 h-6 sm:h-8 md:h-10" />
                                  )}
                                </div>
                              ))}
                            </div>

                            {/* Right upright */}
                            <div className="w-5 sm:w-7 md:w-9 self-stretch shadow-inner border-x border-amber-800/30 bg-gradient-to-r from-amber-700 via-amber-600 to-amber-700" />
                          </div>

                          {/* Wooden shelf plank */}
                          <div className="flex">
                            <div className="w-5 sm:w-7 md:w-9 border-x border-amber-800/30 bg-gradient-to-r from-amber-700 via-amber-600 to-amber-700" />
                            <div className="flex-1 h-3 sm:h-4 shadow-md relative bg-gradient-to-b from-amber-600 via-amber-700 to-amber-800">
                              <div className="absolute top-0 left-0 right-0 h-px bg-amber-400/30" />
                              <div className="absolute bottom-0 left-0 right-0 h-px bg-amber-950/50" />
                            </div>
                            <div className="w-5 sm:w-7 md:w-9 border-x border-amber-800/30 bg-gradient-to-r from-amber-700 via-amber-600 to-amber-700" />
                          </div>
                        </div>
                    ))}

                    {/* Bottom base — thicker plank */}
                    <div className="mx-6 sm:mx-8 md:mx-10 h-4 sm:h-5 rounded-b-md shadow-lg border-b border-amber-900/60 bg-gradient-to-b from-amber-700 via-amber-800 to-amber-900" />
                  </div>

                  {/* Column labels */}
                  <div className="mt-4 sm:mt-6 md:mt-8 flex justify-center gap-1 sm:gap-2 md:gap-3 text-xs sm:text-sm font-bold px-10 sm:px-14 md:px-18">
                    {COLUMN_LABELS.map((label) => (
                      <div
                        key={label}
                        className={`w-16 sm:w-24 md:w-32 text-center ${
                          ["C", "D", "E"].includes(label)
                            ? "text-gray-400"
                            : "text-amber-700"
                        }`}
                      >
                        {label}
                      </div>
                    ))}
                  </div>
                </div>
                {/* ---- end center ---- */}

                {/* ---- RIGHT WALL ---- */}
                <div className="flex flex-col items-center">
                  <div className="text-xs sm:text-sm font-bold text-gray-600 mb-2 sm:mb-3 text-center">
                    Right Wall
                    <div className="text-xs font-normal text-gray-400">
                      (Other)
                    </div>
                  </div>
                  <div className="border-2 border-gray-300 rounded-xl bg-gradient-to-b from-gray-50 to-gray-100 p-2 sm:p-3 shadow-inner">
                    <div className="flex flex-col gap-1 sm:gap-2">
                      {RIGHT_WALL_POSITIONS.map((pos) => (
                        <ToteCard
                          key={pos}
                          position={pos}
                          tote={totesByPosition[pos]}
                          onClick={() => handleToteClick(pos)}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              </div>
              {/* === end main layout === */}

              <div className="mt-8 pt-8 border-t border-gray-200">
                <div className="text-center">
                  <div className="text-lg font-bold bg-gradient-to-r from-amber-600 to-amber-800 bg-clip-text text-transparent mb-2">
                    Storage Configuration
                  </div>
                  <div className="text-gray-500 text-sm">
                    A &amp; B columns: 5 levels each &bull; C, D, E columns: 2
                    levels each (4 &amp; 5) &bull; F &amp; G columns: 5 levels
                    each &bull; Left &amp; Right Walls: 5 overflow slots each
                  </div>
                </div>
              </div>
            </>
          )}

          {/* ---- TABLE VIEW ---- */}
          {activeTab === "table" && (
            <>
              <div className="text-center mb-4 sm:mb-6 md:mb-8">
                <h2 className="apple-subtitle mb-2">Tote Inventory Table</h2>
                <div className="w-16 sm:w-20 h-1 bg-gradient-to-r from-blue-500 to-indigo-500 rounded-full mx-auto" />
              </div>

              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="text-left py-3 px-4 font-semibold text-gray-700">
                        Position
                      </th>
                      <th className="text-left py-3 px-4 font-semibold text-gray-700">
                        Tote Name
                      </th>
                      <th className="text-left py-3 px-4 font-semibold text-gray-700">
                        Items
                      </th>
                      <th className="text-left py-3 px-4 font-semibold text-gray-700">
                        Count
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {uniqueTotes.map((tote) => (
                      <tr
                        key={tote.id}
                        className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer"
                        onClick={() => onSelectTote(tote)}
                      >
                        <td className="py-3 px-4 font-medium text-blue-600">
                          {tote.position}
                        </td>
                        <td className="py-3 px-4">{tote.name}</td>
                        <td className="py-3 px-4">
                          {tote.items && tote.items.length > 0 ? (
                            <div className="text-sm text-gray-600">
                              {tote.items
                                .slice(0, 3)
                                .map((i) => i.name)
                                .join(", ")}
                              {tote.items.length > 3 &&
                                ` +${tote.items.length - 3} more`}
                            </div>
                          ) : (
                            <span className="text-gray-400 text-sm">
                              No items
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4">
                          <span className="bg-blue-100 text-blue-800 px-2 py-1 rounded-full text-sm">
                            {tote.items ? tote.items.length : 0}
                          </span>
                        </td>
                      </tr>
                    ))}
                    {uniqueTotes.length === 0 && (
                      <tr>
                        <td
                          colSpan="4"
                          className="py-8 px-4 text-center text-gray-500"
                        >
                          {searchTerm
                            ? "No totes match your search"
                            : "No totes created yet"}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>

        {/* Legend */}
        <div className="apple-card p-4 sm:p-6 mt-4 sm:mt-6 md:mt-8">
          <h3 className="apple-subtitle text-lg sm:text-xl mb-4 sm:mb-6 text-center">
            Quick Guide
          </h3>
          <div className="flex gap-4 sm:gap-6 flex-wrap justify-center text-sm text-gray-600">
            <div className="flex items-center gap-3 bg-white border border-gray-200 p-3 sm:p-4 rounded-xl shadow-sm">
              <div className="flex flex-col items-center relative">
                <div className="w-10 h-2 bg-gradient-to-br from-yellow-300 via-yellow-400 to-amber-500 rounded-t border border-yellow-600/40" />
                <div className="w-10 h-7 bg-gradient-to-br from-gray-800 via-gray-900 to-black border border-gray-700/60" />
                <div className="w-10 h-0.5 bg-gray-800" />
                <div className="absolute -top-1 -right-1 w-4 h-4 bg-yellow-400 rounded-full border border-white flex items-center justify-center">
                  <span className="text-gray-900 text-xs font-bold">2</span>
                </div>
              </div>
              <div>
                <div className="font-semibold">Occupied tote</div>
                <div className="text-gray-400 text-xs">Click to view / edit contents</div>
              </div>
            </div>

            <div className="flex items-center gap-3 bg-white border border-gray-200 p-3 sm:p-4 rounded-xl shadow-sm">
              <div className="flex flex-col items-center opacity-40">
                <div className="w-10 h-2 bg-gradient-to-br from-yellow-300 via-yellow-400 to-amber-500 rounded-t border border-yellow-600/40" />
                <div className="w-10 h-7 bg-gradient-to-br from-gray-800 via-gray-900 to-black border border-gray-700/60 flex items-center justify-center">
                  <Plus className="w-3 h-3 text-gray-400" />
                </div>
                <div className="w-10 h-0.5 bg-gray-800" />
              </div>
              <div>
                <div className="font-semibold">Empty slot</div>
                <div className="text-gray-400 text-xs">Click to assign a tote</div>
              </div>
            </div>

            <div className="flex items-center gap-3 bg-white border border-amber-200 p-3 sm:p-4 rounded-xl shadow-sm">
              <div className="w-10 h-10 bg-gradient-to-b from-amber-600 via-amber-700 to-amber-800 rounded flex items-center justify-center">
                <span className="text-amber-100 text-xs font-bold">A–G</span>
              </div>
              <div>
                <div className="font-semibold">Rack  <span className="text-gray-400 font-normal text-xs">(A1–G5)</span></div>
                <div className="text-gray-400 text-xs">26 positions on the shelf</div>
              </div>
            </div>

            <div className="flex items-center gap-3 bg-white border border-gray-300 p-3 sm:p-4 rounded-xl shadow-sm">
              <div className="w-10 h-10 bg-gray-100 rounded border-2 border-gray-300 flex items-center justify-center">
                <span className="text-gray-500 text-xs font-bold leading-tight text-center">LW<br/>RW</span>
              </div>
              <div>
                <div className="font-semibold">Walls  <span className="text-gray-400 font-normal text-xs">(LW / RW)</span></div>
                <div className="text-gray-400 text-xs">10 overflow slots beside rack</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
