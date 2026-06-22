"use client";

export type UnderlineTabItem = {
  value: string;
  label: string;
};

interface UnderlineTabsProps {
  tabs: UnderlineTabItem[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

/**
 * テキスト＋下線のタブ（MUI風）。選択中は青文字＋青い下線、非選択はグレー文字。
 */
export function UnderlineTabs({ tabs, value, onChange, className }: UnderlineTabsProps) {
  return (
    <div className={className}>
      <div className="flex gap-6 border-b border-slate-200">
        {tabs.map((t) => {
          const isActive = value === t.value;
          return (
            <button
              key={t.value}
              type="button"
              onClick={() => onChange(t.value)}
              className={`
                relative pb-3 pt-0.5 text-sm font-medium transition-colors
                ${isActive ? "text-blue-600" : "text-slate-600 hover:text-slate-900"}
              `}
            >
              {t.label}
              {isActive && (
                <span
                  className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600"
                  aria-hidden
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
