// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Response shapes. They mirror docs/api.md §2 exactly; the client types in
 * web/src/api/types.ts are checked against these by the contract tests.
 */
export type VisibilityDto = 'private' | 'link' | 'public';
export type LinkRoleDto = 'read' | 'edit' | 'none';
export type AnonWriteDto = 'off' | 'open' | 'moderated';
export type MemberRoleDto = 'owner' | 'admin' | 'editor' | 'viewer';

export type BoardDto = {
  id: string;
  name: string;
  slug: string;
  visibility: VisibilityDto;
  link_role: LinkRoleDto;
  anon_write: AnonWriteDto;
  link_suffix: string | null;
  url: string | null;
  owner: { id: string; username: string };
  closed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ColumnDto = { id: string; name: string; position: string };

export type TagDto = { name: string; color: string | null };

export type CardDto = {
  id: string;
  column_id: string;
  title: string;
  description: string | null;
  assignee: { id: string; username: string } | null;
  assignee_label: string | null;
  /** The display name an anonymous actor chose; null for every other actor. */
  actor_label: string | null;
  /** True when the caller is the anonymous actor who created this card. */
  mine: boolean;
  due_at: string | null;
  done: boolean;
  position: string;
  tags: TagDto[];
  created_at: string;
  updated_at: string;
};

export type MemberDto = {
  user_id: string;
  username: string;
  role: MemberRoleDto;
  joined_at?: string;
};

export type CallerDto = {
  actor_kind: 'user' | 'agent' | 'link' | 'anon';
  role: MemberRoleDto | null;
  label: string;
  /** One flag per affordance, decided by `can()`: the UI never guesses. */
  can_delete_card: boolean;
  can_move_card: boolean;
  can_comment: boolean;
  can_manage_columns: boolean;
  can_manage_members: boolean;
  can_write: boolean;
  can_manage: boolean;
  can_moderate: boolean;
  /** `board.close`: owner or admin, and false once the board is closed. */
  can_close: boolean;
};

export type BoardStateDto = {
  board: BoardDto;
  columns: ColumnDto[];
  cards: CardDto[];
  members: MemberDto[];
  caller: CallerDto;
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
