/**
 * Contextual entity resolution for Voice First captures.
 *
 * Turns a spoken reference ("John", "the Smith project") into a link against
 * data the user already has. Deliberately refuses to guess: when a mention
 * matches several records equally well it reports `ambiguous` and asks, rather
 * than silently picking one. Never creates people or projects.
 */

export type EntityKind = "person" | "project";

export type EntityMatchStatus = "resolved" | "ambiguous" | "unmatched";

/** How a candidate matched, strongest first. Higher tiers win outright. */
export type MatchTier = "alias" | "exact" | "prefix" | "contains";

const TIER_RANK: Record<MatchTier, number> = {
  alias: 4,
  exact: 3,
  prefix: 2,
  contains: 1,
};

const TIER_CONFIDENCE: Record<MatchTier, number> = {
  alias: 0.98,
  exact: 0.95,
  prefix: 0.8,
  contains: 0.6,
};

/** Loose `contains` matching on very short mentions produces noise. */
const MIN_CONTAINS_MENTION_LENGTH = 4;
const MIN_MENTION_LENGTH = 2;

export type EntityRecord = { id: string; name: string };

export type EntityCandidate = {
  id: string;
  name: string;
  tier: MatchTier;
  confidence: number;
};

export type EntityResolution = {
  kind: EntityKind;
  /** Exactly what the user said, preserved as evidence and never overwritten. */
  mention: string;
  status: EntityMatchStatus;
  /** Populated only when status is "resolved". */
  id: string | null;
  name: string | null;
  confidence: number;
  candidates: EntityCandidate[];
  /** A focused question to ask the user when status is "ambiguous". */
  question: string | null;
};

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Strips the filler people speak around project names: "the Smith project". */
function normalizeMention(mention: string, kind: EntityKind): string {
  let value = normalize(mention);
  value = value.replace(/^(?:the|our|my|that)\s+/u, "");
  if (kind === "project") {
    value = value.replace(/\s+(?:project|job|matter|case)$/u, "");
  }
  return value.trim();
}

function tierFor(mention: string, name: string): MatchTier | null {
  if (!mention || !name) return null;
  if (mention === name) return "exact";

  // Word-boundary prefix: "john" matches "john carter" but not "johnson".
  const words = name.split(" ");
  if (words.some((word) => word === mention)) return "prefix";
  if (name.startsWith(`${mention} `)) return "prefix";

  if (mention.length >= MIN_CONTAINS_MENTION_LENGTH) {
    if (name.includes(mention) || mention.includes(name)) return "contains";
  }
  return null;
}

function questionFor(kind: EntityKind, mention: string, candidates: EntityCandidate[]): string {
  const names = candidates.map((c) => c.name);
  const list =
    names.length <= 2
      ? names.join(" or ")
      : `${names.slice(0, -1).join(", ")}, or ${names[names.length - 1]}`;
  const noun = kind === "person" ? "" : " project";
  return `Which ${mention}${noun} did you mean — ${list}?`;
}

/**
 * Pure resolution against injected records.
 *
 * @param aliases user-confirmed corrections, keyed by lowercase mention.
 */
export function resolveEntityMention(
  kind: EntityKind,
  mention: string,
  records: EntityRecord[],
  aliases?: Map<string, string>,
): EntityResolution {
  const raw = mention.trim();
  const base: EntityResolution = {
    kind,
    mention: raw,
    status: "unmatched",
    id: null,
    name: null,
    confidence: 0,
    candidates: [],
    question: null,
  };

  const needle = normalizeMention(raw, kind);
  if (needle.length < MIN_MENTION_LENGTH) return base;

  // A user-confirmed alias is authoritative and short-circuits scoring.
  const aliasId = aliases?.get(raw.toLowerCase()) ?? aliases?.get(needle);
  const aliasHit = aliasId ? records.find((r) => r.id === aliasId) : undefined;
  if (aliasHit) {
    return {
      ...base,
      status: "resolved",
      id: aliasHit.id,
      name: aliasHit.name,
      confidence: TIER_CONFIDENCE.alias,
      candidates: [
        { id: aliasHit.id, name: aliasHit.name, tier: "alias", confidence: TIER_CONFIDENCE.alias },
      ],
    };
  }

  const candidates: EntityCandidate[] = [];
  for (const record of records) {
    const tier = tierFor(needle, normalizeMention(record.name, kind));
    if (!tier) continue;
    candidates.push({
      id: record.id,
      name: record.name,
      tier,
      confidence: TIER_CONFIDENCE[tier],
    });
  }

  if (candidates.length === 0) return base;

  candidates.sort((a, b) => TIER_RANK[b.tier] - TIER_RANK[a.tier] || a.name.localeCompare(b.name));
  const bestRank = TIER_RANK[candidates[0]!.tier];
  const tied = candidates.filter((c) => TIER_RANK[c.tier] === bestRank);

  // Two records matched equally well; picking either one could be wrong.
  if (tied.length > 1) {
    return {
      ...base,
      status: "ambiguous",
      confidence: 0,
      candidates: tied,
      question: questionFor(kind, raw, tied),
    };
  }

  const winner = tied[0]!;
  return {
    ...base,
    status: "resolved",
    id: winner.id,
    name: winner.name,
    confidence: winner.confidence,
    candidates,
  };
}

export type VoiceEntityLinks = {
  person: EntityResolution | null;
  project: EntityResolution | null;
  /** First clarification the user should be asked, if any. */
  clarification: string | null;
};

/** DB-backed wrapper. Dynamic imports mirror resolveCaptureLinks and avoid cycles. */
export async function resolveVoiceEntities(
  userId: string,
  input: { personName?: string | null; projectName?: string | null },
): Promise<VoiceEntityLinks> {
  const personName = input.personName?.trim();
  const projectName = input.projectName?.trim();
  if (!personName && !projectName) {
    return { person: null, project: null, clarification: null };
  }

  const { listPeopleForUser } = await import("../people");
  const { listPersonNameAliases } = await import("../user-corrections");
  const { listProjectsForUser } = await import("../projects");

  const [people, aliases, identities, projects] = await Promise.all([
    personName ? listPeopleForUser(userId) : Promise.resolve([]),
    personName ? listPersonNameAliases(userId) : Promise.resolve(new Map<string, string>()),
    personName
      ? import("../person-identities")
          .then((m) => m.listIdentityAliases(userId))
          .catch(() => new Map<string, string>())
      : Promise.resolve(new Map<string, string>()),
    projectName ? listProjectsForUser(userId) : Promise.resolve([]),
  ]);
  for (const [key, personId] of identities) {
    if (!aliases.has(key)) aliases.set(key, personId);
  }

  const person = personName
    ? resolveEntityMention(
        "person",
        personName,
        people.map((p) => ({ id: p.id, name: p.displayName })),
        aliases,
      )
    : null;

  const project = projectName
    ? resolveEntityMention(
        "project",
        projectName,
        projects.map((p) => ({ id: p.id, name: p.name })),
      )
    : null;

  const clarification = person?.question ?? project?.question ?? null;
  return { person, project, clarification };
}
