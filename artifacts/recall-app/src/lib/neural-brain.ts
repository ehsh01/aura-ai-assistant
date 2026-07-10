/** Procedural neural-brain geometry + memory-graph wiring for the Home backdrop. */

export type BrainParticle = {
  x: number;
  y: number;
  z: number;
  /** Hue in degrees for Dala-like spectrum. */
  hue: number;
  size: number;
  phase: number;
  kind: "ambient" | "entity";
  entityType?: "task" | "note" | "person" | "project" | "capture";
  label?: string;
};

export type BrainSynapse = {
  a: number;
  b: number;
  strength: number;
};

export type MemoryGraphInput = {
  tasks?: { id: string; title: string; completed: boolean; requesterPersonId?: string | null; projectId?: string | null }[];
  notes?: { id: string; title: string; primaryPersonId?: string | null; projectId?: string | null; updatedAt?: string; createdAt?: string }[];
  people?: { id: string; displayName: string }[];
  projects?: { id: string; name: string }[];
  captures?: { id: string; cleanedTitle: string; status: string }[];
};

function hash(n: number): number {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

/** Sample a point inside a brain-ish dual-hemisphere volume. */
function sampleBrainPoint(i: number): { x: number; y: number; z: number } {
  const u = hash(i * 1.7 + 0.3);
  const v = hash(i * 3.1 + 1.1);
  const w = hash(i * 5.9 + 2.2);

  // Two lobes: left / right hemisphere.
  const lobe = u < 0.5 ? -1 : 1;
  const lobeU = u < 0.5 ? u * 2 : (u - 0.5) * 2;

  // Ellipsoid around each lobe center.
  const theta = lobeU * Math.PI * 2;
  const phi = Math.acos(2 * v - 1);
  const r = 0.55 + 0.45 * Math.pow(w, 0.65);

  let x = Math.sin(phi) * Math.cos(theta) * 0.72 * r;
  let y = Math.cos(phi) * 0.55 * r;
  let z = Math.sin(phi) * Math.sin(theta) * 0.5 * r;

  // Offset lobes outward + slight forward tilt.
  x = x * 0.85 + lobe * 0.42;
  y = y * 0.9 - 0.05;
  z = z * 0.95 + 0.08;

  // Soft brainstem / corpus callosum bridge near center.
  if (hash(i * 7.3) > 0.88) {
    x *= 0.35;
    y -= 0.25 + hash(i * 9.1) * 0.2;
    z *= 0.6;
  }

  // Organic noise.
  x += (hash(i * 11.2) - 0.5) * 0.08;
  y += (hash(i * 13.7) - 0.5) * 0.06;
  z += (hash(i * 17.4) - 0.5) * 0.07;

  return { x, y, z };
}

/** Wide field points so the constellation can fill the whole viewport. */
function sampleFieldPoint(i: number): { x: number; y: number; z: number } {
  const u = hash(i * 2.3 + 0.7);
  const v = hash(i * 4.1 + 1.9);
  const w = hash(i * 6.7 + 3.3);
  // Cover a large box; projection scale maps this across the full screen.
  return {
    x: (u - 0.5) * 3.4,
    y: (v - 0.5) * 2.6,
    z: (w - 0.5) * 1.8,
  };
}

const SPECTRUM = [
  265, // violet
  280, // purple
  200, // cyan-teal
  170, // teal
  45, // amber
  320, // magenta
  220, // blue
];

function particleHue(i: number): number {
  return SPECTRUM[Math.floor(hash(i * 19.3) * SPECTRUM.length)]!;
}

export function buildAmbientCloud(count: number, fillScreen = false): BrainParticle[] {
  const particles: BrainParticle[] = [];
  // Mostly brain-shaped; a thin field halo only when filling the screen.
  const brainCount = fillScreen ? Math.floor(count * 0.9) : count;
  const fieldCount = fillScreen ? count - brainCount : 0;

  for (let i = 0; i < brainCount; i++) {
    const p = sampleBrainPoint(i + 1);
    // Slightly inflate the cortex so the silhouette reads larger on Home.
    const inflate = fillScreen ? 1.18 : 1;
    particles.push({
      x: p.x * inflate,
      y: p.y * inflate,
      z: p.z * inflate,
      hue: particleHue(i),
      // fillScreen needs readable nodes without additive white blowout.
      size: (fillScreen ? 1.15 : 0.7) + hash(i * 23.1) * (fillScreen ? 1.9 : 1.6),
      phase: hash(i * 29.7) * Math.PI * 2,
      kind: "ambient",
    });
  }

  for (let i = 0; i < fieldCount; i++) {
    // Sparse outer dust — stays dim and outside the main lobes.
    const p = sampleFieldPoint(i + 9000);
    const len = Math.hypot(p.x, p.y) || 1;
    const push = 1.35 + hash(i * 41.2) * 0.45;
    particles.push({
      x: (p.x / len) * push * 1.6,
      y: (p.y / len) * push * 1.15,
      z: p.z * 0.7,
      hue: particleHue(i + 400),
      size: 0.9 + hash(i * 31.1) * 1.4,
      phase: hash(i * 37.3) * Math.PI * 2,
      kind: "ambient",
    });
  }
  return particles;
}

function placeEntity(
  index: number,
  total: number,
  entityType: BrainParticle["entityType"],
  label: string,
): BrainParticle {
  // Spread entity hubs across the cortex rather than pure random.
  const seed = index * 97 + total * 3 + (entityType?.length ?? 0) * 11;
  const p = sampleBrainPoint(seed + 5000);
  // Pull slightly outward so hubs read as surface nodes.
  const scale = 1.08;
  return {
    x: p.x * scale,
    y: p.y * scale,
    z: p.z * scale,
    hue:
      entityType === "person"
        ? 200
        : entityType === "task"
          ? 265
          : entityType === "note"
            ? 45
            : entityType === "capture"
              ? 320
              : 170,
    size: 2.2 + hash(seed) * 1.4,
    phase: hash(seed * 1.3) * Math.PI * 2,
    kind: "entity",
    entityType,
    label: label.slice(0, 48),
  };
}

export function buildMemoryGraph(
  input: MemoryGraphInput,
  ambientCount = 1400,
  fillScreen = false,
): {
  particles: BrainParticle[];
  synapses: BrainSynapse[];
} {
  const ambient = buildAmbientCloud(ambientCount, fillScreen);
  const entities: BrainParticle[] = [];
  const idToIndex = new Map<string, number>();
  const synapses: BrainSynapse[] = [];

  const pushEntity = (
    key: string,
    type: NonNullable<BrainParticle["entityType"]>,
    label: string,
  ) => {
    if (idToIndex.has(key)) return idToIndex.get(key)!;
    const idx = ambient.length + entities.length;
    entities.push(placeEntity(entities.length, 40, type, label));
    idToIndex.set(key, idx);
    return idx;
  };

  const openTasks = (input.tasks ?? []).filter((t) => !t.completed).slice(0, 18);
  const recentNotes = [...(input.notes ?? [])]
    .sort((a, b) => {
      const ta = new Date(a.updatedAt ?? a.createdAt ?? 0).getTime();
      const tb = new Date(b.updatedAt ?? b.createdAt ?? 0).getTime();
      return tb - ta;
    })
    .slice(0, 16);
  const people = (input.people ?? []).slice(0, 14);
  const projects = (input.projects ?? []).slice(0, 8);
  const captures = (input.captures ?? [])
    .filter((c) => c.status === "pending")
    .slice(0, 8);

  for (const p of people) {
    pushEntity(`person:${p.id}`, "person", p.displayName);
  }
  for (const t of openTasks) {
    const ti = pushEntity(`task:${t.id}`, "task", t.title);
    if (t.requesterPersonId) {
      const pi = idToIndex.get(`person:${t.requesterPersonId}`);
      if (pi !== undefined) synapses.push({ a: ti, b: pi, strength: 0.85 });
    }
    if (t.projectId) {
      const proj = projects.find((pr) => pr.id === t.projectId);
      if (proj) {
        const pri = pushEntity(`project:${proj.id}`, "project", proj.name);
        synapses.push({ a: ti, b: pri, strength: 0.55 });
      }
    }
  }
  for (const n of recentNotes) {
    const ni = pushEntity(`note:${n.id}`, "note", n.title);
    if (n.primaryPersonId) {
      const pi = idToIndex.get(`person:${n.primaryPersonId}`);
      if (pi !== undefined) synapses.push({ a: ni, b: pi, strength: 0.7 });
    }
    if (n.projectId) {
      const proj = projects.find((pr) => pr.id === n.projectId);
      if (proj) {
        const pri = pushEntity(`project:${proj.id}`, "project", proj.name);
        synapses.push({ a: ni, b: pri, strength: 0.45 });
      }
    }
  }
  for (const c of captures) {
    pushEntity(`capture:${c.id}`, "capture", c.cleanedTitle);
  }
  for (const pr of projects) {
    pushEntity(`project:${pr.id}`, "project", pr.name);
  }

  const particles = [...ambient, ...entities];

  // Ambient local synapses — connect nearby ambient particles for the constellation look.
  // fillScreen inflates the cortex, so the link radius must grow with it.
  const sample = Math.min(ambient.length, fillScreen ? 1100 : 900);
  const step = Math.max(1, Math.floor(ambient.length / sample));
  const linkRadius = fillScreen ? 0.16 : 0.085;
  const linkChance = fillScreen ? 0.18 : 0.35;
  const neighborScan = fillScreen ? 65 : 40;
  for (let i = 0; i < ambient.length; i += step) {
    const a = ambient[i]!;
    const neighbors: { j: number; d: number }[] = [];
    for (let j = i + step; j < Math.min(ambient.length, i + step * neighborScan); j += step) {
      const b = ambient[j]!;
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const dz = a.z - b.z;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < linkRadius) neighbors.push({ j, d });
    }
    neighbors.sort((x, y) => x.d - y.d);
    const links = fillScreen ? 2 : 1;
    for (const n of neighbors.slice(0, links)) {
      if (hash(i * 41.2 + n.j) > linkChance) {
        synapses.push({
          a: i,
          b: n.j,
          strength: fillScreen ? 0.32 + (linkRadius - n.d) * 2.8 : 0.18 + (0.085 - n.d) * 4,
        });
      }
    }
  }

  // Soft ring connections among entity hubs so the memory graph reads as a network.
  const entityStart = ambient.length;
  for (let i = entityStart; i < particles.length; i++) {
    for (let j = i + 1; j < Math.min(particles.length, i + 4); j++) {
      if (hash(i * 7 + j * 13) > 0.55) {
        synapses.push({ a: i, b: j, strength: 0.25 });
      }
    }
  }

  return { particles, synapses };
}

