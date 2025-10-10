
import React from 'react';

interface TextInputProps {
  label?: string;
  id: string;
  value: string | number;
  onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  placeholder?: string;
  type?: 'text' | 'password' | 'url' | 'number';
  min?: number;
  max?: number;
  multiline?: boolean;
  rows?: number;
}

export const TextInput: React.FC<TextInputProps> = ({
  label,
  id,
  value,
  onChange,
  placeholder,
  type = 'text',
  min,
  max,
  multiline = false,
  rows = 4,
}) => {
  const normalizedValue = value === undefined || value === null ? '' : value;
  const textareaValue =
    typeof normalizedValue === 'number'
      ? String(normalizedValue)
      : normalizedValue;

  return (
    <div>
      {label && (
        <label htmlFor={id} className="block text-sm font-medium text-slate-300 mb-1">
          {label}
        </label>
      )}
      {multiline ? (
        <textarea
          id={id}
          value={textareaValue}
          onChange={onChange}
          placeholder={placeholder}
          rows={rows}
          className="w-full bg-slate-700 border border-slate-600 rounded-md shadow-sm py-2 px-3 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition"
        />
      ) : (
        <input
          type={type}
          id={id}
          value={normalizedValue}
          onChange={onChange}
          placeholder={placeholder}
          min={min}
          max={max}
          className="w-full bg-slate-700 border border-slate-600 rounded-md shadow-sm py-2 px-3 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition"
        />
      )}
    </div>
  );
};
