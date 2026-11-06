# Protótipo de priorização dos testes do Food Rescue

## Avaliador com tempo completo

Execute `node research/evaluate-pilot.mjs 3` na raiz para três repetições dos seis cenários (cinco falhas controladas conhecidas e uma versão sem defeito), comparando ordem original, menor duração histórica, aleatória e saída real do protótipo. São 72 execuções. É necessário MySQL local disponível e as credenciais usuais do projeto no ambiente. O avaliador cria um esquema novo com nome único; só esse esquema recebe dados fictícios e é esvaziado entre execuções. O banco configurado para o aplicativo não é reutilizado. Artefatos e esquema sintético são preservados para auditoria.

O instante inicial precede a geração da ordem. Um reporter envia eventos de conclusão de teste por IPC, e o processo pai mede com relógio monotônico o recebimento da primeira falha. O tempo inclui a geração da ordem, preparação do arquivo e inicialização do Playwright. A preparação do banco e o início do servidor ficam fora da medição para todos os métodos. Para a versão sem defeito, registra-se o tempo completo até o encerramento do executor; tempo até falha e posição do detector ficam nulos.

As quatro ordens são alternadas com sorteio reproduzível. A ordem aleatória recebe uma semente registrada por cenário e repetição. O catálogo e os scripts são conferidos por hash durante a execução. O processo de ordenação recebe somente fontes, método, catálogo e semente; o detector esperado é usado depois para validar o resultado, sem determinar a ordem.

Esta rodada calibra o procedimento nos mesmos casos conhecidos. Três sementes por cenário e três repetições ainda não compõem a avaliação principal proposta. A versão sem defeito repete as fontes de referência: verifica a execução completa, sem representar uma mudança real sem defeito.

**Correção dos dados históricos:** `work/run-pilot-repeated-orders.mjs` escolhia primeiro o detector conhecido. Os ganhos históricos do Food Rescue são de uma ordem idealizada e não podem ser atribuídos ao protótipo. `research/analyze-pilot-results.mjs` mantém esses dados apenas como calibração histórica, com a ressalva correspondente. O relatório da nova rodada deve ser usado para examinar o avaliador corrigido.

O protótipo lê alterações em arquivos JavaScript de `src/`, identifica a rota ou a função que contém cada mudança e coloca primeiro os testes independentes ligados a esse contexto. O catálogo em `test-catalog.json` registra essa relação e a duração histórica mediana de cada teste. O resultado é uma proposta de ordem; o programa não executa os testes nem consulta quais falharam.

## Uso

Para analisar alterações locais nos arquivos rastreados, em relação ao último commit:

```powershell
node research/prioritize-tests.mjs
```

Para comparar uma cópia alternativa de `src/` com o código atual:

```powershell
node research/prioritize-tests.mjs --candidate-src work/prioritizer-validation/lot_visibility
```

A saída JSON mostra o contexto alterado, a ordem proposta, a pontuação, a duração estimada e o motivo de cada prioridade. Uma rota ou função associada recebe 3 pontos. Mudanças na configuração compartilhada de `app.js` recebem 1 ponto para todos os testes. Entre testes com a mesma pontuação, a menor duração histórica vem primeiro. Sem associação reconhecida, a ordem original é mantida.

## Alcance atual

- O catálogo cobre apenas os cinco testes independentes de `e2e/prioritization-pilot.spec.js`. A suíte serial de `critical-flow.spec.js` não pode ser reordenada dessa maneira.
- As durações foram calculadas a partir de execuções anteriores em que cada teste passou; são estimativas, não uma garantia de custo futuro.
- A associação entre código e testes foi declarada manualmente. Mudanças em várias funções, funções não catalogadas, arquivos removidos e efeitos indiretos ainda precisam de tratamento.
- A validação inicial usa as mesmas cinco falhas controladas do piloto; é uma verificação de funcionamento do protótipo, não uma avaliação independente de eficácia.

Para repetir a validação nas cinco cópias temporárias criadas pelo piloto:

```powershell
node work/validate-prioritizer.mjs
```

## Segunda aplicação: SIGOU

O experimento do SIGOU usa uma cópia mínima e isolada de três módulos com seus testes. O projeto original em `C:\Users\Gege\Documents\PROJETO SIGOU` é somente lido. Depois de preparar a cópia em `work/sigou-pilot/baseline`, as falhas controladas e a comparação de ordens podem ser reproduzidas por:

```powershell
node work/run-sigou-pilot.mjs
node work/evaluate-sigou-orders.mjs
```

`prioritize-node-tests.mjs` lê dependências locais declaradas por `require()` ou `import ... from`, classifica mudanças em módulos importados diretamente acima de dependências indiretas e usa a duração histórica como desempate:

```powershell
node research/prioritize-node-tests.mjs --before work/sigou-pilot/baseline --after work/sigou-pilot/priority_score --costs work/sigou-pilot/baseline-costs.json
```

Na cópia do SIGOU, dez testes passaram antes das alterações. Três falhas controladas foram detectadas por três arquivos de teste distintos. Em 27 execuções (três falhas, três ordens e três repetições), a média até a detecção foi de 0,78 s na ordem original, 0,45 s na proposta e 0,81 s nas ordens aleatórias sorteadas. Uma quarta mudança no cálculo de Haversine elevou dois arquivos por dependência, mas só o teste que importa diretamente a função falhou. A análise de dependências é estática: importações dinâmicas e relações de comportamento não declaradas não aparecem nela. Os cenários continuam pequenos e controlados.
