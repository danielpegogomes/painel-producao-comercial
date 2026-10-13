"""
Pipeline de dados da produção comercial: extrai, carrega, transforma e valida.

  1. EXTRAÇÃO   lê as extrações mensais do core (CSV) e a planilha de metas (Excel)
  2. CARGA      grava tudo, sem alterar nada, na camada RAW do warehouse
  3. TRANSFORMA executa os modelos SQL (STAGING → DW → MARTS), escritos no dialeto do Snowflake
  4. VALIDA     roda as checagens de qualidade e interrompe se alguma regra crítica falhar
  5. PUBLICA    exporta os marts (Parquet/CSV para o Power BI) e a base do painel web

Destinos:
  --destino duckdb     (padrão) warehouse local em data/warehouse.duckdb; o SQL do Snowflake
                       é traduzido para o DuckDB com sqlglot, então o mesmo código roda nos dois
  --destino snowflake  usa as variáveis SNOWFLAKE_ACCOUNT, SNOWFLAKE_USER, SNOWFLAKE_PASSWORD,
                       SNOWFLAKE_WAREHOUSE e SNOWFLAKE_DATABASE (ver .env.exemplo)

Uso:  python src/pipeline.py [--destino duckdb|snowflake]
"""

from __future__ import annotations

import argparse
import logging
import os
import time
from pathlib import Path

import pandas as pd
import sqlglot

from qualidade import CHECAGENS, rodar_checagens
from exportar_painel import exportar_painel

RAIZ = Path(__file__).resolve().parents[1]
RAW_DIR = RAIZ / "data" / "raw"
PLAN_DIR = RAIZ / "data" / "planejamento"
MARTS_DIR = RAIZ / "data" / "marts"
SQL_DIR = RAIZ / "sql"
MODELOS = ["01_staging.sql", "02_dimensoes.sql", "03_fatos.sql", "04_marts.sql"]
SCHEMAS = ["RAW", "STAGING", "DW", "MARTS"]

log = logging.getLogger("pipeline")


class DuckDB:
    nome = "DuckDB (local)"

    def __init__(self, caminho: str | None = None):
        import duckdb
        self.con = duckdb.connect(caminho or str(RAIZ / "data" / "warehouse.duckdb"))
        for s in SCHEMAS:
            self.con.execute(f"CREATE SCHEMA IF NOT EXISTS {s}")

    def carregar(self, df: pd.DataFrame, tabela: str):
        self.con.register("_df", df)
        self.con.execute(f"CREATE OR REPLACE TABLE {tabela} AS SELECT * FROM _df")
        self.con.unregister("_df")

    def executar(self, sql_snowflake: str):
        for stmt in sqlglot.transpile(sql_snowflake, read="snowflake", write="duckdb"):
            self.con.execute(stmt)

    def consultar(self, sql: str) -> pd.DataFrame:
        sql = sqlglot.transpile(sql, read="snowflake", write="duckdb")[0]
        return self.con.execute(sql).df()


class Snowflake:
    nome = "Snowflake"

    def __init__(self):
        import snowflake.connector  # pip install snowflake-connector-python[pandas]
        self.con = snowflake.connector.connect(
            account=os.environ["SNOWFLAKE_ACCOUNT"], user=os.environ["SNOWFLAKE_USER"],
            password=os.environ["SNOWFLAKE_PASSWORD"], warehouse=os.environ.get("SNOWFLAKE_WAREHOUSE", "WH_ANALYTICS"),
            database=os.environ.get("SNOWFLAKE_DATABASE", "BANCO_HORIZONTE"),
        )
        for s in SCHEMAS:
            self.con.cursor().execute(f"CREATE SCHEMA IF NOT EXISTS {s}")

    def carregar(self, df: pd.DataFrame, tabela: str):
        from snowflake.connector.pandas_tools import write_pandas
        schema, nome = tabela.split(".")
        write_pandas(self.con, df, nome, schema=schema, auto_create_table=True, overwrite=True, quote_identifiers=False)

    def executar(self, sql_snowflake: str):
        for cur in self.con.execute_string(sql_snowflake):
            cur.close()

    def consultar(self, sql: str) -> pd.DataFrame:
        return self.con.cursor().execute(sql).fetch_pandas_all()


