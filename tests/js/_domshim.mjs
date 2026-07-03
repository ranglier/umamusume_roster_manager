// Minimal document/window stand-ins so src/ui/assets/js/core.js (and anything
// that imports it) can be loaded under plain Node for unit testing pure
// logic. Import this file first, before any module that imports core.js.
//
// core.js queries a couple dozen DOM elements at module top level (e.g.
// `const searchInput = document.getElementById("searchInput")`), and it
// imports back from app.js (for requestRender), whose deferred boot()
// wiring runs on the next microtask once app.js loads. We don't exercise
// boot() here, but Node's default unhandled-rejection behavior is to crash
// the process, so any late async failure inside it (e.g. a missing fetch)
// must not be allowed to bring down an unrelated test run.

class FakeElement {
  constructor() {
    this.classList = { add() {}, remove() {}, toggle() {}, contains: () => false };
    this.style = {};
    this.dataset = {};
  }

  addEventListener() {}

  removeEventListener() {}

  querySelector() {
    return null;
  }

  querySelectorAll() {
    return [];
  }
}

globalThis.document = {
  getElementById: () => new FakeElement(),
  querySelector: () => new FakeElement(),
  querySelectorAll: () => [],
  addEventListener: () => {},
};

globalThis.window = {
  location: { hash: "" },
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  addEventListener: () => {},
  requestAnimationFrame: () => {},
  scrollTo: () => {},
  UMA_REFERENCE_DATA: null,
};

process.on("unhandledRejection", () => {});
