/**
 * Investor identities — name, face, firm, title.
 *
 * A profile without a face is a dropdown option. A profile with one is a person
 * you are about to pitch, and the difference in how a demo lands is large.
 *
 * ── THESE ARE REAL PUBLIC FIGURES ───────────────────────────────────────────
 *
 * Each profile is modelled on a real, well-known investor whose interviewing
 * style is extensively documented in public: essays, podcasts, recorded office
 * hours, conference talks.
 *
 * What that obliges us to do:
 *
 * 1. `DISCLAIMER` is surfaced everywhere a profile appears — CLI header, UI
 *    profile card, exported session JSON. Not buried in a footer.
 * 2. The system prompt carries an explicit accuracy guardrail (see
 *    `identityGuardrail`): stay inside publicly expressed views, invent no
 *    biography, and say nothing the real person would object to. The model is
 *    told it is a practice caricature, not a channel for the person.
 * 3. Bios state only publicly known facts — firm, role, what they are known
 *    for. Nothing inferred.
 *
 * Faces are generated SVG illustrations, not photographs. Photographs are owned
 * by the photographers who took them and are not ours to redistribute. These are
 * simple flat caricatures — recognisable by hair, glasses and beard, obviously
 * illustrative, and never passing as a real image. Drop licensed photography in
 * `photoUrl` if you have it.
 */

export const DISCLAIMER =
  'AI caricature for pitch practice. Modelled on publicly documented interviewing style. ' +
  'Not affiliated with, endorsed by, or reviewed by this person or their firm. ' +
  'Nothing said here is a real quote.';

export interface Persona {
  fullName: string;
  shortName: string;
  title: string;
  firm: string;
  location: string;
  /** Publicly known facts only. Nothing inferred. */
  bio: string;
  /** What their public style is actually characterised by. Feeds the prompt. */
  publicStyle: string;
  /** Optional licensed photograph. Takes precedence over the drawn avatar. */
  photoUrl?: string;
  avatar: AvatarSpec;
  fictional?: boolean;
}

