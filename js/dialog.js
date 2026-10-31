// Shared lifecycle for the help and game-picker dialogs. The surrounding page
// stays inert even if a room update replaces controls behind the overlay.
let current = null;
const focusable = (root) => [...root.querySelectorAll('button, input, select, textarea, a[href], [tabindex]')]
  .filter((el) => el.tabIndex >= 0 && !el.matches(':disabled') && !el.closest('[inert]') && el.getClientRects().length);

export function openModal(el, selector, opener = document.activeElement) {
  if (current) closeModal(current.el);
  const background = [...document.body.children].filter((node) => node !== el).map((node) => [node, node.inert]);
  current = { el, opener, id: opener?.id, help: opener?.dataset?.help, background };
  background.forEach(([node]) => { node.inert = true; });
  document.body.appendChild(el);
  el.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab') return;
    const items = focusable(el), first = items[0], last = items.at(-1);
    if (!first) { event.preventDefault(); return; }
    if (event.shiftKey && (document.activeElement === first || !el.contains(document.activeElement))) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !el.contains(document.activeElement))) {
      event.preventDefault(); first.focus();
    }
  });
  (el.querySelector(selector) || focusable(el)[0])?.focus({ preventScroll: true });
}

export function closeModal(el) {
  if (!el) return;
  if (current?.el !== el) { el.remove(); return; }
  const { opener, id, help, background } = current;
  current = null;
  el.remove();
  background.forEach(([node, inert]) => { node.inert = inert; });
  const target = opener?.isConnected ? opener
    : (id && document.getElementById(id)) || (help && document.querySelector(`[data-help="${CSS.escape(help)}"]`))
      || document.querySelector('#ghMenuBtn, #pickGame, #nameIn');
  if (target && !target.closest('[inert]')) target.focus({ preventScroll: true });
}
