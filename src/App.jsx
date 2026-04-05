import { useState } from "react";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ToteProvider } from "./hooks/useTotes";
import DetailPage from "./pages/DetailPage";
import FormPage from "./pages/FormPage";
import GridPage from "./pages/GridPage";

export default function ToteInventoryApp() {
  const [view, setView] = useState("grid");
  const [selectedTote, setSelectedTote] = useState(null);
  const [editingTote, setEditingTote] = useState(null);
  const [selectedPosition, setSelectedPosition] = useState("");

  const handleBack = () => {
    setView("grid");
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

  return (
    <ErrorBoundary>
      <ToteProvider>
        {view === "grid" && (
          <GridPage onSelectTote={handleSelectTote} onAddTote={handleAddTote} />
        )}
        {view === "detail" && selectedTote && (
          <DetailPage
            tote={selectedTote}
            onBack={handleBack}
            onEdit={handleEditTote}
            onDeleted={handleBack}
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
      </ToteProvider>
    </ErrorBoundary>
  );
}
