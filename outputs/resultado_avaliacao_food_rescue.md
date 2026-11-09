# Avaliação controlada do Food Rescue

Protocolo `food-rescue-controlled-2026-11-05-v1`. Foram verificadas **72 execuções** em seis alterações controladas. Cada método foi executado três vezes por alteração, com o custo de ordenação incluído na medição.

O protótipo teve mediana de tempo pareado maior que a ordem habitual em 4 dos 4 casos com defeito introduzido. A tabela de posições mostra em quais casos houve avanço do detector mesmo com aumento do tempo medido.

## Detecção por alteração

Cada sequência segue as repetições 1, 2 e 3. O traço indica ausência de detecção naquela execução. Os tempos estão em segundos e incluem a preparação da ordem e a inicialização do executor.

| Alteração | Método | Detecções | Posições do detector | Tempos até a falha | Mediana do custo de ordenar |
|---|---|---:|---:|---:|---:|
| Janela de retirada | Habitual | 3/3 | 3 / 3 / 3 | 14,064 / 8,347 / 6,317 | 0,262 |
| Janela de retirada | Menor duração | 3/3 | 3 / 3 / 3 | 10,239 / 9,947 / 6,428 | 0,303 |
| Janela de retirada | Aleatória | 3/3 | 5 / 5 / 5 | 15,852 / 12,836 / 9,489 | 0,276 |
| Janela de retirada | Protótipo | 3/3 | 1 / 1 / 1 | 12,234 / 9,548 / 7,976 | 0,815 |
| Responsável pela reserva | Habitual | 3/3 | 4 / 4 / 4 | 9,782 / 12,210 / 6,887 | 0,254 |
| Responsável pela reserva | Menor duração | 3/3 | 4 / 4 / 4 | 13,422 / 8,742 / 6,920 | 0,272 |
| Responsável pela reserva | Aleatória | 3/3 | 1 / 1 / 1 | 7,565 / 9,735 / 5,665 | 0,258 |
| Responsável pela reserva | Protótipo | 3/3 | 1 / 1 / 1 | 13,640 / 6,092 / 9,647 | 0,730 |
| Validade no cadastro | Habitual | 3/3 | 3 / 3 / 3 | 7,819 / 13,935 / 6,379 | 0,255 |
| Validade no cadastro | Menor duração | 3/3 | 3 / 3 / 3 | 6,885 / 7,625 / 5,548 | 0,209 |
| Validade no cadastro | Aleatória | 3/3 | 1 / 1 / 1 | 6,881 / 7,185 / 5,568 | 0,235 |
| Validade no cadastro | Protótipo | 3/3 | 3 / 3 / 3 | 9,924 / 7,222 / 6,982 | 0,791 |
| Estado do comprovante | Habitual | 3/3 | 5 / 5 / 5 | 10,086 / 12,849 / 7,883 | 0,250 |
| Estado do comprovante | Menor duração | 3/3 | 5 / 5 / 5 | 14,375 / 12,693 / 8,066 | 0,218 |
| Estado do comprovante | Aleatória | 3/3 | 2 / 3 / 1 | 7,326 / 11,065 / 6,027 | 0,247 |
| Estado do comprovante | Protótipo | 3/3 | 5 / 5 / 5 | 11,535 / 13,597 / 7,820 | 1,323 |

## Diferenças pareadas de tempo

Cada diferença é o tempo da referência menos o tempo do protótipo na mesma repetição. Um valor positivo indica que o protótipo detectou a falha mais cedo. Entram apenas os pares com detecção nas duas execuções.

