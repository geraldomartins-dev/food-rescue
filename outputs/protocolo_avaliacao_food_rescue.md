# Protocolo da avaliação controlada do Food Rescue

Versão 1, registrada em 5 de novembro de 2026. Protocolo `food-rescue-controlled-2026-11-05-v1`.

A avaliação examinará se o protótipo antecipa a primeira falha quando o tempo inclui o custo de ordenar e executar os testes. O histórico local contém apenas uma versão do código da aplicação. Os commits seguintes tratam da integração contínua, dos testes e do protótipo. Por isso, a rodada usará seis mudanças preparadas em cópias do código do commit `fea43beaf1b83bb787c9f08c3d23acdbe4ac0db2`. Os cinco defeitos usados na calibração ficaram fora desta seleção.

Foram escolhidos quatro defeitos introduzidos e duas mudanças sem defeito esperado nos comportamentos cobertos. A seleção inclui regiões com e sem associação explícita no catálogo. Como os casos foram escolhidos com conhecimento da aplicação e da suíte, a análise será descritiva e terá alcance limitado a esses cenários.

| Caso | Alteração | Efeito esperado nos cinco testes existentes |
|---|---|---|
| Janela de retirada | Exigir que a retirada já tenha iniciado para listar um lote disponível | O lote com retirada futura deixa de aparecer no teste de visibilidade |
| Responsável pela reserva | Inverter a comparação que autoriza o próprio doador a reservar | O teste de reserva ou o teste de comprovante encontra uma recusa durante a reserva |
| Validade no cadastro | Gravar uma data passada ao criar o lote | Visibilidade, reserva ou comprovante podem detectar a regressão. A função de cadastro está fora do mapeamento explícito |
| Estado do comprovante | Buscar uma solicitação reservada ao recuperar o comprovante | O teste de comprovante recebe a recusa após confirmar a retirada. A função de busca está fora do mapeamento explícito |
| Desempate na listagem | Acrescentar o ID como critério de desempate na ordenação dos estabelecimentos | A propriedade verificada pela suíte, a presença do cadastro do usuário, deve ser preservada |
| Resposta do cadastro do lote | Extrair o ID para uma variável antes de montar a mesma resposta | A suíte deve passar. A função de cadastro está fora do mapeamento explícito |

## Execução e registro

Cada alteração terá três blocos de repetição com quatro ordens por bloco. Serão 72 execuções planejadas, com a ordem habitual, a de menor duração histórica, uma ordem aleatória e a produzida pelo protótipo. A semente da ordem aleatória é `20261105 + 100 × índice do caso + repetição`, com índice iniciado em zero e repetição iniciada em um. O embaralhamento da execução dos métodos usa essa semente acrescida de 1.000.000. Três sementes por caso dão uma comparação exploratória com a estratégia aleatória.

Os cinco testes de ponta a ponta, o catálogo e seus custos históricos permanecem como registrados no piloto. A ordenação recebe as fontes e o catálogo antes da execução. As listas de detectores esperados servem para conferir o resultado obtido, inclusive quando mais de um teste pode detectar o mesmo defeito. Se todos os testes passarem em um caso com defeito introduzido, o resultado será registrado como ausência de detecção naquela execução.

Cada execução terá um servidor local novo, um trabalhador do Playwright, zero tentativas automáticas, parada na primeira falha e restauração do mesmo banco sintético. A preparação do banco e do servidor fica fora da medição. O relógio começa antes de gerar a ordem e termina quando o avaliador recebe o evento do primeiro teste com falha. Serão registrados a ordem gerada, o tempo da ordenação, a posição do detector e o tempo até a falha. Quando todos os testes passarem, o tempo até falha ficará vazio e será registrado o tempo da suíte completa, incluindo o encerramento do executor. O relatório indicará a versão do banco, do Node e a plataforma.

Falha em um teste fora do conjunto previsto, erro do executor, divergência entre ordem planejada e observada, ou problema de infraestrutura interrompem a rodada. Os registros da tentativa serão preservados. Uma falha confirmada de infraestrutura permite repetir a rodada inteira com os mesmos arquivos e sementes, com justificativa documentada. Se for necessário mudar casos, regras ou critérios, a versão seguinte terá novo identificador e nova lista de hashes. Uma execução lenta permanece na análise.

## Análise prevista

Para cada caso com defeito, registrar por método a quantidade de detecções, a posição e os tempos observados. Comparar o protótipo com cada referência por meio da diferença de tempo na mesma repetição, quando ambos detectarem. Usar `tempo da referência − tempo do protótipo`, de modo que valores positivos indiquem antecipação. Apresentar mediana e faixa das diferenças por caso, identificando quantos pares contribuíram. Registrar as ausências de detecção separadamente. Nos casos em que toda a suíte passa, apresentar tempo completo e custo de ordenação por método.

As três repetições medem variação de execução sobre a mesma mudança. O relatório apresentará resultados por alteração, com atenção aos casos em que o catálogo não identifica a função modificada e aos casos em que o detector aparece antes, mas o tempo medido aumenta. A análise não usará as 72 execuções como 72 defeitos independentes nem apresentará um percentual geral de eficácia.

## Arquivos congelados

`research/study-cases.json` contém as substituições exatas, as sementes e os detectores esperados. `research/study-lock.json` registra SHA-256 do protocolo, dos casos, das fontes, do catálogo, da suíte, do avaliador e dos arquivos de configuração e banco usados na rodada. O comando de preparação verifica esses hashes, cria cópias dos casos e confere a sintaxe. O comando de execução volta a validar os hashes antes de medir.

```powershell
node research/evaluate-pilot.mjs --study --prepare
node research/evaluate-pilot.mjs --study
```
