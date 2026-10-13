"""
Testa os modelos SQL com uma base pequena e "suja", montada à mão, num DuckDB em memória.
Cada caso reproduz um problema real das extrações do core.
"""

import pandas as pd
import pytest

from pipeline import DuckDB, transformar
from qualidade import rodar_checagens

CAB = ["CONTRATO_ID", "DATA", "AGENCIA_ID", "GERENTE_ID", "PRODUTO_ID", "CANAL", "FAIXA_ETARIA",
       "VALOR", "TAXA_AM", "PRAZO_MESES", "STATUS", "ARQUIVO_ORIGEM"]


@pytest.fixture(scope="module")
def dw():
    contratos = pd.DataFrame([
        ["CT1", "05/01/2026", "1", "10", "1", "APP", "65+", "1000,50", "1,80", "84", "APROVADO", "contratos_2026_01.csv"],
        ["CT1", "05/01/2026", "1", "10", "1", "APP", "65+", "1000,50", "1,80", "84", "APROVADO", "contratos_2026_01.csv"],  # duplicado
        ["CT2", "06/01/2026", "1", "", "1", "agencia", "50-64", "2000,00", "1,70", "84", "APROVADO", "contratos_2026_01.csv"],  # sem gerente
        ["CT3", "07/01/2026", "2", "11", "2", "Investimentos", "30-49", "5000,00", "", "0", "APROVADO", "contratos_2026_01.csv"],
        ["CT4", "03/02/2026", "2", "11", "1", "corban", "65+", "3000,00", "1,75", "84", "CANCELADO", "contratos_2026_02.csv"],  # cancelado
        ["CT5", "04/02/2026", "2", "11", "1", "IB", "65+", "1500,00", "1,82", "84", "APROVADO", "contratos_2026_02.csv"],
    ], columns=CAB)
    contratos.loc[3, "CANAL"] = "Televendas"
    base = DuckDB(":memory:")
    base.carregar(contratos, "RAW.CONTRATOS")
    base.carregar(pd.DataFrame({"AGENCIA_ID": ["1", "2"], "AGENCIA": ["Centro", "Norte"], "CIDADE": ["BH", "BH"],
                                "REGIONAL": ["BH Metropolitana", "BH Metropolitana"], "REGIONAL_ID": ["1", "1"]}), "RAW.AGENCIAS")
    base.carregar(pd.DataFrame({"GERENTE_ID": ["10", "11"], "GERENTE": ["Ana", "Bruno"], "AGENCIA_ID": ["1", "2"], "CARTEIRA": ["PF", "PF"]}), "RAW.GERENTES")
    base.carregar(pd.DataFrame({"PRODUTO_ID": ["1", "2"], "PRODUTO": ["Consignado INSS", "Investimentos"], "SEGMENTO": ["PF", "PF"],
                                "PRAZO_PADRAO_MESES": ["84", "0"]}), "RAW.PRODUTOS")
    base.carregar(pd.DataFrame({"MES": ["2026-01", "2026-01", "2026-02"], "AGENCIA_ID": ["1", "2", "2"], "PRODUTO_ID": ["1", "2", "1"],
                                "META": ["2500", "4000", "2000"], "REGIONAL": ["x"] * 3, "AGENCIA": ["x"] * 3}), "RAW.METAS")
    transformar(base)
    return base


def valor(dw, sql):
    return dw.consultar(sql).iloc[0, 0]


def test_remove_duplicidade(dw):
    assert valor(dw, "SELECT COUNT(*) FROM STAGING.CONTRATOS") == 5


def test_converte_decimal_com_virgula(dw):
    assert float(valor(dw, "SELECT VALOR FROM STAGING.CONTRATOS WHERE CONTRATO_ID = 'CT1'")) == 1000.50


def test_padroniza_canais(dw):
    canais = set(dw.consultar("SELECT DISTINCT CANAL FROM STAGING.CONTRATOS").iloc[:, 0])
    assert canais == {"App", "Agência", "Central de Atendimento", "Correspondente", "Internet Banking"}


def test_contrato_sem_gerente_vai_para_membro_desconhecido(dw):
    assert valor(dw, "SELECT GERENTE_ID FROM DW.FATO_PRODUCAO WHERE CONTRATO_ID = 'CT2'") == -1


def test_cancelado_fica_fora_da_producao(dw):
    assert valor(dw, "SELECT COUNT(*) FROM DW.FATO_PRODUCAO WHERE CONTRATO_ID = 'CT4'") == 0


def test_atingimento_por_mes(dw):
    df = dw.consultar("SELECT MES, SUM(PRODUCAO) P, SUM(META) M FROM MARTS.PRODUCAO_X_META GROUP BY MES ORDER BY MES")
    assert [round(float(p), 2) for p in df.P] == [8000.50, 1500.00]   # jan: 1000,50 + 2000 + 5000; fev: só o aprovado
    assert [round(float(m)) for m in df.M] == [6500, 2000]


def test_digital_inclui_app_e_internet_banking(dw):
    dig = valor(dw, "SELECT SUM(PRODUCAO_DIGITAL) FROM MARTS.PRODUCAO_X_META")
    assert round(float(dig), 2) == 2500.50


def test_checagens_de_qualidade_passam(dw):
    falhas = [c["nome"] for c in rodar_checagens(dw) if not c["ok"] and c["critica"]]
    assert falhas == []