def extrair() -> dict[str, pd.DataFrame]:
    arquivos = sorted(RAW_DIR.glob("contratos_*.csv"))
    partes = []
    for arq in arquivos:
        df = pd.read_csv(arq, sep=";", dtype=str, keep_default_na=False)
        df["ARQUIVO_ORIGEM"] = arq.name
        partes.append(df)
    contratos = pd.concat(partes, ignore_index=True)
    contratos.columns = [c.upper() for c in contratos.columns]
    log.info("extração: %d arquivos do core, %s linhas", len(arquivos), f"{len(contratos):,}".replace(",", "."))

    metas = pd.concat(pd.read_excel(PLAN_DIR / "metas_comerciais.xlsx", sheet_name=None, dtype=str).values(), ignore_index=True)
    metas.columns = [c.upper() for c in metas.columns]
    log.info("extração: planilha de metas, %d linhas em %d abas", len(metas), metas.MES.str[:4].nunique())

    cad = {n: pd.read_csv(RAW_DIR / f"cadastro_{n}.csv", sep=";", dtype=str) for n in ("agencias", "gerentes", "produtos")}
    for df in cad.values():
        df.columns = [c.upper() for c in df.columns]
    return {"RAW.CONTRATOS": contratos, "RAW.METAS": metas, "RAW.AGENCIAS": cad["agencias"],
            "RAW.GERENTES": cad["gerentes"], "RAW.PRODUTOS": cad["produtos"]}


def transformar(dw):
    for modelo in MODELOS:
        t = time.perf_counter()
        dw.executar((SQL_DIR / modelo).read_text(encoding="utf-8"))
        log.info("transformação: %s em %.1fs", modelo, time.perf_counter() - t)


def publicar(dw):
    MARTS_DIR.mkdir(parents=True, exist_ok=True)
    for tabela in ("PRODUCAO_X_META", "MIX_CANAIS", "RANKING_REGIONAL_YTD", "GERENTES_MENSAL"):
        df = dw.consultar(f"SELECT * FROM MARTS.{tabela}")
        df.to_parquet(MARTS_DIR / f"{tabela.lower()}.parquet", index=False)
        df.to_csv(MARTS_DIR / f"{tabela.lower()}.csv", index=False, sep=";", decimal=",", encoding="utf-8-sig")
        log.info("publicação: MARTS.%s → %d linhas (Parquet + CSV para o Power BI)", tabela, len(df))
    exportar_painel(dw, RAIZ / "dashboard" / "dados.json")
    log.info("publicação: base do painel web atualizada")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--destino", choices=["duckdb", "snowflake"], default="duckdb")
    args = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(levelname)-7s %(message)s", datefmt="%H:%M:%S")

    inicio = time.perf_counter()
    dw = DuckDB() if args.destino == "duckdb" else Snowflake()
    log.info("destino: %s", dw.nome)

    for tabela, df in extrair().items():
        dw.carregar(df, tabela)
        log.info("carga: %s (%s linhas)", tabela, f"{len(df):,}".replace(",", "."))

    transformar(dw)

    resultado = rodar_checagens(dw)
    for c in resultado:
        nivel = logging.INFO if c["ok"] else (logging.ERROR if c["critica"] else logging.WARNING)
        log.log(nivel, "qualidade: %-48s %s", c["nome"], "ok" if c["ok"] else f"FALHOU ({c['detalhe']})")
    if any(not c["ok"] and c["critica"] for c in resultado):
        raise SystemExit("Checagem crítica de qualidade falhou: publicação interrompida.")
    log.info("qualidade: %d de %d checagens aprovadas", sum(c["ok"] for c in resultado), len(CHECAGENS))

    publicar(dw)
    log.info("pipeline concluído em %.1fs", time.perf_counter() - inicio)


if __name__ == "__main__":
    main()
