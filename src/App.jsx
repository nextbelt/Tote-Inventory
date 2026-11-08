import { useCallback, useRef, useState } from "react";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ToastProvider } from "./components/Toast";
import { ToteProvider } from "./hooks/useTotes";
import DetailPage from "./pages/DetailPage";
import FormPage from "./pages/FormPage";
import GridPage from "./pages/GridPage";
import { getWallForPosition } from "./utils/constants";

export default function ToteInventoryApp() {
  const [view, setView] = useState("garage");
  const [selectedTote, setSelectedTote] = useState(null);
  const [editingTote, setEditingTote] = useState(null);
  const [selectedPosition, setSelectedPosition] = useState("");
  const [activeWallId, setActiveWallId] = useState("front");
  const [highlightPosition, setHighlightPosition] = useState(null);
  // Search state lives here (GridPage unmounts on every view change) so Back
  // from a tote lands on the same results, mode and scroll position.
  const [searchTerm, setSearchTerm] = useState("");
  const [mode, setMode] = useState("garage"); // "garage" | "list"
  const gridScrollRef = useRef(0);
  // Which item a search result pointed at (original id value, number or string)
  const [highlightItemId, setHighlightItemId] = useState(undefined);

  const handleBack = () => {
    setView("garage");
    setSelectedTote(null);
    setEditingTote(null);
    setSelectedPosition("");
    setHighlightItemId(undefined);
  };

  const handleSelectTote = (tote, { itemId } = {}) => {
    gridScrollRef.current = window.scrollY || 0;
    setSelectedTote(tote);
    setHighlightItemId(itemId);
    setView("detail");
  };

  const handleAddTote = (position) => {
    setSelectedPosition(position);
    setEditingTote(null);
    setView("form");
  };

  const handleEditTote = (tote) => {
    setEditingTote(tote);
    setSelectedPosition(tote.position);
    setView("form");
  };

  /** Change wall; optionally highlight a slot ("Show me"). */
  const handleWallChange = (wallId, highlight = null) => {
    setActiveWallId(wallId);
    setHighlightPosition(highlight);
  };

  /** From a tote's detail page: jump to its slot in the garage view. */
  const handleShowInGarage = (position) => {
    const wall = getWallForPosition(position);
    setActiveWallId(wall ? wall.id : "front");
    setHighlightPosition(position);
    // Land on the garage, not on a search that was still open
    setSearchTerm("");
    setMode("garage");
    gridScrollRef.current = 0;
    setView("garage");
    setSelectedTote(null);
    setHighlightItemId(undefined);
  };

  const clearHighlight = useCallback(() => setHighlightPosition(null), []);

  return (
    <ErrorBoundary>
      <ToteProvider>
        <ToastProvider>
          {view === "garage" && (
            <GridPage
              onSelectTote={handleSelectTote}
              searchTerm={searchTerm}
              onSearchChange={setSearchTerm}
              mode={mode}
              onModeChange={setMode}
              initialScrollY={gridScrollRef.current}
              onAddTote={handleAddTote}
              activeWallId={activeWallId}
              onWallChange={handleWallChange}
              highlightPosition={highlightPosition}
              onClearHighlight={clearHighlight}
            />
          )}
          {view === "detail" && selectedTote && (
            <DetailPage
              tote={selectedTote}
              highlightItemId={highlightItemId}
              onBack={handleBack}
              onEdit={handleEditTote}
              onDeleted={handleBack}
              onShowInGarage={handleShowInGarage}
            />
          )}
          {view === "form" && (
            <FormPage
              editTote={editingTote}
              position={selectedPosition}
              onBack={handleBack}
              onSaved={handleBack}
            />
          )}
        </ToastProvider>
      </ToteProvider>
    </ErrorBoundary>
  );
}