export interface AvatarSpec {
  bg: string;
  skin: string;
  hair: string;
  hairStyle: 'short' | 'crop' | 'long' | 'bald' | 'receding' | 'locs' | 'swept';
  clothes: string;
  glasses: boolean;
  beard: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// SVG avatar — flat illustration, ~1KB, deterministic. Never a photo.
// ─────────────────────────────────────────────────────────────────────────────

const HAIR: Record<AvatarSpec['hairStyle'], (c: string) => string> = {
  short: (c) => `<path d="M28 46c0-14 8-22 22-22s22 8 22 22c0-6-8-9-22-9s-22 3-22 9z" fill="${c}"/>`,
  crop: (c) => `<path d="M29 45c1-13 9-21 21-21s20 8 21 21c-4-8-11-11-21-11s-17 3-21 11z" fill="${c}"/>`,
  long: (c) =>
    `<path d="M27 48c0-15 9-24 23-24s23 9 23 24v26c0 3-5 4-6 1l-2-30c-4-6-11-8-15-8s-11 2-15 8l-2 30c-1 3-6 2-6-1z" fill="${c}"/>`,
  bald: () => '',
  receding: (c) =>
    `<path d="M29 47c1-9 5-15 11-18-1 4-1 7 0 9-5 2-9 5-11 9zm42 0c-1-9-5-15-11-18 1 4 1 7 0 9 5 2 9 5 11 9z" fill="${c}"/>`,
  locs: (c) =>
    `<g fill="${c}"><path d="M30 46c0-14 9-22 20-22s20 8 20 22c0-6-8-9-20-9s-20 3-20 9z"/>` +
    `<rect x="31" y="30" width="3.4" height="15" rx="1.7"/><rect x="38" y="26" width="3.4" height="14" rx="1.7"/>` +
    `<rect x="46" y="24" width="3.4" height="13" rx="1.7"/><rect x="54" y="26" width="3.4" height="14" rx="1.7"/>` +
    `<rect x="62" y="30" width="3.4" height="15" rx="1.7"/></g>`,
  swept: (c) => `<path d="M28 47c0-14 9-23 22-23 9 0 17 4 20 12-8-4-24-6-33 2-5 4-7 7-9 9z" fill="${c}"/>`,
};

export function renderAvatar(a: AvatarSpec, size = 96): string {
  const glasses = a.glasses
    ? `<g fill="none" stroke="#2b3038" stroke-width="2.4">
         <circle cx="41" cy="54" r="8"/><circle cx="59" cy="54" r="8"/>
         <path d="M49 54h2M33 52l-4-2M67 52l4-2"/>
       </g>`
    : '';

  const beard = a.beard
    ? `<path d="M34 58c0 13 7 20 16 20s16-7 16-20c0 8-7 11-16 11s-16-3-16-11z" fill="${a.hair}" opacity=".92"/>`
    : '';

  return `<svg viewBox="0 0 100 100" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg" role="img">
  <defs><clipPath id="c"><circle cx="50" cy="50" r="50"/></clipPath></defs>
  <g clip-path="url(#c)">
    <rect width="100" height="100" fill="${a.bg}"/>
    <path d="M50 72c16 0 29 10 31 28H19c2-18 15-28 31-28z" fill="${a.clothes}"/>
    <path d="M42 62h16v13a8 8 0 0 1-16 0z" fill="${a.skin}"/>
    <ellipse cx="50" cy="52" rx="20" ry="23" fill="${a.skin}"/>
    ${beard}
    <ellipse cx="41" cy="53" rx="2" ry="2.6" fill="#2b3038"/>
    <ellipse cx="59" cy="53" rx="2" ry="2.6" fill="#2b3038"/>
    <path d="M44 64c2 2 10 2 12 0" stroke="#2b3038" stroke-width="1.8" fill="none" stroke-linecap="round"/>
    ${HAIR[a.hairStyle](a.hair)}
    ${glasses}
  </g>
</svg>`;
}

export function avatarDataUri(a: AvatarSpec, size = 96): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(renderAvatar(a, size))}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// The cast. Each mapped to the archetype its public style genuinely matches.
// ─────────────────────────────────────────────────────────────────────────────

