"use client";

import { useState } from "react";

interface CityInputCardProps {
  message?: string;
  onSubmit: (city: string) => void;
  disabled?: boolean;
}

export function CityInputCard({ message, onSubmit, disabled }: CityInputCardProps) {
  const [city, setCity] = useState("");

  const handleSubmit = () => {
    const trimmed = city.trim();
    if (trimmed && !disabled) {
      onSubmit(trimmed);
    }
  };

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-amber-600">📍</span>
        <p className="text-sm text-amber-700">
          {message || "请输入正确的城市名称"}
        </p>
      </div>
      <div className="flex gap-2">
        <input
          value={city}
          onChange={(e) => setCity(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSubmit();
          }}
          placeholder="例如：北京、上海、深圳"
          disabled={disabled}
          className="flex-1 border border-amber-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent disabled:bg-gray-100 disabled:cursor-not-allowed"
          autoFocus
        />
        <button
          onClick={handleSubmit}
          disabled={!city.trim() || disabled}
          className="bg-amber-500 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-amber-600 active:bg-amber-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          确认
        </button>
      </div>
    </div>
  );
}
