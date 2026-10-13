"""
Exporta a base compacta do painel web (dashboard/dados.json) a partir dos marts.

O painel filtra no navegador, então a base vai agregada no menor grão que ele usa
e em formato colunar (listas de índices), para ficar leve.
"""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path


def _idx(serie):
    valores = sorted(serie.dropna().unique().tolist())
    return valores, {v: i for i, v in enumerate(valores)}


def exportar_painel(dw, destino: Path):
    pm = dw.consultar("SELECT * FROM MARTS.PRODUCAO_X_META")
    pm["MES"] = pm.MES.astype(str).str[:7]
    mix = dw.consultar("SELECT * FROM MARTS.MIX_CANAIS")
    mix["MES"] = mix.MES.astype(str).str[:7]
    ger = dw.consultar("SELECT * FROM MARTS.GERENTES_MENSAL WHERE GERENTE_ID <> -1")
    ger["MES"] = ger.MES.astype(str).str[:7]
    faixa = dw.consultar("""
        SELECT DATE_TRUNC('MONTH', F.DATA_CONTRATACAO) AS MES, A.REGIONAL, P.PRODUTO, F.FAIXA_ETARIA, SUM(F.VALOR) AS PRODUCAO
        FROM DW.FATO_PRODUCAO F
        JOIN DW.DIM_AGENCIA A ON A.AGENCIA_ID = F.AGENCIA_ID
        JOIN DW.DIM_PRODUTO P ON P.PRODUTO_ID = F.PRODUTO_ID
        GROUP BY 1, 2, 3, 4""")
    faixa["MES"] = faixa.MES.astype(str).str[:7]
    produtos = dw.consultar("SELECT PRODUTO_ID, PRODUTO, SEGMENTO, FAMILIA FROM DW.DIM_PRODUTO ORDER BY PRODUTO_ID")
    canais = dw.consultar("SELECT CANAL, TIPO_CANAL FROM DW.DIM_CANAL ORDER BY TIPO_CANAL, CANAL")

    meses, im = _idx(pm.MES)
    regionais, ir = _idx(pm.REGIONAL)
    lista_prod = produtos.PRODUTO.tolist()
    ip = {p: i for i, p in enumerate(lista_prod)}
    lista_canal = canais.CANAL.tolist()
    ic = {c: i for i, c in enumerate(lista_canal)}
    agencias = pm[["AGENCIA", "REGIONAL"]].drop_duplicates().sort_values("AGENCIA")
    ia = {a: i for i, a in enumerate(agencias.AGENCIA)}
    faixas, iff = _idx(faixa.FAIXA_ETARIA)

    reg = pm.groupby(["MES", "REGIONAL", "PRODUTO"], as_index=False)[["PRODUCAO", "CONTRATOS", "PRODUCAO_DIGITAL", "META"]].sum()
    ag = pm.groupby(["MES", "AGENCIA", "PRODUTO"], as_index=False)[["PRODUCAO", "META"]].sum()
    gm = ger.groupby(["MES", "GERENTE_ID", "GERENTE", "AGENCIA"], as_index=False)[["PRODUCAO", "CONTRATOS"]].sum()
    lista_ger = gm[["GERENTE_ID", "GERENTE", "AGENCIA"]].drop_duplicates("GERENTE_ID").sort_values("GERENTE_ID")
    ig = {g: i for i, g in enumerate(lista_ger.GERENTE_ID)}

    r = lambda v: int(round(float(v)))
    base = {
        "gerado_em": datetime.now().strftime("%Y-%m-%d %H:%M"),
        "banco": "Banco Horizonte (fictício)",
        "meses": meses,
        "regionais": regionais,
        "produtos": [{"nome": p.PRODUTO, "segmento": p.SEGMENTO, "familia": p.FAMILIA} for p in produtos.itertuples()],
        "canais": [{"nome": c.CANAL, "tipo": c.TIPO_CANAL} for c in canais.itertuples()],
        "agencias": [{"nome": a.AGENCIA, "regional": ir[a.REGIONAL]} for a in agencias.itertuples()],
        "gerentes": [{"nome": g.GERENTE, "agencia": ia[g.AGENCIA]} for g in lista_ger.itertuples()],
        "faixas": faixas,
        # [mês, regional, produto, produção, contratos, produção digital, meta]
        "producao": [[im[x.MES], ir[x.REGIONAL], ip[x.PRODUTO], r(x.PRODUCAO), int(x.CONTRATOS), r(x.PRODUCAO_DIGITAL), r(x.META)]
                     for x in reg.itertuples()],
        # [mês, regional, produto, canal, produção]
        "canal": [[im[x.MES], ir[x.REGIONAL], ip[x.PRODUTO], ic[x.CANAL], r(x.PRODUCAO)] for x in mix.itertuples()],
        # [mês, agência, produto, produção, meta]
        "agencia": [[im[x.MES], ia[x.AGENCIA], ip[x.PRODUTO], r(x.PRODUCAO), r(x.META)] for x in ag.itertuples()],
        # [mês, gerente, produção, contratos]
        "gerente": [[im[x.MES], ig[x.GERENTE_ID], r(x.PRODUCAO), int(x.CONTRATOS)] for x in gm.itertuples()],
        # [mês, regional, produto, faixa etária, produção]
        "faixa": [[im[x.MES], ir[x.REGIONAL], ip[x.PRODUTO], iff[x.FAIXA_ETARIA], r(x.PRODUCAO)] for x in faixa.itertuples()],
    }
    destino.parent.mkdir(parents=True, exist_ok=True)
    destino.write_text(json.dumps(base, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
