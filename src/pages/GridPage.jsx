import { Package, Plus } from "lucide-react";
import { useState } from "react";
import SearchBar from "../components/SearchBar";
import ToteCard from "../components/ToteCard";
import { useTotes } from "../hooks/useTotes";
import { COLUMN_LABELS, SHELF_LAYOUT } from "../utils/constants";

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
                  of 26 positions
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
                <div className="w-16 sm:w-20 h-1 bg-gradient-to-r from-blue-500 to-indigo-500 rounded-full mx-auto" />
              </div>

              <div className="space-y-3 sm:space-y-4 md:space-y-6">
                {SHELF_LAYOUT.map((row, rowIdx) => (
                  <div
                    key={rowIdx}
                    className="flex justify-center gap-2 sm:gap-4 md:gap-6"
                  >
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
                          <div className="opacity-30">
                            <div className="w-14 sm:w-20 md:w-28 h-6 sm:h-8 md:h-10 border-2 border-dashed border-gray-600/30 rounded-lg" />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ))}

                {/* Column labels */}
                <div className="mt-4 sm:mt-6 md:mt-8 flex justify-center gap-2 sm:gap-4 md:gap-6 text-xs sm:text-sm font-bold">
                  {COLUMN_LABELS.map((label) => (
                    <div
                      key={label}
                      className={`w-16 sm:w-24 md:w-32 text-center ${
                        ["C", "D", "E"].includes(label)
                          ? "text-gray-500"
                          : "text-blue-600"
                      }`}
                    >
                      {label}
                    </div>
                  ))}
                </div>

                <div className="mt-8 pt-8 border-t border-gray-700/50">
                  <div className="text-center">
                    <div className="text-lg font-bold bg-gradient-to-r from-gray-300 to-gray-400 bg-clip-text text-transparent mb-2">
                      Storage Configuration
                    </div>
                    <div className="text-gray-400 text-sm">
                      A &amp; B columns: 5 levels each &bull; C, D, E columns: 2
                      levels each (4 &amp; 5) &bull; F &amp; G columns: 5 levels
                      each
                    </div>
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
          <div className="flex gap-4 sm:gap-8 flex-wrap justify-center">
            <div className="flex items-center gap-2 sm:gap-3 bg-white border border-gray-200 p-3 sm:p-4 rounded-xl sm:rounded-2xl shadow-sm">
              <div className="flex flex-col items-center">
                <div className="w-8 sm:w-10 md:w-12 h-1.5 sm:h-2 bg-gradient-to-br from-gray-200 via-gray-300 to-gray-400 rounded-t border border-gray-400/30" />
                <div className="w-8 sm:w-10 md:w-12 h-6 sm:h-7 md:h-8 bg-gradient-to-br from-gray-700/90 to-gray-900/90 border border-gray-600/30 flex items-center justify-center relative">
                  <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent" />
                  <div className="text-white text-xs sm:text-sm font-bold z-10">
                    Items
                  </div>
                </div>
                <div className="w-8 sm:w-10 md:w-12 h-0.5 bg-gray-700" />
              </div>
              <span className="text-xs sm:text-sm text-gray-600 font-medium">
                Occupied Tote
              </span>
            </div>
            <div className="flex items-center gap-2 sm:gap-3 bg-white border border-gray-200 p-3 sm:p-4 rounded-xl sm:rounded-2xl shadow-sm">
              <div className="flex flex-col items-center">
                <div className="w-8 sm:w-10 md:w-12 h-1.5 sm:h-2 bg-gradient-to-br from-gray-200 via-gray-300 to-gray-400 rounded-t border border-gray-400/30" />
                <div className="w-8 sm:w-10 md:w-12 h-6 sm:h-7 md:h-8 bg-gradient-to-br from-gray-700/90 to-gray-900/90 border border-gray-600/30 flex items-center justify-center relative">
                  <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent" />
                  <Plus className="w-2 sm:w-2.5 md:w-3 h-2 sm:h-2.5 md:h-3 text-white z-10" />
                </div>
                <div className="w-8 sm:w-10 md:w-12 h-0.5 bg-gray-700" />
              </div>
              <span className="text-xs sm:text-sm text-gray-600 font-medium">
                Empty Position
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
