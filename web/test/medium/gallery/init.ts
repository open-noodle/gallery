// Runs in the page before the app, like upstream's `lang` init script in fixtures.ts. Gallery's /photos opens with
// the filter panel beside the timeline; collapsing it gives upstream's specs the full-width grid they were written
// against. A spec about the panel can expand it.
export const galleryInitScript = () => {
  if (location.protocol.startsWith('http')) {
    localStorage.setItem('gallery-filter-collapsed', 'true');
  }
};
