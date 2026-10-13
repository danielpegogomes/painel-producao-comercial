# Como montar o relatório no Power BI Desktop

O modelo, as medidas e o tema já estão prontos. Os passos abaixo produzem um `.pbix` com o mesmo desenho do painel web.

## 1. Dados
1. **Obter dados → Parquet** (ou **Snowflake**, se a base estiver carregada lá):
   - `data/marts/producao_x_meta.parquet` → renomear a tabela para **fProducaoMeta**
   - `data/marts/mix_canais.parquet` → **fMixCanais**
   - `data/marts/gerentes_mensal.parquet` → **fGerentes**
2. No Power Query, conferir os tipos: `MES` = Data, valores = Número decimal, `CONTRATOS` = Número inteiro.

## 2. Modelo estrela
Criar as dimensões com **Nova tabela**:

```DAX
dCalendario =
ADDCOLUMNS (
    CALENDAR ( DATE ( 2024, 1, 1 ), DATE ( 2026, 12, 31 ) ),
    "Ano", YEAR ( [Date] ),
    "Mês", FORMAT ( [Date], "mmm/yy" ),
    "MesNum", YEAR ( [Date] ) * 100 + MONTH ( [Date] )
)

dAgencia = DISTINCT ( SELECTCOLUMNS ( fProducaoMeta, "AGENCIA_ID", fProducaoMeta[AGENCIA_ID], "AGENCIA", fProducaoMeta[AGENCIA], "REGIONAL", fProducaoMeta[REGIONAL] ) )

dProduto = DISTINCT ( SELECTCOLUMNS ( fProducaoMeta, "PRODUTO_ID", fProducaoMeta[PRODUTO_ID], "PRODUTO", fProducaoMeta[PRODUTO], "SEGMENTO", fProducaoMeta[SEGMENTO], "FAMILIA", fProducaoMeta[FAMILIA] ) )
```

- Renomear a coluna `Date` de dCalendario para `Data`, marcar como **tabela de datas** e ordenar "Mês" por "MesNum".
- Relacionamentos (1:*, filtro único): `dCalendario[Data] → fProducaoMeta[MES]`, `dAgencia[AGENCIA_ID] → fProducaoMeta[AGENCIA_ID]`, `dProduto[PRODUTO_ID] → fProducaoMeta[PRODUTO_ID]`.
- Ocultar as colunas de chave das fatos.

## 3. Medidas
Criar uma tabela vazia **_Medidas** e colar as medidas de `medidas.dax`, organizando em pastas: Base, Meta, Indicadores, Tempo, Ranking, Textos.

## 4. Tema
**Exibição → Temas → Procurar temas** → `tema-banco-horizonte.json`.

## 5. Página "Visão geral" (16:9, 1280 × 720)
| Área | Visual | Campos |
|---|---|---|
| Topo | Caixa de texto + segmentações (Ano, Segmento, Regional, Produto) | dCalendario[Ano], dProduto[SEGMENTO], dAgencia[REGIONAL], dProduto[PRODUTO] |
| Linha de KPIs | 5 cartões (novo cartão) | Produção (com Variação a/a %), Atingimento %, Contratos, Ticket Médio, % Digital |
| Esquerda | Gráfico de colunas e linhas | Eixo: dCalendario[Mês] · Colunas: Produção · Linha: Meta |
| Direita | Barras horizontais | Eixo: dAgencia[REGIONAL] · Valor: Atingimento % · Cor: formatação condicional pelo campo **Cor do Status** · linha de referência constante em 1 |
| Meio | Colunas 100% empilhadas | fMixCanais: Eixo MES · Legenda CANAL · Valor PRODUCAO |
| Meio | Barras horizontais | dProduto[PRODUTO] · Produção |
| Base | Tabela | AGENCIA, REGIONAL, Produção, Meta, Atingimento % (barras de dados), Variação a/a % |
| Rodapé | Cartão de texto | Resumo Executivo |

- **Drill-down**: no gráfico de regionais, adicionar `dAgencia[AGENCIA]` abaixo de REGIONAL no eixo e ativar o drill.
- **Dica de ferramenta**: Produção, Meta e Atingimento % em todos os visuais.
- Salvar como `powerbi/producao-comercial.pbix`, tirar um print da página e salvar em `docs/powerbi.jpg` para o README.
