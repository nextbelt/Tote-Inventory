import { Search, X } from "lucide-react";

export default function SearchBar({ value, onChange }) {
  return (
    <div className="relative">
      <Search
        className="absolute left-3 sm:left-4 top-1/2 h-4 w-4 sm:h-5 sm:w-5 -translate-y-1/2 text-gray-400 dark:text-gray-500"
        aria-hidden="true"
      />
      <input
        type="search"
        inputMode="search"
        enterKeyHint="search"
        autoComplete="off"
        aria-label="Search totes and items"
        placeholder="Where is it? Search anything…"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="apple-input w-full pl-10 sm:pl-12 pr-11 [&::-webkit-search-cancel-button]:hidden"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Clear search"
          className="absolute right-1 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full text-gray-400 dark:text-gray-500"
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
