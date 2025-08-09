// app.js — funciona com ou sem elementos “extras” (modo e download)
const $ = (id) => document.getElementById(id);

const fileInput = $('fileInput');
const sendBtn = $('sendBtn');
const out = $('out');
const modeSel = $('mode');          // <select id="mode"> (opcional)
const downloadBtn = $('downloadBtn'); // <button id="downloadBtn"> (opcional)

if (sendBtn) {
  sendBtn.addEventListener('click', async () => {
    const file = fileInput && fileInput.files ? fileInput.files[0] : null;
    if (!file) {
      alert('Selecione um arquivo (PDF, DOCX ou TXT).');
      return;
    }

    const mode = modeSel ? modeSel.value : 'detailed';
    const form = new FormData();
    form.append('file', file);

    if (out) out.textContent = 'Processando...';

    try {
      const r = await fetch(`/api/summarize?mode=${encodeURIComponent(mode)}`, {
        method: 'POST',
        body: form
      });

      // tenta ler JSON; se vier texto puro de erro, trata abaixo
      let data = null;
      try {
        data = await r.json();
      } catch (_) {
        const txt = await r.text();
        throw new Error(txt || 'Erro desconhecido');
      }

      if (!r.ok) {
        throw new Error(data.error || 'Erro ao resumir');
      }

      if (out) out.textContent = data.summary || '(sem conteúdo)';
    } catch (e) {
      if (out) out.textContent = 'Erro: ' + (e.message || e);
    }
  });
}

// Baixar resumo como .txt
if (downloadBtn) {
  downloadBtn.addEventListener('click', () => {
    const content = out ? out.textContent : '';
    const blob = new Blob([content || ''], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'resumo.txt';
    a.click();
    URL.revokeObjectURL(url);
  });
}
