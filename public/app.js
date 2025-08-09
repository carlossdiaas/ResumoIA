const fileInput = document.getElementById('fileInput');
const sendBtn = document.getElementById('sendBtn');
const modeSel = document.getElementById('mode');
const out = document.getElementById('out');
const downloadBtn = document.getElementById('downloadBtn');

sendBtn.addEventListener('click', async () => {
  const file = fileInput.files[0];
  if (!file) return alert('Selecione um arquivo (PDF, DOCX ou TXT).');

  const form = new FormData();
  form.append('file', file);

  out.textContent = 'Processando...';

  try {
    const r = await fetch(`/api/summarize?mode=${encodeURIComponent(modeSel.value)}`, {
      method: 'POST',
      body: form
    });

    // tenta ler JSON
    let data = null;
    try {
      data = await r.json();
    } catch {
      const txt = await r.text();
      throw new Error(txt || 'Erro desconhecido');
    }

    if (!r.ok) {
      throw new Error(data.error || 'Erro ao resumir');
    }

    out.textContent = data.summary || '(sem conteúdo)';
  } catch (e) {
    out.textContent = 'Erro: ' + (e.message || e);
  }
});

downloadBtn.addEventListener('click', () => {
  const blob = new Blob([out.textContent || ''], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'resumo.txt';
  a.click();
  URL.revokeObjectURL(url);
});
