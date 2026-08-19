import PDFDocument from 'pdfkit';

const formatDate = (value) => new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo'
}).format(new Date(value));

export async function generateAdminReportPdf(data) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const doc = new PDFDocument({ size: 'A4', margin: 46, bufferPages: true,
      info: { Title: 'Relatório administrativo - Food Rescue', Author: 'Food Rescue' } });
    doc.on('data', (chunk) => chunks.push(chunk)); doc.on('error', reject);
    doc.on('end', () => resolve(Buffer.concat(chunks)));

    const header = () => {
      doc.rect(0, 0, 595.28, 92).fill('#14532D');
      doc.fillColor('#fff').font('Helvetica-Bold').fontSize(22).text('FOOD RESCUE', 46, 28);
      doc.font('Helvetica').fontSize(10).text('Relatório administrativo de impacto', 46, 57);
      doc.fillColor('#111827'); doc.y = 122;
    };
    const newPageIfNeeded = (height = 70) => { if (doc.y + height > 760) { doc.addPage(); header(); } };
    header();
    doc.font('Helvetica-Bold').fontSize(16).text('Resumo da operação');
    doc.font('Helvetica').fontSize(9).fillColor('#6B7280').text(`Gerado em ${formatDate(data.geradoEm)}`, { lineGap: 2 });
    doc.moveDown(1.2);
    const cards = [
      ['Usuários ativos', data.metrics.usuarios.ativos || 0], ['Lotes cadastrados', data.metrics.lotes.total || 0],
      ['Resgates confirmados', data.metrics.resgates.confirmadas || 0], ['ONGs atendidas', data.metrics.impacto.ongs_atendidas || 0]
    ];
    const y = doc.y;
    cards.forEach(([label, value], index) => { const x = 46 + (index % 2) * 252; const cy = y + Math.floor(index / 2) * 70;
      doc.roundedRect(x, cy, 235, 54, 6).fillAndStroke('#F0FDF4', '#BBF7D0');
      doc.fillColor('#166534').font('Helvetica-Bold').fontSize(18).text(String(value), x + 14, cy + 9);
      doc.fillColor('#4B5563').font('Helvetica').fontSize(8).text(label.toUpperCase(), x + 14, cy + 33);
    });
    doc.y = y + 158; doc.fillColor('#111827').font('Helvetica-Bold').fontSize(14).text('Entregas confirmadas');
    doc.moveDown(.7);
    if (!data.rescues.length) doc.font('Helvetica').fontSize(10).fillColor('#6B7280').text('Nenhum resgate confirmado no período.');
    data.rescues.forEach((item) => {
      newPageIfNeeded(76); const rowY = doc.y;
      doc.fillColor('#111827').font('Helvetica-Bold').fontSize(10).text(item.titulo, 46, rowY, { width: 300 });
      doc.fillColor('#166534').font('Helvetica-Bold').text(`${item.quantidade} ${item.unidade}`, 430, rowY, { width: 115, align: 'right' });
      doc.fillColor('#4B5563').font('Helvetica').fontSize(8).text(`${item.doador}  >  ${item.ong}`, 46, rowY + 19, { width: 490 });
      doc.text(`${item.cidade}/${item.uf}  |  ${formatDate(item.confirmada_em)}  |  #${item.id}`, 46, rowY + 34, { width: 490 });
      doc.moveTo(46, rowY + 56).lineTo(549, rowY + 56).strokeColor('#E5E7EB').stroke(); doc.y = rowY + 66;
    });
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i += 1) { doc.switchToPage(i);
      doc.fillColor('#6B7280').font('Helvetica').fontSize(8)
        .text(`Food Rescue - uso administrativo  |  Página ${i + 1} de ${range.count}`, 46, 780, { width: 503, align: 'center', lineBreak: false });
    }
    doc.end();
  });
}
