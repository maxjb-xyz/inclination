import { useState } from "react";
import type { PermissionRole } from "@inclination/shared";
import type { GrantSubject, PermissionGrant } from "../api/collabTypes";
import {
  usePermissions,
  useRemovePermission,
  useShareInvite,
  useUpsertPermission,
} from "./collabQueries";

const ROLES: PermissionRole[] = ["full", "edit", "comment", "read"];

const ROLE_LABEL: Record<PermissionRole, string> = {
  full: "Full access",
  edit: "Can edit",
  comment: "Can comment",
  read: "Can view",
};

function subjectLabel(grant: PermissionGrant): string {
  const s: GrantSubject = grant.subject ?? null;
  if (!s) return grant.subjectId ?? "Unknown";
  if (s.kind === "user") return s.displayName || s.email;
  if (s.kind === "workspace") return `Everyone in ${s.name}`;
  return "Anyone with the link";
}

export interface ShareDialogProps {
  pageId: string;
  workspaceId: string;
  /** The page's own workspace id — granted via the "share with workspace" toggle. */
  onClose: () => void;
}

/**
 * Share dialog (spec §6): lists current grants, lets a `canShare` user change/
 * remove a grant, share with the whole workspace, and invite a person to THIS
 * page by email. Rendered only when the caller has `canShare` (the page header
 * gates mounting), so it assumes mutation is permitted.
 */
export function ShareDialog({ pageId, workspaceId, onClose }: ShareDialogProps): React.ReactElement {
  const permissions = usePermissions(pageId);
  const upsert = useUpsertPermission(pageId);
  const remove = useRemovePermission(pageId);
  const invite = useShareInvite(pageId);

  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<PermissionRole>("read");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const grants = permissions.data ?? [];
  const workspaceGrant = grants.find(
    (g) => g.subjectType === "workspace" && g.subjectId === workspaceId,
  );

  function submitInvite(e: React.FormEvent): void {
    e.preventDefault();
    setMessage(null);
    setError(null);
    const value = email.trim();
    if (!value) return;
    invite.mutate(
      { email: value, role: inviteRole },
      {
        onSuccess: (res) => {
          setEmail("");
          setMessage(
            res.kind === "granted"
              ? "Access granted."
              : "Invitation sent — they'll get access once they join.",
          );
        },
        onError: (err) => setError(err instanceof Error ? err.message : "Could not share"),
      },
    );
  }

  function shareWithWorkspace(): void {
    upsert.mutate({ subjectType: "workspace", subjectId: workspaceId, role: "edit" });
  }

  return (
    <div
      className="share-dialog-backdrop"
      role="dialog"
      aria-label="Share page"
      data-testid="share-dialog"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="share-dialog">
        <header className="share-dialog__header">
          <h2>Share</h2>
          <button type="button" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </header>

        <form className="share-invite" onSubmit={submitInvite}>
          <input
            type="email"
            aria-label="Invite by email"
            placeholder="Add people by email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <select
            aria-label="Invite role"
            value={inviteRole}
            onChange={(e) => setInviteRole(e.target.value as PermissionRole)}
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
          <button type="submit" disabled={invite.isPending || !email.trim()}>
            Invite
          </button>
        </form>
        {message ? <p className="share-msg" role="status">{message}</p> : null}
        {error ? <p className="share-err" role="alert">{error}</p> : null}

        <div className="share-list" data-testid="share-list">
          {permissions.isLoading ? <p>Loading…</p> : null}
          {grants.length === 0 && !permissions.isLoading ? (
            <p className="share-empty">No one else has access yet.</p>
          ) : null}
          {grants.map((grant) => (
            <div className="share-row" data-testid="share-row" key={grant.id}>
              <span className="share-row__subject">{subjectLabel(grant)}</span>
              <select
                aria-label={`Role for ${subjectLabel(grant)}`}
                value={grant.role}
                onChange={(e) =>
                  upsert.mutate({
                    subjectType: grant.subjectType as "user" | "workspace",
                    subjectId: grant.subjectId as string,
                    role: e.target.value as PermissionRole,
                  })
                }
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </option>
                ))}
              </select>
              <button
                type="button"
                aria-label={`Remove ${subjectLabel(grant)}`}
                onClick={() => remove.mutate(grant.id)}
              >
                Remove
              </button>
            </div>
          ))}
        </div>

        {!workspaceGrant ? (
          <button type="button" className="share-workspace" onClick={shareWithWorkspace}>
            Share with everyone in this workspace
          </button>
        ) : null}
      </div>
    </div>
  );
}
