function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Telegram xabar matni + entities (bold/italic) -> HTML
function messageToHtml(text, entities) {
  if (!text) return '';
  if (!entities || entities.length === 0) return escapeHtml(text).replace(/\n/g, '<br>');

  const points = new Set([0, text.length]);
  entities.forEach(e => {
    points.add(e.offset);
    points.add(e.offset + e.length);
  });
  const sorted = Array.from(points).sort((a, b) => a - b);

  let html = '';
  for (let i = 0; i < sorted.length - 1; i++) {
    const start = sorted[i];
    const end = sorted[i + 1];
    const chunk = escapeHtml(text.slice(start, end));
    const active = entities.filter(e => e.offset <= start && e.offset + e.length >= end && e.length > 0);
    let openTags = '';
    let closeTags = '';
    active.forEach(e => {
      if (e.type === 'bold') { openTags += '<b>'; closeTags = '</b>' + closeTags; }
      if (e.type === 'italic') { openTags += '<i>'; closeTags = '</i>' + closeTags; }
      if (e.type === 'underline') { openTags += '<u>'; closeTags = '</u>' + closeTags; }
    });
    html += openTags + chunk + closeTags;
  }
  return html.replace(/\n/g, '<br>');
}

module.exports = { messageToHtml, escapeHtml };
