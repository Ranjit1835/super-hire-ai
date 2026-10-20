// Monaco code editor for the runner: external paste blocked and reported, large insertions / typing
// bursts reported, every change logged as compact edit events for edit_history (replay later).
// Uncontrolled after mount: the parent remounts it (key = question + language) to switch content.
import { useEffect, useRef } from "react";
import Editor, { type OnMount } from "@monaco-editor/react";
import type { EditEvent } from "./autosave";
import { attachPasteGuard, createTypingMonitor } from "./pasteGuard";

type MonacoEditor = Parameters<OnMount>[0];

const MONACO_LANG: Record<string, string> = { python: "python", java: "java", cpp: "cpp", c: "c", javascript: "javascript" };

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
    <div ref={box} className="h-full min-h-[320px] border border-border rounded-md overflow-hidden" data-testid="code-editor">
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
  );
}

export default CodeEditor;
