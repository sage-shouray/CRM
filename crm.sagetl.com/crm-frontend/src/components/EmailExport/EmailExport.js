import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faEnvelope, faDownload, faFilter, faChevronDown } from "@fortawesome/free-solid-svg-icons";
import { API_BASE_URL } from "../../config";
import "./EmailExport.css";

const authHeaders = () => ({
  headers: { Authorization: `Bearer ${sessionStorage.getItem("token")}` },
});

const ROLE_OPTIONS = ["IT", "Finance", "Business Head", "Other"];
const STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
];

// Escapes one CSV cell: wraps in quotes and doubles any inner quote, only
// when the value actually needs it (contains a comma, quote, or newline).
const csvCell = (value) => {
  const s = String(value ?? "");
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};

// A checkbox-list dropdown for picking several values at once — none picked
// means "no filter", same as the single-select's "All" option used to mean.
function MultiSelectDropdown({ label, icon, options, selected, onChange, allLabel }) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onOutside = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, [open]);

  const toggleValue = (value) => {
    if (selected.includes(value)) onChange(selected.filter((v) => v !== value));
    else onChange([...selected, value]);
  };

  const summary =
    selected.length === 0
      ? allLabel
      : selected.length === 1
      ? selected[0]
      : `${selected.length} selected`;

  return (
    <div className="ee-filter ee-multiselect" ref={boxRef}>
      <label>
        {icon && <FontAwesomeIcon icon={icon} />} {label}
      </label>
      <button
        type="button"
        className="ee-multiselect-trigger"
        onClick={() => setOpen((o) => !o)}
      >
        <span>{summary}</span>
        <FontAwesomeIcon icon={faChevronDown} className={open ? "is-open" : ""} />
      </button>

      {open && (
        <div className="ee-multiselect-panel">
          <button
            type="button"
            className="ee-multiselect-clear"
            onClick={() => onChange([])}
            disabled={selected.length === 0}
          >
            Clear ({allLabel})
          </button>
          <div className="ee-multiselect-options">
            {options.map((opt) => {
              const value = typeof opt === "string" ? opt : opt.value;
              const optLabel = typeof opt === "string" ? opt : opt.label;
              return (
                <label className="ee-multiselect-option" key={value}>
                  <input
                    type="checkbox"
                    checked={selected.includes(value)}
                    onChange={() => toggleValue(value)}
                  />
                  <span>{optLabel}</span>
                </label>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// Bulk-mail list builder — Admin only. Filter by vertical, contact category,
// and active/inactive (each accepts several values at once), then pick who
// actually gets the mail (everyone is selected by default; uncheck the ones
// to leave out) before downloading a CSV of just the checked rows.
function EmailExport() {
  const [verticalOptions, setVerticalOptions] = useState([]);
  const [verticals, setVerticals] = useState([]);
  const [roles, setRoles] = useState([]);
  const [statuses, setStatuses] = useState([]);

  const [contacts, setContacts] = useState([]);
  const [selected, setSelected] = useState(() => new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    axios
      .get(`${API_BASE_URL}/api/options`, authHeaders())
      .then((res) => setVerticalOptions(res.data?.verticalOptions || []))
      .catch((err) => console.error("Error loading verticals:", err));
  }, []);

  const rowKey = (c, i) => `${c.leadNumber}-${c.role}-${i}`;

  const load = useCallback(() => {
    setIsLoading(true);
    setError(null);
    axios
      .get(`${API_BASE_URL}/api/contacts/export`, {
        ...authHeaders(),
        params: {
          vertical: verticals.join(",") || undefined,
          role: roles.join(",") || undefined,
          status: statuses.join(",") || undefined,
        },
      })
      .then((res) => {
        const rows = res.data || [];
        setContacts(rows);
        // Everyone matching the filter starts selected — the point is an
        // opt-out list, not an opt-in one.
        setSelected(new Set(rows.map((c, i) => rowKey(c, i))));
      })
      .catch((err) => {
        console.error("Error loading contact export:", err);
        setError(
          err.response?.status === 403
            ? "This feature is available to Admins only."
            : "Could not load contacts."
        );
        setContacts([]);
        setSelected(new Set());
      })
      .finally(() => setIsLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verticals, roles, statuses]);

  useEffect(() => {
    load();
  }, [load]);

  const allSelected = contacts.length > 0 && selected.size === contacts.length;
  const someSelected = selected.size > 0 && !allSelected;

  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(contacts.map((c, i) => rowKey(c, i))));
  };

  const toggleOne = (key) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const selectedRows = useMemo(
    () => contacts.filter((c, i) => selected.has(rowKey(c, i))),
    [contacts, selected]
  );

  const downloadCsv = () => {
    const header = ["Name", "Email", "Company", "Vertical", "Category", "Designation", "City", "Status"];
    const lines = [header.map(csvCell).join(",")];
    selectedRows.forEach((c) => {
      lines.push(
        [
          c.personName,
          c.email,
          c.companyName,
          c.vertical,
          c.role,
          c.designation,
          c.city,
          c.active ? "Active" : "Inactive",
        ]
          .map(csvCell)
          .join(",")
      );
    });
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `email-list-${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  };

  return (
    <div className="email-export-page">
      <header className="ee-head">
        <h1>
          <FontAwesomeIcon icon={faEnvelope} /> Mass Email List
        </h1>
        <p>
          Build a mailing list for an announcement or policy update — filter
          by vertical, contact category and active/inactive (pick as many of
          each as you need), then uncheck anyone who shouldn't get it before
          downloading the list.
        </p>
      </header>

      {error ? (
        <p className="ee-error">{error}</p>
      ) : (
        <>
          <section className="ee-filters">
            <MultiSelectDropdown
              label="Vertical"
              icon={faFilter}
              options={verticalOptions}
              selected={verticals}
              onChange={setVerticals}
              allLabel="All Verticals"
            />

            <MultiSelectDropdown
              label="Category"
              options={ROLE_OPTIONS}
              selected={roles}
              onChange={setRoles}
              allLabel="All Categories"
            />

            <MultiSelectDropdown
              label="Status"
              options={STATUS_OPTIONS}
              selected={statuses}
              onChange={setStatuses}
              allLabel="Active & Inactive"
            />

            <button
              type="button"
              className="ee-download-btn"
              onClick={downloadCsv}
              disabled={selectedRows.length === 0}
            >
              <FontAwesomeIcon icon={faDownload} />
              Download {selectedRows.length} Selected
            </button>
          </section>

          <section className="ee-table-section">
            <div className="ee-table-head-bar">
              <span>
                {contacts.length} contact{contacts.length === 1 ? "" : "s"} matched ·{" "}
                {selectedRows.length} selected
              </span>
            </div>

            {isLoading ? (
              <p className="ee-empty">Loading…</p>
            ) : contacts.length === 0 ? (
              <p className="ee-empty">No contacts match this filter.</p>
            ) : (
              <div className="ee-table-wrap">
                <table className="ee-table">
                  <thead>
                    <tr>
                      <th className="ee-checkbox-col">
                        <input
                          type="checkbox"
                          checked={allSelected}
                          ref={(el) => {
                            if (el) el.indeterminate = someSelected;
                          }}
                          onChange={toggleAll}
                        />
                      </th>
                      <th>Name</th>
                      <th>Email</th>
                      <th>Company</th>
                      <th>Vertical</th>
                      <th>Category</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {contacts.map((c, i) => {
                      const key = rowKey(c, i);
                      const checked = selected.has(key);
                      return (
                        <tr key={key} className={checked ? "" : "is-unselected"}>
                          <td className="ee-checkbox-col">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleOne(key)}
                            />
                          </td>
                          <td>{c.personName || "—"}</td>
                          <td>{c.email}</td>
                          <td>{c.companyName || `Lead #${c.leadNumber}`}</td>
                          <td>{c.vertical || "—"}</td>
                          <td>{c.role}</td>
                          <td>
                            <span className={`ee-status ${c.active ? "is-active" : "is-inactive"}`}>
                              {c.active ? "Active" : "Inactive"}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

export default EmailExport;
