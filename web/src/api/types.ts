// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The browser types mirror `server/src/contracts/dto.ts`. They are checked
 * against the API by the contract tests; a field that moves in one place and
 * not the other fails the build before it reaches a screen.
 */
export type Visibility = 'private' | 'link' | 'public';
export type LinkRole = 'read' | 'edit' | 'none';
export type AnonWrite = 'off' | 'open' | 'moderated';
export type MemberRole = 'owner' | 'admin' | 'editor' | 'viewer';

export type Me = {
  id: string;
  email: string;
  username: string;
  display_name: string | null;
  totp_enabled: boolean;
  is_instance_admin: boolean;
  created_at: string;
};

export type Branding = {
  instance_name: string;
  tab_title: string | null;
  logo_url: string | null;
  favicon_url: string | null;
  accent_color: string | null;
  accent_foreground: string | null;
};

export type Board = {
  id: string;
  name: string;
  slug: string;
  visibility: Visibility;
  link_role: LinkRole;
  anon_write: AnonWrite;
  link_suffix: string | null;
  url: string | null;
  owner: { id: string; username: string };
  closed_at: string | null;
  created_at: string;
  updated_at: string;
  role?: MemberRole;
};

export type Column = { id: string; name: string; position: string };

/** A board anybody may read: the profile list, and never a link board. */
export type PublicBoard = {
  id: string;
  name: string;
  slug: string;
  url: string;
  updated_at: string;
};

export type Tag = { name: string; color: string | null };

export type Card = {
  id: string;
  column_id: string;
  title: string;
  description: string | null;
  assignee: { id: string; username: string } | null;
  assignee_label: string | null;
  actor_label: string | null;
  mine: boolean;
  due_at: string | null;
  done: boolean;
  position: string;
  tags: Tag[];
  created_at: string;
  updated_at: string;
};

/** Metadata of a write link; the token appears once, at creation. */
export type BoardLink = {
  id: string;
  role: 'read' | 'edit';
  label: string | null;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
};

/** A moderated write, before anyone approved it (K3-04). */
export type PendingCard = {
  id: string;
  column_id: string;
  title: string;
  description: string | null;
  due_at: string | null;
  actor_label: string;
  created_at: string;
  expires_at: string;
};

export type Member = { user_id: string; username: string; role: MemberRole; joined_at?: string };

export type Caller = {
  actor_kind: 'user' | 'agent' | 'link' | 'anon';
  role: MemberRole | null;
  label: string;
  can_write: boolean;
  can_delete_card: boolean;
  can_move_card: boolean;
  can_comment: boolean;
  can_manage: boolean;
  can_manage_columns: boolean;
  can_manage_members: boolean;
  can_moderate: boolean;
  can_export: boolean;
  can_import: boolean;
  can_close: boolean;
};

export type BoardState = {
  board: Board;
  columns: Column[];
  cards: Card[];
  members: Member[];
  caller: Caller;
  pending_count: number;
};

export type EventDto = {
  id: string;
  type: string;
  actor_kind: 'user' | 'link' | 'anon' | 'agent' | 'system';
  actor_label: string | null;
  payload: Record<string, unknown>;
  created_at: string;
};

export type Page<T> = { items: T[]; next_cursor: string | null };

/**
 * An issued agent key, without the credential (`server/src/agents/service.ts`
 * `AgentKeyDto`). The raw key exists only in the response that created it, so
 * `CreatedAgentKey` is the only shape that can carry one.
 */
export type AgentKey = {
  id: string;
  name: string;
  scope: 'board' | 'user';
  board_id: string | null;
  board_name: string | null;
  role: MemberRole | null;
  expires_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
};

export type CreatedAgentKey = AgentKey & { key: string };

export type AgentKeyRefusal =
  | 'revoked'
  | 'expired'
  | 'key_mismatch'
  | 'key_required'
  | 'board_not_found'
  | 'forbidden'
  | 'unreachable'
  | 'mcp_error';

/**
 * What "test connection" actually reached. `board` is null for a user-scoped
 * key (the role is per board, so there is no single one to report), and `key`
 * is the key's *name*, not the credential.
 *
 * `via` names the path that answered: `mcp` is the real `initialize` +
 * `tools/call whoami` against the instance's own endpoint, `inline` the
 * in-process fallback an instance without a public URL is left with, and
 * `null` a refusal decided from the stored row before anything was called.
 */
export type AgentKeyTest =
  | {
      ok: true;
      via: 'mcp' | 'inline';
      board: { id: string; name: string } | null;
      role: MemberRole | null;
      key: string;
    }
  | { ok: false; via: 'mcp' | 'inline' | null; reason: AgentKeyRefusal };
