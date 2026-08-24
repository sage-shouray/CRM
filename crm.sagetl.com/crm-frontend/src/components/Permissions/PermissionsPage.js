import React, { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faUserShield, faCircleInfo } from "@fortawesome/free-solid-svg-icons";
import { API_BASE_URL } from "../../config";
import "./PermissionsPage.css";

// Who each Manager may see. A Manager always sees their own direct reports —
// that comes from the reporting tree and cannot be switched off here. This page
// is for the extra grants on top: "let this Manager also see that Executive".
function PermissionsPage() {
  const [managers, setManagers] = useState([]);
  const [executives, setExecutives] = useState([]);
  const [grants, setGrants] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await axios.get(`${API_BASE_URL}/api/permissions`);
      setManagers(res.data?.managers || []);
      setExecutives(res.data?.executives || []);
      setGrants(res.data?.grants || []);
      setError(null);
    } catch (err) {
      setError(
        err.response?.status === 403
          ? "Permissions are managed by Admins only."
          : "Could not load permissions."
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Fast lookup for "is this pair granted".
  const grantSet = useMemo(
    () => new Set(grants.map((g) => `${g.managerId}:${g.executiveId}`)),
    [grants]
  );

  const isDirectReport = (executive, managerId) =>
    Number(executive.supervisorId) === Number(managerId);

  const toggle = async (managerId, executive) => {
    // A direct report is implied by the reporting tree; there is nothing to
    // grant or revoke, so the box is locked on.
    if (isDirectReport(executive, managerId)) return;

    const key = `${managerId}:${executive.id}`;
    const granted = grantSet.has(key);
    setBusy(key);
    try {
      if (granted) {
        await axios.delete(
          `${API_BASE_URL}/api/permissions/${managerId}/${executive.id}`
        );
        setGrants((prev) =>
          prev.filter(
            (g) =>
              !(g.managerId === managerId && g.executiveId === executive.id)
          )
        );
      } else {
        await axios.post(`${API_BASE_URL}/api/permissions`, {
          managerId,
          executiveId: executive.id,
        });
        setGrants((prev) => [
          ...prev,
          { managerId, executiveId: executive.id },
        ]);
      }
      setError(null);
    } catch (err) {
      setError(err.response?.data?.error || "Could not update that permission.");
    } finally {
      setBusy(null);
    }
  };

  const countFor = (managerId) =>
    executives.filter(
      (e) =>
        isDirectReport(e, managerId) || grantSet.has(`${managerId}:${e.id}`)
    ).length;

  return (
    <div className="perm-page">
      <header className="perm-head">
        <h1>
          <FontAwesomeIcon icon={faUserShield} /> Permissions
        </h1>
        <p>
          Choose which Executives each Manager can see the work and tasks of.
          Managers always see their own direct reports; tick a box to give them
          visibility of someone else&apos;s.
        </p>
      </header>

      {error && <div className="perm-error">{error}</div>}

      {isLoading ? (
        <p className="perm-empty">Loading…</p>
      ) : managers.length === 0 ? (
        <div className="perm-note">
          <FontAwesomeIcon icon={faCircleInfo} />
          <span>
            No Managers yet. Create one in Users → Add User with the Manager
            role, then come back to grant visibility.
          </span>
        </div>
      ) : executives.length === 0 ? (
        <div className="perm-note">
          <FontAwesomeIcon icon={faCircleInfo} />
          <span>No Executives yet.</span>
        </div>
      ) : (
        <div className="perm-panel">
          <table className="perm-table">
            <thead>
              <tr>
                <th className="perm-corner">Executive</th>
                {managers.map((m) => (
                  <th key={m.id} className="perm-manager">
                    <span className="perm-manager-name">{m.name}</span>
                    <span className="perm-manager-count">
                      sees {countFor(m.id)}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {executives.map((e) => (
                <tr key={e.id}>
                  <th scope="row" className="perm-exec">
                    <span>{e.name}</span>
                    {e.status !== "active" && (
                      <span className="perm-inactive">inactive</span>
                    )}
                  </th>
                  {managers.map((m) => {
                    const key = `${m.id}:${e.id}`;
                    const direct = isDirectReport(e, m.id);
                    const checked = direct || grantSet.has(key);
                    return (
                      <td key={m.id} className={direct ? "is-direct" : ""}>
                        <label
                          className="perm-cell"
                          title={
                            direct
                              ? `${e.name} reports to ${m.name} — always visible`
                              : checked
                              ? "Granted — click to revoke"
                              : "Click to grant visibility"
                          }
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={direct || busy === key}
                            onChange={() => toggle(m.id, e)}
                          />
                          {direct && <span className="perm-direct">team</span>}
                        </label>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="perm-foot">
        Granting visibility lets a Manager see that Executive&apos;s leads,
        tasks and activity in Reports, and assign work to them. It does not let
        them edit the account — that stays with Admins.
      </p>
    </div>
  );
}

export default PermissionsPage;
