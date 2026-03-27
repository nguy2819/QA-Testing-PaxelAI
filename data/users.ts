// ─────────────────────────────────────────────────────────────────────────────
// Impersonation matrix — the single source of truth for all 9 QA users.
// DO NOT reorder. Tests iterate this array in sequence (QA execution rule).
// ─────────────────────────────────────────────────────────────────────────────

export type UserRole = 'sales_rep' | 'director' | 'executive';

export interface PaxelUser {
  /** First name only — used for impersonation search (search by first name, rule #4) */
  firstName: string;
  /** Exact full name — used to select the correct result row */
  fullName: string;
  /** Exact company name — used to disambiguate users with the same first name */
  company: string;
  role: UserRole;
}

export const IMPERSONATION_MATRIX: PaxelUser[] = [
  // ── Nexus Pharmaceuticals ────────────────────────────────────────────────
  { firstName: 'David',    fullName: 'David Farris',      company: 'Nexus Pharmaceuticals',   role: 'sales_rep'  },
  { firstName: 'Trenton',  fullName: 'Trenton Lovell',    company: 'Nexus Pharmaceuticals',   role: 'director'   },
  { firstName: 'Karen',    fullName: 'Karen Kirkland',    company: 'Nexus Pharmaceuticals',   role: 'executive'  },

  // ── Caplin Steriles USA Inc ──────────────────────────────────────────────
  { firstName: 'Michelle', fullName: 'Michelle Hupfer',   company: 'Caplin Steriles USA Inc', role: 'sales_rep'  },
  { firstName: 'Rob',      fullName: 'Rob Bloomer',       company: 'Caplin Steriles USA Inc', role: 'director'   },
  { firstName: 'Sagar',    fullName: 'Sagar Patel',       company: 'Caplin Steriles USA Inc', role: 'executive'  },

  // ── Rich Pharmaceuticals ─────────────────────────────────────────────────
  { firstName: 'Rich',     fullName: 'Rich Closer',       company: 'Rich Pharmaceuticals',    role: 'sales_rep'  },
  { firstName: 'Victor',   fullName: 'Victor Pipeline',   company: 'Rich Pharmaceuticals',    role: 'director'   },
  { firstName: 'Natalie',  fullName: 'Natalie Northstar', company: 'Rich Pharmaceuticals',    role: 'executive'  },
];

// ── Convenience subsets ───────────────────────────────────────────────────────

/** One user per role from Nexus — used for smoke tests (fast, high-value) */
export const SMOKE_USERS: PaxelUser[] = [
  IMPERSONATION_MATRIX[0], // David Farris    — Sales Rep
  IMPERSONATION_MATRIX[1], // Trenton Lovell  — Director
  IMPERSONATION_MATRIX[2], // Karen Kirkland  — Executive
];

export const SALES_REPS = IMPERSONATION_MATRIX.filter(u => u.role === 'sales_rep');
export const DIRECTORS   = IMPERSONATION_MATRIX.filter(u => u.role === 'director');
export const EXECUTIVES  = IMPERSONATION_MATRIX.filter(u => u.role === 'executive');
