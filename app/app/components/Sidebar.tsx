"use client";

import { useRef, useState } from "react";
import { API_URL, type DocFile } from "../types";

const ACCEPTED = [".txt", ".md", ".csv", ".json", ".log", ".html", ".xml"];

export default function Sidebar({
  docs,
  onChanged,
}: {
  docs: DocFile[];
  onChanged: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);

  async function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    setUploading(true);
    try {
      for (const file of Array.from(fileList)) {
        const form = new FormData();
        form.append("file", file);
        await fetch(`${API_URL}/documents`, { method: "POST", body: form });
      }
      onChanged();
    } finally {
      setUploading(false);
    }
  }

  async function remove(id: string) {
    await fetch(`${API_URL}/documents/${id}`, { method: "DELETE" });
    onChanged();
  }

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">#</div>
        <div className="brand-name">DemoAI</div>
      </div>

      <div
        className={`upload-zone${dragging ? " dragging" : ""}`}
        onClick={() => !uploading && inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          handleFiles(e.dataTransfer.files);
        }}
      >
        <strong>{uploading ? "Загрузка…" : "Загрузить документы"}</strong>
        <small>Перетащите или нажмите — {ACCEPTED.join(", ")}</small>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPTED.join(",")}
          style={{ display: "none" }}
          onChange={(e) => {
            handleFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      <div className="sidebar-section-title">
        Документы {docs.length > 0 && `(${docs.length})`}
      </div>

      <ul className="doc-list">
        {docs.length === 0 && (
          <li className="doc-empty">Пока нет загруженных документов.</li>
        )}
        {docs.map((doc) => (
          <li key={doc.id} className="doc-item">
            <div className="doc-icon">TXT</div>
            <div className="doc-meta">
              <div className="doc-name" title={doc.name}>
                {doc.name}
              </div>
              <div className="doc-size">{doc._count.chunks} чанков</div>
            </div>
            <button
              className="doc-remove"
              onClick={() => remove(doc.id)}
              aria-label={`Удалить ${doc.name}`}
              title="Удалить"
            >
              ×
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}
