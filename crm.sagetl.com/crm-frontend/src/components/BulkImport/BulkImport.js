import React, { useState } from "react";
import axios from "axios";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faFileExcel,
  faUpload,
  faArrowLeft,
  faCheckCircle,
  faTriangleExclamation,
} from "@fortawesome/free-solid-svg-icons";
import { API_BASE_URL } from "../../config";
import "./BulkImport.css";

const authHeaders = () => ({
  headers: { Authorization: `Bearer ${sessionStorage.getItem("token")}` },
});

// Strict template mode: no fuzzy header guessing, no manual mapping. A file
// is only ever accepted if its columns match the CRM Lead Data Entry
// Template exactly — same count, same headers, same order. A mismatched
// file is rejected outright, with the exact column differences shown, and
// the admin fixes the file itself rather than being offered a workaround
// mapping. Nothing is ever written on the first pass — /preview always runs
// first (header validation + duplicate check), and the admin explicitly
// confirms before /commit actually creates anything. Every accepted row
// lands in the Cold Lead Pool, to be completed by whoever pulls and calls
// each contact.
function BulkImport() {
  const [step, setStep] = useState(1); // 1 = upload, 2 = confirm, 3 = result
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [templateMismatch, setTemplateMismatch] = useState(null); // { mismatches, expectedColumnCount, foundColumnCount } | null

  const [preview, setPreview] = useState(null);
  const [includeDuplicates, setIncludeDuplicates] = useState(false);

  const [result, setResult] = useState(null);

  const runPreview = (chosenFile) => {
    setBusy(true);
    setError(null);
    setTemplateMismatch(null);
    const form = new FormData();
    form.append("file", chosenFile);
    axios
      .post(`${API_BASE_URL}/api/bulk-import/preview`, form, {
        ...authHeaders(),
        headers: { ...authHeaders().headers, "Content-Type": "multipart/form-data" },
      })
      .then((res) => {
        setPreview(res.data);
        setIncludeDuplicates(false);
        setStep(2);
      })
      .catch((err) => {
        if (err.response?.data?.templateMismatch) {
          setTemplateMismatch(err.response.data);
          setError(err.response.data.error);
          return;
        }
        setError(err.response?.data?.error || "Could not read that file.");
      })
      .finally(() => setBusy(false));
  };

  const handleFileChosen = (chosenFile) => {
    if (!chosenFile) return;
    setFile(chosenFile);
    runPreview(chosenFile);
  };

  // The only call in this page that actually writes anything. Re-sends the
  // file itself rather than any client-remembered mapping — the server
  // re-validates the template match from scratch before writing a single
  // row, so a write can never happen against a file that wasn't just tested.
  const handleConfirmCommit = () => {
    if (!file || !preview) return;
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.append("file", file);
    form.append("includeDuplicates", includeDuplicates ? "true" : "false");
    axios
      .post(`${API_BASE_URL}/api/bulk-import/commit`, form, {
        ...authHeaders(),
        headers: { ...authHeaders().headers, "Content-Type": "multipart/form-data" },
      })
      .then((res) => {
        setResult(res.data);
        setStep(3);
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
    setTemplateMismatch(null);
    setPreview(null);
    setIncludeDuplicates(false);
    setResult(null);
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
          Upload a file in the exact CRM Lead Data Entry Template format —
          same columns, same order. A file that doesn't match is rejected
          before anything is read, so there's never a guess about which
          column means what. Every accepted row lands in the Cold Lead Pool;
          whoever pulls a lead fills in anything still missing after calling
          the contact.
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
            <span>{busy ? "Checking file…" : "Click to choose the Excel file (.xlsx)"}</span>
            <input
              type="file"
              accept=".xlsx,.xls"
              onChange={(e) => handleFileChosen(e.target.files?.[0])}
              disabled={busy}
              hidden
            />
          </label>
          <p className="bi-manual-link-row">
            Must match the CRM Lead Data Entry Template exactly — same
            columns, same order, same headers.
          </p>

          {templateMismatch && (
            <div className="bi-mismatch-block">
              <h3>
                Columns don't match the template
                {templateMismatch.expectedColumnCount !== undefined && (
                  <> — expected {templateMismatch.expectedColumnCount} columns, found {templateMismatch.foundColumnCount}</>
                )}
              </h3>
              <div className="bi-table-wrap">
                <table className="bi-mismatch-table">
                  <thead>
                    <tr>
                      <th>Column #</th>
                      <th>Expected</th>
                      <th>Found in your file</th>
                    </tr>
                  </thead>
                  <tbody>
                    {templateMismatch.mismatches.map((m) => (
                      <tr key={m.column}>
                        <td>{m.column}</td>
                        <td>{m.expected}</td>
                        <td>{m.found}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      )}

      {step === 2 && preview && (
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

      {step === 3 && result && (
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

          <button type="button" className="bi-back-btn" onClick={startOver}>
            Import another file
          </button>
        </section>
      )}
    </div>
  );
}

export default BulkImport;