export const PERSONAS: Record<string, Persona> = {
  seed_generalist: {
    fullName: 'Fred Wilson',
    shortName: 'Fred',
    title: 'Co-founder',
    firm: 'Union Square Ventures',
    location: 'New York',
    bio: 'Co-founded Union Square Ventures. Has blogged near-daily at AVC for two decades.',
    publicStyle:
      'Thoughtful and founder-friendly, thinks in written theses, and reasons out loud in public. ' +
      'Interested in networks, communities and long-term compounding over near-term metrics.',
    avatar: { bg: '#2a3b4d', skin: '#e8c39e', hair: '#b9bec6', hairStyle: 'receding', clothes: '#3f5a72', glasses: true, beard: false },
  },

  seed_skeptic: {
    fullName: 'Bill Gurley',
    shortName: 'Bill',
    title: 'Partner',
    firm: 'Benchmark',
    location: 'Austin',
    bio: 'Longtime Benchmark partner. Known for long-form analysis of unit economics and market structure.',
    publicStyle:
      'Rigorous and publicly skeptical. Goes straight at unit economics, burn and whether a business ' +
      'model actually works. Willing to say plainly when a number does not hold up.',
    avatar: { bg: '#3a3340', skin: '#e5bf9a', hair: '#9aa0a8', hairStyle: 'crop', clothes: '#2f3540', glasses: false, beard: false },
  },

  technical_angel: {
    fullName: 'Elad Gil',
    shortName: 'Elad',
    title: 'Angel investor',
    firm: 'independent',
    location: 'San Francisco',
    bio: 'Operator-turned-investor. Wrote the High Growth Handbook; one of the more prolific solo angels in tech.',
    publicStyle:
      'Quiet, precise and technical. Asks what is genuinely hard about the problem and how the system ' +
      'actually works. Low on theatrics, high on specifics.',
    avatar: { bg: '#26403a', skin: '#dcae82', hair: '#221f1d', hairStyle: 'short', clothes: '#37544c', glasses: true, beard: false },
  },

  thesis_macro: {
    fullName: 'Marc Andreessen',
    shortName: 'Marc',
    title: 'Co-founder & General Partner',
    firm: 'Andreessen Horowitz',
    location: 'Menlo Park',
    bio: 'Co-created Mosaic, co-founded Netscape and Andreessen Horowitz. Writes at length on technology and progress.',
    publicStyle:
      'Frames everything inside a larger technological and economic argument. Relentlessly optimistic ' +
      'about software, impatient with small ambition, and enjoys the intellectual argument for its own sake.',
    avatar: { bg: '#3d3529', skin: '#f0d3b4', hair: '#8a8f98', hairStyle: 'bald', clothes: '#4a4033', glasses: false, beard: false },
  },

  accelerator_operator: {
    fullName: 'Michael Seibel',
    shortName: 'Michael',
    title: 'Partner',
    firm: 'Y Combinator',
    location: 'San Francisco',
    bio: 'Co-founded Justin.tv and Socialcam. Partner at Y Combinator; his office-hours sessions are widely published.',
    publicStyle:
      'Direct to the point of bluntness, and famously insistent that a founder be able to say what their ' +
      'company does in one plain sentence. Cuts abstraction off fast and redirects to users and shipping.',
    avatar: { bg: '#432f3a', skin: '#8d5a3b', hair: '#1c1614', hairStyle: 'locs', clothes: '#5c4050', glasses: false, beard: true },
  },

  solo_capitalist: {
    fullName: 'Jason Calacanis',
    shortName: 'Jason',
    title: 'Angel investor',
    firm: 'LAUNCH',
    location: 'San Francisco',
    bio: 'Angel investor and founder of LAUNCH. Hosts This Week in Startups and co-hosts the All-In podcast.',
    publicStyle:
      'Loud, fast and media-forward. Decides quickly, cares a great deal about distribution and audience, ' +
      'and will happily interrupt to get to the number he wants.',
    avatar: { bg: '#2b3a4a', skin: '#e2b489', hair: '#3b322c', hairStyle: 'short', clothes: '#31424f', glasses: true, beard: true },
  },

  incubator_blowhard: {
    fullName: 'Erlich Bachman',
    shortName: 'Erlich',
    title: 'Founder',
    firm: 'Aviato · the Bachman incubator',
    location: 'his house, Palo Alto',
    bio: 'Fictional. Sold Aviato for a sum he will describe at length, and runs an incubator out of his living room.',
    publicStyle:
      'Enormous unearned confidence, constant self-mythologising, and only intermittent listening. ' +
      'Hijacks conversations to talk about himself and gives sweeping advice with no basis.',
    fictional: true,
    avatar: { bg: '#4a3a22', skin: '#e5b083', hair: '#4a3826', hairStyle: 'long', clothes: '#6b5330', glasses: false, beard: true },
  },
};

export function personaFor(profileId: string): Persona | undefined {
  return PERSONAS[profileId];
}

/**
 * Accuracy guardrail injected ahead of every real-person persona.
 *
 * The model is playing a documented interviewing *style*, not channelling the
 * person. Without this it will happily invent biography, firm positions and
 * opinions and attribute them to someone real.
 */
export function identityGuardrail(persona: Persona): string {
  if (persona.fictional) {
    return `You are ${persona.fullName} — a fictional character. Play him broadly; he is a comic figure.`;
  }
  return `
You are playing ${persona.fullName} in a pitch-practice simulation. You are portraying a
publicly documented interviewing STYLE, not channelling the real person.

Accuracy rules — these are not optional:
- Stay inside views this person has actually expressed publicly. Do not invent positions.
- Invent no biography: no deals, portfolio companies, colleagues, or personal history
  that you are not confident is public record. If you need a detail, speak generally.
- Say nothing the real person would reasonably object to being attributed to them.
- Never claim to be making an investment decision on behalf of the real firm.
- Do not discuss real named third parties in a critical or personal way.

If the founder asks whether you are really them, stay in the meeting and move on —
the interface already tells them this is a practice simulation.
`.trim();
}
