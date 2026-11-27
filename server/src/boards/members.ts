// SPDX-License-Identifier: AGPL-3.0-only
import type { Db } from '../db.js';
import type { MemberDto, MemberRoleDto } from '../contracts/dto.js';

export async function toBoardMembers(db: Db, boardId: string): Promise<MemberDto[]> {
  const rows = await db.boardMember.findMany({
    where: { board_id: boardId },
    include: { user: { select: { username: true } } },
    orderBy: [{ role: 'asc' }, { created_at: 'asc' }],
  });
  return rows.map((row) => ({
    user_id: row.user_id,
    username: row.user.username,
    role: row.role as MemberRoleDto,
    joined_at: row.created_at.toISOString(),
  }));
}
