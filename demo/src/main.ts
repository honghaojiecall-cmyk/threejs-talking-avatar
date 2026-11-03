import { PortraitApp } from './portrait/PortraitApp';

const canvas = document.querySelector<HTMLCanvasElement>('#portrait-canvas');

if (!canvas) {
  throw new Error('Missing #portrait-canvas element.');
}

const portrait = new PortraitApp(canvas);
portrait.start();

const sidebar = document.querySelector<HTMLElement>('.speech-studio');
const sidebarToggle = document.querySelector<HTMLButtonElement>('#sidebar-toggle');
sidebarToggle?.addEventListener('click', () => {
  const collapsed = sidebar?.classList.toggle('is-collapsed') ?? false;
  sidebarToggle.classList.toggle('is-collapsed', collapsed);
  sidebarToggle.setAttribute('aria-expanded', String(!collapsed));
  sidebarToggle.setAttribute('aria-label', collapsed ? '展开面板' : '隐藏面板');
});

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    portrait.dispose();
  });
}
