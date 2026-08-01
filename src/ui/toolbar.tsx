"use client";

import { Search } from "lucide-react";

/**
 * The one list-filter toolbar. Filtering is presentation: which rows exist is the
 * server's answer; what the viewer may do with one is the domain's. Escape clears.
 */
export function FilterToolbar({
  value,
  onChange,
  placeholder,
  label
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  label: string;
}) {
  return (
    <div className="list-toolbar">
      <Search size={14} aria-hidden />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onChange("");
        }}
        placeholder={placeholder}
        aria-label={label}
      />
    </div>
  );
}
