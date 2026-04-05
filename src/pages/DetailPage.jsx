import { ChevronLeft, Edit2, MapPin, Trash2 } from "lucide-react";
import { useTotes } from "../hooks/useTotes";

export default function DetailPage({
  tote: initialTote,
  onBack,
  onEdit,
  onDeleted,
}) {
  const { totes, deleteTote } = useTotes();

  // Always read the latest version from the store
  const tote = totes.find((t) => t.id === initialTote.id) || initialTote;
  const items = Array.isArray(tote.items) ? tote.items : [];

  const handleDelete = async () => {
    if (
      !window.confirm(
        "Are you sure you want to delete this tote? This action cannot be undone."
      )
    )
      return;
    try {
      await deleteTote(tote.id);
      onDeleted();
    } catch {
      alert("Failed to delete tote. Please try again.");
    }
  };

  return (
    <div
      className="min-h-screen"
      style={{
        background: "linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%)",
      }}
    >
      <div className="max-w-4xl mx-auto p-4 sm:p-6">
        <div className="apple-card p-4 sm:p-6 md:p-8">
          {/* Top bar */}
          <div className="flex items-center justify-between mb-6 sm:mb-8">
            <button
              onClick={onBack}
              className="flex items-center text-blue-600 hover:text-blue-700 transition-colors duration-200 group"
            >
              <ChevronLeft className="w-4 h-4 sm:w-5 sm:h-5 mr-1 group-hover:-translate-x-1 transition-transform duration-200" />
              <span className="text-sm sm:text-base font-medium">
                Back to Grid
              </span>
            </button>
            <div className="flex gap-2 sm:gap-3">
              <button
                onClick={() => onEdit(tote)}
                className="p-2 sm:p-3 text-blue-600 hover:text-blue-700 hover:bg-blue-100 rounded-lg sm:rounded-xl transition-all duration-200"
              >
                <Edit2 className="w-4 h-4 sm:w-5 sm:h-5" />
              </button>
              <button
                onClick={handleDelete}
                className="p-2 sm:p-3 text-red-400 hover:text-red-300 hover:bg-red-500/20 rounded-lg sm:rounded-xl transition-all duration-300"
              >
                <Trash2 className="w-4 h-4 sm:w-5 sm:h-5" />
              </button>
            </div>
          </div>

          {/* Tote info */}
          <div className="mb-6 sm:mb-8">
            <h1 className="apple-title text-2xl sm:text-3xl md:text-4xl mb-2 sm:mb-3">
              {tote.name}
            </h1>
            <div className="inline-flex items-center text-blue-600 font-semibold bg-blue-50 px-3 sm:px-4 py-2 rounded-full border border-blue-200 text-sm sm:text-base">
              <MapPin className="w-4 h-4 sm:w-5 sm:h-5 mr-1 sm:mr-2" />
              Position: {tote.position}
            </div>
          </div>

          {/* Items */}
          <div className="border-t border-gray-200 pt-6 sm:pt-8">
            <h2 className="apple-subtitle text-xl sm:text-2xl mb-4 sm:mb-6">
              Items ({items.length})
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
              {items.length === 0 ? (
                <div className="text-gray-400 p-4 text-center col-span-full">
                  No items in this tote yet
                </div>
              ) : (
                items.map((item, idx) => (
                  <div
                    key={item.id || idx}
                    className="bg-white border border-gray-200 rounded-xl sm:rounded-2xl p-4 sm:p-6 hover:bg-gray-50 transition-all duration-200 shadow-sm"
                  >
                    {item.image && (
                      <img
                        src={item.image}
                        alt={item.name}
                        className="w-full h-48 sm:h-56 md:h-64 object-cover rounded-lg sm:rounded-xl mb-3 sm:mb-4 border border-gray-300"
                      />
                    )}
                    <h3 className="font-bold text-gray-800 text-base sm:text-lg">
                      {item.name}
                    </h3>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
