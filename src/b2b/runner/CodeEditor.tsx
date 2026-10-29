// Monaco code editor for the runner: external paste blocked and reported, large insertions / typing
// bursts reported, every change logged as compact edit events for edit_history (replay later).
// Uncontrolled after mount: the parent remounts it (key = question + language) to switch content.
import { useEffect, useRef } from "react";
import Editor, { type OnMount } from "@monaco-editor/react";
import type { EditEvent } from "./autosave";
import { attachPasteGuard, createTypingMonitor } from "./pasteGuard";

type MonacoEditor = Parameters<OnMount>[0];

const MONACO_LANG: Record<string, string> = { python: "python", java: "java", cpp: "cpp", c: "c", javascript: "javascript" };
const LANGUAGE_LABEL: Record<string, string> = { python: "Python 3", java: "Java", cpp: "C++", c: "C", javascript: "JavaScript" };

export interface CodeEditorProps {
  language: string;
  value: string;
  onChange: (code: string, edits: EditEvent[]) => void;
  onBlur?: () => void;
  onSignal: (type: "paste_attempt" | "large_paste" | "typing_burst", meta: Record<string, unknown>) => void;
  readOnly?: boolean;
}

export function CodeEditor({ language, value, onChange, onBlur, onSignal, readOnly }: CodeEditorProps) {
  const box = useRef<HTMLDivElement>(null);
  const editorRef = useRef<MonacoEditor | null>(null);
  const cb = useRef({ onChange, onBlur, onSignal });
  cb.current = { onChange, onBlur, onSignal };
  const monitor = useRef(createTypingMonitor((type, meta) => cb.current.onSignal(type, meta)));

  useEffect(() => {
    if (!box.current) return;
    return attachPasteGuard(box.current, {
      getSelectionText: () => {
        const ed = editorRef.current;
        const sel = ed?.getSelection();
        return ed && sel ? ed.getModel()?.getValueInRange(sel) ?? "" : window.getSelection()?.toString() ?? "";
      },
      onBlocked: ({ length }) => cb.current.onSignal("paste_attempt", { length, blocked: true }),
      onAllowed: () => monitor.current.allowNextInsert(),
    });
  }, []);

  const onMount: OnMount = (editor) => {
    editorRef.current = editor;
    editor.onDidChangeModelContent((e) => {
      const t = Date.now();
      const edits: EditEvent[] = [];
      for (const c of e.changes) {
        if (c.rangeLength > 0) edits.push({ t, op: "del", at: c.rangeOffset, len: c.rangeLength });
        if (c.text.length > 0) {
          edits.push({ t, op: "ins", at: c.rangeOffset, text: c.text.slice(0, 20_000) });
          monitor.current.onInsert(c.text.length);
        }
      }
      cb.current.onChange(editor.getValue(), edits);
    });
    editor.onDidBlurEditorText(() => cb.current.onBlur?.());
  };

  return (
    <div ref={box} className="h-full min-h-[320px] flex flex-col shadow-[inset_0_0_0_1px_var(--hr-rule)] bg-[var(--hr-surface)]" data-testid="code-editor">
      <div className="flex items-center gap-2 px-3 h-9 shrink-0 hr-rule-b">
        <span className="hr-data text-xs text-[var(--hr-muted)]">{LANGUAGE_LABEL[language] ?? language}</span>
        <span className="ml-auto">{readOnly && <span className="hr-label !text-[10px]">Paused</span>}</span>
      </div>
      <div className="flex-1 min-h-0">
        <Editor
          height="100%"
          language={MONACO_LANG[language] ?? "plaintext"}
          defaultValue={value}
          onMount={onMount}
          theme="vs-dark"
          options={{
            readOnly, minimap: { enabled: false }, fontSize: 14, scrollBeyondLastLine: false, automaticLayout: true,
            // The context-menu "Paste" reads the clipboard directly (no paste event), and drag-and-drop can carry
            // outside text in: both off so the paste guard sees every paste.
            contextmenu: false, dragAndDrop: false, dropIntoEditor: { enabled: false }, pasteAs: { enabled: false },
            tabSize: 4,
          }}
        />
      </div>
    </div>
  );
}

export default CodeEditor;
