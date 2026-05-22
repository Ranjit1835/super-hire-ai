import { PERSONAS, type PersonaId } from "../../types/studio.types";

interface PersonaSelectorProps {
  selected: PersonaId;
  onChange: (persona: PersonaId) => void;
}

export function PersonaSelector({ selected, onChange }: PersonaSelectorProps) {
  return (
    <div className="flex items-center gap-1.5 px-3 py-2 overflow-x-auto scrollbar-hide">
      {Object.values(PERSONAS).map((p) => (
        <button
          key={p.id}
          onClick={() => onChange(p.id)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all duration-200 ${
            selected === p.id
              ? "bg-gradient-to-r from-violet-600 to-cyan-600 text-white shadow-lg shadow-violet-500/20"
              : "bg-white/5 text-slate-400 hover:bg-white/10 hover:text-white border border-white/5"
          }`}
        >
          <span>{p.icon}</span>
          <span>{p.name}</span>
        </button>
      ))}
    </div>
  );
}
