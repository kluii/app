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

export type Tag = { name: string; color: string | null };

export type Card = {
  id: string;
  column_id: string;
  title: string;
  description: string | null;
  assignee: { id: string; username: string } | null;
  assignee_label: string | null;
  due_at: string | null;
  done: boolean;
  position: string;
  tags: Tag[];
  created_at: string;
  updated_at: string;
};

export type Member = { user_id: string; username: string; role: MemberRole; joined_at?: string };

export type Caller = {
  actor_kind: 'user' | 'agent' | 'link' | 'anon';
  role: MemberRole | null;
  label: string;
  can_write: boolean;
  can_manage: boolean;
  can_moderate: boolean;
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
