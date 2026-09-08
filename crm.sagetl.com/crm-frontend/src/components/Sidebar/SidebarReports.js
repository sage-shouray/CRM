import React, { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faFilePdf, faDownload } from "@fortawesome/free-solid-svg-icons";
import { API_BASE_URL } from "../../config";
import { formatDate } from "../../dateFormat";

const formatSize = (bytes) => {
  if (!bytes && bytes !== 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

// Lists the report PDFs that have been generated, newest first. The server
// scopes the list to the caller's branch, so this shows what the signed-in
// user is allowed to see and nothing more.
function SidebarReports() {
  const [reports, setReports] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await axios.get(`${API_BASE_URL}/api/reports`);
      setReports(Array.isArray(res.data) ? res.data : []);
      setError(null);
    } catch (err) {
      setError("Could not load reports");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    // Regenerating a report elsewhere dispatches this so the list refreshes
    // without a page reload.
    const onChanged = () => load();
    window.addEventListener("reports:changed", onChanged);
    return () => window.removeEventListener("reports:changed", onChanged);
  }, [load]);

  const download = async (report) => {
    try {
      const res = await axios.get(
        `${API_BASE_URL}/api/reports/${report.id}/download`,
        { responseType: "blob" }
      );
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", report.fileName);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setError("Download failed");
    }
  };

  return (
    <section className="sidebar-reports">
      <header className="sidebar-reports-head">
        <h3>Reports</h3>
        {reports.length > 0 && (
          <span className="sidebar-reports-count">{reports.length}</span>
        )}
      </header>

      <div className="sidebar-reports-list">
        {isLoading && <p className="sidebar-reports-note">Loading…</p>}

        {!isLoading && error && (
          <p className="sidebar-reports-note is-error">{error}</p>
        )}

        {!isLoading && !error && reports.length === 0 && (
          <p className="sidebar-reports-note">No reports generated yet.</p>
        )}

        {!isLoading &&
          !error &&
          reports.map((report) => (
            <button
              type="button"
              key={report.id}
              className="sidebar-report-item"
              onClick={() => download(report)}
              title={`Download ${report.fileName}`}
            >
              <FontAwesomeIcon
                icon={faFilePdf}
                className="sidebar-report-icon"
              />
              <span className="sidebar-report-text">
                <span className="sidebar-report-name">{report.fileName}</span>
                <span className="sidebar-report-meta">
                  {[formatDate(report.createdAt), formatSize(report.sizeBytes)]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </span>
              <FontAwesomeIcon
                icon={faDownload}
                className="sidebar-report-dl"
              />
            </button>
          ))}
      </div>
    </section>
  );
}

export default SidebarReports;
