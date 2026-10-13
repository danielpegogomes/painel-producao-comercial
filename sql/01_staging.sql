-- STAGING: padroniza tipos, corrige a grafia dos canais e remove as duplicidades da extração.

CREATE OR REPLACE TABLE STAGING.CONTRATOS AS
SELECT
  CONTRATO_ID,
  TO_DATE(DATA, 'DD/MM/YYYY')                                  AS DATA_CONTRATACAO,
  TRY_TO_NUMBER(AGENCIA_ID)                                    AS AGENCIA_ID,
  TRY_TO_NUMBER(GERENTE_ID)                                    AS GERENTE_ID,
  TRY_TO_NUMBER(PRODUTO_ID)                                    AS PRODUTO_ID,
  CASE
    WHEN LOWER(TRIM(CANAL)) IN ('app', 'app mobile', 'aplicativo')                     THEN 'App'
    WHEN LOWER(TRIM(CANAL)) IN ('internet banking', 'ib')                              THEN 'Internet Banking'
    WHEN LOWER(TRIM(CANAL)) IN ('agencia', 'agência')                                  THEN 'Agência'
    WHEN LOWER(TRIM(CANAL)) IN ('correspondente', 'correspondente bancário', 'corban') THEN 'Correspondente'
    WHEN LOWER(TRIM(CANAL)) IN ('central', 'central de atendimento', 'televendas')     THEN 'Central de Atendimento'
    ELSE 'Não identificado'
  END                                                          AS CANAL,
  FAIXA_ETARIA,
  TRY_TO_NUMBER(REPLACE(VALOR, ',', '.'), 18, 2)               AS VALOR,
  TRY_TO_NUMBER(REPLACE(NULLIF(TAXA_AM, ''), ',', '.'), 6, 2)  AS TAXA_AM,
  TRY_TO_NUMBER(PRAZO_MESES)                                   AS PRAZO_MESES,
  UPPER(TRIM(STATUS))                                          AS STATUS,
  ARQUIVO_ORIGEM
FROM RAW.CONTRATOS
QUALIFY ROW_NUMBER() OVER (PARTITION BY CONTRATO_ID ORDER BY ARQUIVO_ORIGEM) = 1;

CREATE OR REPLACE TABLE STAGING.METAS AS
SELECT
  TO_DATE(MES || '-01', 'YYYY-MM-DD') AS MES,
  TRY_TO_NUMBER(AGENCIA_ID)           AS AGENCIA_ID,
  TRY_TO_NUMBER(PRODUTO_ID)           AS PRODUTO_ID,
  TRY_TO_NUMBER(META, 18, 2)          AS META
FROM RAW.METAS;
