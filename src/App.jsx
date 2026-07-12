import { useCallback, useState } from "react";
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

  const handleBack = () => {
    setView("garage");
    setSelectedTote(null);
    setEditingTote(null);
    setSelectedPosition("");
  };

  const handleSelectTote = (tote) => {
    setSelectedTote(tote);
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
    setView("garage");
    setSelectedTote(null);
  };

  const clearHighlight = useCallback(() => setHighlightPosition(null), []);

  return (
    <ErrorBoundary>
      <ToteProvider>
        <ToastProvider>
          {view === "garage" && (
            <GridPage
              onSelectTote={handleSelectTote}
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
