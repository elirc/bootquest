// FIXTURE (W6 mutation gate): the module whose tests get gutted in the "gutted" variant.
export function slugify(title) {
  return title.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export function isSlug(s) {
  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(s);
}
