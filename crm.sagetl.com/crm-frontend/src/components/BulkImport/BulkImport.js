import React, { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faFileExcel,
  faUpload,
  faArrowLeft,
  faCheckCircle,
  faTriangleExclamation,
  faTrash,
  faPlus,
} from "@fortawesome/free-solid-svg-icons";
import { API_BASE_URL } from "../../config";
import "./BulkImport.css";

const authHeaders = () => ({
  headers: { Authorization: `Bearer ${sessionStorage.getItem("token")}` },
});

// Any vendor Excel, any layout — this is the admin-facing half of the bulk
// import "middleware". Column mapping is automatic and needs no manual
// step for a normal file: the server detects the header row, maps every
// column (including splitting a combined "Name | Mobile | Email" column on
// its own), and checks every row against the database for a duplicate
// company. Nothing is ever written on that first pass — the admin always
// sees a confirmation screen first: how many companies, what fields they
// carry, and which ones are duplicates, with a choice to skip or push
// those duplicates before anything actually lands in the Cold Pool. Manual
// mapping is still available as a fallback for a file the auto-detector
// genuinely can't read, or when an admin wants to set the mapping by hand.
function BulkImport() {
  const [step, setStep] = useState(1); // 1 = upload, 2 = map (manual only), 3 = confirm, 4 = result
  const [autoBusy, setAutoBusy] = useState(false);
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const [fields, setFields] = useState([]);
  const [sheetNames, setSheetNames] = useState([]);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [headerRowIndex, setHeaderRowIndex] = useState(0);
  const [headers, setHeaders] = useState([]);
  const [sampleRows, setSampleRows] = useState([]);
  const [totalDataRows, setTotalDataRows] = useState(0);
  const [mapping, setMapping] = useState({});
  const [splitRules, setSplitRules] = useState([]);

  const [presets, setPresets] = useState([]);
  const [presetName, setPresetName] = useState("");

  // What a preview call (auto or manual) came back with — the confirmation
  // screen renders straight off this, and /commit is sent exactly the
  // mapping/splitRules/headerRowIndex it contains, so the write always
  // matches what was actually shown and confirmed.
  const [preview, setPreview] = useState(null);
  const [includeDuplicates, setIncludeDuplicates] = useState(false);

  const [result, setResult] = useState(null);

  useEffect(() => {
    axios
      .get(`${API_BASE_URL}/api/bulk-import/presets`, authHeaders())
      .then((res) => setPresets(res.data || []))
      .catch(() => setPresets([]));
  }, []);

  const parseFile = useCallback(
    (chosenFile, opts = {}) => {
      setBusy(true);
      setError(null);
      const form = new FormData();
      form.append("file", chosenFile);
      form.append("sheetIndex", opts.sheetIndex ?? sheetIndex);
      if (opts.headerRowIndex !== undefined) {
        form.append("headerRowIndex", opts.headerRowIndex);
      }
      axios
        .post(`${API_BASE_URL}/api/bulk-import/parse`, form, {
          ...authHeaders(),
          headers: { ...authHeaders().headers, "Content-Type": "multipart/form-data" },
        })
        .then((res) => {
          const d = res.data;
          setFields(d.fields || []);
          setSheetNames(d.sheetNames || []);
          setSheetIndex(d.sheetIndex ?? 0);
          setHeaderRowIndex(d.headerRowIndex ?? 0);
          setHeaders(d.headers || []);
          setSampleRows(d.sampleRows || []);
          setTotalDataRows(d.totalDataRows || 0);
          setMapping(d.suggestedMapping || {});
          setSplitRules([]);
          setStep(2);
        })
        .catch((err) => {
          setError(err.response?.data?.error || "Could not read that file.");
        })
        .finally(() => setBusy(false));
    },
    [sheetIndex]
  );

  // Default path: the server figures out the header row, the column
  // mapping, and any split rules on its own, then runs the full duplicate
  // check — but writes nothing. Result lands on the confirmation screen.
  // Only falls back to the manual mapping screen if the server genuinely
  // couldn't find a Company Name column with any confidence.
  const runAutoPreview = useCallback((chosenFile, opts = {}) => {
    setAutoBusy(true);
    setError(null);
    const form = new FormData();
    form.append("file", chosenFile);
    form.append("sheetIndex", opts.sheetIndex ?? 0);
    axios
      .post(`${API_BASE_URL}/api/bulk-import/auto-preview`, form, {
        ...authHeaders(),
        headers: { ...authHeaders().headers, "Content-Type": "multipart/form-data" },
      })
      .then((res) => {
        setPreview(res.data);
        setIncludeDuplicates(false);
        setStep(3);
      })
      .catch((err) => {
        if (err.response?.data?.needsManualMapping) {
          setError(
            "Couldn't confidently find a Company Name column on its own — map the columns below."
          );
          parseFile(chosenFile, { sheetIndex: opts.sheetIndex ?? 0 });
          return;
        }
        setError(err.response?.data?.error || "Could not read that file.");
      })
      .finally(() => setAutoBusy(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleFileChosen = (chosenFile) => {
    if (!chosenFile) return;
    setFile(chosenFile);
    runAutoPreview(chosenFile);
  };

  const handleMapManually = () => {
    if (!file) return;
    parseFile(file, { sheetIndex: 0 });
  };

  const handleSheetChange = (idx) => {
    if (!file) return;
    parseFile(file, { sheetIndex: idx });
  };

  const handleHeaderRowChange = (idx) => {
    if (!file) return;
    parseFile(file, { sheetIndex, headerRowIndex: idx });
  };

  const setFieldMapping = (fieldKey, header) => {
    setMapping((prev) => {
      const next = { ...prev };
      if (header) next[fieldKey] = header;
      else delete next[fieldKey];
      return next;
    });
  };

  const usedHeaders = useMemo(() => {
    const set = new Set(Object.values(mapping));
    splitRules.forEach((r) => r.sourceHeader && set.add(r.sourceHeader));
    return set;
  }, [mapping, splitRules]);

  const addSplitRule = () => {
    setSplitRules((prev) => [...prev, { sourceHeader: "", delimiter: "|", targets: [""] }]);
  };

  const updateSplitRule = (idx, patch) => {
    setSplitRules((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };

  const updateSplitTarget = (ruleIdx, targetIdx, fieldKey) => {
    setSplitRules((prev) =>
      prev.map((r, i) => {
        if (i !== ruleIdx) return r;
        const targets = [...r.targets];
        targets[targetIdx] = fieldKey;
        return { ...r, targets };
      })
    );
  };

  const addSplitTarget = (ruleIdx) => {
    setSplitRules((prev) =>
      prev.map((r, i) => (i === ruleIdx ? { ...r, targets: [...r.targets, ""] } : r))
    );
  };

  const removeSplitRule = (idx) => {
    setSplitRules((prev) => prev.filter((_, i) => i !== idx));
  };

  const applyPreset = (preset) => {
    setMapping(preset.mapping || {});
    setSplitRules(preset.splitRules || []);
  };

  const savePreset = () => {
    if (!presetName.trim()) return;
    axios
      .post(
        `${API_BASE_URL}/api/bulk-import/presets`,
        { name: presetName.trim(), mapping, splitRules },
        authHeaders()
      )
      .then(() => {
        setPresetName("");
        return axios.get(`${API_BASE_URL}/api/bulk-import/presets`, authHeaders());
      })
      .then((res) => setPresets(res.data || []))
      .catch(() => setError("Could not save this mapping."));
  };

  const deletePreset = (id) => {
    axios
      .delete(`${API_BASE_URL}/api/bulk-import/presets/${id}`, authHeaders())
      .then(() => setPresets((prev) => prev.filter((p) => p.id !== id)))
      .catch(() => {});
  };

  const fieldsByGroup = useMemo(() => {
    const groups = {};
    fields.forEach((f) => {
      groups[f.group] = groups[f.group] || [];
      groups[f.group].push(f);
    });
    return groups;
  }, [fields]);

  // Live preview: applies the current mapping (not split rules — those only
  // matter server-side) to the sample rows so the admin can sanity-check the
  // column choices before committing anything.
  const previewRows = useMemo(() => {
    const previewFields = ["companyName", "itName", "itMobile", "itEmail", "city", "vertical"];
    return sampleRows.map((row) => {
      const byHeader = {};
      headers.forEach((h, i) => {
        byHeader[h] = row[i];
      });
      const out = {};
      previewFields.forEach((key) => {
        const header = mapping[key];
        out[key] = header ? byHeader[header] || "" : "";
      });
      return out;
    });
  }, [sampleRows, headers, mapping]);

  // Manual mapping screen's "Continue" — this is a preview call too, not a
  // commit. The admin still has to see the confirmation screen and the
  // duplicate check before anything is written, same as the automatic path.
  const handleRequestPreview = () => {
    if (!file || !mapping.companyName) return;
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.append("file", file);
    form.append("sheetIndex", sheetIndex);
    form.append("headerRowIndex", headerRowIndex);
    form.append("mapping", JSON.stringify(mapping));
    form.append("splitRules", JSON.stringify(splitRules));
    axios
      .post(`${API_BASE_URL}/api/bulk-import/preview`, form, {
        ...authHeaders(),
        headers: { ...authHeaders().headers, "Content-Type": "multipart/form-data" },
      })
      .then((res) => {
        setPreview(res.data);
        setIncludeDuplicates(false);
        setStep(3);
      })
      .catch((err) => {
        setError(err.response?.data?.error || "Could not read that file.");
      })
      .finally(() => setBusy(false));
  };

  // The only call in this whole page that actually writes anything — always
  // sent with the exact mapping/splitRules/headerRowIndex the confirmation
  // screen is showing, plus the admin's explicit skip/push choice for
  // whatever duplicates were found.
  const handleConfirmCommit = () => {
    if (!file || !preview) return;
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.append("file", file);
    form.append("sheetIndex", preview.sheetIndex);
    form.append("headerRowIndex", preview.headerRowIndex);
    form.append("mapping", JSON.stringify(preview.mapping));
    form.append("splitRules", JSON.stringify(preview.splitRules));
    form.append("includeDuplicates", includeDuplicates ? "true" : "false");
    axios
      .post(`${API_BASE_URL}/api/bulk-import/commit`, form, {
        ...authHeaders(),
        headers: { ...authHeaders().headers, "Content-Type": "multipart/form-data" },
      })
      .then((res) => {
        setResult(res.data);
        setStep(4);
      })
      .catch((err) => {
        setError(err.response?.data?.error || "Import failed.");
      })
      .finally(() => setBusy(false));
  };

  const startOver = () => {
    setStep(1);
    setFile(null);
    setError(null);
    setResult(null);
    setPreview(null);
    setIncludeDuplicates(false);
    setMapping({});
    setSplitRules([]);
  };

  // In-file repeats are always skipped, no matter what includeDuplicates
  // is — only a company's DB-duplicate status is that flag's business.
  const confirmButtonLabel = (() => {
    if (busy) return "Importing…";
    if (!preview) return "";
    const inFileDup = preview.inFileDuplicateCount || 0;
    const dbOnlyDup = preview.companies.filter((c) => c.isDuplicateInDb && !c.isDuplicateInFile).length;
    const skippedForDb = includeDuplicates ? 0 : dbOnlyDup;
    const willImport = preview.totalCount - inFileDup - skippedForDb;
    const skippedParts = [];
    if (inFileDup > 0) skippedParts.push(`${inFileDup} repeated in file`);
    if (skippedForDb > 0) skippedParts.push(`${skippedForDb} already existing`);
    if (skippedParts.length === 0) return `Confirm — import all ${willImport} into Cold Pool`;
    return `Confirm — import ${willImport} (skip ${skippedParts.join(", ")})`;
  })();

  return (
    <div className="bulk-import-page">
      <header className="bi-head">
        <h1>
          <FontAwesomeIcon icon={faFileExcel} /> Bulk Import
        </h1>
        <p>
          Upload a market-sourced Excel file in whatever format it arrived —
          columns are detected and mapped automatically, including splitting
          a combined "Name | Mobile | Email" column on its own. Every row
          lands in the Cold Lead Pool; whoever pulls a lead fills in
          anything still missing after calling the contact.
        </p>
      </header>

      {error && (
        <p className="bi-error">
          <FontAwesomeIcon icon={faTriangleExclamation} /> {error}
        </p>
      )}

      {step === 1 && (
        <section className="bi-upload-box">
          <label className="bi-dropzone">
            <FontAwesomeIcon icon={faUpload} />
            <span>{autoBusy ? "Reading & importing automatically…" : "Click to choose an Excel file (.xlsx)"}</span>
            <input
              type="file"
              accept=".xlsx,.xls"
              onChange={(e) => handleFileChosen(e.target.files?.[0])}
              disabled={autoBusy}
              hidden
            />
          </label>
          <p className="bi-manual-link-row">
            No column mapping needed for a normal file — it imports as soon
            as you pick it.{" "}
            {file && !autoBusy && (
              <button type="button" className="bi-manual-link" onClick={handleMapManually}>
                Prefer to check the mapping first? Review it manually.
              </button>
            )}
          </p>
        </section>
      )}

      {step === 2 && (
        <section className="bi-map-section">
          <div className="bi-map-toolbar">
            <button type="button" className="bi-back-btn" onClick={startOver}>
              <FontAwesomeIcon icon={faArrowLeft} /> Choose a different file
            </button>

            {sheetNames.length > 1 && (
              <label className="bi-inline-field">
                Sheet:
                <select value={sheetIndex} onChange={(e) => handleSheetChange(Number(e.target.value))}>
                  {sheetNames.map((name, i) => (
                    <option key={name} value={i}>{name}</option>
                  ))}
                </select>
              </label>
            )}

            <label className="bi-inline-field">
              Header row:
              <input
                type="number"
                min={1}
                value={headerRowIndex + 1}
                onChange={(e) => handleHeaderRowChange(Math.max(0, Number(e.target.value) - 1))}
                title="The row number (in the original file) that holds the column titles — auto-detected, override if it guessed wrong."
              />
            </label>

            <span className="bi-row-count">{totalDataRows} data row{totalDataRows === 1 ? "" : "s"} found</span>
          </div>

          {presets.length > 0 && (
            <div className="bi-preset-row">
              <span>Load a saved mapping:</span>
              {presets.map((p) => (
                <span key={p.id} className="bi-preset-chip">
                  <button type="button" onClick={() => applyPreset(p)}>{p.name}</button>
                  <button type="button" className="bi-preset-delete" onClick={() => deletePreset(p.id)} title="Delete this preset">
                    <FontAwesomeIcon icon={faTrash} />
                  </button>
                </span>
              ))}
            </div>
          )}

          <div className="bi-mapping-grid">
            {Object.entries(fieldsByGroup).map(([group, groupFields]) => (
              <div key={group} className="bi-mapping-group">
                <h3>{group}</h3>
                {groupFields.map((f) => (
                  <div key={f.key} className="bi-mapping-row">
                    <label htmlFor={`map-${f.key}`}>
                      {f.label}
                      {f.required && <span className="bi-required"> *</span>}
                    </label>
                    <select
                      id={`map-${f.key}`}
                      value={mapping[f.key] || ""}
                      onChange={(e) => setFieldMapping(f.key, e.target.value)}
                    >
                      <option value="">Not present in file</option>
                      {headers.map((h) => (
                        <option key={h} value={h}>
                          {h}
                          {usedHeaders.has(h) && mapping[f.key] !== h ? " (in use)" : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            ))}
          </div>

          <div className="bi-split-section">
            <div className="bi-split-header">
              <h3>Combined columns (optional)</h3>
              <p>
                If one source column has several things crammed together
                (e.g. "Name | Mobile | Email" in one cell), split it into
                separate fields here instead of mapping it directly above.
              </p>
              <button type="button" className="bi-add-split-btn" onClick={addSplitRule}>
                <FontAwesomeIcon icon={faPlus} /> Add a split rule
              </button>
            </div>

            {splitRules.map((rule, ruleIdx) => (
              <div key={ruleIdx} className="bi-split-rule">
                <select
                  value={rule.sourceHeader}
                  onChange={(e) => updateSplitRule(ruleIdx, { sourceHeader: e.target.value })}
                >
                  <option value="">Choose source column…</option>
                  {headers.map((h) => (
                    <option key={h} value={h}>{h}</option>
                  ))}
                </select>
                <span>split by</span>
                <input
                  type="text"
                  className="bi-delimiter-input"
                  value={rule.delimiter}
                  onChange={(e) => updateSplitRule(ruleIdx, { delimiter: e.target.value })}
                  maxLength={5}
                />
                <span>into, in order:</span>
                {rule.targets.map((t, tIdx) => (
                  <select
                    key={tIdx}
                    value={t}
                    onChange={(e) => updateSplitTarget(ruleIdx, tIdx, e.target.value)}
                  >
                    <option value="">—</option>
                    {fields.map((f) => (
                      <option key={f.key} value={f.key}>{f.label}</option>
                    ))}
                  </select>
                ))}
                <button type="button" className="bi-icon-btn" onClick={() => addSplitTarget(ruleIdx)} title="Add another part">
                  <FontAwesomeIcon icon={faPlus} />
                </button>
                <button type="button" className="bi-icon-btn bi-icon-btn-danger" onClick={() => removeSplitRule(ruleIdx)} title="Remove this rule">
                  <FontAwesomeIcon icon={faTrash} />
                </button>
              </div>
            ))}
          </div>

          <div className="bi-save-preset-row">
            <input
              type="text"
              placeholder="Save this mapping as… (e.g. Vendor X format)"
              value={presetName}
              onChange={(e) => setPresetName(e.target.value)}
            />
            <button type="button" onClick={savePreset} disabled={!presetName.trim()}>
              Save mapping
            </button>
          </div>

          <div className="bi-preview-section">
            <h3>Preview — first {previewRows.length} rows as they'll be imported</h3>
            <div className="bi-table-wrap">
              <table className="bi-preview-table">
                <thead>
                  <tr>
                    <th>Company</th>
                    <th>IT Name</th>
                    <th>IT Mobile</th>
                    <th>IT Email</th>
                    <th>City</th>
                    <th>Vertical</th>
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((r, i) => (
                    <tr key={i}>
                      <td>{r.companyName || "—"}</td>
                      <td>{r.itName || "—"}</td>
                      <td>{r.itMobile || "—"}</td>
                      <td>{r.itEmail || "—"}</td>
                      <td>{r.city || "—"}</td>
                      <td>{r.vertical || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bi-commit-row">
            <button
              type="button"
              className="bi-commit-btn"
              onClick={handleRequestPreview}
              disabled={busy || !mapping.companyName}
              title={!mapping.companyName ? "Map Company Name first" : ""}
            >
              {busy ? "Checking…" : `Review ${totalDataRows} rows before importing`}
            </button>
          </div>
        </section>
      )}

      {step === 3 && preview && (
        <section className="bi-confirm-section">
          <div className="bi-confirm-summary">
            <h2>
              You're about to push <strong>{preview.totalCount}</strong> compan
              {preview.totalCount === 1 ? "y" : "ies"} into the Cold Lead Pool
            </h2>
            <p>
              Every row below is checked against what's already in the
              database, and against every other row in this same file.
            </p>
            {preview.skipped?.length > 0 && (
              <p className="bi-confirm-note">
                {preview.skipped.length} row{preview.skipped.length === 1 ? "" : "s"} in the
                file had no company name and won't be imported at all.
              </p>
            )}
          </div>

          {preview.inFileDuplicateCount > 0 && (
            <div className="bi-confirm-note-block">
              <strong>
                {preview.inFileDuplicateCount} row{preview.inFileDuplicateCount === 1 ? "" : "s"} repeat
                {preview.inFileDuplicateCount === 1 ? "s" : ""} a company already elsewhere in this
                same file.
              </strong>
              <p>
                Each company can only be uploaded once per import — this
                isn't a choice, only the first occurrence of each repeated
                company will ever be created, the rest are always skipped.
              </p>
            </div>
          )}

          {preview.dbDuplicateCount > 0 && (
            <div className="bi-duplicate-choice">
              <strong>
                {preview.dbDuplicateCount} of these {preview.dbDuplicateCount === 1 ? "is" : "are"}
                {" "}already in the system as an existing lead.
              </strong>
              <div className="bi-duplicate-choice-options">
                <label>
                  <input
                    type="radio"
                    name="dup-choice"
                    checked={!includeDuplicates}
                    onChange={() => setIncludeDuplicates(false)}
                  />
                  Leave them — skip these, import only the new companies
                </label>
                <label>
                  <input
                    type="radio"
                    name="dup-choice"
                    checked={includeDuplicates}
                    onChange={() => setIncludeDuplicates(true)}
                  />
                  Push them anyway — import these too, even though they already exist
                </label>
              </div>
            </div>
          )}

          <div className="bi-table-wrap bi-confirm-table-wrap">
            <table className="bi-preview-table bi-confirm-table">
              <thead>
                <tr>
                  <th>Company</th>
                  <th>City</th>
                  <th>Vertical</th>
                  <th>IT Contact</th>
                  <th>Mobile</th>
                  <th>Email</th>
                  <th>Turnover</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {preview.companies.map((c, i) => (
                  <tr key={`${c.companyName}-${i}`} className={c.isDuplicate ? "is-duplicate-row" : ""}>
                    <td>{c.companyName || "—"}</td>
                    <td>{c.city || "—"}</td>
                    <td>{c.vertical || "—"}</td>
                    <td>{c.itName || c.financeName || c.businessHeadName || "—"}</td>
                    <td>{c.itMobile || "—"}</td>
                    <td>{c.itEmail || "—"}</td>
                    <td>{c.turnOverINR || "—"}</td>
                    <td>
                      {c.isDuplicateInFile ? (
                        <span className="bi-dup-badge bi-dup-badge-file" title={c.duplicateReason || ""}>
                          Repeated in file
                        </span>
                      ) : c.isDuplicateInDb ? (
                        <span className="bi-dup-badge" title={c.duplicateReason || ""}>
                          Duplicate of #{c.existingLeadNumber}
                        </span>
                      ) : (
                        <span className="bi-new-badge">New</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="bi-confirm-actions">
            <button type="button" className="bi-back-btn" onClick={startOver}>
              <FontAwesomeIcon icon={faArrowLeft} /> Cancel — choose a different file
            </button>
            <button
              type="button"
              className="bi-commit-btn"
              onClick={handleConfirmCommit}
              disabled={busy}
            >
              {confirmButtonLabel}
            </button>
          </div>
        </section>
      )}

      {step === 4 && result && (
        <section className="bi-result-section">
          <div className="bi-result-icon">
            <FontAwesomeIcon icon={faCheckCircle} />
          </div>
          <h2>{result.createdCount} lead{result.createdCount === 1 ? "" : "s"} added to the Cold Pool</h2>

          {result.duplicates?.length > 0 && (
            <div className="bi-result-block">
              <h4>{result.duplicates.length} skipped — company already exists</h4>
              <ul>
                {result.duplicates.map((d, i) => (
                  <li key={i}>{d.companyName} — already Lead #{d.existingLeadNumber}</li>
                ))}
              </ul>
            </div>
          )}

          {result.pushedDespiteDuplicate?.length > 0 && (
            <div className="bi-result-block">
              <h4>{result.pushedDespiteDuplicate.length} imported despite being a duplicate (you chose to push them)</h4>
              <ul>
                {result.pushedDespiteDuplicate.map((d, i) => (
                  <li key={i}>{d.companyName}{d.existingLeadNumber ? ` — also Lead #${d.existingLeadNumber}` : ""}</li>
                ))}
              </ul>
            </div>
          )}

          {result.skipped?.length > 0 && (
            <div className="bi-result-block">
              <h4>{result.skipped.length} row{result.skipped.length === 1 ? "" : "s"} skipped</h4>
              <ul>
                {result.skipped.map((s, i) => (
                  <li key={i}>Row {s.row}: {s.reason}</li>
                ))}
              </ul>
            </div>
          )}

          {result.mappingUsed && (
            <div className="bi-result-block bi-result-mapping">
              <h4>Columns used automatically</h4>
              <ul>
                {Object.entries(result.mappingUsed).map(([key, header]) => (
                  <li key={key}>{key}: "{header}"</li>
                ))}
                {(result.splitRulesUsed || []).map((r, i) => (
                  <li key={`split-${i}`}>
                    "{r.sourceHeader}" split by "{r.delimiter}" into: {r.targets.join(", ")}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <button type="button" className="bi-back-btn" onClick={startOver}>
            Import another file
          </button>
        </section>
      )}
    </div>
  );
}

export default BulkImport;
