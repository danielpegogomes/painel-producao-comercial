"""
Gera as bases de origem de um banco fictício (Banco Horizonte) para o projeto.

Simula o que chega para a área de dados no dia a dia:
  - extrações mensais do core bancário em CSV (com os problemas reais de origem:
    decimal com vírgula, datas em texto, canais escritos de jeitos diferentes,
    registros duplicados e gerente em branco);
  - cadastros de agências, gerentes e produtos;
  - a planilha de metas da área de planejamento, em Excel.

Os dados são sintéticos, mas seguem comportamentos plausíveis de um banco de
varejo focado no público 50+: consignado INSS como carro-chefe, migração para o
digital, sazonalidade e diferenças de desempenho entre regionais.

Uso:  python src/gerar_dados.py [--seed 42]
"""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
import pandas as pd

RAIZ = Path(__file__).resolve().parents[1]
RAW = RAIZ / "data" / "raw"
PLAN = RAIZ / "data" / "planejamento"

INICIO = pd.Timestamp("2024-01-01")
FIM = pd.Timestamp("2026-09-30")

REGIONAIS = {
    # regional: (cidades, peso no volume, desempenho em 2026 frente ao planejado)
    "BH Metropolitana": (["Belo Horizonte", "Contagem", "Betim", "Nova Lima", "Santa Luzia", "Ribeirão das Neves", "Sabará", "Vespasiano"], 1.00, 1.02),
    "Triângulo Mineiro": (["Uberlândia", "Uberaba", "Araguari", "Ituiutaba", "Patos de Minas", "Araxá"], 0.62, 1.12),
    "Norte de Minas": (["Montes Claros", "Janaúba", "Pirapora", "Januária", "Bocaiúva", "Salinas"], 0.48, 0.81),
    "Zona da Mata": (["Juiz de Fora", "Muriaé", "Ubá", "Viçosa", "Cataguases", "Leopoldina"], 0.52, 0.97),
    "Sul de Minas": (["Poços de Caldas", "Pouso Alegre", "Varginha", "Lavras", "Itajubá", "Passos"], 0.55, 1.04),
    "Vale do Aço e Leste": (["Ipatinga", "Governador Valadares", "Coronel Fabriciano", "Teófilo Otoni", "Caratinga"], 0.45, 0.93),
    "Centro-Oeste": (["Goiânia", "Anápolis", "Rio Verde", "Brasília", "Cuiabá", "Várzea Grande"], 0.58, 1.06),
    "Nordeste": (["Salvador", "Feira de Santana", "Vitória da Conquista", "Itabuna", "Maceió", "Juazeiro"], 0.50, 0.95),
}

PRODUTOS = [
    # id, nome, segmento, ticket mediano, dispersão, taxa a.m. (min, max), prazo, peso, crescimento a.a., % digital (jan/24 -> set/26)
    (1, "Consignado INSS", "PF", 6_800, 0.55, (1.66, 1.85), 84, 1.00, 0.24, (0.70, 0.87)),
    (2, "Consignado Público", "PF", 9_500, 0.60, (1.55, 1.98), 96, 0.30, 0.12, (0.62, 0.80)),
    (3, "Cartão Consignado", "PF", 2_100, 0.45, (2.40, 2.89), 0, 0.42, 0.18, (0.66, 0.84)),
    (4, "Crédito Pessoal", "PF", 3_600, 0.70, (3.90, 6.90), 24, 0.36, 0.09, (0.58, 0.79)),
    (5, "Investimentos", "PF", 24_000, 0.95, (None, None), 0, 0.075, 0.30, (0.74, 0.90)),
    (6, "Seguros", "PF", 1_150, 0.50, (None, None), 12, 0.30, 0.15, (0.40, 0.63)),
    (7, "Capital de Giro", "PJ", 78_000, 0.80, (1.75, 2.60), 24, 0.028, 0.10, (0.18, 0.33)),
    (8, "Antecipação de Recebíveis", "PJ", 32_000, 0.85, (1.45, 2.15), 3, 0.045, 0.14, (0.35, 0.58)),
]

CANAIS_DIGITAIS = ["App", "Internet Banking"]
CANAIS_FISICOS = ["Agência", "Correspondente", "Central de Atendimento"]
# Como cada canal aparece na extração (a origem não é padronizada)
GRAFIAS = {
    "App": ["APP", "App", "app mobile", "Aplicativo"],
    "Internet Banking": ["INTERNET BANKING", "Internet Banking", "IB"],
    "Agência": ["AGENCIA", "Agência", "agencia"],
    "Correspondente": ["CORRESPONDENTE", "Correspondente Bancário", "corban"],
    "Central de Atendimento": ["CENTRAL", "Central de Atendimento", "Televendas"],
}

NOMES = ("Ana Bruno Carla Daniel Eduarda Felipe Gabriela Henrique Isabela João Karina Lucas Mariana "
         "Nathália Otávio Patrícia Rafael Sabrina Thiago Vanessa Wagner Yasmin Rodrigo Juliana Marcelo "
         "Fernanda Gustavo Letícia Paulo Renata Vinícius Aline Leonardo Camila Diego Priscila").split()
