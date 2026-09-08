import React, { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faNoteSticky, faPlus, faXmark } from "@fortawesome/free-solid-svg-icons";
import { API_BASE_URL } from "../../config";
import { formatDate } from "../../dateFormat";

// Quick scratch notes for the signed-in user.
//
// Stored server-side and private to the author, so they follow the user to any
// machine. They used to live in localStorage, which meant they vanished the
// moment someone switched browsers.
const legacyKey = () =>
  `crm_sidebar_notes_${sessionStorage.getItem("userId") || "default"}`;

function SidebarNotes() {
  const [notes, setNotes] = useState([]);
  const [draft, setDraft] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState(null);
  const inputRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const res = await axios.get(`${API_BASE_URL}/api/notes`);
      setNotes(res.data || []);
      setError(null);
    } catch (err) {
      setError("Could not load notes");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // One-time migration: push anything left in localStorage up to the server so
  // notes written before this change are not lost, then clear the old store.
  useEffect(() => {
    const migrate = async () => {
      let stale = [];
      try {
        stale = JSON.parse(localStorage.getItem(legacyKey()) || "[]");
      } catch (err) {
        stale = [];
      }
      if (!Array.isArray(stale) || stale.length === 0) return;

      try {
        // Oldest first, so the server's ordering matches what the user saw.
        for (const note of [...stale].reverse()) {
          if (note?.text) {
            await axios.post(`${API_BASE_URL}/api/notes`, { text: note.text });
          }
        }
        localStorage.removeItem(legacyKey());
        load();
      } catch (err) {
        // Leave the local copy in place and try again next time.
      }
    };
    migrate();
  }, [load]);

  const addNote = async () => {
    const text = draft.trim();
    if (!text || isSaving) return;
    setIsSaving(true);
    try {
      const res = await axios.post(`${API_BASE_URL}/api/notes`, { text });
      setNotes((prev) => [res.data, ...prev]);
      setDraft("");
      setError(null);
      inputRef.current?.focus();
    } catch (err) {
      setError("Could not save note");
    } finally {
      setIsSaving(false);
    }
  };

  const removeNote = async (id) => {
    const previous = notes;
    setNotes((prev) => prev.filter((n) => n.id !== id));
    try {
      await axios.delete(`${API_BASE_URL}/api/notes/${id}`);
    } catch (err) {
      // Put it back rather than pretending the delete worked.
      setNotes(previous);
      setError("Could not delete note");
    }
  };

  // Enter saves, Shift+Enter makes a new line — the box is small, so most
  // notes are one line.
  const onKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      addNote();
    }
  };

  return (
    <section className="sidebar-notes">
      <header className="sidebar-notes-head">
        <h3>
          <FontAwesomeIcon icon={faNoteSticky} /> Notes
        </h3>
        {notes.length > 0 && (
          <span className="sidebar-notes-count">{notes.length}</span>
        )}
      </header>

      <div className="sidebar-notes-compose">
        <textarea
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Write a note…"
          rows={3}
          aria-label="New note"
        />
        <button
          type="button"
          className="sidebar-notes-add"
          onClick={addNote}
          disabled={!draft.trim() || isSaving}
          title="Save note"
        >
          <FontAwesomeIcon icon={faPlus} />
        </button>
      </div>

      <div className="sidebar-notes-list">
        {error && <p className="sidebar-notes-empty">{error}</p>}
        {!error && notes.length === 0 ? (
          <p className="sidebar-notes-empty">No notes yet.</p>
        ) : (
          notes.map((note) => (
            <article className="sidebar-note" key={note.id}>
              <p>{note.text}</p>
              <div className="sidebar-note-foot">
                <span>
                  {formatDate(note.createdAt)}
                </span>
                <button
                  type="button"
                  onClick={() => removeNote(note.id)}
                  title="Delete note"
                  aria-label="Delete note"
                >
                  <FontAwesomeIcon icon={faXmark} />
                </button>
              </div>
            </article>
          ))
        )}
      </div>
    </section>
  );
}

export default SidebarNotes;
