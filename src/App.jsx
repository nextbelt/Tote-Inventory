import React, { useState, useEffect } from 'react';
import { Camera, Package, MapPin, Search, Plus, X, ChevronLeft, Edit2, Trash2, Save } from 'lucide-react';
import { dbService } from './supabase.js';

const SHELF_POSITIONS = [
  'A1', 'A2', 'A3', 'A4', 'A5',
  'B1', 'B2', 'B3', 'B4', 'B5',
  'C4', 'C5',
  'D4', 'D5',
  'E4', 'E5',
  'F1', 'F2', 'F3', 'F4', 'F5',
  'G1', 'G2', 'G3', 'G4', 'G5'
];

export default function ToteInventoryApp() {
  const [totes, setTotes] = useState([]);
  const [view, setView] = useState('grid'); // grid, addTote, toteDetail
  const [selectedTote, setSelectedTote] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [editingTote, setEditingTote] = useState(false);
  const [loading, setLoading] = useState(true);

  // Form states
  const [toteName, setToteName] = useState('');
  const [shelfPosition, setShelfPosition] = useState('');
  const [items, setItems] = useState([]);
  const [currentItem, setCurrentItem] = useState({ name: '', image: null });

  useEffect(() => {
    // Test database connection first, then load data
    const initializeApp = async () => {
      console.log('Testing database connection...');
      const isConnected = await dbService.testConnection();
      
      if (isConnected) {
        console.log('✅ Database connected successfully');
      } else {
        console.log('⚠️ Database connection failed, using localStorage');
      }
      
      await loadData();
      setupRealtimeSubscription();
    };
    
    initializeApp();
  }, []);

  const loadData = async () => {
    console.log('🔄 Starting data load...');
    setLoading(true);
    try {
      const data = await dbService.getTotes();
      console.log('📊 Raw data from database:', data);
      console.log('📊 Data length:', data?.length || 0);
      
      setTotes(data);
      console.log('✅ Totes state updated with:', data?.length || 0, 'items');
    } catch (error) {
      console.error('❌ Failed to load data:', error);
      // Show user-friendly error message
      alert('Unable to load data. Using local storage as backup.');
    } finally {
      setLoading(false);
      console.log('🏁 Data loading complete');
    }
  };

  const setupRealtimeSubscription = () => {
    const subscription = dbService.subscribeToChanges(() => {
      // Reload data when changes occur
      loadData();
    });

    return () => {
      if (subscription) {
        subscription.unsubscribe();
      }
    };
  };

  const handleImageUpload = async (e) => {
    const file = e.target.files[0];
    if (file) {
      try {
        const fileName = `${Date.now()}-${file.name}`;
        const imageUrl = await dbService.uploadImage(file, fileName);
        setCurrentItem({ ...currentItem, image: imageUrl });
      } catch (error) {
        console.error('Error uploading image:', error);
        // Fallback to base64
        const reader = new FileReader();
        reader.onloadend = () => {
          setCurrentItem({ ...currentItem, image: reader.result });
        };
        reader.readAsDataURL(file);
      }
    }
  };

  const addItemToList = () => {
    if (currentItem.name.trim()) {
      setItems([...items, { ...currentItem, id: Date.now() }]);
      setCurrentItem({ name: '', image: null });
    }
  };

  const removeItem = (id) => {
    setItems(items.filter(item => item.id !== id));
  };

  const saveTote = async () => {
    if (!toteName.trim() || !shelfPosition) return;

    const newTote = {
      id: editingTote ? selectedTote.id : Date.now(),
      name: toteName,
      position: shelfPosition,
      items: items,
      created_at: editingTote ? selectedTote.created_at : new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    console.log('💾 Attempting to save tote:', newTote);

    try {
      const savedTote = await dbService.saveTote(newTote);
      console.log('✅ Tote saved successfully:', savedTote);
      
      // Update local state immediately for instant UI feedback
      if (editingTote) {
        setTotes(prev => prev.map(t => t.id === savedTote.id ? savedTote : t));
      } else {
        setTotes(prev => [...prev, savedTote]);
      }
      
      // Also refresh from database to make sure we're in sync
      await loadData();
      
      resetForm();
      setView('grid');
      alert('✅ Tote saved successfully!');
    } catch (error) {
      console.error('❌ Failed to save tote:', error);
      alert('❌ Failed to save tote. Please check your internet connection and try again.');
    }
  };

  const resetForm = () => {
    setToteName('');
    setShelfPosition('');
    setItems([]);
    setCurrentItem({ name: '', image: null });
    setEditingTote(false);
    setSelectedTote(null);
  };

  const editTote = (tote) => {
    setSelectedTote(tote);
    setToteName(tote.name);
    setShelfPosition(tote.position);
    setItems(tote.items || []);
    setEditingTote(true);
    setView('addTote');
  };

  const getTotesByPosition = () => {
    console.log('🗂️ Filtering totes for display:');
    console.log('🗂️ Total totes in state:', totes.length);
    console.log('🗂️ Search term:', searchTerm);
    
    const filtered = totes.filter(tote =>
      tote.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      tote.position.toLowerCase().includes(searchTerm.toLowerCase()) ||
      tote.items.some(item => item.name.toLowerCase().includes(searchTerm.toLowerCase()))
    );
    
    console.log('🗂️ Filtered totes count:', filtered.length);
    console.log('🗂️ Filtered totes:', filtered);
    
    const grouped = {};
    filtered.forEach(tote => {
      if (!grouped[tote.position]) grouped[tote.position] = [];
      grouped[tote.position].push(tote);
    });
    
    console.log('🗂️ Grouped by position:', grouped);
    return grouped;
  };

  const handleToteClick = (position, tote) => {
    if (tote) {
      setSelectedTote(tote);
      setView('toteDetail');
    } else {
      setShelfPosition(position);
      setView('addTote');
    }
  };

  if (view === 'addTote') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900 p-2 sm:p-4">
        <div className="max-w-2xl mx-auto">
          <div className="bg-gray-800/50 backdrop-blur-xl border border-gray-700/50 rounded-2xl sm:rounded-3xl shadow-2xl p-4 sm:p-6 md:p-8">
            <div className="flex items-center justify-between mb-6 sm:mb-8">
              <button
                onClick={() => { resetForm(); setView('grid'); }}
                className="flex items-center text-purple-400 hover:text-purple-300 transition-colors duration-300 group"
              >
                <ChevronLeft className="w-4 h-4 sm:w-5 sm:h-5 mr-1 group-hover:-translate-x-1 transition-transform duration-300" />
                <span className="text-sm sm:text-base">Back to Grid</span>
              </button>
              <h1 className="text-lg sm:text-xl md:text-2xl font-bold bg-gradient-to-r from-purple-400 via-pink-400 to-blue-400 bg-clip-text text-transparent">
                {editingTote ? 'Edit Tote' : 'New Tote'}
              </h1>
              <div className="w-16 sm:w-20 md:w-24"></div>
            </div>

            <div className="space-y-6 sm:space-y-8">
              <div>
                <label className="block text-sm font-semibold text-purple-300 mb-2 sm:mb-3">Tote Name</label>
                <input
                  type="text"
                  value={toteName}
                  onChange={(e) => setToteName(e.target.value)}
                  placeholder="e.g., Holiday Decorations"
                  className="w-full px-4 sm:px-6 py-3 sm:py-4 bg-gray-700/50 backdrop-blur-xl border border-gray-600/50 rounded-xl sm:rounded-2xl focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500/50 text-white placeholder-gray-400 transition-all duration-300 text-sm sm:text-base"
                />
              </div>

              {/* Show selected position (read-only) */}
              <div>
                <label className="block text-sm font-semibold text-purple-300 mb-2 sm:mb-3">Selected Position</label>
                <div className="w-full px-4 sm:px-6 py-3 sm:py-4 bg-gray-600/30 backdrop-blur-xl border border-gray-500/30 rounded-xl sm:rounded-2xl text-gray-300 font-semibold text-sm sm:text-base">
                  {shelfPosition || 'No position selected'}
                </div>
              </div>

              <div className="border-t border-gray-700/50 pt-6 sm:pt-8">
                <h3 className="text-lg sm:text-xl font-bold bg-gradient-to-r from-yellow-400 to-yellow-600 bg-clip-text text-transparent mb-4 sm:mb-6">Add Items</h3>
                <div className="space-y-4 sm:space-y-6">
                  <input
                    type="text"
                    value={currentItem.name}
                    onChange={(e) => setCurrentItem({ ...currentItem, name: e.target.value })}
                    placeholder="Item name"
                    className="w-full px-4 sm:px-6 py-3 sm:py-4 bg-gray-700/50 backdrop-blur-xl border border-gray-600/50 rounded-xl sm:rounded-2xl focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500/50 text-white placeholder-gray-400 transition-all duration-300 text-sm sm:text-base"
                  />
                  
                  <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
                    <label className="flex-1 cursor-pointer group">
                      <div className="flex items-center justify-center px-4 sm:px-6 py-3 sm:py-4 border-2 border-dashed border-gray-600/50 rounded-xl sm:rounded-2xl hover:border-purple-500/50 hover:bg-purple-500/10 transition-all duration-300 group-hover:scale-105">
                        <Camera className="w-4 h-4 sm:w-5 sm:h-5 mr-2 sm:mr-3 text-purple-400 group-hover:text-purple-300" />
                        <span className="text-xs sm:text-sm text-gray-300 group-hover:text-white">
                          {currentItem.image ? 'Change Photo' : 'Add Photo'}
                        </span>
                      </div>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleImageUpload}
                        className="hidden"
                      />
                    </label>
                    <button
                      onClick={addItemToList}
                      disabled={!currentItem.name.trim()}
                      className="px-6 sm:px-8 py-3 sm:py-4 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-xl sm:rounded-2xl font-semibold hover:from-purple-700 hover:to-pink-700 disabled:from-gray-600 disabled:to-gray-700 disabled:cursor-not-allowed flex items-center justify-center transition-all duration-300 transform hover:scale-105 text-sm sm:text-base"
                    >
                      <Plus className="w-4 h-4 sm:w-5 sm:h-5 mr-2" />
                      Add
                    </button>
                  </div>

                  {currentItem.image && (
                    <div className="flex justify-center">
                      <img src={currentItem.image} alt="Preview" className="w-24 h-24 sm:w-32 sm:h-32 object-cover rounded-xl sm:rounded-2xl border border-gray-600/50 shadow-lg" />
                    </div>
                  )}
                </div>
              </div>

              {items.length > 0 && (
                <div className="border-t border-gray-700/50 pt-6 sm:pt-8">
                  <h3 className="text-lg sm:text-xl font-bold text-gray-300 mb-4 sm:mb-6">Items ({items.length})</h3>
                  <div className="space-y-3 sm:space-y-4">
                    {items.map(item => (
                      <div key={item.id} className="flex items-center gap-3 sm:gap-4 p-3 sm:p-4 bg-gray-700/30 backdrop-blur-xl rounded-xl sm:rounded-2xl border border-gray-600/30">
                        {item.image && (
                          <img src={item.image} alt={item.name} className="w-12 h-12 sm:w-16 sm:h-16 object-cover rounded-lg sm:rounded-xl border border-gray-600/50" />
                        )}
                        <span className="flex-1 font-semibold text-white text-sm sm:text-base">{item.name}</span>
                        <button
                          onClick={() => removeItem(item.id)}
                          className="p-2 sm:p-3 text-red-400 hover:text-red-300 hover:bg-red-500/20 rounded-lg sm:rounded-xl transition-all duration-300"
                        >
                          <X className="w-4 h-4 sm:w-5 sm:h-5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <button
                onClick={saveTote}
                disabled={!toteName.trim() || !shelfPosition}
                className="w-full py-4 sm:py-5 bg-gradient-to-r from-purple-600 via-pink-600 to-blue-600 text-white rounded-xl sm:rounded-2xl font-bold hover:from-purple-700 hover:via-pink-700 hover:to-blue-700 disabled:from-gray-600 disabled:to-gray-700 disabled:cursor-not-allowed flex items-center justify-center transition-all duration-300 transform hover:scale-105 shadow-lg text-sm sm:text-base"
              >
                <Save className="w-4 h-4 sm:w-5 sm:h-5 mr-2 sm:mr-3" />
                {editingTote ? 'Update Tote' : 'Save Tote'}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (view === 'toteDetail' && selectedTote) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900 p-2 sm:p-4">
        <div className="max-w-4xl mx-auto">
          <div className="bg-gray-800/50 backdrop-blur-xl border border-gray-700/50 rounded-2xl sm:rounded-3xl shadow-2xl p-4 sm:p-6 md:p-8">
            <div className="flex items-center justify-between mb-6 sm:mb-8">
              <button
                onClick={() => { setView('grid'); setSelectedTote(null); }}
                className="flex items-center text-purple-400 hover:text-purple-300 transition-colors duration-300 group"
              >
                <ChevronLeft className="w-4 h-4 sm:w-5 sm:h-5 mr-1 group-hover:-translate-x-1 transition-transform duration-300" />
                <span className="text-sm sm:text-base">Back to Grid</span>
              </button>
              <div className="flex gap-2 sm:gap-3">
                <button
                  onClick={() => editTote(selectedTote)}
                  className="p-2 sm:p-3 text-purple-400 hover:text-purple-300 hover:bg-purple-500/20 rounded-lg sm:rounded-xl transition-all duration-300"
                >
                  <Edit2 className="w-4 h-4 sm:w-5 sm:h-5" />
                </button>
                <button
                  onClick={() => deleteTote(selectedTote.id)}
                  className="p-2 sm:p-3 text-red-400 hover:text-red-300 hover:bg-red-500/20 rounded-lg sm:rounded-xl transition-all duration-300"
                >
                  <Trash2 className="w-4 h-4 sm:w-5 sm:h-5" />
                </button>
              </div>
            </div>

            <div className="mb-6 sm:mb-8">
              <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold bg-gradient-to-r from-purple-400 via-pink-400 to-blue-400 bg-clip-text text-transparent mb-2 sm:mb-3">
                {selectedTote.name}
              </h1>
              <div className="inline-flex items-center text-yellow-400 font-semibold bg-gray-700/30 px-3 sm:px-4 py-2 rounded-full border border-gray-600/30 text-sm sm:text-base">
                <MapPin className="w-4 h-4 sm:w-5 sm:h-5 mr-1 sm:mr-2" />
                Position: {selectedTote.position}
              </div>
            </div>

            <div className="border-t border-gray-700/50 pt-6 sm:pt-8">
              <h2 className="text-xl sm:text-2xl font-bold bg-gradient-to-r from-yellow-400 to-yellow-600 bg-clip-text text-transparent mb-4 sm:mb-6">
                Items ({selectedTote.items.length})
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
                {selectedTote.items.map(item => (
                  <div key={item.id} className="bg-gray-700/30 backdrop-blur-xl border border-gray-600/30 rounded-xl sm:rounded-2xl p-4 sm:p-6 hover:bg-gray-700/40 transition-all duration-300 transform hover:scale-105">
                    {item.image && (
                      <img
                        src={item.image}
                        alt={item.name}
                        className="w-full h-32 sm:h-40 md:h-48 object-cover rounded-lg sm:rounded-xl mb-3 sm:mb-4 border border-gray-600/50"
                      />
                    )}
                    <h3 className="font-bold text-white text-base sm:text-lg">{item.name}</h3>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const grouped = getTotesByPosition();

  // Component for individual tote visualization - Railway style with Mobile Optimization
  const ToteCard = ({ position, tote, onClick }) => {
    return (
      <div className="flex flex-col items-center p-1 sm:p-2">
        <div className="text-xs font-semibold text-purple-300 mb-1 sm:mb-2">{position}</div>
        <div
          onClick={onClick}
          className="relative cursor-pointer transform hover:scale-110 transition-all duration-300 hover:shadow-2xl group"
        >
          {/* Tote with Railway-inspired design - Mobile Responsive */}
          <div className="relative">
            {/* Glowing effect */}
            <div className="absolute inset-0 bg-gradient-to-r from-purple-400 via-pink-400 to-indigo-400 rounded-lg opacity-0 group-hover:opacity-20 blur-xl transition-opacity duration-300"></div>
            
            {/* Yellow Lid with glass effect - Mobile Responsive */}
            <div className="relative w-8 h-2 sm:w-12 sm:h-2.5 md:w-16 md:h-3 bg-gradient-to-br from-yellow-200 via-yellow-400 to-yellow-600 rounded-t-lg border border-yellow-500/30 shadow-lg backdrop-blur-sm">
              {/* Glass shine effect */}
              <div className="absolute inset-0 bg-gradient-to-br from-white/40 to-transparent rounded-t-lg"></div>
              {/* Lid handle indentations - Mobile Responsive */}
              <div className="absolute left-1 sm:left-1.5 md:left-2 top-0.5 w-1.5 sm:w-2 md:w-3 h-1 sm:h-1 md:h-1.5 bg-yellow-600/60 rounded-sm backdrop-blur-sm"></div>
              <div className="absolute right-1 sm:right-1.5 md:right-2 top-0.5 w-1.5 sm:w-2 md:w-3 h-1 sm:h-1 md:h-1.5 bg-yellow-600/60 rounded-sm backdrop-blur-sm"></div>
            </div>
            
            {/* Black Tote Body with glass morphism - Mobile Responsive */}
            <div className="relative w-8 h-8 sm:w-12 sm:h-10 md:w-16 md:h-12 bg-gradient-to-br from-gray-700/90 via-gray-800/90 to-gray-900/90 backdrop-blur-xl border border-gray-600/30 shadow-xl">
              {/* Glass effect overlay */}
              <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent"></div>
              
              {/* Subtle vertical ridges - Mobile Responsive */}
              <div className="absolute left-0.5 sm:left-1 top-0 h-full w-px bg-gradient-to-b from-gray-500/40 to-gray-700/40"></div>
              <div className="absolute left-1.5 sm:left-3 top-0 h-full w-px bg-gradient-to-b from-gray-500/30 to-gray-700/30"></div>
              <div className="absolute right-1.5 sm:right-3 top-0 h-full w-px bg-gradient-to-b from-gray-500/30 to-gray-700/30"></div>
              <div className="absolute right-0.5 sm:right-1 top-0 h-full w-px bg-gradient-to-b from-gray-500/40 to-gray-700/40"></div>
              
              {/* Content indicator - Mobile Responsive */}
              {tote && (
                <div className="absolute inset-0.5 sm:inset-1 flex flex-col justify-center items-center text-white text-xs overflow-hidden z-10">
                  <div className="font-bold text-center text-xs leading-tight truncate w-full px-0.5 sm:px-1 text-transparent bg-clip-text bg-gradient-to-r from-yellow-200 to-yellow-400">
                    {tote.name.length > 4 ? tote.name.substring(0, 4) + '...' : tote.name}
                  </div>
                  <div className="text-purple-300 text-xs font-semibold mt-0.5">{tote.items.length}</div>
                </div>
              )}
              
              {!tote && (
                <div className="absolute inset-0 flex items-center justify-center z-10">
                  <Plus className="w-2 h-2 sm:w-3 sm:h-3 md:w-4 md:h-4 text-purple-400 opacity-60 group-hover:opacity-100 transition-opacity duration-300" />
                </div>
              )}
            </div>
            
            {/* Bottom rim with glow - Mobile Responsive */}
            <div className="w-8 sm:w-12 md:w-16 h-0.5 sm:h-1 bg-gradient-to-r from-gray-700 via-gray-800 to-gray-700 rounded-b-sm shadow-lg"></div>
            
            {/* Hover glow effect */}
            <div className="absolute inset-0 rounded-lg bg-gradient-to-r from-purple-500/0 via-pink-500/0 to-blue-500/0 group-hover:from-purple-500/20 group-hover:via-pink-500/20 group-hover:to-blue-500/20 transition-all duration-300 pointer-events-none"></div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900 p-2 sm:p-4">
      <div className="max-w-7xl mx-auto">
        {/* Header with Railway styling */}
        <div className="bg-gray-800/50 backdrop-blur-xl border border-gray-700/50 rounded-2xl sm:rounded-3xl shadow-2xl p-4 sm:p-6 md:p-8 mb-4 sm:mb-6 md:mb-8">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 sm:gap-6 mb-4 sm:mb-6 md:mb-8">
            <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold bg-gradient-to-r from-purple-400 via-pink-400 to-blue-400 bg-clip-text text-transparent flex items-center">
              <div className="w-8 h-8 sm:w-10 sm:h-10 mr-3 sm:mr-4 bg-gradient-to-r from-purple-500 to-pink-500 rounded-xl flex items-center justify-center">
                <Package className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
              </div>
              Tote Inventory
            </h1>
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="text-xs sm:text-sm text-gray-300 bg-gray-700/50 px-3 sm:px-4 py-2 rounded-full border border-gray-600/50 flex items-center gap-2">
                <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
                <span className="text-purple-400 font-semibold">{totes.length}</span>
                <span className="text-gray-400 hidden sm:inline">/26 totes • Cloud Sync Active</span>
                <span className="text-gray-400 sm:hidden">/{totes.length} totes</span>
              </div>
              <button
                onClick={loadData}
                disabled={loading}
                className="p-2 text-purple-400 hover:text-purple-300 hover:bg-purple-500/20 rounded-lg transition-all duration-300 disabled:opacity-50"
                title="Refresh data"
              >
                <svg className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>
            </div>
          </div>

          <div className="relative">
            <Search className="absolute left-3 sm:left-4 top-1/2 transform -translate-y-1/2 text-purple-400 w-4 h-4 sm:w-5 sm:h-5" />
            <input
              type="text"
              placeholder="Search totes, positions, or items..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 sm:pl-12 pr-4 sm:pr-6 py-3 sm:py-4 bg-gray-700/50 backdrop-blur-xl border border-gray-600/50 rounded-xl sm:rounded-2xl focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500/50 text-white placeholder-gray-400 transition-all duration-300 text-sm sm:text-base"
            />
          </div>
        </div>

        {/* All Totes Dashboard with Railway styling */}
        <div className="bg-gray-800/50 backdrop-blur-xl border border-gray-700/50 rounded-2xl sm:rounded-3xl shadow-2xl p-4 sm:p-6 md:p-8">
          <div className="text-center mb-4 sm:mb-6 md:mb-8">
            <h2 className="text-xl sm:text-2xl font-bold bg-gradient-to-r from-yellow-400 to-yellow-600 bg-clip-text text-transparent mb-2">
              Storage Grid
            </h2>
            <div className="w-16 sm:w-20 h-1 bg-gradient-to-r from-purple-500 to-pink-500 rounded-full mx-auto"></div>
          </div>
          
          {/* Custom layout with Railway glass morphism - Mobile Optimized */}
          <div className="space-y-3 sm:space-y-4 md:space-y-6">
            {/* Row 1: A1, B1, [empty], [empty], [empty], F1, G1 */}
            <div className="flex justify-center gap-2 sm:gap-4 md:gap-6">
              <div className="w-12 sm:w-16 md:w-20 flex justify-center">
                <ToteCard position="A1" tote={grouped["A1"]?.[0]} onClick={() => handleToteClick("A1", grouped["A1"]?.[0])} />
              </div>
              <div className="w-12 sm:w-16 md:w-20 flex justify-center">
                <ToteCard position="B1" tote={grouped["B1"]?.[0]} onClick={() => handleToteClick("B1", grouped["B1"]?.[0])} />
              </div>
              <div className="w-12 sm:w-16 md:w-20 flex justify-center opacity-30">
                <div className="w-8 sm:w-12 md:w-16 h-8 sm:h-12 md:h-16 border-2 border-dashed border-gray-600/30 rounded-lg"></div>
              </div>
              <div className="w-12 sm:w-16 md:w-20 flex justify-center opacity-30">
                <div className="w-8 sm:w-12 md:w-16 h-8 sm:h-12 md:h-16 border-2 border-dashed border-gray-600/30 rounded-lg"></div>
              </div>
              <div className="w-12 sm:w-16 md:w-20 flex justify-center opacity-30">
                <div className="w-8 sm:w-12 md:w-16 h-8 sm:h-12 md:h-16 border-2 border-dashed border-gray-600/30 rounded-lg"></div>
              </div>
              <div className="w-12 sm:w-16 md:w-20 flex justify-center">
                <ToteCard position="F1" tote={grouped["F1"]?.[0]} onClick={() => handleToteClick("F1", grouped["F1"]?.[0])} />
              </div>
              <div className="w-12 sm:w-16 md:w-20 flex justify-center">
                <ToteCard position="G1" tote={grouped["G1"]?.[0]} onClick={() => handleToteClick("G1", grouped["G1"]?.[0])} />
              </div>
            </div>

            {/* Row 2: A2, B2, [empty], [empty], [empty], F2, G2 */}
            <div className="flex justify-center gap-2 sm:gap-4 md:gap-6">
              <div className="w-12 sm:w-16 md:w-20 flex justify-center">
                <ToteCard position="A2" tote={grouped["A2"]?.[0]} onClick={() => handleToteClick("A2", grouped["A2"]?.[0])} />
              </div>
              <div className="w-12 sm:w-16 md:w-20 flex justify-center">
                <ToteCard position="B2" tote={grouped["B2"]?.[0]} onClick={() => handleToteClick("B2", grouped["B2"]?.[0])} />
              </div>
              <div className="w-12 sm:w-16 md:w-20 flex justify-center opacity-30">
                <div className="w-8 sm:w-12 md:w-16 h-8 sm:h-12 md:h-16 border-2 border-dashed border-gray-600/30 rounded-lg"></div>
              </div>
              <div className="w-12 sm:w-16 md:w-20 flex justify-center opacity-30">
                <div className="w-8 sm:w-12 md:w-16 h-8 sm:h-12 md:h-16 border-2 border-dashed border-gray-600/30 rounded-lg"></div>
              </div>
              <div className="w-12 sm:w-16 md:w-20 flex justify-center opacity-30">
                <div className="w-8 sm:w-12 md:w-16 h-8 sm:h-12 md:h-16 border-2 border-dashed border-gray-600/30 rounded-lg"></div>
              </div>
              <div className="w-12 sm:w-16 md:w-20 flex justify-center">
                <ToteCard position="F2" tote={grouped["F2"]?.[0]} onClick={() => handleToteClick("F2", grouped["F2"]?.[0])} />
              </div>
              <div className="w-12 sm:w-16 md:w-20 flex justify-center">
                <ToteCard position="G2" tote={grouped["G2"]?.[0]} onClick={() => handleToteClick("G2", grouped["G2"]?.[0])} />
              </div>
            </div>

            {/* Row 3: A3, B3, [empty], [empty], [empty], F3, G3 */}
            <div className="flex justify-center gap-2 sm:gap-4 md:gap-6">
              <div className="w-12 sm:w-16 md:w-20 flex justify-center">
                <ToteCard position="A3" tote={grouped["A3"]?.[0]} onClick={() => handleToteClick("A3", grouped["A3"]?.[0])} />
              </div>
              <div className="w-12 sm:w-16 md:w-20 flex justify-center">
                <ToteCard position="B3" tote={grouped["B3"]?.[0]} onClick={() => handleToteClick("B3", grouped["B3"]?.[0])} />
              </div>
              <div className="w-12 sm:w-16 md:w-20 flex justify-center opacity-30">
                <div className="w-8 sm:w-12 md:w-16 h-8 sm:h-12 md:h-16 border-2 border-dashed border-gray-600/30 rounded-lg"></div>
              </div>
              <div className="w-12 sm:w-16 md:w-20 flex justify-center opacity-30">
                <div className="w-8 sm:w-12 md:w-16 h-8 sm:h-12 md:h-16 border-2 border-dashed border-gray-600/30 rounded-lg"></div>
              </div>
              <div className="w-12 sm:w-16 md:w-20 flex justify-center opacity-30">
                <div className="w-8 sm:w-12 md:w-16 h-8 sm:h-12 md:h-16 border-2 border-dashed border-gray-600/30 rounded-lg"></div>
              </div>
              <div className="w-12 sm:w-16 md:w-20 flex justify-center">
                <ToteCard position="F3" tote={grouped["F3"]?.[0]} onClick={() => handleToteClick("F3", grouped["F3"]?.[0])} />
              </div>
              <div className="w-12 sm:w-16 md:w-20 flex justify-center">
                <ToteCard position="G3" tote={grouped["G3"]?.[0]} onClick={() => handleToteClick("G3", grouped["G3"]?.[0])} />
              </div>
            </div>

            {/* Row 4: A4, B4, C4, D4, E4, F4, G4 */}
            <div className="flex justify-center gap-2 sm:gap-4 md:gap-6">
              <div className="w-12 sm:w-16 md:w-20 flex justify-center">
                <ToteCard position="A4" tote={grouped["A4"]?.[0]} onClick={() => handleToteClick("A4", grouped["A4"]?.[0])} />
              </div>
              <div className="w-12 sm:w-16 md:w-20 flex justify-center">
                <ToteCard position="B4" tote={grouped["B4"]?.[0]} onClick={() => handleToteClick("B4", grouped["B4"]?.[0])} />
              </div>
              <div className="w-12 sm:w-16 md:w-20 flex justify-center">
                <ToteCard position="C4" tote={grouped["C4"]?.[0]} onClick={() => handleToteClick("C4", grouped["C4"]?.[0])} />
              </div>
              <div className="w-12 sm:w-16 md:w-20 flex justify-center">
                <ToteCard position="D4" tote={grouped["D4"]?.[0]} onClick={() => handleToteClick("D4", grouped["D4"]?.[0])} />
              </div>
              <div className="w-12 sm:w-16 md:w-20 flex justify-center">
                <ToteCard position="E4" tote={grouped["E4"]?.[0]} onClick={() => handleToteClick("E4", grouped["E4"]?.[0])} />
              </div>
              <div className="w-12 sm:w-16 md:w-20 flex justify-center">
                <ToteCard position="F4" tote={grouped["F4"]?.[0]} onClick={() => handleToteClick("F4", grouped["F4"]?.[0])} />
              </div>
              <div className="w-12 sm:w-16 md:w-20 flex justify-center">
                <ToteCard position="G4" tote={grouped["G4"]?.[0]} onClick={() => handleToteClick("G4", grouped["G4"]?.[0])} />
              </div>
            </div>

            {/* Row 5: A5, B5, C5, D5, E5, F5, G5 */}
            <div className="flex justify-center gap-2 sm:gap-4 md:gap-6">
              <div className="w-12 sm:w-16 md:w-20 flex justify-center">
                <ToteCard position="A5" tote={grouped["A5"]?.[0]} onClick={() => handleToteClick("A5", grouped["A5"]?.[0])} />
              </div>
              <div className="w-12 sm:w-16 md:w-20 flex justify-center">
                <ToteCard position="B5" tote={grouped["B5"]?.[0]} onClick={() => handleToteClick("B5", grouped["B5"]?.[0])} />
              </div>
              <div className="w-12 sm:w-16 md:w-20 flex justify-center">
                <ToteCard position="C5" tote={grouped["C5"]?.[0]} onClick={() => handleToteClick("C5", grouped["C5"]?.[0])} />
              </div>
              <div className="w-12 sm:w-16 md:w-20 flex justify-center">
                <ToteCard position="D5" tote={grouped["D5"]?.[0]} onClick={() => handleToteClick("D5", grouped["D5"]?.[0])} />
              </div>
              <div className="w-12 sm:w-16 md:w-20 flex justify-center">
                <ToteCard position="E5" tote={grouped["E5"]?.[0]} onClick={() => handleToteClick("E5", grouped["E5"]?.[0])} />
              </div>
              <div className="w-12 sm:w-16 md:w-20 flex justify-center">
                <ToteCard position="F5" tote={grouped["F5"]?.[0]} onClick={() => handleToteClick("F5", grouped["F5"]?.[0])} />
              </div>
              <div className="w-12 sm:w-16 md:w-20 flex justify-center">
                <ToteCard position="G5" tote={grouped["G5"]?.[0]} onClick={() => handleToteClick("G5", grouped["G5"]?.[0])} />
              </div>
            </div>
          </div>

          {/* Column labels with Railway styling - Mobile Optimized */}
          <div className="mt-4 sm:mt-6 md:mt-8 flex justify-center gap-2 sm:gap-4 md:gap-6 text-xs sm:text-sm font-bold">
            <div className="w-12 sm:w-16 md:w-20 text-center text-purple-400">A</div>
            <div className="w-12 sm:w-16 md:w-20 text-center text-purple-400">B</div>
            <div className="w-12 sm:w-16 md:w-20 text-center text-gray-500">C</div>
            <div className="w-12 sm:w-16 md:w-20 text-center text-gray-500">D</div>
            <div className="w-12 sm:w-16 md:w-20 text-center text-gray-500">E</div>
            <div className="w-12 sm:w-16 md:w-20 text-center text-purple-400">F</div>
            <div className="w-12 sm:w-16 md:w-20 text-center text-purple-400">G</div>
          </div>

          {/* Position breakdown with Railway styling */}
          <div className="mt-8 pt-8 border-t border-gray-700/50">
            <div className="text-center">
              <div className="text-lg font-bold bg-gradient-to-r from-gray-300 to-gray-400 bg-clip-text text-transparent mb-2">
                Storage Configuration
              </div>
              <div className="text-gray-400 text-sm">
                A & B columns: 5 levels each • C, D, E columns: 2 levels each (4 & 5) • F & G columns: 5 levels each
              </div>
            </div>
          </div>
        </div>

        {/* Legend with Railway styling - Mobile Optimized */}
        <div className="bg-gray-800/50 backdrop-blur-xl border border-gray-700/50 rounded-2xl sm:rounded-3xl shadow-2xl p-4 sm:p-6 mt-4 sm:mt-6 md:mt-8">
          <h3 className="text-lg sm:text-xl font-bold bg-gradient-to-r from-yellow-400 to-yellow-600 bg-clip-text text-transparent mb-4 sm:mb-6 text-center">
            Quick Guide
          </h3>
          <div className="flex gap-4 sm:gap-8 flex-wrap justify-center">
            <div className="flex items-center gap-2 sm:gap-3 bg-gray-700/30 p-3 sm:p-4 rounded-xl sm:rounded-2xl border border-gray-600/30">
              <div className="flex flex-col items-center">
                <div className="w-8 sm:w-10 md:w-12 h-1.5 sm:h-2 bg-gradient-to-br from-yellow-300 to-yellow-500 rounded-t border border-yellow-500/30"></div>
                <div className="w-8 sm:w-10 md:w-12 h-6 sm:h-7 md:h-8 bg-gradient-to-br from-gray-700/90 to-gray-900/90 border border-gray-600/30 backdrop-blur-xl flex items-center justify-center relative">
                  <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent"></div>
                  <div className="text-purple-300 text-xs sm:text-sm font-bold z-10">Items</div>
                </div>
                <div className="w-8 sm:w-10 md:w-12 h-0.5 bg-gray-700"></div>
              </div>
              <span className="text-xs sm:text-sm text-gray-300 font-medium">Occupied Tote</span>
            </div>
            <div className="flex items-center gap-2 sm:gap-3 bg-gray-700/30 p-3 sm:p-4 rounded-xl sm:rounded-2xl border border-gray-600/30">
              <div className="flex flex-col items-center">
                <div className="w-8 sm:w-10 md:w-12 h-1.5 sm:h-2 bg-gradient-to-br from-yellow-300 to-yellow-500 rounded-t border border-yellow-500/30"></div>
                <div className="w-8 sm:w-10 md:w-12 h-6 sm:h-7 md:h-8 bg-gradient-to-br from-gray-700/90 to-gray-900/90 border border-gray-600/30 backdrop-blur-xl flex items-center justify-center relative">
                  <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent"></div>
                  <Plus className="w-2 sm:w-2.5 md:w-3 h-2 sm:h-2.5 md:h-3 text-purple-400 z-10" />
                </div>
                <div className="w-8 sm:w-10 md:w-12 h-0.5 bg-gray-700"></div>
              </div>
              <span className="text-xs sm:text-sm text-gray-300 font-medium">Empty Position</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}