export type ProjectedPoint = {
  x: number;
  y: number;
  depth: number;
  particle: BrainParticle;
  index: number;
};

/** Project 3D brain coords into canvas space with slow rotation. */
export function projectParticles(
  particles: BrainParticle[],
  width: number,
  height: number,
  time: number,
  pointer: { x: number; y: number },
  fillScreen = false,
): ProjectedPoint[] {
  const cx = fillScreen ? width * 0.5 : width * 0.58;
  const cy = fillScreen ? height * 0.46 : height * 0.42;
  // fillScreen: large brain silhouette covering most of the viewport (not a full wash).
  const scale = fillScreen
    ? Math.min(width, height) * 0.82
    : Math.min(width, height) * 0.42;
  const rotY = time * 0.12 + pointer.x * 0.35;
  const rotX = (fillScreen ? 0.12 : 0.25) + pointer.y * 0.2;
  const cosY = Math.cos(rotY);
  const sinY = Math.sin(rotY);
  const cosX = Math.cos(rotX);
  const sinX = Math.sin(rotX);

  return particles.map((p, index) => {
    const pulse = 1 + Math.sin(time * 1.4 + p.phase) * 0.03;
    let x = p.x * pulse;
    let y = p.y * pulse;
    let z = p.z * pulse;

    // Rotate Y then X.
    const xz = x * cosY - z * sinY;
    z = x * sinY + z * cosY;
    x = xz;
    const yz = y * cosX - z * sinX;
    z = y * sinX + z * cosX;
    y = yz;

    const perspective = 2.4 / (2.4 + z);
    return {
      x: cx + x * scale * perspective,
      y: cy + y * scale * perspective,
      depth: z,
      particle: p,
      index,
    };
  });
}
