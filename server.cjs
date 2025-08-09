// server.cjs — CommonJS
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs').promises;
const path = require('path');
const OpenAI = require('openai');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');

const app = express();
app.use(cors());
app.use(express.static('public')); // serve /public

// -------- Upload ----------
const upload = multer({
  dest: 'uploads/',
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB
  fileFilter: (_req, file, cb) => {
    const ok = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain'
    ].includes(file.mimetype);
    cb(ok ? null : new Error('Formato inválido (use PDF, DOCX ou TXT)'), ok);
  }
});

// -------- OpenAI ----------
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// -------- Rotas ----------
app.get('/health', (_req, res) => res.send('ok'));

app.post('/api/summarize', upload.single('file'), async (req, res) => {
  // segurança básica
  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: 'OPENAI_API_KEY ausente no .env' });
  }

  const file = req.file;
  if (!file) return res.status(400).json({ error: 'Arquivo não enviado.' });

  const mode = (req.query.mode || 'detailed').toLowerCase(); // 'short' | 'detailed'

  try {
    // 1) extrair texto
    const text = (await extractText(file)).trim().replace(/\s+\n/g, '\n');
    // remove temporário, mesmo se falhar a extração
    await fs.unlink(file.path).catch(() => {});

    if (!text || text.length < 20) {
      return res.status(400).json({
        error: 'Não foi possível extrair texto. O arquivo pode estar vazio ou ser PDF escaneado (imagem).'
      });
    }

    // 2) resumir (map-reduce)
    const summary = await summarizeLongText(text, mode);

    return res.json({ summary });
  } catch (e) {
    console.error(e);
    if (e.code === 'insufficient_quota' || e.status === 429) {
      return res.status(429).json({ error: 'Limite de uso da API atingido. Verifique seu plano/créditos.' });
    }
    if (String(e.message || '').includes('Formato inválido')) {
      return res.status(400).json({ error: 'Formato inválido (use PDF, DOCX ou TXT).' });
    }
    return res.status(500).json({ error: 'Falha ao processar o documento.' });
  }
});

// -------- Start ----------
app.listen(process.env.PORT || 3000, () => {
  console.log(`Servidor rodando em http://localhost:${process.env.PORT || 3000}`);
});

// ============ Helpers ============

async function extractText(file) {
  const ext = path.extname(file.originalname || '').toLowerCase();

  if (ext === '.pdf') {
    const buf = await fs.readFile(file.path);
    const data = await pdfParse(buf);
    return data.text || '';
  }

  if (ext === '.docx') {
    const result = await mammoth.extractRawText({ path: file.path });
    return result.value || '';
  }

  // .txt (ou fallback)
  return await fs.readFile(file.path, 'utf8');
}

function chunkText(str, targetSize = 6000) {
  // divide por parágrafos para não “quebrar” no meio de frases
  const parts = [];
  let current = '';
  for (const para of str.split(/\n{2,}/)) {
    const candidate = current ? `${current}\n\n${para}` : para;
    if (candidate.length > targetSize) {
      if (current) parts.push(current);
      // se o parágrafo por si só é gigante, corta bruto
      if (para.length > targetSize) {
        for (let i = 0; i < para.length; i += targetSize) {
          parts.push(para.slice(i, i + targetSize));
        }
        current = '';
      } else {
        current = para;
      }
    } else {
      current = candidate;
    }
  }
  if (current) parts.push(current);
  return parts;
}

async function summarizeLongText(fullText, mode = 'detailed') {
  const chunks = chunkText(fullText);
  const partials = [];
  for (let i = 0; i < chunks.length; i++) {
    partials.push(await summarizeChunk(chunks[i], i + 1, chunks.length, mode));
  }
  if (partials.length === 1) return partials[0];

  const combinedPrompt =
    mode === 'short'
      ? `
Faça um único resumo em português, 5–8 frases, claro e objetivo, cobrindo os pontos essenciais do documento inteiro.
Resumos parciais:
${partials.map((s, i) => `[Parte ${i + 1}]\n${s}`).join('\n\n')}
`.trim()
      : `
Você é um assistente que sintetiza relatórios.
Junte os resumos parciais abaixo em um ÚNICO resumo claro, em português, com:
- 5 a 8 tópicos principais (bullets)
- seção "Pontos-chave" (3–5 bullets)
- seção "Ações/Próximos passos" se aplicável
Mantenha 200–300 palavras.

RESUMOS PARCIAIS:
${partials.map((s, i) => `[Parte ${i + 1}]\n${s}`).join('\n\n')}
`.trim();

  const resp = await client.responses.create({
    model: 'gpt-4.1', // pode trocar p/ 'gpt-4.1-mini' p/ reduzir custo
    input: combinedPrompt
  });
  return resp.output_text;
}

async function summarizeChunk(text, index, total, mode = 'detailed') {
  const prompt =
    mode === 'short'
      ? `
Resuma em português o trecho (${index}/${total}) em 3–5 frases objetivas, focando ideias principais e dados importantes:
"""${text}"""
`.trim()
      : `
Resuma em português o trecho (${index}/${total}). Produza:
- 1 parágrafo curto (3–5 frases)
- 3 bullets com fatos/dados
- 3–5 palavras-chave (se existirem)

Trecho:
"""${text}"""
`.trim();

  const resp = await client.responses.create({
    model: 'gpt-4.1-mini',
    input: prompt
  });
  return resp.output_text;
}
