// Mermaid 本地运行时由 build 按需内嵌；单张图失败不会中断其他图或反馈。
(() => {
  const cards = [...document.querySelectorAll('[data-mermaid-card]')];
  if (!cards.length) return;
  const fail = (card, error) => {
    card.dataset.diagramState = 'error';
    card.querySelector('.diagram-status').textContent = `图示暂时无法绘制，请查看源码。${error?.message ? ' ' + error.message.slice(0, 240) : ''}`;
    card.querySelector('.diagram-source').open = true;
  };
  async function copySource(card) {
    const source = card.querySelector('.diagram-source code').textContent;
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(source);
      else throw new Error('Clipboard API unavailable');
    } catch {
      const active = document.activeElement, input = document.createElement('textarea');
      input.value = source; input.style.cssText = 'position:fixed;left:-9999px;top:0';
      document.body.append(input); input.select();
      let copied = false;
      try { copied = document.execCommand('copy'); } catch {} finally { input.remove(); active?.focus({ preventScroll: true }); }
      if (!copied) {
        card.querySelector('.diagram-source').open = true;
        card.querySelector('.diagram-status').textContent = '未能自动复制，请在展开的源码中选择并复制。';
        return;
      }
    }
    card.querySelector('.diagram-status').textContent = '已复制 Mermaid 源码。';
  }
  cards.forEach(card => card.querySelector('[data-diagram-copy]').addEventListener('click', () => copySource(card)));
  async function renderAll() {
    try {
      if (!globalThis.mermaid) throw new Error('离线绘图资源未就绪。');
      mermaid.initialize({
        startOnLoad: false, securityLevel: 'strict', suppressErrorRendering: true,
        htmlLabels: false, theme: 'base', fontFamily: 'system-ui, "PingFang SC", "Microsoft YaHei", sans-serif',
        themeVariables: { primaryColor: '#e9eef4', primaryTextColor: '#2b2b2b', primaryBorderColor: '#4d6a8a', lineColor: '#6b6b68', secondaryColor: '#ecebe8', tertiaryColor: '#f4eedd', fontSize: '16px' },
        flowchart: { htmlLabels: false },
      });
      await document.fonts?.ready;
    } catch (error) { cards.forEach(card => fail(card, error)); return; }
    for (const [i, card] of cards.entries()) {
      try {
        const source = card.querySelector('.diagram-source code').textContent;
        await mermaid.parse(source);
        const { svg } = await mermaid.render(`pm-mermaid-${i}`, source);
        const stage = card.querySelector('.diagram-stage'), view = card.querySelector('.diagram-view');
        stage.innerHTML = svg;
        const drawing = stage.querySelector('svg'), box = drawing?.viewBox.baseVal;
        if (!box?.width || !box?.height) throw new Error('图示没有有效尺寸。');
        drawing.setAttribute('role', 'img');
        drawing.setAttribute('aria-label', card.querySelector('figcaption').textContent);
        const width = box.width, height = box.height;
        let zoom = 1, mode = 'readable';
        const resize = () => {
          if (mode !== 'manual') zoom = Math.min(1, Math.max(mode === 'fit' ? 0.05 : 0.75, (view.clientWidth - 26) / width));
          drawing.style.maxWidth = 'none'; drawing.style.width = `${width * zoom}px`; drawing.style.height = `${height * zoom}px`;
          card.querySelector('.diagram-scale').textContent = `${Math.round(zoom * 100)}%`;
          card.querySelector('.diagram-hint').textContent = width * zoom > view.clientWidth - 26 ? '图较宽，可横向滚动，或点击“适应宽度”查看全图。' : '';
        };
        for (const button of card.querySelectorAll('[data-diagram-zoom]')) {
          button.disabled = false;
          button.addEventListener('click', () => {
            const action = button.dataset.diagramZoom;
            mode = action === 'fit' ? 'fit' : 'manual';
            if (mode === 'manual') zoom = action === 'actual' ? 1 : Math.max(0.05, Math.min(3, zoom * (action === 'in' ? 1.25 : 0.8)));
            resize();
          });
        }
        new ResizeObserver(resize).observe(view);
        card.querySelector('.diagram-source').open = false;
        card.querySelector('.diagram-status').textContent = '';
        card.dataset.diagramState = 'ready';
        resize();
      } catch (error) { fail(card, error); }
    }
  }
  renderAll();
})();