| Alteração | Referência | Pares | Mediana em segundos | Faixa em segundos |
|---|---|---:|---:|---:|
| Janela de retirada | Habitual | 3 | -1,201 | -1,659 a 1,831 |
| Janela de retirada | Menor duração | 3 | -1,549 | -1,994 a 0,398 |
| Janela de retirada | Aleatória | 3 | 3,288 | 1,512 a 3,619 |
| Responsável pela reserva | Habitual | 3 | -2,760 | -3,858 a 6,118 |
| Responsável pela reserva | Menor duração | 3 | -0,218 | -2,727 a 2,650 |
| Responsável pela reserva | Aleatória | 3 | -3,982 | -6,075 a 3,644 |
| Validade no cadastro | Habitual | 3 | -0,603 | -2,105 a 6,713 |
| Validade no cadastro | Menor duração | 3 | -1,433 | -3,039 a 0,403 |
| Validade no cadastro | Aleatória | 3 | -1,414 | -3,043 a -0,037 |
| Estado do comprovante | Habitual | 3 | -0,749 | -1,449 a 0,063 |
| Estado do comprovante | Menor duração | 3 | 0,246 | -0,905 a 2,840 |
| Estado do comprovante | Aleatória | 3 | -2,532 | -4,209 a -1,792 |

## Execuções com a suíte completa

O tempo completo vai da preparação da ordem ao encerramento do executor. A tabela inclui as alterações sem defeito esperado e qualquer execução em que a suíte passou diante de um defeito introduzido.

| Alteração | Método | Suítes completas | Tempos em segundos | Mediana do custo de ordenar |
|---|---|---:|---:|---:|
| Desempate na listagem | Habitual | 3/3 | 8,435 / 12,664 / 10,154 | 0,254 |
| Desempate na listagem | Menor duração | 3/3 | 10,128 / 14,103 / 7,544 | 0,218 |
| Desempate na listagem | Aleatória | 3/3 | 10,121 / 17,519 / 8,152 | 0,264 |
| Desempate na listagem | Protótipo | 3/3 | 10,957 / 10,368 / 9,164 | 0,780 |
| Resposta do cadastro do lote | Habitual | 3/3 | 13,109 / 14,132 / 9,338 | 0,281 |
| Resposta do cadastro do lote | Menor duração | 3/3 | 10,645 / 9,125 / 8,854 | 0,277 |
| Resposta do cadastro do lote | Aleatória | 3/3 | 13,863 / 10,076 / 12,901 | 0,314 |
| Resposta do cadastro do lote | Protótipo | 3/3 | 14,776 / 16,156 / 8,339 | 0,882 |

Todos os defeitos introduzidos foram detectados nas execuções previstas.

## Posição do detector e tempo medido

| Alteração | Mapeamento | Posições habitual | Posições protótipo | Ordens idênticas | Mediana da diferença contra a habitual em segundos |
|---|---|---:|---:|---:|---:|
| Janela de retirada | Mapeado | 3 / 3 / 3 | 1 / 1 / 1 | 0/3 | -1,201 |
| Responsável pela reserva | Mapeado | 4 / 4 / 4 | 1 / 1 / 1 | 0/3 | -2,760 |
| Validade no cadastro | Sem mapeamento explícito | 3 / 3 / 3 | 3 / 3 / 3 | 3/3 | -0,603 |
| Estado do comprovante | Sem mapeamento explícito | 5 / 5 / 5 | 5 / 5 / 5 | 3/3 | -0,749 |

Em 6 dos 12 pares com detecção frente à ordem habitual, o protótipo colocou o detector em uma posição anterior. Em 4 desses pares, o tempo medido aumentou. Quando as ordens são idênticas, diferenças de tempo refletem preparação e variação de execução.

Os casos são mudanças controladas escolhidas com conhecimento da aplicação e da suíte. As três repetições descrevem a variação de cada mudança. Os dados servem para examinar quando a posição e o custo de ordenar afetam a detecção neste conjunto.

Em Validade no cadastro, as 3 sementes produziram 2 ordens aleatórias distintas. Todas as execuções previstas foram mantidas na análise.

## Rastreabilidade

- Ambiente Windows com Node `v24.14.0` e banco `10.4.32-MariaDB`.
- Referência do código `fea43beaf1b83bb787c9f08c3d23acdbe4ac0db2`.
- Registro bruto `work/evaluation-1793926240671_e8dea7/summary.json`.
- SHA-256 do registro bruto `1530d49408033bafd5aa6754a0d2cdb73146ad81521ec4338cbb24ab2d677c9f`.
- SHA-256 do conjunto congelado `e1fc4295c22451e85b2065d19373b58a1684ab72433f19cdab258a6a7fe173d8`.
- [Protocolo e critérios de análise](protocolo_avaliacao_food_rescue.md).