SOBRENOMES = ("Silva Souza Oliveira Santos Pereira Lima Carvalho Ferreira Rodrigues Almeida Costa Gomes "
              "Martins Araújo Ribeiro Barbosa Rocha Dias Moreira Teixeira Cardoso Mendes Freitas Nunes "
              "Vieira Campos Pinto Moura Duarte Fonseca").split()


def sazonalidade(mes: pd.Timestamp) -> float:
    """Fator mensal: janeiro fraco, antecipação do 13º do INSS (abr/mai), pico de fim de ano em crédito."""
    base = {1: 0.84, 2: 0.90, 3: 1.00, 4: 1.08, 5: 1.10, 6: 0.98, 7: 1.00, 8: 1.03, 9: 1.01, 10: 1.04, 11: 1.07, 12: 0.95}
    return base[mes.month]


def gerar_cadastros(rng: np.random.Generator):
    agencias, gerentes = [], []
    ag_id, ger_id = 1001, 5001
    for reg_id, (regional, (cidades, peso, _)) in enumerate(REGIONAIS.items(), start=1):
        for cidade in cidades:
            n_ag = 3 if cidade in ("Belo Horizonte", "Goiânia", "Salvador", "Uberlândia") else 1
            for k in range(n_ag):
                nome = f"{cidade}" + (f" {['Centro', 'Savassi', 'Barreiro', 'Pampulha', 'Norte', 'Sul'][k]}" if n_ag > 1 else "")
                porte = rng.choice([0.7, 1.0, 1.3], p=[0.35, 0.45, 0.20])
                agencias.append((ag_id, nome, cidade, regional, reg_id, float(porte * peso)))
                for _ in range(int(rng.integers(3, 6))):
                    gerentes.append((ger_id, f"{rng.choice(NOMES)} {rng.choice(SOBRENOMES)}", ag_id,
                                     rng.choice(["PF", "PF", "PF", "PJ"]), float(rng.normal(1.0, 0.18))))
                    ger_id += 1
                ag_id += 1
    ag = pd.DataFrame(agencias, columns=["agencia_id", "agencia", "cidade", "regional", "regional_id", "peso"])
    ge = pd.DataFrame(gerentes, columns=["gerente_id", "gerente", "agencia_id", "carteira", "eficiencia"])
    pr = pd.DataFrame([(p[0], p[1], p[2], p[6]) for p in PRODUTOS], columns=["produto_id", "produto", "segmento", "prazo_padrao_meses"])
    return ag, ge, pr


def gerar_contratos(rng, ag, ge, meses):
    """Um DataFrame por mês, já no formato 'sujo' da extração do core."""
    ger_por_ag = {a: g for a, g in ge.groupby("agencia_id")}
    total_meses = len(meses)
    out = {}
    seq = 1
    for i, mes in enumerate(meses):
        dias = pd.date_range(mes, mes + pd.offsets.MonthEnd(0), freq="D")
        uteis = dias[dias.dayofweek < 5]
        partes = []
        t = i / max(total_meses - 1, 1)
        for p in PRODUTOS:
            pid, nome, seg, ticket, disp, taxa, prazo, peso, cresc, dig = p
            anos = (mes - INICIO).days / 365.25
            fator_tempo = (1 + cresc) ** anos
            # redução do teto de juros do consignado em mar/25: um mês de produção mais fraca
            choque = 0.84 if (pid in (1, 3) and mes == pd.Timestamp("2025-03-01")) else 1.0
            for _, a in ag.iterrows():
                desemp = REGIONAIS[a.regional][2] if mes.year == 2026 else 1.0
                desemp = 1 + (desemp - 1) * (0.6 if mes.year == 2026 and mes.month < 4 else 1.0)
                lam = 200 * peso * a.peso * fator_tempo * sazonalidade(mes) * choque * desemp
                n = rng.poisson(lam)
                if n == 0:
                    continue
                gs = ger_por_ag[a.agencia_id]
                gs = gs[gs.carteira == seg] if (gs.carteira == seg).any() else gs
                pesos = np.clip(gs.eficiencia.to_numpy(), 0.3, None)
                gerente = rng.choice(gs.gerente_id.to_numpy(), size=n, p=pesos / pesos.sum())
                valor = np.round(ticket * rng.lognormal(0, disp, n) * (1 + 0.04 * anos), 2)
                pdig = dig[0] + (dig[1] - dig[0]) * t
                digital = rng.random(n) < pdig
                canal = np.where(digital, rng.choice(CANAIS_DIGITAIS, n, p=[0.8, 0.2]),
                                 rng.choice(CANAIS_FISICOS, n, p=[0.55, 0.33, 0.12] if seg == "PF" else [0.9, 0.0, 0.1]))
                taxa_am = np.round(rng.uniform(*taxa, n), 2) if taxa[0] else np.full(n, np.nan)
                faixa = rng.choice(["18-29", "30-49", "50-64", "65+"], n,
                                   p=[0.04, 0.16, 0.38, 0.42] if pid in (1, 3) else [0.12, 0.38, 0.30, 0.20])
                partes.append(pd.DataFrame({
                    "data": rng.choice(uteis, n),
                    "agencia_id": a.agencia_id, "gerente_id": gerente, "produto_id": pid, "canal": canal,
                    "faixa_etaria": faixa, "valor": valor, "taxa_am": taxa_am, "prazo_meses": prazo,
                    "status": rng.choice(["APROVADO", "CANCELADO"], n, p=[0.972, 0.028]),
                }))
        df = pd.concat(partes, ignore_index=True).sort_values("data", kind="stable").reset_index(drop=True)
        df.insert(0, "contrato_id", [f"CT{seq + k:09d}" for k in range(len(df))])
        seq += len(df)
        out[mes] = df
    return out


