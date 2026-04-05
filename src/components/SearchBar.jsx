import { Search } from "lucide-react";

export default function SearchBar({ value, onChange }) {
  return (
    <div className="relative">
      <Search className="absolute left-3 sm:left-4 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4 sm:w-5 sm:h-5" />
      <input
        type="text"
        placeholder="Search totes, positions, or items..."
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="apple-input w-full pl-10 sm:pl-12"
      />
    </div>
  );
}
