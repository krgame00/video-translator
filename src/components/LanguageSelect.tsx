'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Languages, ChevronDown, Check } from 'lucide-react';

export interface LanguageOption {
  code: string;
  label: string;
  local: string;
  flag: string;
}

export const LANGUAGES: LanguageOption[] = [
  { code: 'th', label: 'ภาษาไทย', local: 'ไทย', flag: '🇹🇭' },
  { code: 'en', label: 'English', local: 'EN', flag: '🇺🇸' },
  { code: 'ja', label: '日本語', local: '日本語', flag: '🇯🇵' },
  { code: 'zh', label: '中文', local: '中文', flag: '🇨🇳' },
  { code: 'ko', label: '한국어', local: '한국어', flag: '🇰🇷' },
];

interface LanguageSelectProps {
  value: string;
  onChange: (code: string) => void;
  disabled?: boolean;
}

export const LanguageSelect: React.FC<LanguageSelectProps> = ({
  value,
  onChange,
  disabled = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const currentLang = LANGUAGES.find((l) => l.code === value) || LANGUAGES[0];

  // Close when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  // Close on Escape key
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  return (
    <div className="relative inline-block text-left shrink-0" ref={containerRef}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen(!isOpen)}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        className="flex items-center gap-1.5 sm:gap-2 px-2 sm:px-2.5 py-1.5 rounded-lg bg-zinc-950 hover:bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-xs text-zinc-200 hover:text-white transition-all shadow-sm focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        title="เลือกภาษาปลายทางสำหรับแปลซับไตเติล"
      >
        <Languages className="w-3.5 h-3.5 text-blue-400 shrink-0" />
        <span className="text-sm leading-none">{currentLang.flag}</span>
        <span className="font-medium text-zinc-100 hidden sm:inline">{currentLang.label}</span>
        <span className="font-medium text-zinc-100 sm:hidden">{currentLang.local}</span>
        <ChevronDown
          className={`w-3.5 h-3.5 text-zinc-400 transition-transform duration-200 shrink-0 ${
            isOpen ? 'rotate-180 text-blue-400' : ''
          }`}
        />
      </button>

      {isOpen && (
        <div
          role="listbox"
          className="absolute left-0 top-full mt-1.5 w-48 py-1.5 px-1 bg-zinc-900 border border-zinc-750 border-zinc-700/80 rounded-xl shadow-2xl z-50 animate-in fade-in-50 zoom-in-95 duration-150 backdrop-blur-xl"
        >
          <div className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-400 border-b border-zinc-800/80 mb-1">
            Target Language (แปลเป็น)
          </div>
          {LANGUAGES.map((lang) => {
            const isSelected = lang.code === value;
            return (
              <button
                key={lang.code}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => {
                  onChange(lang.code);
                  setIsOpen(false);
                }}
                className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-colors cursor-pointer text-left ${
                  isSelected
                    ? 'bg-blue-600/20 text-blue-300 font-semibold'
                    : 'text-zinc-200 hover:bg-zinc-800/90 hover:text-white'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-base leading-none">{lang.flag}</span>
                  <span className="font-medium">{lang.label}</span>
                </div>
                {isSelected && <Check className="w-3.5 h-3.5 text-blue-400 shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