def sujar(df: pd.DataFrame, rng) -> pd.DataFrame:
    """Aplica os problemas típicos de uma extração de sistema legado."""
    d = df.copy()
    d["canal"] = [rng.choice(GRAFIAS[c]) for c in d.canal]
    d["data"] = pd.to_datetime(d.data).dt.strftime("%d/%m/%Y")
    d["valor"] = d.valor.map(lambda v: f"{v:.2f}".replace(".", ","))
    d["taxa_am"] = d.taxa_am.map(lambda v: "" if pd.isna(v) else f"{v:.2f}".replace(".", ","))
    sem_gerente = rng.random(len(d)) < 0.002
    d["gerente_id"] = d.gerente_id.astype("Int64")
    d.loc[sem_gerente, "gerente_id"] = pd.NA
    dup = d.sample(frac=0.003, random_state=int(rng.integers(1e9)))
    return pd.concat([d, dup]).sort_index(kind="stable").reset_index(drop=True)


def gerar_metas(contratos: dict, ag: pd.DataFrame) -> pd.DataFrame:
    """Metas mensais por agência e produto: tendência do ano anterior + crescimento planejado."""
    base = pd.concat(contratos.values())
    base = base[base.status == "APROVADO"].copy()
    base["mes"] = pd.to_datetime(base.data).dt.to_period("M").dt.to_timestamp()
    real = base.groupby(["mes", "agencia_id", "produto_id"]).valor.sum().rename("realizado").reset_index()
    # tendência: média móvel de 3 meses do realizado, por agência e produto (tira o ruído do mês isolado)
    real = real.sort_values("mes")
    real["tendencia"] = (real.groupby(["agencia_id", "produto_id"]).realizado
                         .transform(lambda s: s.rolling(3, center=True, min_periods=1).mean()))
    linhas = []
    # meta = tendência do mesmo mês do ano anterior × crescimento planejado
    # (2024 não tem ano anterior na base: o planejamento parte da própria tendência, com folga)
    for ano, cresc_plan in ((2024, 1.02), (2025, 1.25), (2026, 1.27)):
        ref = real[real.mes.dt.year == (ano - 1 if ano > 2024 else 2024)]
        for m in range(1, 13):
            mes = pd.Timestamp(year=ano, month=m, day=1)
            if mes > FIM:
                break
            t = ref[ref.mes.dt.month == m][["agencia_id", "produto_id", "tendencia"]].copy()
            t["mes"] = mes
            t["meta"] = (t.tendencia * cresc_plan).round(-3)
            linhas.append(t[["mes", "agencia_id", "produto_id", "meta"]])
    metas = pd.concat(linhas, ignore_index=True)
    return metas.merge(ag[["agencia_id", "agencia", "regional"]], on="agencia_id")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()
    rng = np.random.default_rng(args.seed)
    RAW.mkdir(parents=True, exist_ok=True)
    PLAN.mkdir(parents=True, exist_ok=True)

    ag, ge, pr = gerar_cadastros(rng)
    ag.drop(columns="peso").to_csv(RAW / "cadastro_agencias.csv", index=False, sep=";")
    ge.drop(columns="eficiencia").to_csv(RAW / "cadastro_gerentes.csv", index=False, sep=";")
    pr.to_csv(RAW / "cadastro_produtos.csv", index=False, sep=";")

    meses = pd.date_range(INICIO, FIM, freq="MS")
    contratos = gerar_contratos(rng, ag, ge, meses)
    total = 0
    for mes, df in contratos.items():
        sujo = sujar(df, rng)
        sujo.to_csv(RAW / f"contratos_{mes:%Y_%m}.csv", index=False, sep=";", encoding="utf-8")
        total += len(sujo)

    metas = gerar_metas(contratos, ag)
    with pd.ExcelWriter(PLAN / "metas_comerciais.xlsx") as xw:
        for ano, t in metas.groupby(metas.mes.dt.year):
            t = t.assign(mes=t.mes.dt.strftime("%Y-%m"))
            t[["mes", "regional", "agencia_id", "agencia", "produto_id", "meta"]].to_excel(xw, sheet_name=f"Metas {ano}", index=False)

    print(f"{len(ag)} agências · {len(ge)} gerentes · {len(meses)} arquivos mensais · {total:,} linhas de contratos")


if __name__ == "__main__":
    main()
