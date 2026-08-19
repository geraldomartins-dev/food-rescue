import fs from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';

const storageDirectory = path.resolve('storage', 'comprovantes');

function formatDate(value) {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'long', timeStyle: 'short', timeZone: 'America/Sao_Paulo'
  }).format(new Date(value));
}

export function receiptPath(code) {
  if (!/^[0-9a-f-]{36}$/i.test(code)) throw new Error('Código de comprovante inválido.');
  return path.join(storageDirectory, `${code}.pdf`);
}

export async function generateReceiptPdf(data) {
  await fs.promises.mkdir(storageDirectory, { recursive: true });
  const outputPath = receiptPath(data.codigoComprovante);

  await new Promise((resolve, reject) => {
    const document = new PDFDocument({ size: 'A4', margin: 54, info: {
      Title: `Comprovante de resgate ${data.codigoComprovante}`,
      Author: 'Food Rescue', Subject: 'Comprovante de doação e resgate de alimentos'
    }});
    const stream = fs.createWriteStream(outputPath);
    document.pipe(stream);

    document.rect(0, 0, 595.28, 105).fill('#14532D');
    document.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(24).text('FOOD RESCUE', 54, 36);
    document.font('Helvetica').fontSize(10).text('Comprovante de doação e resgate de alimentos', 54, 69);

    document.fillColor('#111827').font('Helvetica-Bold').fontSize(16)
      .text('Entrega confirmada', 54, 137);
    document.fillColor('#4B5563').font('Helvetica').fontSize(10)
      .text(`Código: ${data.codigoComprovante}`, 54, 163);

    const row = (label, value, y) => {
      document.fillColor('#6B7280').font('Helvetica-Bold').fontSize(9).text(label.toUpperCase(), 54, y);
      document.fillColor('#111827').font('Helvetica').fontSize(11).text(String(value), 190, y - 1, { width: 350 });
      document.moveTo(54, y + 21).lineTo(541, y + 21).strokeColor('#E5E7EB').stroke();
    };

    row('Alimento', data.titulo, 205);
    row('Categoria', data.categoria.replaceAll('_', ' '), 244);
    row('Quantidade', `${data.quantidade} ${data.unidade}`, 283);
    row('Doador', data.estabelecimentoDoador, 322);
    row('ONG beneficiária', data.estabelecimentoOng, 361);
    row('Município', `${data.cidade}, ${data.uf}`, 400);
    row('Entrega confirmada em', formatDate(data.confirmadaEm), 439);

    document.roundedRect(54, 498, 487, 74, 6).fillAndStroke('#F0FDF4', '#BBF7D0');
    document.fillColor('#166534').font('Helvetica-Bold').fontSize(10).text('DECLARAÇÃO', 70, 514);
    document.fillColor('#14532D').font('Helvetica').fontSize(9)
      .text('Este documento registra a confirmação do resgate do lote informado entre o estabelecimento doador e a ONG beneficiária.', 70, 535, { width: 455, lineGap: 2 });

    document.fillColor('#6B7280').font('Helvetica').fontSize(8)
      .text('Documento gerado automaticamente pela plataforma Food Rescue. Valide pelo código acima.', 54, 748, { align: 'center', width: 487 });
    document.text('Página 1 de 1', 54, 766, { align: 'center', width: 487 });

    document.end();
    stream.on('finish', resolve); stream.on('error', reject); document.on('error', reject);
  });
  return outputPath;
}
