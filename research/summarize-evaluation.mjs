import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const input = path.resolve(process.argv[2] ?? '');
const data = JSON.parse(fs.readFileSync(input, 'utf8'));
if (data.version !== 2 || !data.completed || data.results.length !== data.schedule.length || data.results.some((row) => !row.valid)) {
  throw new Error('Only a complete validated v2 run can be summarized');
}
for (const entry of data.schedule) {
  const rows = data.results.filter((row) => row.case === entry.case && row.method === entry.method && row.repetition === entry.repetition);
  if (rows.length !== 1) throw new Error('Missing or duplicate execution');
}
for (const row of data.results) {
  if (row.events.some((event, index) => event.title !== row.order[index])) throw new Error('Observed tests differ from the planned order');
  if (row.case === 'no_fault' && (row.timeToFirstFailureMs !== null || row.detectorPosition !== null || !(row.fullSuiteWallMs > 0))) throw new Error('Invalid no-fault measure');
  if (row.case !== 'no_fault' && (!(row.timeToFirstFailureMs > row.orderGenerationMs) || row.fullSuiteWallMs !== null)) throw new Error('Invalid detection measure');
}
const labels = { original: 'Habitual', shortest: 'Menor duração', random: 'Aleatória', prioritized: 'Protótipo' };
const cases = { auth_permission: 'Permissão administrativa', establishment_listing: 'Lista de estabelecimentos',
  lot_visibility: 'Visibilidade de lotes', reservation_response: 'Resposta de reserva', receipt_content: 'Comprovante PDF' };
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const seconds = (value) => (value / 1000).toFixed(3).replace('.', ',');
let text = `# Validação do avaliador de testes do Food Rescue\n\n`;
text += `Rodada de 4 de novembro de 2026. Foram concluídas **${data.results.length} execuções válidas**, com ${data.repeats} repetição por combinação de cenário e método: cinco falhas controladas conhecidas e uma versão sem defeito introduzido, em quatro ordens.\n\n`;
text += `O objetivo foi verificar o procedimento de medição. Esta rodada reutiliza os casos empregados na construção do piloto; não é uma avaliação independente de eficácia. ${data.repeats === 1 ? 'Há apenas uma observação por combinação. Não é possível estimar sua estabilidade temporal.' : 'As repetições temporais não representam novos casos de defeito.'}\n\n`;
text += `## Correção da comparação anterior\n\nO script histórico do Food Rescue colocava explicitamente o detector conhecido em primeiro lugar. Os 47% de redução relatados anteriormente correspondem a essa ordem idealizada, não a uma medição da ordem produzida pelo algoritmo. O relatório histórico recebeu uma correção e seus dados foram preservados.\n\n`;
text += `O novo processo de ordenação recebe as fontes de referência e alteradas, o método, os custos e a semente aleatória. O detector esperado só é consultado depois, para conferir o resultado da execução.\n\n`;
text += `## O que o relógio inclui\n\nO processo pai inicia um relógio monotônico antes da geração da ordem. Registra o recebimento por IPC do primeiro teste com falha; o tempo inclui os processos usados para ordenar, a preparação do arquivo de testes, a inicialização do Playwright e a execução até esse evento. Não é a soma das durações internas dos testes. O envio do evento também tem um pequeno custo, não isolado nesta rodada.\n\n`;
text += `A criação e restauração do banco, o início do servidor e a espera por sua saúde ficam fora dessa medida para todos os métodos. Cada execução usa o mesmo banco sintético esvaziado, um servidor novo e dados fictícios criados pelos próprios testes. As ordens são alternadas por sorteio com semente registrada. Os arquivos do algoritmo, catálogo e testes são conferidos por hash durante a rodada.\n\n`;
text += `## Falhas controladas\n\nTempos em segundos, ${data.repeats === 1 ? 'com uma observação por cenário e método' : 'resumidos pela mediana por cenário e método'}. A posição corresponde ao primeiro teste que falhou.\n\n| Cenário | Ordem | Ordenação | Até a primeira falha, incluindo preparação | Posição |\n|---|---|---:|---:|---:|\n`;
for (const [scenario, label] of Object.entries(cases)) {
  for (const [method, methodLabel] of Object.entries(labels)) {
    const rows = data.results.filter((row) => row.case === scenario && row.method === method);
    text += `| ${label} | ${methodLabel} | ${seconds(median(rows.map((row) => row.orderGenerationMs)))} | ${seconds(median(rows.map((row) => row.timeToFirstFailureMs)))} | ${median(rows.map((row) => row.detectorPosition))} |\n`;
  }
}
text += `\n## Versão sem defeito introduzido\n\nOs cinco testes passaram em cada ordem. O tempo até falha e a posição do detector são nulos. O tempo completo vai da geração da ordem até o encerramento do executor, incluindo sua finalização. Essa definição difere do ponto final de detecção nos casos com defeito; as duas medidas não devem ser misturadas em uma média.\n\n| Ordem | Ordenação em segundos | Suíte completa em segundos |\n|---|---:|---:|\n`;
for (const [method, methodLabel] of Object.entries(labels)) {
  const rows = data.results.filter((row) => row.case === 'no_fault' && row.method === method);
  text += `| ${methodLabel} | ${seconds(median(rows.map((row) => row.orderGenerationMs)))} | ${seconds(median(rows.map((row) => row.fullSuiteWallMs)))} |\n`;
}
text += `\n## Interpretação e limites\n\nA rodada confirma que o avaliador gera as quatro ordens, detecta os defeitos esperados, mantém todos os testes elegíveis e trata a ausência de falha sem atribuir zero ao tempo de detecção. A referência de menor duração permite investigar se ganhos futuros dependem apenas de executar testes curtos antes.\n\n`;
text += `Quando a ordem do protótipo coincide com a habitual, qualquer diferença de tempo entre as duas execuções não decorre da posição do detector; pode refletir custo de preparação e variação de execução. Não se calculou um percentual geral de eficácia nem intervalo de confiança nesta calibração.\n\n`;
text += `A versão sem defeito é uma cópia da referência, não uma mudança real sem defeito. As sementes aleatórias são poucas; os custos históricos e o mapeamento manual foram construídos durante o piloto. O executor do protótipo também inicia um processo adicional para comparar fontes, custo que está incluído. Esses fatores precisam ser considerados na avaliação principal.\n\n`;
text += `## Próxima etapa de pesquisa\n\nCongelar o método calibrado e reunir novas alterações, incluindo mudanças sem falha observada e casos em que o catálogo não identifica a região afetada. Definir previamente número de sementes e repetições, revisar independência dos testes e manter os resultados separados por aplicação e nível de teste. Só então comparar eficácia e estabilidade.\n\n`;
const digest = crypto.createHash('sha256').update(fs.readFileSync(input)).digest('hex');
text += `## Rastreabilidade\n\n- Dados brutos: \`${path.relative(process.cwd(), input).replaceAll('\\', '/')}\`.\n- SHA-256 dos dados: \`${digest}\`.\n- Banco sintético: \`${data.database}\`; preservado para auditoria.\n- Ambiente: Node ${data.node}, ${data.platform}.\n- Reprodução do avaliador: \`node research/evaluate-pilot.mjs ${data.repeats}\`. A nova execução recebe outro banco e outro diretório.\n- Relatório: \`node research/summarize-evaluation.mjs caminho/para/summary.json\`.\n- Rodadas interrompidas durante a correção do avaliador foram preservadas em diretórios próprios e não integram as tabelas.\n`;
const target = path.resolve('outputs/validacao_avaliador_food_rescue.md');
fs.writeFileSync(target, text);
console.log(target);
