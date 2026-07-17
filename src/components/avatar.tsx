import type { Person } from "@/lib/types";

export function Avatar({ person, size = "md", title = true }: { person: Person; size?: "sm" | "md" | "lg"; title?: boolean }) {
  return (
    <span className={`avatar avatar-${size}`} style={{ backgroundColor: person.color }} title={title ? person.name : undefined}>
      {person.initials}
    </span>
  );
}

export function AvatarGroup({ people, max = 3 }: { people: Person[]; max?: number }) {
  const extra = people.length - max;
  return (
    <span className="avatar-group" aria-label={`${people.length} integrantes`}>
      {people.slice(0, max).map((person) => <Avatar key={person.id} person={person} size="sm" />)}
      {extra > 0 && <span className="avatar avatar-sm avatar-extra">+{extra}</span>}
    </span>
  );
}
