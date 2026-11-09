// Runs in the page before the app, like upstream's `lang` init script in fixtures.ts.
export const galleryInitScript = () => {
  if (!location.protocol.startsWith('http')) {
    return;
  }

  // The page lives for the whole worker, so localStorage outlives a test: an info panel one test opened
  // (`asset-viewer-state`) was still open in the next. Mock teardown clears cookies after every test, so a
  // missing marker cookie means this is the test's first page load: start it from clean storage.
  if (!document.cookie.includes('gallery_medium_test=1')) {
    const lang = localStorage.getItem('lang');
    localStorage.clear();
    sessionStorage.clear();
    if (lang) {
      localStorage.setItem('lang', lang);
    }
    document.cookie = 'gallery_medium_test=1; path=/';
  }

  // Gallery's /photos opens with the filter panel beside the timeline; collapsing it gives upstream's specs the
  // full-width grid they were written against. A spec about the panel can expand it.
  localStorage.setItem('gallery-filter-collapsed', 'true');
};
