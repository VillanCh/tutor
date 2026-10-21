const header = document.querySelector('.site-header');
const menu = document.querySelector('.menu-toggle');
const links = document.querySelector('.nav-links');

const updateHeader = () => header.classList.toggle('is-scrolled', window.scrollY > 12);
window.addEventListener('scroll', updateHeader, { passive: true });
updateHeader();

function closeMenu() {
  links.classList.remove('is-open');
  menu.setAttribute('aria-expanded', 'false');
  menu.setAttribute('aria-label', '打开导航菜单');
}

menu.addEventListener('click', () => {
  const open = menu.getAttribute('aria-expanded') !== 'true';
  menu.setAttribute('aria-expanded', String(open));
  menu.setAttribute('aria-label', open ? '关闭导航菜单' : '打开导航菜单');
  links.classList.toggle('is-open', open);
});
links.addEventListener('click', (event) => {
  if (event.target.closest('a')) closeMenu();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && menu.getAttribute('aria-expanded') === 'true') {
    closeMenu();
    menu.focus();
  }
});
document.addEventListener('click', (event) => {
  if (!header.contains(event.target)) closeMenu();
});
window.matchMedia('(min-width: 761px)').addEventListener('change', closeMenu);
