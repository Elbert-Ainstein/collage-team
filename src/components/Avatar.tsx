import type { Member } from "@/types";

export function Avatar({ member, size = 34 }: { member: Member; size?: number }) {
  return (
    <span
      className="avatar"
      style={{ width: size, height: size, background: member.avatarTint, fontSize: size * 0.4 }}
      title={member.name}
    >
      {member.initials}
    </span>
  );
}
