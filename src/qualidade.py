"""
Checagens de qualidade de dados executadas a cada carga.

Cada regra é uma consulta que deve retornar zero (nenhuma linha problemática).
Regras críticas interrompem a publicação; as demais geram alerta no log.
"""

from __future__ import annotations

CHECAGENS = [
    # (nome, sql que conta problemas, crítica?)
    ("contratos sem duplicidade após o staging",
     "SELECT COUNT(*) - COUNT(DISTINCT CONTRATO_ID) FROM STAGING.CONTRATOS", True),
    ("todas as datas foram convertidas",
     "SELECT COUNT(*) FROM STAGING.CONTRATOS WHERE DATA_CONTRATACAO IS NULL", True),
    ("todos os valores foram convertidos",
     "SELECT COUNT(*) FROM STAGING.CONTRATOS WHERE VALOR IS NULL", True),
    ("todos os canais foram reconhecidos",
     "SELECT COUNT(*) FROM STAGING.CONTRATOS WHERE CANAL = 'Não identificado'", True),
    ("toda produção tem agência cadastrada",
     "SELECT COUNT(*) FROM DW.FATO_PRODUCAO F LEFT JOIN DW.DIM_AGENCIA A ON A.AGENCIA_ID = F.AGENCIA_ID WHERE A.AGENCIA_ID IS NULL", True),
    ("toda produção tem produto cadastrado",
     "SELECT COUNT(*) FROM DW.FATO_PRODUCAO F LEFT JOIN DW.DIM_PRODUTO P ON P.PRODUTO_ID = F.PRODUTO_ID WHERE P.PRODUTO_ID IS NULL", True),
    ("produção do mart bate com a fato",
     "SELECT IFF(ABS((SELECT SUM(PRODUCAO) FROM MARTS.PRODUCAO_X_META) - (SELECT SUM(VALOR) FROM DW.FATO_PRODUCAO)) < 1, 0, 1)", True),
    ("todo mês com produção tem meta",
     "SELECT COUNT(*) FROM (SELECT MES FROM MARTS.PRODUCAO_X_META GROUP BY MES HAVING SUM(META) = 0)", True),
    ("contratos sem gerente abaixo de 0,5%",
     "SELECT IFF(DIV0(SUM(IFF(GERENTE_ID = -1, 1, 0)), COUNT(*)) > 0.005, 1, 0) FROM DW.FATO_PRODUCAO", False),
    ("taxas dentro da faixa esperada (0,5% a 10% a.m.)",
     "SELECT COUNT(*) FROM DW.FATO_PRODUCAO WHERE TAXA_AM IS NOT NULL AND (TAXA_AM < 0.5 OR TAXA_AM > 10)", False),
]


def rodar_checagens(dw) -> list[dict]:
    resultado = []
    for nome, sql, critica in CHECAGENS:
        valor = int(dw.consultar(sql).iloc[0, 0])
        resultado.append({"nome": nome, "ok": valor == 0, "critica": critica, "detalhe": f"{valor} ocorrências"})
    return resultado
