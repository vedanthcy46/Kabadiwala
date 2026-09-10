// src/utils/categoryAliases.js
// Single source of truth for e-waste material category aliases.
//
// WHY THIS EXISTS:
//   The DB, XLSX dataset, and recycler profiles use slightly different names
//   for the same material (e.g. "Motor" vs "Motor/Magnet Assembly"). All alias
//   resolution logic was previously duplicated across 7+ files as hardcoded
//   OR chains.  This module centralises it so adding a new material type only
//   requires a one-line change here.
//
// CANONICAL IDs (match MATERIAL_CATEGORIES in frontend/src/api/client.js):
//   PCB, LCD, CRT, Cable, Battery, Motor, Plastic

/** @type {Record<string, string[]>} canonical → [all aliases including self] */
export const CATEGORY_ALIAS_MAP = {
  PCB:     ['PCB', 'PCBs'],
  LCD:     ['LCD', 'LCD Panel', 'LCD Panels', 'LCDs'],
  CRT:     ['CRT', 'CRTs'],
  Cable:   ['Cable', 'Cables'],
  Battery: ['Battery', 'Batteries'],
  Motor:   ['Motor', 'Motors', 'Motor/Magnet Assembly'],
  Plastic: ['Plastic', 'Plastics', 'Mixed Plastic', 'Mixed Plastics'],
};

/**
 * Return all known aliases for a given category name (canonical or alias).
 * Always returns an array containing at minimum the input itself.
 *
 * @param {string} cat - Any known category name or alias
 * @returns {string[]}
 */
export function getCategoryAliases(cat) {
  if (!cat) return [];
  // Direct canonical lookup
  if (CATEGORY_ALIAS_MAP[cat]) return CATEGORY_ALIAS_MAP[cat];
  // Search through all alias arrays
  for (const aliases of Object.values(CATEGORY_ALIAS_MAP)) {
    if (aliases.includes(cat)) return aliases;
  }
  // Unknown category — return it as-is (future-proof)
  return [cat];
}

/**
 * Resolve any alias to its canonical ID (used in MATERIAL_CATEGORIES).
 * e.g. 'Motor/Magnet Assembly' → 'Motor', 'Mixed Plastic' → 'Plastic'
 *
 * @param {string} cat
 * @returns {string}
 */
export function normalizeCategory(cat) {
  if (!cat) return cat;
  for (const [canonical, aliases] of Object.entries(CATEGORY_ALIAS_MAP)) {
    if (aliases.includes(cat)) return canonical;
  }
  return cat; // unknown — pass through unchanged
}

/**
 * Build a SQL fragment that matches material_category against all known
 * aliases of the given category.  Uses `= ANY(ARRAY[...]::text[])` which
 * leverages the existing index on material_category.
 *
 * Usage:
 *   const [sqlFrag, aliases] = buildCategorySQL('$1', cat, 'material_category');
 *   // sqlFrag = "material_category = ANY(ARRAY['Motor','Motors','Motor/Magnet Assembly']::text[])"
 *   // pass aliases as the positional parameter value
 *
 * @param {string} column  - column name (default 'material_category')
 * @param {string} cat     - category to expand
 * @returns {[string, string[]]}  [sql fragment, alias array to bind]
 */
export function buildCategorySQL(column = 'material_category', cat) {
  const aliases = getCategoryAliases(cat);
  // Build a static IN list — safe because values come from our own constant map
  const inList = aliases.map(a => `'${a.replace(/'/g, "''")}'`).join(', ');
  return [`${column} IN (${inList})`, aliases];
}

/**
 * Build the SQL WHERE fragment for a parameterised query.
 * The caller binds `aliases` as a text[] parameter.
 *
 * Usage:
 *   const frag = buildCategorySQLParam('material_category', '$1');
 *   // frag = "material_category = ANY($1::text[])"
 *   // bind value: getCategoryAliases(cat)
 *
 * @param {string} column
 * @param {string} paramRef - e.g. '$1', '$3'
 * @returns {string}
 */
export function buildCategorySQLParam(column = 'material_category', paramRef = '$1') {
  return `${column} = ANY(${paramRef}::text[])`;
}
