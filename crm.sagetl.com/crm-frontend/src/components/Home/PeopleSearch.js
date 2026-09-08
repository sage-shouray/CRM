import React, { useEffect, useRef, useState } from "react";
import axios from "axios";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faSearch, faUser, faBuilding } from "@fortawesome/free-solid-svg-icons";
import LeadDetails from "../Leads/LeadDetails";
import { API_BASE_URL } from "../../config";
import "./PeopleSearch.css";

const authHeaders = () => ({
  headers: { Authorization: `Bearer ${sessionStorage.getItem("token")}` },
});

// Search by the contact's own name — sometimes the company slips your mind
// before the person you actually spoke to does. Shows which company they sit
// under and whether that contact is still marked active there.
function PeopleSearch() {
  const [term, setTerm] = useState("");
  const [results, setResults] = useState([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [openLeadNumber, setOpenLeadNumber] = useState(null);
  const boxRef = useRef(null);
  const debounceRef = useRef(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = term.trim();
    if (q.length < 2) {
      setResults([]);
      setIsOpen(false);
      return;
    }
    debounceRef.current = setTimeout(() => {
      setIsLoading(true);
      axios
        .get(`${API_BASE_URL}/api/contacts/search`, { ...authHeaders(), params: { q } })
        .then((res) => {
          setResults(res.data || []);
          setIsOpen(true);
        })
        .catch((err) => console.error("Error searching people:", err))
        .finally(() => setIsLoading(false));
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [term]);

  useEffect(() => {
    const onClickOutside = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setIsOpen(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  return (
    <div className="people-search" ref={boxRef}>
      <div className="people-search-box">
        <FontAwesomeIcon icon={faSearch} className="people-search-icon" />
        <input
          type="text"
          placeholder="Search by contact person's name…"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          onFocus={() => results.length > 0 && setIsOpen(true)}
        />
      </div>

      {isOpen && (
        <div className="people-search-results">
          {isLoading ? (
            <p className="people-search-empty">Searching…</p>
          ) : results.length === 0 ? (
            <p className="people-search-empty">No contact matches "{term.trim()}".</p>
          ) : (
            results.map((r, i) => (
              <button
                type="button"
                className="people-search-item"
                key={`${r.leadNumber}-${r.role}-${i}`}
                onClick={() => {
                  setOpenLeadNumber(r.leadNumber);
                  setIsOpen(false);
                }}
              >
                <FontAwesomeIcon icon={faUser} className="people-search-item-icon" />
                <div className="people-search-item-body">
                  <div className="people-search-item-top">
                    <span className="people-search-name">{r.personName}</span>
                    <span
                      className={`people-search-status ${r.active ? "is-active" : "is-inactive"}`}
                    >
                      {r.active ? "Active" : "Inactive"}
                    </span>
                  </div>
                  <span className="people-search-sub">
                    <FontAwesomeIcon icon={faBuilding} />
                    {r.companyName || `Lead #${r.leadNumber}`}
                    {r.role ? ` · ${r.role}` : ""}
                    {r.city ? ` · ${r.city}` : ""}
                  </span>
                </div>
              </button>
            ))
          )}
        </div>
      )}

      {openLeadNumber && (
        <LeadDetails leadNumber={openLeadNumber} onClose={() => setOpenLeadNumber(null)} />
      )}
    </div>
  );
}

export default PeopleSearch;
