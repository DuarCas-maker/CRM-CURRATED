import test from "node:test";
import assert from "node:assert/strict";
import {
  changeSnapshot,
  leaveState,
  type ChangeProtection,
} from "../src/lib/unsaved-changes";

test("restoring original fields and removing selections returns to the saved snapshot", () => {
  const original = { name: "Acme", owners: [{ name: "Owner" }], files: [] };
  const baseline = changeSnapshot(original);
  assert.notEqual(changeSnapshot({ ...original, name: "Changed" }), baseline);
  assert.notEqual(
    changeSnapshot({ ...original, files: ["attachment"] }),
    baseline,
  );
  assert.equal(
    changeSnapshot({ files: [], owners: [{ name: "Owner" }], name: "Acme" }),
    baseline,
  );
});

test("saved baselines compare complete drafts, including attachment identity and recipients", () => {
  const draft = {
    body: "Hello",
    uploads: ["file-1"],
    cc: ["copy@example.test"],
  };
  const saved = changeSnapshot(draft);
  assert.equal(changeSnapshot(structuredClone(draft)), saved);
  assert.notEqual(changeSnapshot({ ...draft, uploads: ["file-2"] }), saved);
  assert.notEqual(changeSnapshot({ ...draft, cc: [] }), saved);
  assert.notEqual(changeSnapshot({ ...draft, body: "Hello again" }), saved);
  // A failed save retains the old baseline; only success replaces it.
  const modified = { ...draft, body: "Hello again" };
  assert.notEqual(changeSnapshot(modified), saved);
  const afterSuccess = changeSnapshot(modified);
  assert.equal(changeSnapshot(modified), afterSuccess);
});

function element(parent?: HTMLElement): HTMLElement {
  const children = new Set<HTMLElement>();
  const node = {
    contains: (candidate: HTMLElement) => children.has(candidate),
  } as HTMLElement;
  if (parent)
    (parent as HTMLElement & { add: (node: HTMLElement) => void }).add(node);
  Object.assign(node, { add: (child: HTMLElement) => children.add(child) });
  return node;
}
function entry(
  node: HTMLElement | null,
  dirty = false,
  busy = false,
): ChangeProtection {
  return { element: () => node, dirty: () => dirty, busy: () => busy };
}

test("closing a nested informational dialog ignores dirty fields in its parent", () => {
  const outer = element(),
    inner = element(outer);
  const entries = [entry(outer, true), entry(inner)];
  assert.deepEqual(leaveState(entries, inner), { dirty: false, busy: false });
  assert.deepEqual(leaveState(entries, outer), { dirty: true, busy: false });
});

test("dirty nested forms protect their own dialog and the containing editor", () => {
  const outer = element(),
    inner = element(outer);
  const entries = [entry(outer), entry(inner, true)];
  assert.deepEqual(leaveState(entries, inner), { dirty: true, busy: false });
  assert.deepEqual(leaveState(entries, outer), { dirty: true, busy: false });
});

test("operations in progress block discarding, even after a clean save", () => {
  const outer = element(),
    inner = element(outer),
    unrelated = element();
  const entries = [entry(inner, false, true), entry(unrelated, true)];
  assert.deepEqual(leaveState(entries, outer), { dirty: false, busy: true });
  assert.deepEqual(leaveState(entries, unrelated), {
    dirty: true,
    busy: false,
  });
});

test("page unload aggregates editors and ignores unmounted forms", () => {
  assert.deepEqual(leaveState([entry(null, true, true)]), {
    dirty: false,
    busy: false,
  });
  assert.deepEqual(leaveState([entry(element()), entry(element(), true)]), {
    dirty: true,
    busy: false,
  });
  assert.deepEqual(leaveState([entry(element())]), {
    dirty: false,
    busy: false,
  });
});
